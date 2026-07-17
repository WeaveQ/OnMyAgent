import Foundation
import XCTest
@testable import HandsFreeComputerUse

final class ComputerUseActivityTests: XCTestCase {
    func testActivityStoreRoundTripsCurrentSessionState() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent("activity.json")
        let store = ComputerUseActivityStore(fileURL: file, processID: 42)
        try store.update(phase: .running, app: "TextEdit", reason: nil)

        let snapshot = try store.read(processExists: { $0 == 42 })
        XCTAssertEqual(snapshot.phase, .running)
        XCTAssertEqual(snapshot.app, "TextEdit")
        XCTAssertEqual(snapshot.processID, 42)
    }

    func testDeadProcessActivityBecomesInactive() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = ComputerUseActivityStore(
            fileURL: directory.appendingPathComponent("activity.json"),
            processID: 99
        )
        try store.update(phase: .paused, app: "Notes", reason: "physical_input")
        let snapshot = try store.read(processExists: { _ in false })
        XCTAssertEqual(snapshot.phase, .inactive)
        XCTAssertNil(snapshot.app)
    }
}
