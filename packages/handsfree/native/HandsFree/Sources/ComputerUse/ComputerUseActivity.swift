import Darwin
import Foundation

enum ComputerUseActivityPhase: String, Codable, Equatable, Sendable {
    case inactive
    case ready
    case running
    case paused
    case errored
}

struct ComputerUseActivitySnapshot: Codable, Equatable, Sendable {
    let phase: ComputerUseActivityPhase
    let app: String?
    let reason: String?
    let processID: Int32?
    let updatedAt: Date

    var dictionary: [String: Any] {
        var result: [String: Any] = [
            "phase": phase.rawValue,
            "updatedAt": ISO8601DateFormatter().string(from: updatedAt),
        ]
        if let app { result["app"] = app }
        if let reason { result["reason"] = reason }
        if let processID { result["processId"] = processID }
        return result
    }
}

final class ComputerUseActivityStore: @unchecked Sendable {
    let fileURL: URL
    private let processID: Int32
    private let lock = NSLock()

    init(fileURL: URL = ComputerUseActivityStore.defaultFileURL(), processID: Int32 = getpid()) {
        self.fileURL = fileURL
        self.processID = processID
    }

    func update(phase: ComputerUseActivityPhase, app: String?, reason: String?) throws {
        let snapshot = ComputerUseActivitySnapshot(
            phase: phase,
            app: app,
            reason: reason,
            processID: phase == .inactive ? nil : processID,
            updatedAt: Date()
        )
        try lock.withLock {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(snapshot).write(to: fileURL, options: .atomic)
        }
    }

    func read(processExists: (Int32) -> Bool = ComputerUseActivityStore.processExists) throws -> ComputerUseActivitySnapshot {
        let snapshot: ComputerUseActivitySnapshot = try lock.withLock {
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                return inactiveSnapshot()
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(ComputerUseActivitySnapshot.self, from: Data(contentsOf: fileURL))
        }
        guard let recordedPID = snapshot.processID, processExists(recordedPID) else {
            return inactiveSnapshot()
        }
        return snapshot
    }

    static func defaultFileURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("OnMyAgent", isDirectory: true)
            .appendingPathComponent("ComputerUse", isDirectory: true)
            .appendingPathComponent("activity.json")
    }

    private static func processExists(_ processID: Int32) -> Bool {
        kill(processID, 0) == 0 || errno == EPERM
    }

    private func inactiveSnapshot() -> ComputerUseActivitySnapshot {
        ComputerUseActivitySnapshot(
            phase: .inactive,
            app: nil,
            reason: nil,
            processID: nil,
            updatedAt: Date()
        )
    }
}
