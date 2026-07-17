import XCTest
@testable import HandsFreeComputerUse

final class AppGuidanceTests: XCTestCase {
    func testBuiltInGuidanceCoversObservedCodexAppSet() {
        let cases = [
            ("com.apple.Music", "Music", "Double-click"),
            ("com.apple.clock", "Clock", "23:59:59"),
            ("notion.id", "Notion", "placeholder"),
            ("com.apple.Numbers", "Numbers", "one row"),
            ("com.tinyspeck.slackmacgap", "Slack", "focused"),
            ("com.spotify.client", "Spotify", "fresh app state"),
            ("com.apple.ScreenContinuity", "iPhone Mirroring", "⌘1"),
        ]

        for (bundleIdentifier, appName, expectedText) in cases {
            let guidance = AppGuidance.instructions(
                bundleIdentifier: bundleIdentifier,
                appName: appName
            )
            XCTAssertNotNil(guidance, appName)
            XCTAssertTrue(guidance?.contains(expectedText) == true, appName)
        }
    }

    func testUnknownAppsDoNotReceiveUnrelatedGuidance() {
        XCTAssertNil(AppGuidance.instructions(
            bundleIdentifier: "com.apple.TextEdit",
            appName: "TextEdit"
        ))
    }
}
