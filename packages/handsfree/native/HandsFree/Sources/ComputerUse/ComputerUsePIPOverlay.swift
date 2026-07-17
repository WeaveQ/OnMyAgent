import AppKit
import Foundation

enum ComputerUsePIPPolicy {
    static func shouldShow(targetProcessID: pid_t, frontmostProcessID: pid_t?) -> Bool {
        guard let frontmostProcessID else { return false }
        return targetProcessID != frontmostProcessID
    }
}

@MainActor
final class ComputerUsePIPOverlay {
    static let shared = ComputerUsePIPOverlay()

    private var panel: NSPanel?
    private var imageView: NSImageView?
    private var titleLabel: NSTextField?

    func update(appName: String, processID: pid_t, imageData: Data) {
        let frontmostProcessID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        guard ComputerUsePIPPolicy.shouldShow(
            targetProcessID: processID,
            frontmostProcessID: frontmostProcessID
        ), let image = NSImage(data: imageData) else {
            hide()
            return
        }
        let panel = ensurePanel()
        titleLabel?.stringValue = "Computer Use · \(appName)"
        imageView?.image = image
        position(panel)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
        imageView?.image = nil
    }

    private func ensurePanel() -> NSPanel {
        if let panel { return panel }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 250),
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
        panel.hidesOnDeactivate = false

        let title = NSTextField(labelWithString: "Computer Use")
        title.font = .systemFont(ofSize: 12, weight: .semibold)
        title.lineBreakMode = .byTruncatingTail
        title.translatesAutoresizingMaskIntoConstraints = false

        let image = NSImageView()
        image.imageScaling = .scaleProportionallyUpOrDown
        image.wantsLayer = true
        image.layer?.backgroundColor = NSColor.black.cgColor
        image.layer?.cornerRadius = 8
        image.layer?.masksToBounds = true
        image.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.addSubview(title)
        content.addSubview(image)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            title.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            title.topAnchor.constraint(equalTo: content.topAnchor, constant: 10),
            image.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 10),
            image.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -10),
            image.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            image.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -10),
        ])
        panel.contentView = content
        self.panel = panel
        imageView = image
        titleLabel = title
        return panel
    }

    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        panel.setFrameOrigin(NSPoint(
            x: screen.visibleFrame.maxX - panel.frame.width - 20,
            y: screen.visibleFrame.minY + 20
        ))
    }
}
