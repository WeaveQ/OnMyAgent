import XCTest
@testable import HandsFreeComputerUse

final class AppshotTests: XCTestCase {
    func testBothCommandKeysTriggerExactlyOnceUntilReleased() {
        var tracker = AppshotShortcutTracker()
        XCTAssertFalse(tracker.update(leftCommandDown: true, rightCommandDown: false))
        XCTAssertTrue(tracker.update(leftCommandDown: true, rightCommandDown: true))
        XCTAssertFalse(tracker.update(leftCommandDown: true, rightCommandDown: true))
        XCTAssertFalse(tracker.update(leftCommandDown: false, rightCommandDown: true))
        XCTAssertTrue(tracker.update(leftCommandDown: true, rightCommandDown: true))
    }

    func testCopyIsLocalized() {
        XCTAssertEqual(AppshotCopy.resolve(["en-US"]).title, "Appshot captured")
        XCTAssertTrue(AppshotCopy.resolve(["zh-Hans"]).title.contains("截图"))
        XCTAssertTrue(AppshotCopy.resolve(["zh-TW"]).title.contains("截圖"))
    }
}
