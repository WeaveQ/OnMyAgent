import AppKit
import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

private struct ElectronFixtureState: Decodable {
    let pid: Int32
    let clickCount: Int
    let typedText: String
    let keyCount: Int
    let scrollCount: Int
    let dragCount: Int
}

final class ElectronBackgroundInteractionE2ETests: XCTestCase {
    func testElectronReceivesBackgroundInputWithoutTakingCursorOrForeground() async throws {
        guard ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_NATIVE_E2E"] == "1" else {
            throw XCTSkip("Set ONMYAGENT_COMPUTER_USE_NATIVE_E2E=1 to run the Electron background-input test")
        }

        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        guard let electronURL = electronExecutable(packageRoot: packageRoot) else {
            throw XCTSkip("No repository Electron runtime is available")
        }

        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("onmyagent-electron-computer-use-e2e-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
        let stateURL = temporaryDirectory.appendingPathComponent("state.json")
        let foregroundStateURL = temporaryDirectory.appendingPathComponent("foreground-state.json")
        try writeFixture(to: temporaryDirectory)

        let electron = Process()
        electron.executableURL = electronURL
        electron.arguments = [temporaryDirectory.path]
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "ELECTRON_RUN_AS_NODE")
        environment["ONMYAGENT_ELECTRON_FIXTURE_STATE"] = stateURL.path
        electron.environment = environment
        try electron.run()
        defer {
            if electron.isRunning {
                electron.terminate()
                electron.waitUntilExit()
            }
        }

