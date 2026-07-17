import Foundation
import AppKit
import Darwin

struct SkysightEvent: Codable, Equatable, Sendable {
    let timestamp: Date
    let appID: String
    let appName: String
    let windowTitle: String?
    let semanticLabels: [String]
}

enum SkysightSummaryInterval: String, Codable, Sendable {
    case tenMinutes = "10min"
    case sixHours = "6h"
}

struct SkysightActivityArc: Equatable, Sendable {
    let appID: String
    let appName: String
    let windowTitle: String?
    let startedAt: Date
    let endedAt: Date
}

struct SkysightSummary: Sendable {
    let interval: SkysightSummaryInterval
    let startedAt: Date
    let endedAt: Date
    let arcs: [SkysightActivityArc]
    let markdown: String
}

enum SkysightRedactor {
    private static let urlExpression = try? NSRegularExpression(
        pattern: #"https?://[^\s]+"#,
        options: [.caseInsensitive]
    )
    private static let sensitiveExpression = try? NSRegularExpression(
        pattern: #"\b(password|passcode|token|secret|api[ _-]?key|authorization)\b\s*[:=]"#,
        options: [.caseInsensitive]
    )
    private static let promptLikeExpression = try? NSRegularExpression(
        pattern: #"\b(ignore (all |the )?(previous|prior) instructions|system prompt|developer message|you are (chatgpt|an ai)|run this command|execute this)\b"#,
        options: [.caseInsensitive]
    )

    static func safeText(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let fullRange = NSRange(trimmed.startIndex..<trimmed.endIndex, in: trimmed)
        if sensitiveExpression?.firstMatch(in: trimmed, range: fullRange) != nil {
            return "[redacted sensitive text]"
        }
        let redacted = urlExpression?.stringByReplacingMatches(
            in: trimmed,
            range: fullRange,
            withTemplate: "[redacted URL]"
        ) ?? trimmed
        return String(redacted.prefix(160))
    }

    static func safeObservedLabel(_ raw: String) -> String? {
        let safe = safeText(raw)
        guard !safe.isEmpty, safe != "[redacted sensitive text]" else { return nil }
        let range = NSRange(safe.startIndex..<safe.endIndex, in: safe)
        guard promptLikeExpression?.firstMatch(in: safe, range: range) == nil else { return nil }
        return safe
    }
}

enum SkysightSummarizer {
    static func summarize(
        events: [SkysightEvent],
        interval: SkysightSummaryInterval
    ) -> SkysightSummary? {
        let sorted = events.sorted { $0.timestamp < $1.timestamp }
        guard let first = sorted.first, let last = sorted.last else { return nil }

        var arcs: [SkysightActivityArc] = []
        for event in sorted {
            let safeTitle = event.windowTitle.flatMap(SkysightRedactor.safeObservedLabel)
            if let previous = arcs.last,
               previous.appID == event.appID,
               previous.windowTitle == safeTitle {
                arcs[arcs.count - 1] = SkysightActivityArc(
                    appID: previous.appID,
                    appName: previous.appName,
                    windowTitle: previous.windowTitle,
                    startedAt: previous.startedAt,
                    endedAt: event.timestamp
                )
            } else {
                arcs.append(SkysightActivityArc(
                    appID: event.appID,
                    appName: SkysightRedactor.safeText(event.appName),
                    windowTitle: safeTitle,
                    startedAt: event.timestamp,
                    endedAt: event.timestamp
                ))
            }
        }

        let activityLines = arcs.map { arc in
            let minutes = max(1, Int(ceil(arc.endedAt.timeIntervalSince(arc.startedAt) / 60)))
            let window = arc.windowTitle.map { " — \($0)" } ?? ""
            return "- \(arc.appName)\(window) (about \(minutes) min)"
        }
        let markdown = ([
            "## Recent activity",
            "",
            "Chronological local activity summary [skysight memory]",
            "",
        ] + activityLines).joined(separator: "\n")
        return SkysightSummary(
            interval: interval,
            startedAt: first.timestamp,
            endedAt: last.timestamp,
            arcs: arcs,
            markdown: markdown
        )
    }
}

final class SkysightStore: @unchecked Sendable {
    let rootURL: URL
    private let lock = NSLock()

    init(rootURL: URL = SkysightStore.defaultRootURL()) {
        self.rootURL = rootURL
    }

