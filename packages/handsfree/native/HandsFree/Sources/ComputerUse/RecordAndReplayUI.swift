import AppKit
import Foundation

struct RecordAndReplayCopy: Sendable {
    let approvalTitle: String
    let approvalMessage: String
    let startRecording: String
    let cancel: String
    let recordingTitle: String
    let stopRecording: String
    let discardRecording: String
    let discardTitle: String
    let discardMessage: String

    static var current: RecordAndReplayCopy {
        resolve(Locale.preferredLanguages)
    }

    static func resolve(_ preferredLanguages: [String]) -> RecordAndReplayCopy {
        let language = preferredLanguages.first?.lowercased() ?? "en"
        if language.hasPrefix("zh-hant") || language.hasPrefix("zh-tw") || language.hasPrefix("zh-hk") {
            return traditionalChinese
        }
        if language.hasPrefix("zh") { return simplifiedChinese }
        return english
    }

    private static let english = RecordAndReplayCopy(
        approvalTitle: "Start Record & Replay?",
        approvalMessage: "OnMyAgent will record mouse clicks, typed text, and visible app context locally until you stop it or 30 minutes pass. Protected security and password manager apps are excluded.",
        startRecording: "Start Recording",
        cancel: "Cancel",
        recordingTitle: "Record & Replay is recording your actions",
        stopRecording: "Stop",
        discardRecording: "Discard Recording",
        discardTitle: "Discard this recording?",
        discardMessage: "The local recording metadata and events will be permanently deleted."
    )

    private static let simplifiedChinese = RecordAndReplayCopy(
        approvalTitle: "开始 Record & Replay？",
        approvalMessage: "OnMyAgent 会在本地录制鼠标点击、输入文字和可见的应用上下文，直到你停止录制或达到 30 分钟。系统安全进程和密码管理器不会被录制。",
        startRecording: "开始录制",
        cancel: "取消",
        recordingTitle: "Record & Replay 正在录制你的操作",
        stopRecording: "停止",
        discardRecording: "丢弃录制",
        discardTitle: "丢弃此次录制？",
        discardMessage: "本地录制元数据和事件将被永久删除。"
    )

    private static let traditionalChinese = RecordAndReplayCopy(
        approvalTitle: "開始 Record & Replay？",
        approvalMessage: "OnMyAgent 會在本機錄製滑鼠點擊、輸入文字與可見的應用程式脈絡，直到你停止錄製或達到 30 分鐘。系統安全程序與密碼管理器不會被錄製。",
        startRecording: "開始錄製",
        cancel: "取消",
        recordingTitle: "Record & Replay 正在錄製你的操作",
        stopRecording: "停止",
        discardRecording: "捨棄錄製",
        discardTitle: "捨棄這次錄製？",
        discardMessage: "本機錄製中繼資料與事件將被永久刪除。"
    )
}

enum RecordAndReplayApprovalPrompt {
    @MainActor
    static func request() -> Bool {
        let copy = RecordAndReplayCopy.current
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = copy.approvalTitle
        alert.informativeText = copy.approvalMessage
        alert.addButton(withTitle: copy.startRecording)
        alert.addButton(withTitle: copy.cancel)
        let previous = NSWorkspace.shared.frontmostApplication
        NSApplication.shared.activate(ignoringOtherApps: true)
        let approved = alert.runModal() == .alertFirstButtonReturn
        if previous?.isTerminated == false { previous?.activate() }
        return approved
    }
}

@MainActor
final class RecordAndReplayOverlay {
    static let shared = RecordAndReplayOverlay()

    private var panel: NSPanel?
    private var stopAction: (() -> Void)?
    private var discardAction: (() -> Void)?

    func show(onStop: @escaping () -> Void, onDiscard: @escaping () -> Void) {
        stopAction = onStop
        discardAction = onDiscard
        let panel = ensurePanel()
        position(panel)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
        stopAction = nil
        discardAction = nil
    }

    private func ensurePanel() -> NSPanel {
        if let panel { return panel }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 540, height: 72),
            styleMask: [.titled, .nonactivatingPanel, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]

        let dot = NSView(frame: NSRect(x: 0, y: 0, width: 10, height: 10))
        dot.wantsLayer = true
        dot.layer?.backgroundColor = NSColor.systemRed.cgColor
        dot.layer?.cornerRadius = 5
        dot.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 10),
            dot.heightAnchor.constraint(equalToConstant: 10),
        ])

        let copy = RecordAndReplayCopy.current
        let label = NSTextField(labelWithString: copy.recordingTitle)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let stop = ClosureButton(title: copy.stopRecording) { [weak self] in
            self?.stopAction?()
        }
        stop.bezelStyle = .rounded

        let discard = ClosureButton(title: copy.discardRecording) { [weak self] in
            self?.confirmDiscard()
        }
        discard.bezelStyle = .rounded
        discard.contentTintColor = .systemRed

        let stack = NSStackView(views: [dot, label, stop, discard])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
        ])
        panel.contentView = content
        self.panel = panel
        return panel
    }

    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let x = screen.visibleFrame.midX - panel.frame.width / 2
        let y = screen.visibleFrame.maxY - panel.frame.height - 20
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func confirmDiscard() {
        let copy = RecordAndReplayCopy.current
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = copy.discardTitle
        alert.informativeText = copy.discardMessage
        alert.addButton(withTitle: copy.discardRecording)
        alert.addButton(withTitle: copy.cancel)
        if alert.runModal() == .alertFirstButtonReturn {
            discardAction?()
        }
    }
}

@MainActor
private final class ClosureButton: NSButton {
    private let actionHandler: () -> Void

    init(title: String, action: @escaping () -> Void) {
        actionHandler = action
        super.init(frame: .zero)
        self.title = title
        target = self
        self.action = #selector(performAction)
    }

    required init?(coder: NSCoder) {
        nil
    }

    @objc private func performAction() {
        actionHandler()
    }
}
