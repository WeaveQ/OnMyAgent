import AppKit
import CoreServices
import Foundation

struct AppDescriptor: Equatable, Sendable {
    let id: String
    let displayName: String?
    let path: String?
    let lastUsedDate: Date?
    let useCount: Int?
    let isRunning: Bool

    var dictionary: [String: Any] {
        var result: [String: Any] = [
            "id": id,
            "isRunning": isRunning,
        ]
        if let displayName {
            result["displayName"] = displayName
        }
        if let lastUsedDate {
            result["lastUsedDate"] = ISO8601DateFormatter().string(from: lastUsedDate)
        }
        if let useCount {
            result["useCount"] = useCount
        }
        return result
    }
}

enum AppResolution: Equatable, Sendable {
    case match(AppDescriptor)
    case ambiguous([String])
    case notFound
}

enum AppCatalogLogic {
    private static let recentWindow: TimeInterval = 14 * 86_400

    static func resolve(_ query: String, in apps: [AppDescriptor]) -> AppResolution {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .notFound }
        let needle = trimmed.lowercased()

        if let app = apps.first(where: { $0.id.lowercased() == needle }) {
            return .match(app)
        }

        let standardizedPath = NSString(string: trimmed).standardizingPath.lowercased()
        if let app = apps.first(where: {
            guard let path = $0.path else { return false }
            return NSString(string: path).standardizingPath.lowercased() == standardizedPath
        }) {
            return .match(app)
        }

        if let app = apps.first(where: { $0.displayName?.lowercased() == needle }) {
            return .match(app)
        }

        let partialMatches = apps.filter { app in
            app.displayName?.lowercased().contains(needle) == true
                || app.id.lowercased().contains(needle)
        }
        if partialMatches.count == 1, let app = partialMatches.first {
            return .match(app)
        }
        if partialMatches.count > 1 {
            return .ambiguous(partialMatches.map(\.id).sorted())
        }
        return .notFound
    }

    static func merge(
        running: [AppDescriptor],
        recent: [AppDescriptor],
        now: Date
    ) -> [AppDescriptor] {
        let cutoff = now.addingTimeInterval(-recentWindow)
        let recentApps = recent.filter { descriptor in
            guard let lastUsedDate = descriptor.lastUsedDate else { return false }
            return lastUsedDate >= cutoff && lastUsedDate <= now
        }
        let recentByID = Dictionary(recentApps.map { ($0.id, $0) }, uniquingKeysWith: newerDescriptor)
        let runningByID = Dictionary(running.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        let mergedRunning = runningByID.values.map { runningApp in
            guard let recentApp = recentByID[runningApp.id] else { return runningApp }
            return AppDescriptor(
                id: runningApp.id,
                displayName: runningApp.displayName ?? recentApp.displayName,
                path: runningApp.path ?? recentApp.path,
                lastUsedDate: recentApp.lastUsedDate,
                useCount: recentApp.useCount,
                isRunning: true
            )
        }.sorted(by: descriptorOrder)

        let nonRunningRecent = recentByID.values.filter { runningByID[$0.id] == nil }
            .sorted(by: descriptorOrder)
        return mergedRunning + nonRunningRecent
    }

    private static func newerDescriptor(_ lhs: AppDescriptor, _ rhs: AppDescriptor) -> AppDescriptor {
        guard let lhsDate = lhs.lastUsedDate else { return rhs }
        guard let rhsDate = rhs.lastUsedDate else { return lhs }
        return lhsDate >= rhsDate ? lhs : rhs
    }

    private static func descriptorOrder(_ lhs: AppDescriptor, _ rhs: AppDescriptor) -> Bool {
        if lhs.isRunning != rhs.isRunning { return lhs.isRunning }
        switch (lhs.lastUsedDate, rhs.lastUsedDate) {
        case let (left?, right?) where left != right:
            return left > right
        default:
            return (lhs.displayName ?? lhs.id).localizedCaseInsensitiveCompare(
                rhs.displayName ?? rhs.id
            ) == .orderedAscending
        }
    }
}

final class AppCatalog: @unchecked Sendable {
    func descriptors(now: Date = Date()) -> [AppDescriptor] {
        AppCatalogLogic.merge(running: runningDescriptors(), recent: recentDescriptors(), now: now)
    }

    func runningApplication(matching descriptor: AppDescriptor) -> NSRunningApplication? {
        runningApplications().first { application in
            if application.bundleIdentifier == descriptor.id { return true }
            guard let applicationURL = application.bundleURL, let path = descriptor.path else { return false }
            return applicationURL.standardizedFileURL.path == URL(fileURLWithPath: path).standardizedFileURL.path
        }
    }