    func append(_ event: SkysightEvent) throws {
        try lock.withLock {
            let eventsDirectory = rootURL.appendingPathComponent("events", isDirectory: true)
            try FileManager.default.createDirectory(
                at: eventsDirectory,
                withIntermediateDirectories: true
            )
            let fileURL = eventsDirectory.appendingPathComponent("\(Self.dayFormatter.string(from: event.timestamp)).jsonl")
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            var data = try encoder.encode(event)
            data.append(0x0A)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                let handle = try FileHandle(forWritingTo: fileURL)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: fileURL, options: .atomic)
            }
        }
    }

    func events(since start: Date) throws -> [SkysightEvent] {
        try lock.withLock {
            let directory = rootURL.appendingPathComponent("events", isDirectory: true)
            guard let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            ) else { return [] }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try files.filter { $0.pathExtension == "jsonl" }.sorted { $0.path < $1.path }
                .flatMap { file -> [SkysightEvent] in
                    let content = try String(contentsOf: file, encoding: .utf8)
                    return content.split(separator: "\n").compactMap { line in
                        guard let data = String(line).data(using: .utf8),
                              let event = try? decoder.decode(SkysightEvent.self, from: data),
                              event.timestamp >= start else { return nil }
                        return event
                    }
                }
                .sorted { $0.timestamp < $1.timestamp }
        }
    }

    func write(_ summary: SkysightSummary) throws -> URL {
        try lock.withLock {
            let resources = rootURL.appendingPathComponent("resources", isDirectory: true)
            try FileManager.default.createDirectory(
                at: resources,
                withIntermediateDirectories: true
            )
            let appSlug = summary.arcs.first.map { slug($0.appName) } ?? "activity"
            let filename = "\(Self.timestampFormatter.string(from: summary.startedAt))-\(randomTag())-\(summary.interval.rawValue)-\(appSlug).md"
            let url = resources.appendingPathComponent(filename)
            try summary.markdown.write(to: url, atomically: true, encoding: .utf8)
            return url
        }
    }

    func recentSummaries(limit: Int = 12) throws -> [String] {
        let resources = rootURL.appendingPathComponent("resources", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: resources,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return [] }
        return try files.filter { $0.pathExtension == "md" }
            .sorted { left, right in
                let leftDate = try? left.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                let rightDate = try? right.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                return (leftDate ?? .distantPast) > (rightDate ?? .distantPast)
            }
            .prefix(max(0, limit))
            .map { try String(contentsOf: $0, encoding: .utf8) }
    }

    @discardableResult
    func prune(before cutoff: Date) throws -> Int {
        try lock.withLock {
            var removed = 0
            for directoryName in ["events", "resources"] {
                let directory = rootURL.appendingPathComponent(directoryName, isDirectory: true)
                guard let files = try? FileManager.default.contentsOfDirectory(
                    at: directory,
                    includingPropertiesForKeys: [.contentModificationDateKey]
                ) else { continue }
                for file in files {
                    let modifiedAt = try file.resourceValues(
                        forKeys: [.contentModificationDateKey]
                    ).contentModificationDate ?? .distantPast
                    if modifiedAt < cutoff {
                        try FileManager.default.removeItem(at: file)
                        removed += 1
                    }
                }
            }
            return removed
        }
    }

    func clearActivityData() throws {
        try lock.withLock {
            for directoryName in ["events", "resources"] {
                let directory = rootURL.appendingPathComponent(directoryName, isDirectory: true)
                if FileManager.default.fileExists(atPath: directory.path) {
                    try FileManager.default.removeItem(at: directory)
                }
            }
        }
    }

    static func defaultRootURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("OnMyAgent", isDirectory: true)
            .appendingPathComponent("ComputerUse", isDirectory: true)
            .appendingPathComponent("Skysight", isDirectory: true)
    }

    private func slug(_ input: String) -> String {
        let allowed = input.lowercased().map { character in
            character.isLetter || character.isNumber ? character : "-"
        }
        return String(allowed).split(separator: "-").filter { !$0.isEmpty }.joined(separator: "-").prefix(48).description
    }

    private func randomTag() -> String {
        String((0..<4).compactMap { _ in "abcdefghijklmnopqrstuvwxyz".randomElement() })
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH-mm-ss"
        return formatter
    }()
}

enum SkysightExclusionScope: String, Codable, Sendable {
    case app
    case website
    case privateBrowsing = "private_browsing"
}

enum SkysightExclusionOperation: String, Codable, Sendable {
    case add
    case remove
}

struct SkysightExclusion: Codable, Equatable, Hashable, Sendable {
    let scope: SkysightExclusionScope
    let value: String?

    init(scope: SkysightExclusionScope, value: String?) {
        self.scope = scope
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.value = scope == .privateBrowsing || trimmed?.isEmpty != false
            ? nil
            : trimmed?.lowercased()
    }

    var dictionary: [String: Any] {
        var result: [String: Any] = ["scope": scope.rawValue]
        if let value { result["value"] = value }
        return result
    }
}

struct SkysightSettings: Codable, Equatable, Sendable {
    var enabled: Bool
    var paused: Bool
    var retentionDays: Int
    var exclusions: [SkysightExclusion]

