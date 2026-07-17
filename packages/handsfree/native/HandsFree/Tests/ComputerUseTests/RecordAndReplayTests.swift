import XCTest
@testable import HandsFreeComputerUse

final class RecordAndReplayTests: XCTestCase {
    func testRecordingPromptAndOverlayCopyAreLocalized() {
        XCTAssertEqual(
            RecordAndReplayCopy.resolve(["zh-Hans-CN"]).startRecording,
            "开始录制"
        )
        XCTAssertEqual(
            RecordAndReplayCopy.resolve(["zh-Hant-TW"]).discardRecording,
            "捨棄錄製"
        )
        XCTAssertEqual(
            RecordAndReplayCopy.resolve(["fr-FR"]).recordingTitle,
            "Record & Replay is recording your actions"
        )
    }

    func testStoreStartsIdempotentlyAppendsEventsAndStops() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = RecordAndReplayStore(rootURL: root)
        let startedAt = Date(timeIntervalSince1970: 1_000)

        let first = try store.start(now: startedAt, sessionID: "session-one")
        let second = try store.start(
            now: startedAt.addingTimeInterval(10),
            sessionID: "session-two"
        )
        XCTAssertEqual(first.sessionID, "session-one")
        XCTAssertEqual(second.sessionID, "session-one")
        XCTAssertEqual(first.state, .recording)
        XCTAssertEqual(first.endsAt, startedAt.addingTimeInterval(1_800))
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.metadataPath))

        try store.append(RecordAndReplayEvent(
            timestamp: startedAt,
            kind: .mouseClick,
            appID: "com.apple.TextEdit",
            appName: "TextEdit",
            windowTitle: "Untitled",
            x: 120,
            y: 240,
            text: nil
        ), sessionID: first.sessionID)
        let events = try String(contentsOfFile: first.eventsPath, encoding: .utf8)
        XCTAssertTrue(events.contains("mouse_click"))

        let stopped = try store.stop(now: startedAt.addingTimeInterval(20))
        XCTAssertEqual(stopped?.state, .stopped)
        XCTAssertEqual(stopped?.stoppedAt, startedAt.addingTimeInterval(20))
    }

    func testStatusExpiresRecordingAtThirtyMinutesAndDiscardRemovesIt() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = RecordAndReplayStore(rootURL: root)
        let startedAt = Date(timeIntervalSince1970: 2_000)
        let started = try store.start(now: startedAt, sessionID: "session-expiring")

        let expired = try store.status(now: startedAt.addingTimeInterval(1_801))
        XCTAssertEqual(expired?.state, .stopped)
        XCTAssertEqual(expired?.stopReason, "time_limit")

        try store.discard(sessionID: started.sessionID)
        XCTAssertNil(try store.status(now: startedAt.addingTimeInterval(1_802)))
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: URL(fileURLWithPath: started.metadataPath).deletingLastPathComponent().path
        ))
    }
}
