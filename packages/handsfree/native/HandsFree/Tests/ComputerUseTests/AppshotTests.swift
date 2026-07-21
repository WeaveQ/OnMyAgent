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

    func testAppSlugIsPlainStringNotJoinedSequenceDump() {
        XCTAssertEqual(AppshotCaptureStore.makeAppSlug("OnMyAgent Dev"), "OnMyAgent-Dev")
        XCTAssertEqual(AppshotCaptureStore.makeAppSlug("Safari"), "Safari")
        XCTAssertEqual(AppshotCaptureStore.makeAppSlug("!!!"), "App")
        let slug = AppshotCaptureStore.makeAppSlug("Microsoft Edge")
        XCTAssertFalse(slug.contains("JoinedSequence"))
        XCTAssertFalse(slug.contains("ArraySlice"))
        XCTAssertEqual(slug, "Microsoft-Edge")
    }

    func testFileNameShape() {
        let date = Date(timeIntervalSince1970: 1_721_491_200) // fixed
        let name = AppshotCaptureStore.makeFileName(appName: "OnMyAgent Dev", date: date)
        XCTAssertTrue(name.hasPrefix("Appshot-"))
        XCTAssertTrue(name.hasSuffix("-OnMyAgent-Dev.jpg"))
        XCTAssertFalse(name.contains("JoinedSequence"))
        XCTAssertFalse(name.contains(" "))
    }
}