        let initial = try await waitForState(at: stateURL, label: "Electron launch") { $0.pid > 0 }
        let target = try await waitForWindow(pid: initial.pid)
        let foreground = Process()
        foreground.executableURL = try fixtureExecutableURL(packageRoot: packageRoot)
        foreground.arguments = [foregroundStateURL.path, "--regular", "--activate-on-launch"]
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
        ) { $0.pid > 0 }
        try await waitForFrontmostApplication(pid: foregroundState.pid)
        let previousPID = foregroundState.pid
        let previousCursor = try XCTUnwrap(CGEvent(source: nil)?.location)
        XCTAssertNotEqual(initial.pid, previousPID)

        let session = BackgroundInteractionSession(
            previousPID: previousPID,
            targetPID: initial.pid
        )
        try session.start()
        defer { session.stop() }
        try await session.establish(target: target)

        let clickPoint = CGPoint(x: target.bounds.midX, y: target.bounds.minY + 100)
        try await session.click(windowNumber: try XCTUnwrap(target.windowNumber), point: clickPoint)
        let clicked = try await waitForState(at: stateURL, label: "Electron click") {
            $0.clickCount >= initial.clickCount + 1
        }
        XCTAssertEqual(clicked.clickCount, initial.clickCount + 1)

        try await session.typeText(windowNumber: try XCTUnwrap(target.windowNumber), text: "electron")
        let typed = try await waitForState(at: stateURL, label: "Electron text") {
            $0.typedText == initial.typedText + "electron"
        }
        XCTAssertEqual(typed.keyCount, initial.keyCount + 8)

        try await session.scroll(
            windowNumber: try XCTUnwrap(target.windowNumber),
            point: target.center,
            deltaX: 0,
            deltaY: -3
        )
        let scrolled = try await waitForState(at: stateURL, label: "Electron scroll") {
            $0.scrollCount >= initial.scrollCount + 1
        }
        XCTAssertEqual(scrolled.scrollCount, initial.scrollCount + 1)

        let dragPath = MouseInputGeometry.linearPath(
            from: CGPoint(x: target.bounds.minX + 70, y: target.bounds.midY),
            to: CGPoint(x: target.bounds.maxX - 70, y: target.bounds.midY)
        )
        try await session.drag(windowNumber: try XCTUnwrap(target.windowNumber), path: dragPath)
        let dragged = try await waitForState(at: stateURL, label: "Electron drag") {
            $0.dragCount >= initial.dragCount + 1
        }
        XCTAssertLessThanOrEqual(dragged.dragCount, initial.dragCount + 2)

        XCTAssertEqual(NSWorkspace.shared.frontmostApplication?.processIdentifier, previousPID)
        let finalCursor = try XCTUnwrap(CGEvent(source: nil)?.location)
        XCTAssertEqual(finalCursor.x, previousCursor.x, accuracy: 0.5)
        XCTAssertEqual(finalCursor.y, previousCursor.y, accuracy: 0.5)
    }

    private func electronExecutable(packageRoot: URL) -> URL? {
        let repositoryRoot = packageRoot
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        guard let enumerator = FileManager.default.enumerator(
            at: repositoryRoot.appendingPathComponent("node_modules/.pnpm"),
            includingPropertiesForKeys: [.isExecutableKey],
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }
        for case let url as URL in enumerator where url.path.hasSuffix("/Electron.app/Contents/MacOS/Electron") {
            if FileManager.default.isExecutableFile(atPath: url.path) { return url }
        }
        return nil
    }

    private func fixtureExecutableURL(packageRoot: URL) throws -> URL {
        let candidates = [
            packageRoot.appendingPathComponent(".build/debug/BackgroundInteractionFixture"),
            packageRoot.appendingPathComponent(".build/arm64-apple-macosx/debug/BackgroundInteractionFixture"),
        ]
        return try XCTUnwrap(
            candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }),
            "Build BackgroundInteractionFixture before running the Electron E2E test"
        )
    }

    private func writeFixture(to directory: URL) throws {
        let packageJSON = #"{"name":"onmyagent-computer-use-e2e","version":"1.0.0","main":"main.js"}"#
        let main = #"""
        const { app, BrowserWindow } = require('electron');
        app.whenReady().then(async () => {
          const win = new BrowserWindow({
            x: 160, y: 160, width: 520, height: 360, show: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
          });
          await win.loadFile('index.html');
          win.showInactive();
        });
        """#
        let html = #"""
        <!doctype html><html><body style="margin:0;height:1000px;background:#eef2ff">
        <input id="field" style="margin:50px;width:360px;height:44px;font-size:20px" />
        <div style="height:800px"></div>
        <script>
        const fs = require('fs');
        const statePath = process.env.ONMYAGENT_ELECTRON_FIXTURE_STATE;
        const state = { pid: process.ppid, clickCount: 0, typedText: '', keyCount: 0, scrollCount: 0, dragCount: 0 };
        const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
        const field = document.getElementById('field');
        document.addEventListener('click', () => { state.clickCount++; field.focus(); save(); });
        field.addEventListener('input', () => { state.typedText = field.value; save(); });
        document.addEventListener('keydown', () => { state.keyCount++; save(); });
        document.addEventListener('wheel', () => { state.scrollCount++; save(); });
        let dragging = false;
        document.addEventListener('mousedown', () => { dragging = true; });
        document.addEventListener('mousemove', () => { if (dragging) { state.dragCount++; save(); } });
        document.addEventListener('mouseup', () => { dragging = false; });
        save();
        </script></body></html>
        """#
        try Data(packageJSON.utf8).write(to: directory.appendingPathComponent("package.json"), options: .atomic)
        try Data(main.utf8).write(to: directory.appendingPathComponent("main.js"), options: .atomic)
        try Data(html.utf8).write(to: directory.appendingPathComponent("index.html"), options: .atomic)
    }

    private func waitForWindow(pid: pid_t) async throws -> WindowTarget {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(8))
        while clock.now < deadline {
            if let windows = CGWindowListCopyWindowInfo(
                [.optionAll, .excludeDesktopElements],
                kCGNullWindowID
            ) as? [[String: Any]], let window = windows.first(where: {
                ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
                    && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
                    && (($0[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0) > 0
            }), let windowNumber = (window[kCGWindowNumber as String] as? NSNumber)?.intValue,
               let rawBounds = window[kCGWindowBounds as String] as? [String: Any],
               let x = (rawBounds["X"] as? NSNumber)?.doubleValue,
               let y = (rawBounds["Y"] as? NSNumber)?.doubleValue,
               let width = (rawBounds["Width"] as? NSNumber)?.doubleValue,
               let height = (rawBounds["Height"] as? NSNumber)?.doubleValue {
                let bounds = CGRect(x: x, y: y, width: width, height: height)
                return WindowTarget(
                    appName: "Electron Background Fixture",
                    pid: pid,
                    windowNumber: windowNumber,
                    windowTitle: "Electron Background Fixture",
                    bounds: bounds,
                    isFrontmost: false,
                    axWindow: nil
                )
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        XCTFail("Electron did not publish a visible WindowServer window")
        throw CocoaError(.fileReadUnknown)
    }

    private func waitForState(
        at url: URL,
        label: String,
        predicate: (ElectronFixtureState) -> Bool
    ) async throws -> ElectronFixtureState {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(8))
        while clock.now < deadline {
            if let data = try? Data(contentsOf: url),
               let state = try? JSONDecoder().decode(ElectronFixtureState.self, from: data),
               predicate(state) {
                return state
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        let lastState = (try? Data(contentsOf: url))
            .flatMap { try? JSONDecoder().decode(ElectronFixtureState.self, from: $0) }
        XCTFail("Electron fixture did not publish expected \(label) state. Last state: \(String(describing: lastState))")
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

}