    static let defaults = SkysightSettings(
        enabled: false,
        paused: false,
        retentionDays: 30,
        exclusions: [SkysightExclusion(scope: .privateBrowsing, value: nil)]
    )

    init(
        enabled: Bool,
        paused: Bool = false,
        retentionDays: Int,
        exclusions: [SkysightExclusion] = []
    ) {
        self.enabled = enabled
        self.paused = paused
        self.retentionDays = retentionDays
        self.exclusions = Self.sorted(exclusions)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        paused = try container.decodeIfPresent(Bool.self, forKey: .paused) ?? false
        retentionDays = try container.decodeIfPresent(Int.self, forKey: .retentionDays) ?? 30
        exclusions = Self.sorted(try container.decodeIfPresent(
            [SkysightExclusion].self,
            forKey: .exclusions
        ) ?? [SkysightExclusion(scope: .privateBrowsing, value: nil)])
    }

    private static func sorted(_ exclusions: [SkysightExclusion]) -> [SkysightExclusion] {
        Array(Set(exclusions)).sorted { left, right in
            if left.scope.rawValue != right.scope.rawValue {
                return left.scope.rawValue < right.scope.rawValue
            }
            return (left.value ?? "") < (right.value ?? "")
        }
    }
}

final class SkysightSettingsStore: @unchecked Sendable {
    let fileURL: URL
    private let lock = NSLock()

    init(fileURL: URL = SkysightStore.defaultRootURL().appendingPathComponent("settings.json")) {
        self.fileURL = fileURL
    }

    func read() throws -> SkysightSettings {
        try lock.withLock {
            guard FileManager.default.fileExists(atPath: fileURL.path) else { return .defaults }
            return try JSONDecoder().decode(
                SkysightSettings.self,
                from: Data(contentsOf: fileURL)
            )
        }
    }

    func setEnabled(_ enabled: Bool) throws {
        try update { settings in
            settings.enabled = enabled
            if !enabled { settings.paused = false }
        }
    }

    func setPaused(_ paused: Bool) throws {
        try update { settings in
            settings.paused = paused
        }
    }

    func updateExclusion(
        operation: SkysightExclusionOperation,
        exclusion: SkysightExclusion
    ) throws {
        try update { settings in
            var values = Set(settings.exclusions)
            if operation == .add { values.insert(exclusion) }
            else { values.remove(exclusion) }
            settings.exclusions = Array(values).sorted { left, right in
                if left.scope.rawValue != right.scope.rawValue {
                    return left.scope.rawValue < right.scope.rawValue
                }
                return (left.value ?? "") < (right.value ?? "")
            }
        }
    }

    private func update(_ change: (inout SkysightSettings) -> Void) throws {
        try lock.withLock {
            var settings: SkysightSettings = {
                guard FileManager.default.fileExists(atPath: fileURL.path),
                      let data = try? Data(contentsOf: fileURL),
                      let decoded = try? JSONDecoder().decode(SkysightSettings.self, from: data) else {
                    return .defaults
                }
                return decoded
            }()
            change(&settings)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try JSONEncoder().encode(settings).write(to: fileURL, options: .atomic)
        }
    }
}

final class SkysightRecorder: @unchecked Sendable {
    private let store: SkysightStore
    private let settingsStore: SkysightSettingsStore
    private let accessibility = AccessibilityService()
    private var lastEventKey: String?
    private var lastEventAt = Date.distantPast

    init(
        store: SkysightStore = SkysightStore(),
        settingsStore: SkysightSettingsStore = SkysightSettingsStore()
    ) {
        self.store = store
        self.settingsStore = settingsStore
    }

    func run() async throws {
        let lease = SkysightRecorderLease()
        guard try lease.acquire() else { return }
        defer { lease.release() }
        var lastTenMinuteSummary = Date()
        var lastSixHourSummary = Date()
        var lastPrune = Date.distantPast
        while try settingsStore.read().enabled {
            let now = Date()
            let currentSettings = try settingsStore.read()
            if currentSettings.paused {
                try await Task.sleep(for: .seconds(1))
                continue
            }
            if now.timeIntervalSince(lastPrune) >= 86_400 {
                let retentionDays = max(1, currentSettings.retentionDays)
                try store.prune(before: now.addingTimeInterval(-Double(retentionDays) * 86_400))
                lastPrune = now
            }
            if let event = captureEvent(
                at: now,
                exclusions: currentSettings.exclusions
            ) {
                let key = "\(event.appID)\u{0}\(event.windowTitle ?? "")"
                if key != lastEventKey || now.timeIntervalSince(lastEventAt) >= 60 {
                    try store.append(event)
                    lastEventKey = key
                    lastEventAt = now
                }
            }
            if now.timeIntervalSince(lastTenMinuteSummary) >= 600 {
                try writeSummary(interval: .tenMinutes, since: now.addingTimeInterval(-600))
                lastTenMinuteSummary = now
            }
            if now.timeIntervalSince(lastSixHourSummary) >= 21_600 {
                try writeSummary(interval: .sixHours, since: now.addingTimeInterval(-21_600))
                lastSixHourSummary = now
            }
            try await Task.sleep(for: .seconds(5))
        }
    }

