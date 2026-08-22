import AppKit
import CoreGraphics
import Foundation

struct FixtureBounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct FixtureState: Codable {
    var pid: Int32
    var windowNumber: Int
    var bounds: FixtureBounds
    var clickCount = 0
    var typedText = ""
    var keyCount = 0
    var scrollCount = 0
    var dragCount = 0
    var events: [FixtureEvent] = []
    var applicationBecameActiveCount = 0
    var applicationResignedActiveCount = 0
    var windowBecameKeyCount = 0
    var windowResignedKeyCount = 0
    var applicationIsActive = false
    var windowIsKey = false
}

struct FixtureEvent: Codable {
    let kind: String
    let eventType: UInt
    let eventWindowNumber: Int
    let locationInWindow: FixturePoint
    let cgLocation: FixturePoint?
    let hardwareCursor: FixturePoint?
    let sourcePID: Int64?
    let targetPID: Int64?
    let windowUnderPointer: Int64?
    let frontmostPID: Int32?
    let targetAppIsActive: Bool
    let targetWindowIsKey: Bool
    let targetWindowIsMain: Bool
    let integerFields: [String: Int64]
}

struct FixturePoint: Codable {
    let x: Double
    let y: Double
}

@MainActor
final class FixtureStore {
    private let stateURL: URL
    private(set) var state: FixtureState

    init(stateURL: URL) {
        self.stateURL = stateURL
        state = FixtureState(
            pid: getpid(),
            windowNumber: 0,
            bounds: FixtureBounds(x: 0, y: 0, width: 0, height: 0)
        )
    }

    func configure(window: NSWindow) {
        state.windowNumber = window.windowNumber
        state.bounds = cgBounds(windowNumber: window.windowNumber)
            ?? FixtureBounds(
                x: window.frame.minX,
                y: window.frame.minY,
                width: window.frame.width,
                height: window.frame.height
            )
        state.applicationIsActive = NSApplication.shared.isActive
        state.windowIsKey = window.isKeyWindow
        persist()
    }

    func recordApplicationBecameActive() {
        state.applicationBecameActiveCount += 1
        state.applicationIsActive = true
        persist()
    }

    func recordApplicationResignedActive() {
        state.applicationResignedActiveCount += 1
        state.applicationIsActive = false
        persist()
    }

    func recordWindowBecameKey() {
        state.windowBecameKeyCount += 1
        state.windowIsKey = true
        persist()
    }

    func recordWindowResignedKey() {
        state.windowResignedKeyCount += 1
        state.windowIsKey = false
        persist()
    }

    func recordClick(_ event: NSEvent) {
        state.clickCount += 1
        record(event, kind: "mouseDown")
        persist()
    }

    func recordKey(_ event: NSEvent) {
        state.keyCount += 1
        state.typedText += event.characters ?? ""
        record(event, kind: "keyDown")
        persist()
    }

    func recordScroll(_ event: NSEvent) {
        state.scrollCount += 1
        record(event, kind: "scrollWheel")
        persist()
    }

    func recordDrag(_ event: NSEvent) {
        state.dragCount += 1
        record(event, kind: "mouseDragged")
        persist()
    }

    func record(_ event: NSEvent, kind: String) {
        let cgEvent = event.cgEvent
        let cgLocation = cgEvent?.location
        let hardwareCursor = CGEvent(source: nil)?.location
        var integerFields: [String: Int64] = [:]
        if let cgEvent {
            for rawValue in UInt32(0)...UInt32(200) {
                guard let field = CGEventField(rawValue: rawValue) else { continue }
                let value = cgEvent.getIntegerValueField(field)
                if value != 0 { integerFields[String(rawValue)] = value }
            }
        }
        state.events.append(FixtureEvent(
            kind: kind,
            eventType: event.type.rawValue,
            eventWindowNumber: event.windowNumber,
            locationInWindow: FixturePoint(x: event.locationInWindow.x, y: event.locationInWindow.y),
            cgLocation: cgLocation.map { FixturePoint(x: $0.x, y: $0.y) },
            hardwareCursor: hardwareCursor.map { FixturePoint(x: $0.x, y: $0.y) },
            sourcePID: cgEvent.map { $0.getIntegerValueField(.eventSourceUnixProcessID) },
            targetPID: cgEvent.map { $0.getIntegerValueField(.eventTargetUnixProcessID) },
            windowUnderPointer: cgEvent.map { $0.getIntegerValueField(.mouseEventWindowUnderMousePointer) },
            frontmostPID: NSWorkspace.shared.frontmostApplication?.processIdentifier,
            targetAppIsActive: NSApplication.shared.isActive,
            targetWindowIsKey: event.window?.isKeyWindow ?? false,
            targetWindowIsMain: event.window?.isMainWindow ?? false,
            integerFields: integerFields
        ))
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: stateURL, options: .atomic)
    }

    private func cgBounds(windowNumber: Int) -> FixtureBounds? {
        guard let windows = CGWindowListCopyWindowInfo(
            .optionIncludingWindow,
            CGWindowID(windowNumber)
        ) as? [[String: Any]],
        let window = windows.first,
        let rawBounds = window[kCGWindowBounds as String] as? [String: Any],
        let x = number(rawBounds["X"]),
        let y = number(rawBounds["Y"]),
        let width = number(rawBounds["Width"]),
        let height = number(rawBounds["Height"]) else {
            return nil
        }
        return FixtureBounds(x: x, y: y, width: width, height: height)
    }

    private func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }
}

