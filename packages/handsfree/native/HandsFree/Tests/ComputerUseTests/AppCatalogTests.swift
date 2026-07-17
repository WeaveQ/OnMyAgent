import Foundation
import XCTest
@testable import HandsFreeComputerUse

final class AppCatalogTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testResolvesBundleIdentifierPathAndDisplayName() {
        let apps = [
            AppDescriptor(
                id: "com.apple.TextEdit",
                displayName: "TextEdit",
                path: "/System/Applications/TextEdit.app",
                lastUsedDate: nil,
                useCount: nil,
                isRunning: true
            ),
            AppDescriptor(
                id: "com.google.Chrome",
                displayName: "Google Chrome",
                path: "/Applications/Google Chrome.app",
                lastUsedDate: nil,
                useCount: nil,
                isRunning: false
            ),
        ]

        XCTAssertEqual(AppCatalogLogic.resolve("com.apple.TextEdit", in: apps), .match(apps[0]))
        XCTAssertEqual(AppCatalogLogic.resolve("/Applications/Google Chrome.app", in: apps), .match(apps[1]))
        XCTAssertEqual(AppCatalogLogic.resolve("textedit", in: apps), .match(apps[0]))
        XCTAssertEqual(AppCatalogLogic.resolve("Chrome", in: apps), .match(apps[1]))
    }

    func testAmbiguousDisplayNameDoesNotGuess() {
        let apps = [
            AppDescriptor(id: "one", displayName: "Notes Alpha", path: "/Applications/Notes Alpha.app", lastUsedDate: nil, useCount: nil, isRunning: true),
            AppDescriptor(id: "two", displayName: "Notes Beta", path: "/Applications/Notes Beta.app", lastUsedDate: nil, useCount: nil, isRunning: true),
        ]
        XCTAssertEqual(AppCatalogLogic.resolve("Notes", in: apps), .ambiguous(["one", "two"]))
        XCTAssertEqual(AppCatalogLogic.resolve("Missing", in: apps), .notFound)
    }

    func testMergeIncludesRunningAndRecentFourteenDayApps() {
        let running = [
            AppDescriptor(id: "com.apple.TextEdit", displayName: "TextEdit", path: "/System/Applications/TextEdit.app", lastUsedDate: nil, useCount: nil, isRunning: true),
        ]
        let recent = [
            AppDescriptor(id: "com.apple.TextEdit", displayName: "TextEdit", path: "/System/Applications/TextEdit.app", lastUsedDate: now.addingTimeInterval(-60), useCount: 12, isRunning: false),
            AppDescriptor(id: "com.apple.Preview", displayName: "Preview", path: "/System/Applications/Preview.app", lastUsedDate: now.addingTimeInterval(-13 * 86_400), useCount: 4, isRunning: false),
            AppDescriptor(id: "old", displayName: "Old", path: "/Applications/Old.app", lastUsedDate: now.addingTimeInterval(-15 * 86_400), useCount: 2, isRunning: false),
        ]

        let merged = AppCatalogLogic.merge(running: running, recent: recent, now: now)
        XCTAssertEqual(merged.map(\.id), ["com.apple.TextEdit", "com.apple.Preview"])
        XCTAssertEqual(merged[0].lastUsedDate, recent[0].lastUsedDate)
        XCTAssertEqual(merged[0].useCount, 12)
        XCTAssertTrue(merged[0].isRunning)
        XCTAssertFalse(merged[1].isRunning)
    }

    func testDescriptorDictionaryMatchesSkyShape() {
        let descriptor = AppDescriptor(
            id: "com.apple.TextEdit",
            displayName: "TextEdit",
            path: "/System/Applications/TextEdit.app",
            lastUsedDate: Date(timeIntervalSince1970: 1_700_000_000),
            useCount: 8,
            isRunning: true
        )
        let dictionary = descriptor.dictionary
        XCTAssertEqual(dictionary["id"] as? String, "com.apple.TextEdit")
        XCTAssertEqual(dictionary["displayName"] as? String, "TextEdit")
        XCTAssertEqual(dictionary["useCount"] as? Int, 8)
        XCTAssertEqual(dictionary["isRunning"] as? Bool, true)
        XCTAssertNotNil(dictionary["lastUsedDate"] as? String)
        XCTAssertNil(dictionary["path"])
    }
}
