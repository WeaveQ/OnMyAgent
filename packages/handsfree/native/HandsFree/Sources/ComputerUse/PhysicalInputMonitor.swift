import ApplicationServices
import Foundation

struct PhysicalInputPauseState: Sendable {
    let quietWindow: TimeInterval
    private var lastPhysicalInput: TimeInterval?

    init(quietWindow: TimeInterval = 1) {
        self.quietWindow = quietWindow
    }

    mutating func recordPhysicalInput(at timestamp: TimeInterval) {
        lastPhysicalInput = timestamp
    }

    func isPaused(at timestamp: TimeInterval) -> Bool {
        guard let lastPhysicalInput else { return false }
        return timestamp - lastPhysicalInput < quietWindow
    }
}

final class PhysicalInputMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private var state = PhysicalInputPauseState()
    private var eventTap: CFMachPort?
    private var runLoop: CFRunLoop?

    init() {
        let thread = Thread { [weak self] in
            self?.runEventTap()
        }
        thread.name = "OnMyAgent Computer Use physical-input monitor"
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    func isPaused() -> Bool {
        lock.withLock {
            state.isPaused(at: ProcessInfo.processInfo.systemUptime)
        }
    }

    private func recordPhysicalInput() {
        lock.withLock {
            state.recordPhysicalInput(at: ProcessInfo.processInfo.systemUptime)
        }
    }

    private func runEventTap() {
        let types: [CGEventType] = [
            .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel, .keyDown, .keyUp, .flagsChanged,
        ]
        let mask = types.reduce(CGEventMask(0)) { result, type in
            result | (CGEventMask(1) << type.rawValue)
        }
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: physicalInputEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return }
        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        let currentRunLoop = CFRunLoopGetCurrent()
        runLoop = currentRunLoop
        CFRunLoopAddSource(currentRunLoop, source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        CFRunLoopRun()
    }

    fileprivate func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            return
        }
        let sourcePID = pid_t(event.getIntegerValueField(.eventSourceUnixProcessID))
        guard sourcePID != getpid() else { return }
        recordPhysicalInput()
    }

    deinit {
        if let eventTap { CFMachPortInvalidate(eventTap) }
        if let runLoop { CFRunLoopStop(runLoop) }
    }
}

private func physicalInputEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let monitor = Unmanaged<PhysicalInputMonitor>.fromOpaque(userInfo).takeUnretainedValue()
    monitor.handle(type: type, event: event)
    return Unmanaged.passUnretained(event)
}
