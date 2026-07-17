import AppKit
import Foundation

struct SkysightApprovalCopy: Sendable {
    let title: String
    let message: String
    let approve: String
    let cancel: String

    static var current: SkysightApprovalCopy { resolve(Locale.preferredLanguages) }

    static func resolve(_ preferredLanguages: [String]) -> SkysightApprovalCopy {
        let language = preferredLanguages.first?.lowercased() ?? "en"
        if language.hasPrefix("zh-hant") || language.hasPrefix("zh-tw") || language.hasPrefix("zh-hk") {
            return SkysightApprovalCopy(
                title: "啟用 Skysight？",
                message: "Skysight 會在本機記錄近期活動，讓 OnMyAgent 回答你剛才做過什麼。你可以隨時暫停、停止，或排除應用程式、網站與私密瀏覽。",
                approve: "啟用 Skysight",
                cancel: "取消"
            )
        }
        if language.hasPrefix("zh") {
            return SkysightApprovalCopy(
                title: "启用 Skysight？",
                message: "Skysight 会在本地记录近期活动，让 OnMyAgent 回答你刚才做过什么。你可以随时暂停、停止，或排除应用、网站和隐私浏览。",
                approve: "启用 Skysight",
                cancel: "取消"
            )
        }
        return SkysightApprovalCopy(
            title: "Start Skysight?",
            message: "Skysight records recent activity locally so OnMyAgent can answer questions about what you were doing. You can pause or stop it, or exclude apps and websites, at any time. Private browsing is excluded by default.",
            approve: "Start Skysight",
            cancel: "Cancel"
        )
    }
}

enum SkysightApprovalPrompt {
    @MainActor
    static func request() -> Bool {
        let copy = SkysightApprovalCopy.current
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = copy.title
        alert.informativeText = copy.message
        alert.addButton(withTitle: copy.approve)
        alert.addButton(withTitle: copy.cancel)
        let previous = NSWorkspace.shared.frontmostApplication
        NSApplication.shared.activate(ignoringOtherApps: true)
        let approved = alert.runModal() == .alertFirstButtonReturn
        if previous?.isTerminated == false { previous?.activate() }
        return approved
    }
}

final class SkysightController: @unchecked Sendable {
    private let settingsStore: SkysightSettingsStore
    private let store: SkysightStore
    private let lock = NSLock()
    private var recorderTask: Task<Void, Never>?

    init(
        settingsStore: SkysightSettingsStore = SkysightSettingsStore(),
        store: SkysightStore = SkysightStore()
    ) {
        self.settingsStore = settingsStore
        self.store = store
    }

    func start() async throws -> [String: Any] {
        if try settingsStore.read().enabled {
            startRecorderIfNeeded()
            return try status()
        }
        guard await SkysightApprovalPrompt.request() else {
            throw ComputerUseError.recordingStartDeclined
        }
        try settingsStore.setEnabled(true)
        startRecorderIfNeeded()
        return try status()
    }

    func stop() throws -> [String: Any] {
        try settingsStore.setEnabled(false)
        let task = lock.withLock { () -> Task<Void, Never>? in
            let value = recorderTask
            recorderTask = nil
            return value
        }
        task?.cancel()
        return try status()
    }

    func status() throws -> [String: Any] {
        let settings = try settingsStore.read()
        return [
            "ok": true,
            "enabled": settings.enabled,
            "paused": settings.paused,
            "retentionDays": settings.retentionDays,
            "eventsPath": store.rootURL.appendingPathComponent("events", isDirectory: true).path,
            "resourcesPath": store.rootURL.appendingPathComponent("resources", isDirectory: true).path,
            "exclusions": settings.exclusions.map(\.dictionary),
        ]
    }

    func updateExclusion(args: [String: Any]) throws -> [String: Any] {
        guard let operationValue = args["operation"] as? String,
              let operation = SkysightExclusionOperation(rawValue: operationValue) else {
            throw ComputerUseError.invalidCommand("Invalid Skysight exclusion operation")
        }
        guard let scopeValue = args["scope"] as? String,
              let scope = SkysightExclusionScope(rawValue: scopeValue) else {
            throw ComputerUseError.invalidCommand("Invalid Skysight exclusion scope")
        }
        let value = args["value"] as? String
        if scope != .privateBrowsing, value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            throw ComputerUseError.invalidCommand("A value is required for app and website exclusions")
        }
        try settingsStore.updateExclusion(
            operation: operation,
            exclusion: SkysightExclusion(scope: scope, value: value)
        )
        return try status()
    }

    func listExclusions() throws -> [String: Any] {
        let settings = try settingsStore.read()
        return ["ok": true, "exclusions": settings.exclusions.map(\.dictionary)]
    }

    private func startRecorderIfNeeded() {
        let shouldStart = lock.withLock { () -> Bool in
            guard recorderTask == nil else { return false }
            recorderTask = Task.detached { [settingsStore, store] in
                try? await SkysightRecorder(store: store, settingsStore: settingsStore).run()
            }
            return true
        }
        if !shouldStart { return }
    }
}
