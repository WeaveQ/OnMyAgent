import AppKit
import ApplicationServices
import Foundation

struct AppshotShortcutTracker: Sendable {
    private var fired = false

    mutating func update(leftCommandDown: Bool, rightCommandDown: Bool) -> Bool {
        let bothDown = leftCommandDown && rightCommandDown
        if !bothDown {
            fired = false
            return false
        }
        guard !fired else { return false }
        fired = true
        return true
    }
}

struct AppshotCopy: Sendable {
    let title: String

    static var current: AppshotCopy { resolve(Locale.preferredLanguages) }

    static func resolve(_ preferredLanguages: [String]) -> AppshotCopy {
        let language = preferredLanguages.first?.lowercased() ?? "en"
        if language.hasPrefix("zh-hant") || language.hasPrefix("zh-tw") || language.hasPrefix("zh-hk") {
            return AppshotCopy(title: "Appshot 截圖已擷取")
        }
        if language.hasPrefix("zh") { return AppshotCopy(title: "Appshot 截图已捕获") }
        return AppshotCopy(title: "Appshot captured")
    }
}

struct AppshotResult: Codable, Sendable {
    let ok: Bool
    let path: String
    let name: String
    let mimeType: String
    let appName: String
    let capturedAt: Date

    var dictionary: [String: Any] {
        [
            "ok": ok,
            "path": path,
            "name": name,
            "mimeType": mimeType,
            "appName": appName,
            "capturedAt": ISO8601DateFormatter().string(from: capturedAt),
        ]
    }
}

final class AppshotCaptureStore: @unchecked Sendable {
    let rootURL: URL
    private let accessibility = AccessibilityService()

    init(rootURL: URL = AppshotCaptureStore.defaultRootURL()) {
        self.rootURL = rootURL
    }

    func capture(publishEvent: Bool = true) async throws -> AppshotResult {
        guard let application = captureApplication(),
              let bundleIdentifier = application.bundleIdentifier ?? application.bundleURL?.path else {
            throw ComputerUseError.invalidCommand("Appshot could not identify the frontmost app")
        }
        if ComputerUseTargetPolicy.disposition(
            bundleIdentifier: bundleIdentifier,
            sessionAllowed: [],
            persistentAllowed: []
        ) == .blocked {
            throw ComputerUseError.invalidCommand("Appshot is unavailable for protected apps")
        }
        if let rawURL = accessibility.currentBrowserURL(application: application),
           ComputerUseTargetPolicy.isBlockedBrowserURL(rawURL) {
            throw ComputerUseError.invalidCommand("Appshot is unavailable for protected browser pages")
        }
        let target = try accessibility.resolveTarget(appName: bundleIdentifier)
        let snapshot = try await accessibility.snapshot(
            target: target,
            strictMode: true,
            backgroundActivated: false
        )
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        let filename = Self.makeFileName(appName: target.appName, date: Date())
        let fileURL = rootURL.appendingPathComponent(filename)
        try snapshot.screenshotData.write(to: fileURL, options: .atomic)
        let result = AppshotResult(
            ok: true,
            path: fileURL.path,
            name: filename,
            mimeType: snapshot.screenshotMimeType,
            appName: target.appName,
            capturedAt: Date()
        )
        if publishEvent {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(result).write(
                to: rootURL.appendingPathComponent("latest-event.json"),
                options: .atomic
            )
        }
        await MainActor.run {
            AppshotCaptureOverlay.shared.show(
                imageData: snapshot.screenshotData,
                appName: target.appName
            )
        }
        return result
    }

