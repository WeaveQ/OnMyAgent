import AppKit
import ApplicationServices
import Foundation

final class RecordAndReplayController: @unchecked Sendable {
    private let store: RecordAndReplayStore
    private let lock = NSLock()
    private var inputMonitor: RecordAndReplayInputMonitor?
    private var observationTask: Task<Void, Never>?
    private var deadlineTask: Task<Void, Never>?
    private var activeSessionID: String?
    private let accessibility = AccessibilityService()
    private var lastObservationKey: String?

    init(store: RecordAndReplayStore = RecordAndReplayStore()) {
        self.store = store
    }

    func start() async throws -> RecordAndReplayStatus {
        if let current = try store.status(), current.state == .recording {
            beginCaptureIfNeeded(status: current)
            return current
        }
        guard await RecordAndReplayApprovalPrompt.request() else {
            throw ComputerUseError.recordingStartDeclined
        }
        let status = try store.start()
        beginCaptureIfNeeded(status: status)
        return status
    }

    func status() throws -> RecordAndReplayStatus? {
        let status = try store.status()
        if status?.state != .recording {
            stopCaptureUI()
        }
        return status
    }

    @discardableResult
    func stop(reason: String = "user_stopped") throws -> RecordAndReplayStatus? {
        let status = try store.stop(reason: reason)
        stopCaptureUI()
        return status
    }

    func discard() throws {
        guard let status = try store.status() else { return }
        _ = try stop(reason: "discarded")
        try store.discard(sessionID: status.sessionID)
    }

    private func beginCaptureIfNeeded(status: RecordAndReplayStatus) {
        let shouldStart = lock.withLock { () -> Bool in
            guard activeSessionID != status.sessionID else { return false }
            activeSessionID = status.sessionID
            return true
        }
        guard shouldStart else { return }

        let monitor = RecordAndReplayInputMonitor { [weak self] event in
            guard let self else { return }
            try? self.store.append(event, sessionID: status.sessionID)
        }
        lock.withLock { inputMonitor = monitor }
        monitor.start()

        observationTask = Task.detached { [weak self] in
            while !Task.isCancelled {
                self?.captureAppObservation(sessionID: status.sessionID)
                try? await Task.sleep(for: .seconds(2))
            }
        }
        let remaining = max(0, status.endsAt.timeIntervalSinceNow)
        deadlineTask = Task.detached { [weak self] in
            try? await Task.sleep(for: .seconds(remaining))
            guard !Task.isCancelled else { return }
            _ = try? self?.stop(reason: "time_limit")
        }
        Task { @MainActor [weak self] in
            RecordAndReplayOverlay.shared.show(
                onStop: { _ = try? self?.stop() },
                onDiscard: { try? self?.discard() }
            )
        }
    }

    private func stopCaptureUI() {
        let capture = lock.withLock { () -> (
            RecordAndReplayInputMonitor?,
            Task<Void, Never>?,
            Task<Void, Never>?
        ) in
            let values = (inputMonitor, observationTask, deadlineTask)
            inputMonitor = nil
            observationTask = nil
            deadlineTask = nil
            activeSessionID = nil
            lastObservationKey = nil
            return values
        }
        capture.0?.stop()
        capture.1?.cancel()
        capture.2?.cancel()
        Task { @MainActor in RecordAndReplayOverlay.shared.hide() }
    }

    private func captureAppObservation(sessionID: String) {
        guard let application = NSWorkspace.shared.frontmostApplication,
              let context = safeContext(application: application) else { return }
        let labels: String? = {
            guard let target = try? accessibility.resolveTarget(appName: context.appID) else {
                return nil
            }
            let values = accessibility.records(target: target)
                .map(\.semantic.label)
                .filter { !$0.isEmpty }
                .prefix(24)
            return values.isEmpty ? nil : values.joined(separator: " | ")
        }()
        let observationKey = "\(context.appID)\u{0}\(context.windowTitle ?? "")\u{0}\(labels ?? "")"
        let changed = lock.withLock { () -> Bool in
            guard lastObservationKey != observationKey else { return false }
            lastObservationKey = observationKey
            return true
        }
        guard changed else { return }
        try? store.append(RecordAndReplayEvent(
            timestamp: Date(),
            kind: .appState,
            appID: context.appID,
            appName: context.appName,
            windowTitle: context.windowTitle,
            x: nil,
            y: nil,
            text: labels
        ), sessionID: sessionID)
    }

