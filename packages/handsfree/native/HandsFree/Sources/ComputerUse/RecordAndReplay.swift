import Foundation

enum RecordAndReplayEventKind: String, Codable, Sendable {
    case mouseClick = "mouse_click"
    case scroll = "scroll"
    case keyText = "key_text"
    case appState = "app_state"
}

struct RecordAndReplayEvent: Codable, Equatable, Sendable {
    let timestamp: Date
    let kind: RecordAndReplayEventKind
    let appID: String
    let appName: String
    let windowTitle: String?
    let x: Double?
    let y: Double?
    let text: String?
}

enum RecordAndReplayState: String, Codable, Sendable {
    case recording
    case stopped
}

struct RecordAndReplayStatus: Codable, Equatable, Sendable {
    let sessionID: String
    let state: RecordAndReplayState
    let startedAt: Date
    let endsAt: Date
    let stoppedAt: Date?
    let stopReason: String?
    let metadataPath: String
    let eventsPath: String

    var dictionary: [String: Any] {
        var result: [String: Any] = [
            "ok": true,
            "sessionId": sessionID,
            "state": state.rawValue,
            "startedAt": ISO8601DateFormatter().string(from: startedAt),
            "endsAt": ISO8601DateFormatter().string(from: endsAt),
            "metadataPath": metadataPath,
            "eventsPath": eventsPath,
        ]
        if let stoppedAt {
            result["stoppedAt"] = ISO8601DateFormatter().string(from: stoppedAt)
        }
        if let stopReason { result["stopReason"] = stopReason }
        return result
    }
}

final class RecordAndReplayStore: @unchecked Sendable {
    let rootURL: URL
    private let lock = NSLock()
    private let duration: TimeInterval = 1_800

    init(rootURL: URL = RecordAndReplayStore.defaultRootURL()) {
        self.rootURL = rootURL
    }

    func start(now: Date = Date(), sessionID: String = UUID().uuidString) throws -> RecordAndReplayStatus {
        try lock.withLock {
            if let current = try statusUnlocked(now: now), current.state == .recording {
                return current
            }
            let directory = sessionDirectory(sessionID)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let status = RecordAndReplayStatus(
                sessionID: sessionID,
                state: .recording,
                startedAt: now,
                endsAt: now.addingTimeInterval(duration),
                stoppedAt: nil,
                stopReason: nil,
                metadataPath: metadataURL(sessionID).path,
                eventsPath: eventsURL(sessionID).path
            )
            try writeStatus(status)
            try writePointer(sessionID, to: activePointerURL)
            try writePointer(sessionID, to: latestPointerURL)
            if !FileManager.default.fileExists(atPath: status.eventsPath) {
                try Data().write(to: eventsURL(sessionID), options: .atomic)
            }
            return status
        }
    }

    func append(_ event: RecordAndReplayEvent, sessionID: String) throws {
        try lock.withLock {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            var data = try encoder.encode(event)
            data.append(0x0A)
            let fileURL = eventsURL(sessionID)
            guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
            let handle = try FileHandle(forWritingTo: fileURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        }
    }

    func status(now: Date = Date()) throws -> RecordAndReplayStatus? {
        try lock.withLock { try statusUnlocked(now: now) }
    }

    func stop(now: Date = Date(), reason: String = "user_stopped") throws -> RecordAndReplayStatus? {
        try lock.withLock { try stopUnlocked(now: now, reason: reason) }
    }

    func discard(sessionID: String) throws {
        try lock.withLock {
            let activeID = readPointer(activePointerURL)
            if activeID == sessionID {
                try? FileManager.default.removeItem(at: activePointerURL)
            }
            let latestID = readPointer(latestPointerURL)
            if latestID == sessionID {
                try? FileManager.default.removeItem(at: latestPointerURL)
            }
            let directory = sessionDirectory(sessionID)
            if FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.removeItem(at: directory)
            }
        }
    }

    static func defaultRootURL() -> URL {
        let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("OnMyAgent", isDirectory: true)
            .appendingPathComponent("ComputerUse", isDirectory: true)
            .appendingPathComponent("RecordAndReplay", isDirectory: true)
    }

    private var activePointerURL: URL {
        rootURL.appendingPathComponent("active-session.txt")
    }

    private var latestPointerURL: URL {
        rootURL.appendingPathComponent("latest-session.txt")
    }

    private func sessionDirectory(_ sessionID: String) -> URL {
        rootURL.appendingPathComponent(sessionID, isDirectory: true)
    }

    private func metadataURL(_ sessionID: String) -> URL {
        sessionDirectory(sessionID).appendingPathComponent("metadata.json")
    }

    private func eventsURL(_ sessionID: String) -> URL {
        sessionDirectory(sessionID).appendingPathComponent("events.jsonl")
    }

    private func statusUnlocked(now: Date) throws -> RecordAndReplayStatus? {
        let sessionID = readPointer(activePointerURL) ?? readPointer(latestPointerURL)
        guard let sessionID else { return nil }
        let metadata = metadataURL(sessionID)
        guard FileManager.default.fileExists(atPath: metadata.path) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let status = try decoder.decode(
            RecordAndReplayStatus.self,
            from: Data(contentsOf: metadata)
        )
        if status.state == .recording, now >= status.endsAt {
            return try stopUnlocked(now: status.endsAt, reason: "time_limit")
        }
        return status
    }

    private func stopUnlocked(now: Date, reason: String) throws -> RecordAndReplayStatus? {
        guard let sessionID = readPointer(activePointerURL) else {
            return try statusUnlockedWithoutExpiry()
        }
        let current = try readStatus(sessionID)
        let stopped = RecordAndReplayStatus(
            sessionID: current.sessionID,
            state: .stopped,
            startedAt: current.startedAt,
            endsAt: current.endsAt,
            stoppedAt: now,
            stopReason: reason,
            metadataPath: current.metadataPath,
            eventsPath: current.eventsPath
        )
        try writeStatus(stopped)
        try? FileManager.default.removeItem(at: activePointerURL)
        return stopped
    }

    private func statusUnlockedWithoutExpiry() throws -> RecordAndReplayStatus? {
        guard let sessionID = readPointer(latestPointerURL),
              FileManager.default.fileExists(atPath: metadataURL(sessionID).path) else {
            return nil
        }
        return try readStatus(sessionID)
    }

    private func readStatus(_ sessionID: String) throws -> RecordAndReplayStatus {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(
            RecordAndReplayStatus.self,
            from: Data(contentsOf: metadataURL(sessionID))
        )
    }

    private func writeStatus(_ status: RecordAndReplayStatus) throws {
        try FileManager.default.createDirectory(
            at: metadataURL(status.sessionID).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(status).write(
            to: metadataURL(status.sessionID),
            options: .atomic
        )
    }

    private func readPointer(_ url: URL) -> String? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func writePointer(_ sessionID: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try sessionID.write(to: url, atomically: true, encoding: .utf8)
    }
}