    private func captureApplication() -> NSRunningApplication? {
        guard let frontmost = NSWorkspace.shared.frontmostApplication else { return nil }
        let bundleIdentifier = frontmost.bundleIdentifier?.lowercased() ?? ""
        guard bundleIdentifier.hasPrefix("com.differentai.onmyagent") else { return frontmost }
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else { return frontmost }
        for window in windows {
            guard (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let owner = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
                  owner != frontmost.processIdentifier,
                  owner != getpid(),
                  let application = NSRunningApplication(processIdentifier: owner),
                  application.activationPolicy == .regular else { continue }
            return application
        }
        return frontmost
    }

    static func defaultRootURL() -> URL {
        if let override = ProcessInfo.processInfo.environment[
            "ONMYAGENT_COMPUTER_USE_APPSHOT_ROOT"
        ]?.trimmingCharacters(in: .whitespacesAndNewlines), !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("OnMyAgent", isDirectory: true)
            .appendingPathComponent("ComputerUse", isDirectory: true)
            .appendingPathComponent("Appshots", isDirectory: true)
    }

    private static let filenameFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()

    /// Build a portable basename. Must return a real `String` — never a
    /// `JoinedSequence` (Swift `map`+`joined` dump) which previously leaked
    /// into Electron toasts as `JoinedSequence<Array<ArraySlice<Character>>>…`.
    static func makeFileName(appName: String, date: Date = Date()) -> String {
        let safeSlug = makeAppSlug(appName)
        let timestamp = filenameFormatter.string(from: date)
        return "Appshot-\(timestamp)-\(safeSlug).jpg"
    }

    static func makeAppSlug(_ appName: String) -> String {
        // Character-by-character into [Character] → String. Do NOT use
        // String.map(...).joined(separator:) — that yields JoinedSequence.
        var slugChars: [Character] = []
        for ch in appName {
            if ch.isLetter || ch.isNumber {
                slugChars.append(ch)
            } else if slugChars.last != Character("-") {
                slugChars.append(Character("-"))
            }
        }
        while slugChars.first == Character("-") { slugChars.removeFirst() }
        while slugChars.last == Character("-") { slugChars.removeLast() }
        let appSlug = String(slugChars)
        return appSlug.isEmpty ? "App" : appSlug
    }
}

final class AppshotShortcutMonitor: @unchecked Sendable {
    private let store: AppshotCaptureStore
    private let lock = NSLock()
    private var tracker = AppshotShortcutTracker()
    private var eventTap: CFMachPort?

    init(store: AppshotCaptureStore = AppshotCaptureStore()) {
        self.store = store
    }

    func run() {
        let mask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: appshotShortcutEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return }
        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
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
        let leftDown = CGEventSource.keyState(.combinedSessionState, key: 55)
        let rightDown = CGEventSource.keyState(.combinedSessionState, key: 54)
        let shouldCapture = lock.withLock {
            tracker.update(leftCommandDown: leftDown, rightCommandDown: rightDown)
        }
        if shouldCapture {
            Task { [store] in _ = try? await store.capture() }
        }
    }
}

@MainActor
final class AppshotCaptureOverlay {
    static let shared = AppshotCaptureOverlay()
    private var panel: NSPanel?
    private var imageView: NSImageView?
    private var hideTask: Task<Void, Never>?

    func show(imageData: Data, appName: String) {
        guard let image = NSImage(data: imageData) else { return }
        let panel = ensurePanel()
        panel.title = "\(AppshotCopy.current.title) · \(appName)"
        imageView?.image = image
        position(panel)
        NSSound(named: "Tink")?.play()
        panel.orderFrontRegardless()
        hideTask?.cancel()
        hideTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled else { return }
            self?.panel?.orderOut(nil)
        }
    }

    private func ensurePanel() -> NSPanel {
        if let panel { return panel }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 280, height: 190),
            styleMask: [.titled, .nonactivatingPanel, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        let image = NSImageView()
        image.imageScaling = .scaleProportionallyUpOrDown
        image.wantsLayer = true
        image.layer?.cornerRadius = 8
        image.layer?.masksToBounds = true
        image.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(image)
        NSLayoutConstraint.activate([
            image.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 8),
            image.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -8),
            image.topAnchor.constraint(equalTo: content.topAnchor, constant: 8),
            image.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -8),
        ])
        panel.contentView = content
        self.panel = panel
        imageView = image
        return panel
    }

    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        panel.setFrameOrigin(NSPoint(
            x: screen.visibleFrame.maxX - panel.frame.width - 20,
            y: screen.visibleFrame.maxY - panel.frame.height - 20
        ))
    }
}

private func appshotShortcutEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let monitor = Unmanaged<AppshotShortcutMonitor>.fromOpaque(userInfo).takeUnretainedValue()
    monitor.handle(type: type, event: event)
    return Unmanaged.passUnretained(event)
}