    func runningApplication(named query: String) throws -> NSRunningApplication {
        let running = runningDescriptors()
        switch AppCatalogLogic.resolve(query, in: running) {
        case .match(let descriptor):
            guard let application = runningApplication(matching: descriptor) else {
                throw ComputerUseError.appNotFound(query)
            }
            return application
        case .ambiguous(let identifiers):
            throw ComputerUseError.ambiguousApp(query, identifiers)
        case .notFound:
            throw ComputerUseError.appNotFound(query)
        }
    }

    func ensureRunning(named query: String, activates: Bool) async throws -> NSRunningApplication {
        if let running = try? runningApplication(named: query) {
            if activates { running.activate() }
            return running
        }

        let descriptor: AppDescriptor
        switch AppCatalogLogic.resolve(query, in: descriptors()) {
        case .match(let match):
            descriptor = match
        case .ambiguous(let identifiers):
            throw ComputerUseError.ambiguousApp(query, identifiers)
        case .notFound:
            guard let fallbackURL = fallbackApplicationURL(named: query) else {
                throw ComputerUseError.appNotFound(query)
            }
            descriptor = makeDescriptor(for: fallbackURL, isRunning: false)
        }

        guard let path = descriptor.path else { throw ComputerUseError.appNotFound(query) }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = activates
        return try await NSWorkspace.shared.openApplication(
            at: URL(fileURLWithPath: path),
            configuration: configuration
        )
    }

    private func runningApplications() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    }

    private func runningDescriptors() -> [AppDescriptor] {
        runningApplications().map { application in
            AppDescriptor(
                id: application.bundleIdentifier ?? application.bundleURL?.path ?? String(application.processIdentifier),
                displayName: application.localizedName,
                path: application.bundleURL?.path,
                lastUsedDate: nil,
                useCount: nil,
                isRunning: true
            )
        }
    }

    private func recentDescriptors() -> [AppDescriptor] {
        let queryString = "kMDItemContentTypeTree == 'com.apple.application-bundle'"
        guard let query = MDQueryCreate(nil, queryString as CFString, nil, nil) else { return [] }
        MDQuerySetSearchScope(query, ["/Applications", "/System/Applications"] as CFArray, 0)
        guard MDQueryExecute(query, CFOptionFlags(kMDQuerySynchronous.rawValue)) else { return [] }

        return (0..<MDQueryGetResultCount(query)).compactMap { index -> AppDescriptor? in
            guard let rawItem = MDQueryGetResultAtIndex(query, index) else { return nil }
            let item = unsafeBitCast(rawItem, to: MDItem.self)
            let path = MDItemCopyAttribute(item, kMDItemPath) as? String
            guard let path else { return nil }
            let id = MDItemCopyAttribute(item, kMDItemCFBundleIdentifier) as? String
            let displayName = MDItemCopyAttribute(item, kMDItemDisplayName) as? String
            let lastUsedDate = MDItemCopyAttribute(item, kMDItemLastUsedDate) as? Date
            let useCount = (MDItemCopyAttribute(item, "kMDItemUseCount" as CFString) as? NSNumber)?.intValue
            return AppDescriptor(
                id: id ?? path,
                displayName: displayName ?? URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent,
                path: path,
                lastUsedDate: lastUsedDate,
                useCount: useCount,
                isRunning: false
            )
        }
    }

    private func fallbackApplicationURL(named query: String) -> URL? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("/"), FileManager.default.fileExists(atPath: trimmed) {
            return URL(fileURLWithPath: trimmed)
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: trimmed) {
            return url
        }
        let candidates = [
            "/Applications/\(trimmed).app",
            "/System/Applications/\(trimmed).app",
            "/Applications/Utilities/\(trimmed).app",
            NSString(string: "~/Applications/\(trimmed).app").expandingTildeInPath,
        ]
        return candidates.map(URL.init(fileURLWithPath:)).first {
            FileManager.default.fileExists(atPath: $0.path)
        }
    }

    private func makeDescriptor(for url: URL, isRunning: Bool) -> AppDescriptor {
        let bundle = Bundle(url: url)
        return AppDescriptor(
            id: bundle?.bundleIdentifier ?? url.path,
            displayName: bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                ?? bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String
                ?? url.deletingPathExtension().lastPathComponent,
            path: url.path,
            lastUsedDate: nil,
            useCount: nil,
            isRunning: isRunning
        )
    }
}