    private func captureEvent(
        at timestamp: Date,
        exclusions: [SkysightExclusion]
    ) -> SkysightEvent? {
        guard let application = NSWorkspace.shared.frontmostApplication,
              let appID = application.bundleIdentifier ?? application.bundleURL?.path,
              let appName = application.localizedName else { return nil }
        let rawTitle = frontmostWindowTitle(processID: application.processIdentifier)
        guard !isExcluded(
            application: application,
            appID: appID,
            windowTitle: rawTitle,
            exclusions: exclusions
        ) else { return nil }
        let title = rawTitle
            .flatMap(SkysightRedactor.safeObservedLabel)
        let labels: [String] = {
            guard let target = try? accessibility.resolveTarget(appName: appID) else { return [] }
            return accessibility.records(target: target).compactMap { record in
                SkysightRedactor.safeObservedLabel(record.semantic.label)
            }.prefix(24).map { $0 }
        }()
        return SkysightEvent(
            timestamp: timestamp,
            appID: appID,
            appName: appName,
            windowTitle: title,
            semanticLabels: labels
        )
    }

    private func isExcluded(
        application: NSRunningApplication,
        appID: String,
        windowTitle: String?,
        exclusions: [SkysightExclusion]
    ) -> Bool {
        let normalizedAppID = appID.lowercased()
        if exclusions.contains(where: {
            $0.scope == .app && $0.value == normalizedAppID
        }) {
            return true
        }
        if exclusions.contains(where: { $0.scope == .privateBrowsing }),
           let title = windowTitle?.lowercased(),
           title.contains("private browsing")
            || title.contains("incognito")
            || title.contains("inprivate")
            || title.contains("private window") {
            return true
        }
        guard let rawURL = accessibility.currentBrowserURL(application: application),
              let host = URLComponents(string: rawURL)?.host?.lowercased() else {
            return false
        }
        return exclusions.contains { exclusion in
            guard exclusion.scope == .website, let value = exclusion.value else {
                return false
            }
            return host == value || host.hasSuffix(".\(value)")
        }
    }

    private func frontmostWindowTitle(processID: pid_t) -> String? {
        guard let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else { return nil }
        return rawWindows.first { window in
            (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == processID
                && (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        }?[kCGWindowName as String] as? String
    }

    private func writeSummary(interval: SkysightSummaryInterval, since: Date) throws {
        guard let summary = SkysightSummarizer.summarize(
            events: try store.events(since: since),
            interval: interval
        ) else { return }
        _ = try store.write(summary)
    }
}

final class SkysightRecorderLease: @unchecked Sendable {
    let fileURL: URL
    private let processID: Int32
    private let lock = NSLock()
    private var acquired = false

    init(
        fileURL: URL = SkysightStore.defaultRootURL().appendingPathComponent("recorder.lock"),
        processID: Int32 = getpid()
    ) {
        self.fileURL = fileURL
        self.processID = processID
    }

    func acquire() throws -> Bool {
        try lock.withLock {
            if acquired { return true }
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            do {
                try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: false)
            } catch {
                if Self.isRunning(fileURL: fileURL) { return false }
                try? FileManager.default.removeItem(at: fileURL)
                try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: false)
            }
            try "\(processID)\n".write(
                to: Self.ownerURL(fileURL: fileURL),
                atomically: true,
                encoding: .utf8
            )
            acquired = true
            return true
        }
    }

    func release() {
        lock.withLock {
            guard acquired else { return }
            acquired = false
            if Self.owner(fileURL: fileURL) == processID {
                try? FileManager.default.removeItem(at: fileURL)
            }
        }
    }

    static func isRunning(
        fileURL: URL = SkysightStore.defaultRootURL().appendingPathComponent("recorder.lock"),
        processExists: (Int32) -> Bool = { processID in
            kill(processID, 0) == 0 || errno == EPERM
        }
    ) -> Bool {
        guard let owner = owner(fileURL: fileURL) else { return false }
        return processExists(owner)
    }

    private static func owner(fileURL: URL) -> Int32? {
        guard let raw = try? String(contentsOf: ownerURL(fileURL: fileURL), encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        return Int32(raw)
    }

    private static func ownerURL(fileURL: URL) -> URL {
        fileURL.appendingPathComponent("owner")
    }

    deinit { release() }
}
