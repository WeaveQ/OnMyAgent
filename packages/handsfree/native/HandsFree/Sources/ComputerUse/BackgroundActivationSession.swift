import AppKit
import CoreGraphics

private final class ScopedFocusStealGuard: @unchecked Sendable {
    private let pid: pid_t
    private var tap: CFMachPort?
    private var runLoop: CFRunLoop?
    private var thread: Thread?
    private var startupError: Error?

    init(pid: pid_t) {
        self.pid = pid
    }

    func start() throws {
        startupError = nil
        let ready = DispatchSemaphore(value: 0)
        let thread = Thread { [weak self] in
            guard let self else {
                ready.signal()
                return
            }
            self.runLoop = CFRunLoopGetCurrent()
            do {
                try self.installOnCurrentRunLoop()
            } catch {
                self.startupError = error
            }
            ready.signal()
            if self.startupError == nil { CFRunLoopRun() }
        }
        thread.name = "OnMyAgentScopedFocusStealGuard"
        self.thread = thread
        thread.start()
        ready.wait()
        if let startupError { throw startupError }
    }

    func arm() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    }

    func disarm() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
    }

    func stop() {
        disarm()
        if let tap { CFMachPortInvalidate(tap) }
        if let runLoop { CFRunLoopStop(runLoop) }
        tap = nil
        runLoop = nil
        thread = nil
    }

    private func installOnCurrentRunLoop() throws {
        guard let tap = CGEvent.tapCreateForPid(
            pid: pid,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask.max,
            callback: Self.callback,
            userInfo: nil
        ) else {
            throw ComputerUseError.strictModeViolation(
                "could not install the scoped focus-steal guard for pid \(pid)"
            )
        }
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap)
            throw ComputerUseError.strictModeViolation("could not create the focus-steal guard run loop source")
        }
        self.tap = tap
        CGEvent.tapEnable(tap: tap, enable: false)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
    }

    private static let callback: CGEventTapCallBack = { _, type, event, _ in
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            return Unmanaged.passUnretained(event)
        }
        let raw = Int(type.rawValue)
        if raw == 13 || raw == 19 || raw == 20 { return nil }
        return Unmanaged.passUnretained(event)
    }
}

struct BackgroundInteractionBaseline: Equatable, Sendable {
    let frontmostPID: pid_t
    let cursorPosition: CGPoint?
}

enum BackgroundInteractionInvariant {
    static func validate(
        baseline: BackgroundInteractionBaseline,
        frontmostPID: pid_t?,
        cursorPosition: CGPoint?,
        tolerance: CGFloat = 0.5
    ) throws {
        guard frontmostPID == baseline.frontmostPID else {
            throw ComputerUseError.strictModeViolation("the foreground application changed during background input")
        }
        guard let before = baseline.cursorPosition, let after = cursorPosition else { return }
        guard abs(before.x - after.x) <= tolerance, abs(before.y - after.y) <= tolerance else {
            throw ComputerUseError.strictModeViolation(
                "the system cursor moved during background input (\(Int(before.x)),\(Int(before.y)) -> \(Int(after.x)),\(Int(after.y)))"
            )
        }
    }
}

/// Owns one strict PID/window binding. Observation is read-only; each input
/// action temporarily guards the user's process from focus-steal messages,
/// routes synthetic focus and input to the target process/window, then removes
/// target focus. The real frontmost PID, window order, Space, and hardware
/// pointer are invariant.
final class BackgroundInteractionSession: @unchecked Sendable {
    private let previousPID: pid_t
    private let targetPID: pid_t
    private let bridge: SkyLightBridge
    private let cursorTolerance: CGFloat
    private let focusStealGuard: ScopedFocusStealGuard?
    private var started = false
    private var target: WindowTarget?

    init(
        previousPID: pid_t,
        targetPID: pid_t,
        bridge: SkyLightBridge = .shared,
        cursorTolerance: CGFloat = 0.5
    ) {
        self.previousPID = previousPID
        self.targetPID = targetPID
        self.bridge = bridge
        self.cursorTolerance = cursorTolerance
        focusStealGuard = previousPID == targetPID ? nil : ScopedFocusStealGuard(pid: previousPID)
    }

    deinit {
        stop()
    }

    func start() throws {
        guard !started else { return }
        guard bridge.isAvailable else {
            throw ComputerUseError.strictModeViolation(
                "trusted targeted input is unavailable on this macOS release"
            )
        }
        try focusStealGuard?.start()
        started = true
    }

    /// Like Codex get_app_state, establishing a snapshot does not synthesize
    /// focus or send a click.
    func establish(target: WindowTarget) async throws {
        guard started else {
            throw ComputerUseError.strictModeViolation("background interaction session is not running")
        }
        guard target.pid == targetPID else {
            throw ComputerUseError.strictModeViolation("the target process changed while opening the background session")
        }
        guard target.windowNumber != nil else {
            throw ComputerUseError.strictModeViolation("target window has no CG window number")
        }
        let baseline = try captureBaseline()
        try validate(baseline)
        self.target = target
    }

