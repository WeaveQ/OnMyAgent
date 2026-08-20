import AppKit
import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

private struct FixtureBounds: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    var cgRect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }
}

private struct FixtureState: Decodable {
    let pid: Int32
    let windowNumber: Int
    let bounds: FixtureBounds
    let clickCount: Int
    let typedText: String
    let keyCount: Int
    let scrollCount: Int
    let dragCount: Int
    let applicationBecameActiveCount: Int
    let applicationResignedActiveCount: Int
    let windowBecameKeyCount: Int
    let windowResignedKeyCount: Int
    let applicationIsActive: Bool
    let windowIsKey: Bool
}

final class BackgroundInteractionE2ETests: XCTestCase {
    func testTargetedActionsChangeOnlyTheBackgroundFixture() async throws {
        guard ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_NATIVE_E2E"] == "1" else {
            throw XCTSkip("Set ONMYAGENT_COMPUTER_USE_NATIVE_E2E=1 to run the real macOS background-input test")
        }

        let fixtureURL = try fixtureExecutableURL()
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("onmyagent-computer-use-e2e-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
        let stateURL = temporaryDirectory.appendingPathComponent("state.json")
        let foregroundStateURL = temporaryDirectory.appendingPathComponent("foreground-state.json")

        let fixture = Process()
        fixture.executableURL = fixtureURL
        fixture.arguments = [stateURL.path, "--trace-focus-events"]
        try fixture.run()
        defer {
            if fixture.isRunning {
                fixture.terminate()
                fixture.waitUntilExit()
            }
        }

        let initial = try await waitForState(at: stateURL, label: "initial window") { $0.windowNumber > 0 }
        let foreground = Process()
        foreground.executableURL = fixtureURL
        foreground.arguments = [
            foregroundStateURL.path,
            "--regular",
            "--activate-on-launch",
            "--trace-focus-events",
        ]
        try foreground.run()
        defer {
            if foreground.isRunning {
                foreground.terminate()
                foreground.waitUntilExit()
            }
        }
        let foregroundState = try await waitForState(
            at: foregroundStateURL,
            label: "foreground sentinel"
        ) { $0.windowNumber > 0 }
        try await waitForFrontmostApplication(pid: foregroundState.pid)
        let previousFrontmostPID = foregroundState.pid
        let previousCursor = try XCTUnwrap(CGEvent(source: nil)?.location)
        XCTAssertNotEqual(initial.pid, previousFrontmostPID)

        let physicalInputMonitor = PhysicalInputMonitor()
        try await Task.sleep(for: .milliseconds(100))

        let target = WindowTarget(
            appName: "Background Interaction Fixture",
            pid: initial.pid,
            windowNumber: initial.windowNumber,
            windowTitle: "Background Interaction Fixture",
            bounds: try XCTUnwrap(cgWindowBounds(windowNumber: initial.windowNumber)),
            isFrontmost: false,
            axWindow: nil
        )
        let session = BackgroundInteractionSession(
            previousPID: previousFrontmostPID,
            targetPID: initial.pid
        )
        try session.start()
        defer { session.stop() }
        try await session.establish(target: target)

        let cursorTarget = try XCTUnwrap(AgentCursorTarget(windowTarget: target))
        let cursorStart = CGPoint(x: target.bounds.minX + 80, y: target.bounds.midY)
        let cursorEnd = CGPoint(x: target.bounds.maxX - 80, y: target.bounds.midY)
        await AgentCursorOverlay.shared.move(to: cursorStart, target: cursorTarget, animated: false)
        defer { AgentCursorOverlay.shared.hide() }
        let cursorMotionStarted = ContinuousClock().now
        await AgentCursorOverlay.shared.move(to: cursorEnd, target: cursorTarget)
        let cursorMotionDuration = cursorMotionStarted.duration(to: ContinuousClock().now)
        XCTAssertGreaterThanOrEqual(cursorMotionDuration, .milliseconds(170))

        let cursorState = await AgentCursorOverlay.shared.debugState()
        XCTAssertTrue(cursorState.isVisible)
        XCTAssertEqual(cursorState.targetWindowNumber, initial.windowNumber)
        XCTAssertEqual(try XCTUnwrap(cursorState.point).x, cursorEnd.x, accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(cursorState.point).y, cursorEnd.y, accuracy: 0.5)
        let cursorWindowNumber = try XCTUnwrap(cursorState.windowNumber)
        let orderedWindowNumbers = try XCTUnwrap(CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]]).compactMap {
            ($0[kCGWindowNumber as String] as? NSNumber)?.intValue
        }
        let foregroundIndex = try XCTUnwrap(orderedWindowNumbers.firstIndex(of: foregroundState.windowNumber))
        let cursorIndex = try XCTUnwrap(orderedWindowNumbers.firstIndex(of: cursorWindowNumber))
        let targetIndex = try XCTUnwrap(orderedWindowNumbers.firstIndex(of: initial.windowNumber))
        XCTAssertLessThan(foregroundIndex, cursorIndex)
        XCTAssertLessThan(cursorIndex, targetIndex)

        let center = target.center
        try await session.click(windowNumber: initial.windowNumber, point: center)
        let clicked = try await waitForState(at: stateURL, label: "click") {
            $0.clickCount >= initial.clickCount + 1
        }
        XCTAssertEqual(clicked.clickCount, initial.clickCount + 1)

        try await session.typeText(windowNumber: initial.windowNumber, text: "fixture")
        let typed = try await waitForState(at: stateURL, label: "text input") {
            $0.typedText == initial.typedText + "fixture"
        }
        XCTAssertEqual(typed.keyCount, initial.keyCount + 7)

        try await session.pressKey(windowNumber: initial.windowNumber, combo: "a")
        let keyed = try await waitForState(at: stateURL, label: "key press") {
            $0.typedText == initial.typedText + "fixturea"
        }
        XCTAssertEqual(keyed.keyCount, initial.keyCount + 8)

        try await session.scroll(windowNumber: initial.windowNumber, point: center, deltaX: 0, deltaY: -3)
        let scrolled = try await waitForState(at: stateURL, label: "scroll") {
            $0.scrollCount >= initial.scrollCount + 1
        }
        XCTAssertEqual(scrolled.scrollCount, initial.scrollCount + 1)

        let dragPath = MouseInputGeometry.linearPath(
            from: CGPoint(x: target.bounds.minX + 80, y: target.bounds.midY),
            to: CGPoint(x: target.bounds.maxX - 80, y: target.bounds.midY)
        )
        try await session.drag(windowNumber: initial.windowNumber, path: dragPath)
        let dragged = try await waitForState(at: stateURL, label: "drag") {
            $0.dragCount >= initial.dragCount + 2
        }
        XCTAssertEqual(dragged.dragCount, initial.dragCount + 2)

        XCTAssertEqual(NSWorkspace.shared.frontmostApplication?.processIdentifier, previousFrontmostPID)
        let finalCursor = try XCTUnwrap(CGEvent(source: nil)?.location)
        XCTAssertEqual(finalCursor.x, previousCursor.x, accuracy: 0.5)
        XCTAssertEqual(finalCursor.y, previousCursor.y, accuracy: 0.5)
        XCTAssertFalse(
            physicalInputMonitor.isPaused(),
            "Computer Use must not classify its own process-directed events as physical user input"
        )
        let finalForegroundState = try await waitForState(
            at: foregroundStateURL,
            label: "unchanged foreground focus"
        ) { _ in true }
        XCTAssertEqual(
            finalForegroundState.applicationResignedActiveCount,
            foregroundState.applicationResignedActiveCount
        )
        XCTAssertTrue(finalForegroundState.applicationIsActive)
        XCTAssertTrue(finalForegroundState.windowIsKey)
        if ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_E2E_DEBUG"] == "1",
           let data = try? Data(contentsOf: stateURL),
           let json = String(data: data, encoding: .utf8) {
            print("ONMYAGENT_COMPUTER_USE_E2E_STATE=\(json)")
        }
        if ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_E2E_DEBUG"] == "1",
           let data = try? Data(contentsOf: foregroundStateURL),
           let json = String(data: data, encoding: .utf8) {
            print("ONMYAGENT_COMPUTER_USE_E2E_FOREGROUND_STATE=\(json)")
        }
    }

    private func fixtureExecutableURL() throws -> URL {
        if let explicit = ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_FIXTURE_BINARY"],
           !explicit.isEmpty {
            let url = URL(fileURLWithPath: explicit)
            guard FileManager.default.isExecutableFile(atPath: url.path) else {
                throw XCTSkip("Fixture executable does not exist at \(url.path)")
            }
            return url
        }

        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let candidates = [
            packageRoot.appendingPathComponent(".build/debug/BackgroundInteractionFixture"),
            packageRoot.appendingPathComponent(".build/arm64-apple-macosx/debug/BackgroundInteractionFixture"),
        ]
        guard let fixture = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) else {
            throw XCTSkip("Build BackgroundInteractionFixture before running the native E2E test")
        }
        return fixture
    }

    private func waitForState(
        at url: URL,
        label: String,
        predicate: (FixtureState) -> Bool
    ) async throws -> FixtureState {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        while clock.now < deadline {
            if let data = try? Data(contentsOf: url),
               let state = try? JSONDecoder().decode(FixtureState.self, from: data),
               predicate(state) {
                return state
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        let lastState = (try? Data(contentsOf: url))
            .flatMap { try? JSONDecoder().decode(FixtureState.self, from: $0) }
        if ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_E2E_DEBUG"] == "1",
           let data = try? Data(contentsOf: url),
           let json = String(data: data, encoding: .utf8) {
            print("ONMYAGENT_COMPUTER_USE_E2E_FAILURE_STATE=\(json)")
        }
        XCTFail("Fixture did not publish expected \(label) state. Last state: \(String(describing: lastState))")
        throw CocoaError(.fileReadUnknown)
    }

    private func waitForFrontmostApplication(pid: pid_t) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(3))
        while clock.now < deadline {
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Foreground sentinel did not become the real frontmost application")
        throw CocoaError(.userCancelled)
    }

    private func cgWindowBounds(windowNumber: Int) -> CGRect? {
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionIncludingWindow, .excludeDesktopElements],
            CGWindowID(windowNumber)
        ) as? [[String: Any]],
        let info = windows.first,
        let rawBounds = info[kCGWindowBounds as String] as? [String: Any],
        let x = (rawBounds["X"] as? NSNumber)?.doubleValue,
        let y = (rawBounds["Y"] as? NSNumber)?.doubleValue,
        let width = (rawBounds["Width"] as? NSNumber)?.doubleValue,
        let height = (rawBounds["Height"] as? NSNumber)?.doubleValue else {
            return nil
        }
        return CGRect(x: x, y: y, width: width, height: height)
    }

}