    fileprivate func safeContext(application: NSRunningApplication) -> RecordAndReplayAppContext? {
        guard let appID = application.bundleIdentifier ?? application.bundleURL?.path,
              let appName = application.localizedName else { return nil }
        if ComputerUseTargetPolicy.disposition(
            bundleIdentifier: appID,
            sessionAllowed: [],
            persistentAllowed: []
        ) == .blocked {
            return nil
        }
        if let url = accessibility.currentBrowserURL(application: application),
           ComputerUseTargetPolicy.isBlockedBrowserURL(url) {
            return nil
        }
        return RecordAndReplayAppContext(
            appID: appID,
            appName: appName,
            windowTitle: frontmostWindowTitle(processID: application.processIdentifier)
        )
    }

    private func frontmostWindowTitle(processID: pid_t) -> String? {
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else { return nil }
        return windows.first { window in
            (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == processID
                && (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        }?[kCGWindowName as String] as? String
    }
}

private struct RecordAndReplayAppContext {
    let appID: String
    let appName: String
    let windowTitle: String?
}

private final class RecordAndReplayInputMonitor: @unchecked Sendable {
    private let onEvent: @Sendable (RecordAndReplayEvent) -> Void
    private let accessibility = AccessibilityService()
    private let lock = NSLock()
    private var eventTap: CFMachPort?
    private var runLoop: CFRunLoop?
    private var stopped = false

    init(onEvent: @escaping @Sendable (RecordAndReplayEvent) -> Void) {
        self.onEvent = onEvent
    }

    func start() {
        let thread = Thread { [weak self] in self?.runEventTap() }
        thread.name = "OnMyAgent Record & Replay input recorder"
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    func stop() {
        let values = lock.withLock { () -> (CFMachPort?, CFRunLoop?) in
            stopped = true
            return (eventTap, runLoop)
        }
        if let tap = values.0 { CFMachPortInvalidate(tap) }
        if let runLoop = values.1 { CFRunLoopStop(runLoop) }
    }

    fileprivate func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            let tap = lock.withLock { eventTap }
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        guard !lock.withLock({ stopped }) else { return }
        let sourcePID = pid_t(event.getIntegerValueField(.eventSourceUnixProcessID))
        guard sourcePID != getpid(),
              let application = NSWorkspace.shared.frontmostApplication,
              let appID = application.bundleIdentifier ?? application.bundleURL?.path,
              let appName = application.localizedName else { return }
        if ComputerUseTargetPolicy.disposition(
            bundleIdentifier: appID,
            sessionAllowed: [],
            persistentAllowed: []
        ) == .blocked {
            return
        }
        if let url = accessibility.currentBrowserURL(application: application),
           ComputerUseTargetPolicy.isBlockedBrowserURL(url) {
            return
        }

        let kind: RecordAndReplayEventKind
        let location = event.location
        let text: String?
        switch type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            kind = .mouseClick
            text = nil
        case .scrollWheel:
            kind = .scroll
            let dx = event.getIntegerValueField(.scrollWheelEventDeltaAxis2)
            let dy = event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
            text = "dx=\(dx),dy=\(dy)"
        case .keyDown:
            kind = .keyText
            text = keyboardText(event)
        default:
            return
        }
        onEvent(RecordAndReplayEvent(
            timestamp: Date(),
            kind: kind,
            appID: appID,
            appName: appName,
            windowTitle: nil,
            x: kind == .keyText ? nil : location.x,
            y: kind == .keyText ? nil : location.y,
            text: text
        ))
    }

    private func runEventTap() {
        let types: [CGEventType] = [
            .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .scrollWheel, .keyDown,
        ]
        let mask = types.reduce(CGEventMask(0)) { value, type in
            value | (CGEventMask(1) << type.rawValue)
        }
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: recordAndReplayEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return }
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        let currentRunLoop = CFRunLoopGetCurrent()
        lock.withLock {
            eventTap = tap
            runLoop = currentRunLoop
        }
        CFRunLoopAddSource(currentRunLoop, source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        CFRunLoopRun()
    }

    private func keyboardText(_ event: CGEvent) -> String {
        var buffer = [UniChar](repeating: 0, count: 32)
        var actualLength = 0
        event.keyboardGetUnicodeString(
            maxStringLength: buffer.count,
            actualStringLength: &actualLength,
            unicodeString: &buffer
        )
        if actualLength > 0 {
            return String(utf16CodeUnits: buffer, count: actualLength)
        }
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        return "keycode:\(keyCode)"
    }
}

private func recordAndReplayEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let monitor = Unmanaged<RecordAndReplayInputMonitor>
        .fromOpaque(userInfo)
        .takeUnretainedValue()
    monitor.handle(type: type, event: event)
    return Unmanaged.passUnretained(event)
}