    func click(
        windowNumber: Int,
        point: CGPoint,
        button: ComputerMouseButton = .left,
        clickCount: Int = 1
    ) async throws {
        try await withTarget(windowNumber: windowNumber, mousePrimerPoint: point) { target in
            try await BackgroundInputDispatcher.click(
                pid: self.targetPID,
                windowNumber: windowNumber,
                windowBounds: target.bounds,
                point: point,
                button: button,
                clickCount: clickCount,
                bridge: self.bridge
            )
        }
    }

    func drag(windowNumber: Int, path: [CGPoint], button: ComputerMouseButton = .left) async throws {
        try await withTarget(windowNumber: windowNumber, mousePrimerPoint: path.first) { target in
            try await BackgroundInputDispatcher.drag(
                pid: self.targetPID,
                windowNumber: windowNumber,
                windowBounds: target.bounds,
                path: path,
                button: button,
                bridge: self.bridge
            )
        }
    }

    func scroll(windowNumber: Int, point: CGPoint, deltaX: Int32, deltaY: Int32) async throws {
        try await withTarget(windowNumber: windowNumber, mousePrimerPoint: point) { target in
            try BackgroundInputDispatcher.scroll(
                pid: self.targetPID,
                windowNumber: windowNumber,
                windowBounds: target.bounds,
                point: point,
                deltaX: deltaX,
                deltaY: deltaY,
                bridge: self.bridge
            )
        }
    }

    func typeText(windowNumber: Int, text: String) async throws {
        try await withTarget(windowNumber: windowNumber) { _ in
            try BackgroundInputDispatcher.typeText(
                pid: self.targetPID,
                windowNumber: windowNumber,
                text: text,
                bridge: self.bridge
            )
        }
    }

    func pressKey(windowNumber: Int, combo: String) async throws {
        try await withTarget(windowNumber: windowNumber) { _ in
            try BackgroundInputDispatcher.pressKey(
                pid: self.targetPID,
                windowNumber: windowNumber,
                combo: combo,
                bridge: self.bridge
            )
        }
    }

    func stop() {
        focusStealGuard?.stop()
        target = nil
        started = false
    }

    private func withTarget(
        windowNumber: Int,
        mousePrimerPoint: CGPoint? = nil,
        operation: (WindowTarget) async throws -> Void
    ) async throws {
        guard let target, target.windowNumber == windowNumber else {
            throw ComputerUseError.staleSnapshot("The target window changed. Take a new snapshot before sending input.")
        }
        let baseline = try captureBaseline()
        try validate(baseline)

        focusStealGuard?.arm()
        var targetFocusStarted = false
        var operationError: Error?
        do {
            if let mousePrimerPoint {
                try BackgroundInputDispatcher.primeMouse(
                    pid: targetPID,
                    windowNumber: windowNumber,
                    windowBounds: target.bounds,
                    point: mousePrimerPoint,
                    bridge: bridge
                )
            }
            if focusStealGuard != nil {
                try bridge.postSyntheticFocus(pid: targetPID, windowNumber: windowNumber, subtype: 1)
                targetFocusStarted = true
                try await Task.sleep(for: .milliseconds(50))
            }
            try validate(baseline)
            try await operation(target)
            try await Task.sleep(for: .milliseconds(50))
        } catch {
            operationError = error
        }

        var restoreError: Error?
        if targetFocusStarted {
            do {
                try bridge.postSyntheticFocus(pid: targetPID, windowNumber: windowNumber, subtype: 2)
                try await Task.sleep(for: .milliseconds(20))
            } catch {
                restoreError = error
            }
        }
        focusStealGuard?.disarm()
        do {
            try validate(baseline)
        } catch {
            restoreError = error
        }

        if let restoreError { throw restoreError }
        if let operationError { throw operationError }
    }

    private func captureBaseline() throws -> BackgroundInteractionBaseline {
        guard let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier else {
            throw ComputerUseError.noFrontmostApplication
        }
        guard frontmostPID == previousPID else {
            throw ComputerUseError.staleSnapshot("The user changed the foreground app. Take a new snapshot before sending input.")
        }
        return BackgroundInteractionBaseline(
            frontmostPID: frontmostPID,
            cursorPosition: CGEvent(source: nil)?.location
        )
    }

    private func validate(_ baseline: BackgroundInteractionBaseline) throws {
        try BackgroundInteractionInvariant.validate(
            baseline: baseline,
            frontmostPID: NSWorkspace.shared.frontmostApplication?.processIdentifier,
            cursorPosition: CGEvent(source: nil)?.location,
            tolerance: cursorTolerance
        )
    }
}
