import AppKit
import CoreGraphics
import Darwin
import Foundation

/// Small WindowServer compatibility boundary for process/window-directed input.
///
/// The target fields and focus sequence in this file are covered by the local
/// event-fingerprint fixture. The window-local coordinate symbol is deliberately
/// isolated: it is private macOS SPI and strict mode fails closed when it is
/// unavailable.
final class SkyLightBridge: @unchecked Sendable {
    private typealias PostToPID = @convention(c) (pid_t, UnsafeMutableRawPointer) -> Void
    private typealias SetWindowLocation = @convention(c) (UnsafeMutableRawPointer, Double, Double) -> Void
    private typealias EventRecordPointer = @convention(c) (UnsafeMutableRawPointer) -> UnsafeRawPointer?
    private typealias GetProcessForPID = @convention(c) (pid_t, UnsafeMutableRawPointer) -> Int32
    private typealias PostEventRecord = @convention(c) (UnsafeRawPointer, UnsafeRawPointer) -> Int32

    static let shared = SkyLightBridge()

    private let skyLightHandle: UnsafeMutableRawPointer?
    private let applicationServicesHandle: UnsafeMutableRawPointer?
    private let setWindowLocation: SetWindowLocation?
    private let postToPID: PostToPID?
    private let eventRecordPointer: EventRecordPointer?
    private let getProcessForPID: GetProcessForPID?
    private let postEventRecord: PostEventRecord?

    var isAvailable: Bool {
        setWindowLocation != nil
            && postToPID != nil
            && eventRecordPointer != nil
            && getProcessForPID != nil
            && postEventRecord != nil
    }

    private init() {
        let handle = dlopen(
            "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
            RTLD_LAZY | RTLD_LOCAL
        )
        let applicationServicesHandle = dlopen(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
            RTLD_LAZY | RTLD_LOCAL
        )
        skyLightHandle = handle
        self.applicationServicesHandle = applicationServicesHandle
        setWindowLocation = Self.resolve("CGEventSetWindowLocation", from: handle)
        postToPID = Self.resolve("SLEventPostToPid", from: handle)
        eventRecordPointer = Self.resolve("SLEventRecordPointer", from: handle)
        getProcessForPID = Self.resolve("GetProcessForPID", from: applicationServicesHandle)
        postEventRecord = Self.resolve("SLPSPostEventRecordTo", from: handle)
    }

    deinit {
        if let applicationServicesHandle { dlclose(applicationServicesHandle) }
        if let skyLightHandle { dlclose(skyLightHandle) }
    }

    func postSyntheticFocus(
        pid: pid_t,
        windowNumber: Int,
        subtype: Int16
    ) throws {
        guard isAvailable, let eventRecordPointer, let getProcessForPID, let postEventRecord else {
            throw ComputerUseError.strictModeViolation("trusted targeted focus delivery is unavailable")
        }
        guard let event = NSEvent.otherEvent(
            with: .appKitDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: windowNumber,
            context: nil,
            subtype: subtype,
            data1: 0,
            data2: 0
        )?.cgEvent else {
            throw ComputerUseError.eventCreationFailed
        }

        let eventPointer = Unmanaged.passUnretained(event).toOpaque()
        stampTarget(
            event: event,
            pid: pid,
            windowNumber: windowNumber
        )
        // Present on Codex's observed target-focus record. Without it, the
        // target process receives the record but does not consistently accept
        // the following process-directed mouse-down while it remains behind a
        // different real frontmost application.
        setField(event, rawValue: 59, value: 786_432)
        var psn = [UInt8](repeating: 0, count: 8)
        let lookupStatus = psn.withUnsafeMutableBytes { bytes in
            getProcessForPID(pid, bytes.baseAddress!)
        }
        guard lookupStatus == 0, let eventRecord = eventRecordPointer(eventPointer) else {
            throw ComputerUseError.strictModeViolation("could not build a target-process focus record")
        }
        let postStatus = psn.withUnsafeBytes { bytes in
            postEventRecord(bytes.baseAddress!, eventRecord)
        }
        guard postStatus == 0 else {
            throw ComputerUseError.strictModeViolation("WindowServer rejected target-process focus")
        }
    }

    func postMouse(
        _ event: CGEvent,
        pid: pid_t,
        windowNumber: Int,
        screenPoint: CGPoint,
        windowBounds: CGRect,
        clickState: Int64,
        buttonNumber: Int64,
        subtype: Int64,
        publicRoute: Bool = false,
        dualRoute: Bool = false
    ) throws {
        guard isAvailable, let setWindowLocation, let postToPID else {
            throw ComputerUseError.strictModeViolation("trusted targeted mouse delivery is unavailable")
        }
        let pointer = Unmanaged.passUnretained(event).toOpaque()
        let local = CGPoint(x: screenPoint.x - windowBounds.minX, y: screenPoint.y - windowBounds.minY)

        // A process-directed event can carry the target coordinate without
        // moving the hardware pointer. Codex's recorded target event has this
        // global point while a simultaneous CGEvent(source:nil) read remains
        // at the user's independent pointer location.
        event.location = screenPoint
        setWindowLocation(pointer, local.x, local.y)
        stampTarget(
            event: event,
            pid: pid,
            windowNumber: windowNumber
        )
        setField(event, rawValue: 1, value: clickState)
        setField(event, rawValue: 3, value: buttonNumber)
        setField(event, rawValue: 7, value: subtype)
        if dualRoute {
            // This order is intentional. In a real background AppKit fixture,
            // the public call alone is rejected and the private call alone is
            // incomplete; public-then-private produces one accepted event.
            event.postToPid(pid)
            postToPID(pid, pointer)
        } else if publicRoute {
            event.postToPid(pid)
        } else {
            postToPID(pid, pointer)
        }
    }

    func postKeyboard(_ event: CGEvent, pid: pid_t, windowNumber: Int) throws {
        guard isAvailable, let postToPID else {
            throw ComputerUseError.strictModeViolation("trusted targeted keyboard delivery is unavailable")
        }
        let pointer = Unmanaged.passUnretained(event).toOpaque()
        stampTarget(
            event: event,
            pid: pid,
            windowNumber: windowNumber
        )
        postToPID(pid, pointer)
    }

    private func stampTarget(
        event: CGEvent,
        pid: pid_t,
        windowNumber: Int
    ) {
        let window = Int64(windowNumber)
        setField(event, rawValue: 40, value: Int64(pid))
        setField(event, rawValue: 51, value: window)
        setField(event, rawValue: 91, value: window)
        setField(event, rawValue: 92, value: window)
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
    }

    private func setField(_ event: CGEvent, rawValue: UInt32, value: Int64) {
        guard let field = CGEventField(rawValue: rawValue) else { return }
        event.setIntegerValueField(field, value: value)
    }

    private static func resolve<T>(_ name: String, from handle: UnsafeMutableRawPointer?) -> T? {
        guard let handle, let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: T.self)
    }
}