@MainActor
final class FixtureView: NSView {
    private let store: FixtureStore

    init(frame: NSRect, store: FixtureStore) {
        self.store = store
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        store.recordClick(event)
    }

    override func keyDown(with event: NSEvent) {
        store.recordKey(event)
    }

    override func keyUp(with event: NSEvent) {
        store.record(event, kind: "keyUp")
    }

    override func scrollWheel(with event: NSEvent) {
        store.recordScroll(event)
    }

    override func mouseDragged(with event: NSEvent) {
        store.recordDrag(event)
    }

    override func mouseUp(with event: NSEvent) {
        store.record(event, kind: "mouseUp")
    }

    override func mouseMoved(with event: NSEvent) {
        store.record(event, kind: "mouseMoved")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let text = "OnMyAgent background interaction fixture"
        text.draw(
            at: NSPoint(x: 24, y: bounds.midY),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 16, weight: .medium),
                .foregroundColor: NSColor.labelColor,
            ]
        )
    }
}

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: BackgroundInteractionFixture <state-file> [--regular] [--activate-on-launch]\n", stderr)
    exit(2)
}

MainActor.assumeIsolated {
    let stateURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let application = NSApplication.shared
    let regular = CommandLine.arguments.contains("--regular")
    application.setActivationPolicy(regular ? .regular : .accessory)
    application.finishLaunching()

    let store = FixtureStore(stateURL: stateURL)
    let contentRect = NSRect(x: 160, y: 160, width: 440, height: 280)
    let window: NSWindow
    if regular {
        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
    } else {
        let panel = NSPanel(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.becomesKeyOnlyIfNeeded = false
        window = panel
    }
    window.title = "Background Interaction Fixture"
    window.acceptsMouseMovedEvents = true
    window.contentView = FixtureView(
        frame: window.contentRect(forFrameRect: window.frame),
        store: store
    )
    window.makeFirstResponder(window.contentView)
    NotificationCenter.default.addObserver(
        forName: NSApplication.didBecomeActiveNotification,
        object: application,
        queue: .main
    ) { _ in MainActor.assumeIsolated { store.recordApplicationBecameActive() } }
    NotificationCenter.default.addObserver(
        forName: NSApplication.didResignActiveNotification,
        object: application,
        queue: .main
    ) { _ in MainActor.assumeIsolated { store.recordApplicationResignedActive() } }
    NotificationCenter.default.addObserver(
        forName: NSWindow.didBecomeKeyNotification,
        object: window,
        queue: .main
    ) { _ in MainActor.assumeIsolated { store.recordWindowBecameKey() } }
    NotificationCenter.default.addObserver(
        forName: NSWindow.didResignKeyNotification,
        object: window,
        queue: .main
    ) { _ in MainActor.assumeIsolated { store.recordWindowResignedKey() } }
    if CommandLine.arguments.contains("--trace-focus-events") {
        NSEvent.addLocalMonitorForEvents(
            matching: [.appKitDefined, .systemDefined, .applicationDefined]
        ) { event in
            MainActor.assumeIsolated {
                store.record(event, kind: "focus:\(event.type.rawValue):\(event.subtype.rawValue)")
            }
            return event
        }
    }
    if CommandLine.arguments.contains("--activate-on-launch") {
        application.activate(ignoringOtherApps: true)
        window.orderFrontRegardless()
    } else {
        window.orderBack(nil)
    }
    store.configure(window: window)
    application.run()
}
