import AppKit
import CoreGraphics
import QuartzCore

enum AgentCursorEffect: Sendable {
    case move
    case action
}

struct AgentCursorTarget: Equatable, Sendable {
    let pid: pid_t
    let windowNumber: Int
    let bounds: CGRect

    init?(pid: pid_t, windowNumber: Int?, bounds: CGRect) {
        guard let windowNumber, windowNumber > 0 else { return nil }
        self.pid = pid
        self.windowNumber = windowNumber
        self.bounds = bounds
    }

    init?(snapshot: AppSnapshot) {
        self.init(
            pid: snapshot.pid,
            windowNumber: snapshot.windowNumber,
            bounds: snapshot.screenshotMeta.capturedBounds
        )
    }

    init?(windowTarget: WindowTarget) {
        self.init(
            pid: windowTarget.pid,
            windowNumber: windowTarget.windowNumber,
            bounds: windowTarget.bounds
        )
    }
}

struct AgentCursorTargetWindowState: Equatable {
    let windowNumber: Int
    let pid: pid_t
    let bounds: CGRect
    let layer: Int
    let isOnScreen: Bool

    static func parse(_ info: [String: Any], target: AgentCursorTarget) -> Self? {
        guard number(info[kCGWindowNumber as String])?.intValue == target.windowNumber,
              number(info[kCGWindowOwnerPID as String])?.int32Value == target.pid,
              let rawBounds = info[kCGWindowBounds as String] as? [String: Any],
              let x = number(rawBounds["X"])?.doubleValue,
              let y = number(rawBounds["Y"])?.doubleValue,
              let width = number(rawBounds["Width"])?.doubleValue,
              let height = number(rawBounds["Height"])?.doubleValue else {
            return nil
        }
        return Self(
            windowNumber: target.windowNumber,
            pid: target.pid,
            bounds: CGRect(x: x, y: y, width: width, height: height),
            layer: number(info[kCGWindowLayer as String])?.intValue ?? 0,
            isOnScreen: number(info[kCGWindowIsOnscreen as String])?.boolValue ?? false
        )
    }

    private static func number(_ value: Any?) -> NSNumber? {
        value as? NSNumber
    }
}

enum AgentCursorGeometry {
    /// Codex's fog cursor reports the center of its fitting size as its hotspot.
    /// A compact 34 pt surface keeps the nine-point cursor core and its halo
    /// visible without obscuring the target beneath it.
    static let panelSize = CGSize(width: 34, height: 34)
    static let hotSpot = CGPoint(x: 17, y: 17)

    static func panelFrame(
        for topLeftGlobalPoint: CGPoint,
        mainDisplayHeight: CGFloat,
        size: CGSize = panelSize,
        hotSpot: CGPoint = hotSpot
    ) -> CGRect {
        CGRect(
            x: topLeftGlobalPoint.x - hotSpot.x,
            y: mainDisplayHeight - topLeftGlobalPoint.y - (size.height - hotSpot.y),
            width: size.width,
            height: size.height
        )
    }

    static func topLeftGlobalPoint(
        for panelFrame: CGRect,
        mainDisplayHeight: CGFloat,
        size: CGSize = panelSize,
        hotSpot: CGPoint = hotSpot
    ) -> CGPoint {
        CGPoint(
            x: panelFrame.minX + hotSpot.x,
            y: mainDisplayHeight - panelFrame.minY - (size.height - hotSpot.y)
        )
    }

    static func animationDuration(from start: CGPoint, to end: CGPoint) -> TimeInterval {
        let distance = hypot(end.x - start.x, end.y - start.y)
        return min(0.48, max(0.18, 0.14 + TimeInterval(distance / 1_650)))
    }

    static func motionPoint(
        from start: CGPoint,
        to end: CGPoint,
        progress rawProgress: CGFloat,
        constrainedTo bounds: CGRect?
    ) -> CGPoint {
        let progress = min(1, max(0, rawProgress))
        if progress == 0 { return start }
        if progress == 1 { return end }

        let eased = progress * progress * (3 - 2 * progress)
        let delta = CGPoint(x: end.x - start.x, y: end.y - start.y)
        let distance = hypot(delta.x, delta.y)
        guard distance >= 72 else {
            return CGPoint(
                x: start.x + delta.x * eased,
                y: start.y + delta.y * eased
            )
        }

        let midpoint = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
        let normal = CGPoint(x: -delta.y / distance, y: delta.x / distance)
        let direction: CGFloat = delta.x * delta.y >= 0 ? 1 : -1
        let arc = min(54, max(10, distance * 0.09)) * direction
        var control = CGPoint(
            x: midpoint.x + normal.x * arc,
            y: midpoint.y + normal.y * arc
        )
        if let bounds {
            let safeBounds = bounds.insetBy(dx: 8, dy: 8)
            control.x = min(safeBounds.maxX, max(safeBounds.minX, control.x))
            control.y = min(safeBounds.maxY, max(safeBounds.minY, control.y))
        }

        let inverse = 1 - eased
        return CGPoint(
            x: inverse * inverse * start.x + 2 * inverse * eased * control.x + eased * eased * end.x,
            y: inverse * inverse * start.y + 2 * inverse * eased * control.y + eased * eased * end.y
        )
    }
}

struct AgentCursorDebugState: Sendable {
    let windowNumber: Int?
    let targetWindowNumber: Int?
    let point: CGPoint?
    let isVisible: Bool
}

final class AgentCursorOverlay: @unchecked Sendable {
    static let shared = AgentCursorOverlay()

    private struct Motion {
        let start: CGPoint
        let end: CGPoint
        let targetBounds: CGRect
        let startedAt: CFTimeInterval
        let duration: TimeInterval
        let completion: () -> Void
    }

    private var panel: AgentCursorPanel?
    private var target: AgentCursorTarget?
    private var currentPoint: CGPoint?
    private var wantsToBeVisible = false
    private var actionResetWorkItem: DispatchWorkItem?
    private var motion: Motion?
    private var motionTimer: DispatchSourceTimer?
    private var orderingTimer: DispatchSourceTimer?
    private var observerTokens: [NSObjectProtocol] = []

    func move(
        to point: CGPoint,
        target: AgentCursorTarget?,
        animated: Bool = true
    ) async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { [weak self] in
                guard let self else {
                    continuation.resume()
                    return
                }
                self.moveOnMain(
                    to: point,
                    target: target,
                    animated: animated,
                    completion: { continuation.resume() }
                )
            }
        }
    }

    func indicateAction() {
        DispatchQueue.main.async { [weak self] in
            self?.setActionEffectOnMain()
        }
    }

    func hide() {
        DispatchQueue.main.async { [weak self] in
            self?.hideOnMain()
        }
    }

    func debugState() async -> AgentCursorDebugState {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { [weak self] in
                guard let self else {
                    continuation.resume(returning: AgentCursorDebugState(
                        windowNumber: nil,
                        targetWindowNumber: nil,
                        point: nil,
                        isVisible: false
                    ))
                    return
                }
                continuation.resume(returning: AgentCursorDebugState(
                    windowNumber: self.panel?.windowNumber,
                    targetWindowNumber: self.target?.windowNumber,
                    point: self.currentPoint,
                    isVisible: self.panel?.isVisible ?? false
                ))
            }
        }
    }

    private func moveOnMain(
        to point: CGPoint,
        target: AgentCursorTarget?,
        animated: Bool,
        completion: @escaping () -> Void
    ) {
        cancelMotion(finishAtDestination: false)
        guard let target else {
            currentPoint = point
            wantsToBeVisible = false
            panel?.orderOut(nil)
            completion()
            return
        }

        _ = ensurePanel()
        self.target = target
        wantsToBeVisible = true
        startOrderingMonitor()

        let start = currentPoint ?? point
        let shouldAnimate = animated
            && currentPoint != nil
            && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            && hypot(point.x - start.x, point.y - start.y) >= 1

        if !shouldAnimate {
            currentPoint = point
            setPanelPosition(point)
            reconcileWindowOrdering()
            completion()
            return
        }

        motion = Motion(
            start: start,
            end: point,
            targetBounds: target.bounds,
            startedAt: CACurrentMediaTime(),
            duration: AgentCursorGeometry.animationDuration(from: start, to: point),
            completion: completion
        )
        reconcileWindowOrdering()
        startMotionTimer()
    }

    private func startMotionTimer() {
        guard motionTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(16), leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in
            self?.advanceMotion()
        }
        motionTimer = timer
        timer.resume()
    }

    private func advanceMotion() {
        guard let motion else {
            stopMotionTimer()
            return
        }
        let elapsed = CACurrentMediaTime() - motion.startedAt
        let progress = min(1, max(0, elapsed / motion.duration))
        let point = AgentCursorGeometry.motionPoint(
            from: motion.start,
            to: motion.end,
            progress: CGFloat(progress),
            constrainedTo: motion.targetBounds
        )
        currentPoint = point
        setPanelPosition(point)
        panel?.cursorView.motionVector = CGPoint(
            x: motion.end.x - motion.start.x,
            y: motion.end.y - motion.start.y
        )

        guard progress >= 1 else { return }
        self.motion = nil
        stopMotionTimer()
        panel?.cursorView.motionVector = .zero
        motion.completion()
    }

    private func cancelMotion(finishAtDestination: Bool) {
        guard let motion else { return }
        self.motion = nil
        stopMotionTimer()
        if finishAtDestination {
            currentPoint = motion.end
            setPanelPosition(motion.end)
        }
        motion.completion()
    }

    private func stopMotionTimer() {
        motionTimer?.setEventHandler {}
        motionTimer?.cancel()
        motionTimer = nil
    }

    private func setPanelPosition(_ point: CGPoint) {
        guard let panel else { return }
        let mainDisplayHeight = CGDisplayBounds(CGMainDisplayID()).height
        let destination = AgentCursorGeometry.panelFrame(
            for: point,
            mainDisplayHeight: mainDisplayHeight
        )
        panel.setFrame(destination, display: true)
    }

    private func setActionEffectOnMain() {
        actionResetWorkItem?.cancel()
        panel?.cursorView.effect = .action
        let reset = DispatchWorkItem { [weak panel] in
            panel?.cursorView.effect = .move
        }
        actionResetWorkItem = reset
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.24, execute: reset)
    }

    private func hideOnMain() {
        actionResetWorkItem?.cancel()
        actionResetWorkItem = nil
        cancelMotion(finishAtDestination: false)
        wantsToBeVisible = false
        target = nil
        panel?.orderOut(nil)
        stopOrderingMonitor()
    }

    private func windowState(for target: AgentCursorTarget) -> AgentCursorTargetWindowState? {
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionIncludingWindow, .excludeDesktopElements],
            CGWindowID(target.windowNumber)
        ) as? [[String: Any]] else {
            return nil
        }
        return windows.lazy.compactMap {
            AgentCursorTargetWindowState.parse($0, target: target)
        }.first
    }

    private func reconcileWindowOrdering() {
        guard wantsToBeVisible,
              let panel,
              let target,
              let state = windowState(for: target),
              state.isOnScreen,
              let currentPoint,
              state.bounds.insetBy(dx: -4, dy: -4).contains(currentPoint) else {
            panel?.orderOut(nil)
            return
        }

        panel.level = NSWindow.Level(rawValue: state.layer)
        panel.order(.above, relativeTo: target.windowNumber)
    }

    private func startOrderingMonitor() {
        installObserversIfNeeded()
        guard orderingTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .milliseconds(200), repeating: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            self?.reconcileWindowOrdering()
        }
        orderingTimer = timer
        timer.resume()
    }

    private func stopOrderingMonitor() {
        orderingTimer?.setEventHandler {}
        orderingTimer?.cancel()
        orderingTimer = nil
    }

    private func installObserversIfNeeded() {
        guard observerTokens.isEmpty else { return }
        let workspaceCenter = NSWorkspace.shared.notificationCenter
        let workspaceNames: [Notification.Name] = [
            NSWorkspace.didActivateApplicationNotification,
            NSWorkspace.didHideApplicationNotification,
            NSWorkspace.didUnhideApplicationNotification,
            NSWorkspace.didTerminateApplicationNotification,
            NSWorkspace.activeSpaceDidChangeNotification,
        ]
        observerTokens += workspaceNames.map { name in
            workspaceCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.reconcileWindowOrdering()
            }
        }
        observerTokens.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.didChangeScreenParametersNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.reconcileWindowOrdering()
            }
        )
    }

    private func ensurePanel() -> AgentCursorPanel {
        if let panel { return panel }

        let panel = AgentCursorPanel(
            contentRect: NSRect(origin: .zero, size: AgentCursorGeometry.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "OnMyAgent Computer Use Cursor"
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.level = .normal
        panel.animationBehavior = .none
        panel.collectionBehavior = [.transient, .ignoresCycle]
        panel.contentView = panel.cursorView
        self.panel = panel
        return panel
    }
}

final class AgentCursorPanel: NSPanel {
    let cursorView = AgentCursorView(
        frame: NSRect(origin: .zero, size: AgentCursorGeometry.panelSize)
    )

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

final class AgentCursorView: NSView {
    private let outerGlowLayer = CAShapeLayer()
    private let innerGlowLayer = CAShapeLayer()
    private let cursorLayer = CAShapeLayer()

    var effect: AgentCursorEffect = .move {
        didSet { updateAppearance() }
    }

    var motionVector: CGPoint = .zero {
        didSet { updateMotionTilt() }
    }

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.masksToBounds = false
        [outerGlowLayer, innerGlowLayer, cursorLayer].forEach {
            $0.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
            layer?.addSublayer($0)
        }
        cursorLayer.lineJoin = .round
        cursorLayer.lineCap = .round
        cursorLayer.lineWidth = 1.15
        updateLayerGeometry()
        updateAppearance()
        startBreathingAnimation()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateLayerGeometry()
    }

    private func updateLayerGeometry() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        outerGlowLayer.frame = bounds
        innerGlowLayer.frame = bounds
        cursorLayer.frame = bounds
        outerGlowLayer.path = CGPath(ellipseIn: bounds.insetBy(dx: 3.5, dy: 3.5), transform: nil)
        innerGlowLayer.path = CGPath(ellipseIn: bounds.insetBy(dx: 7.5, dy: 7.5), transform: nil)

        let arrow = CGMutablePath()
        arrow.move(to: CGPoint(x: 17, y: 16))
        arrow.addLine(to: CGPoint(x: 17.8, y: 28.4))
        arrow.addLine(to: CGPoint(x: 21.0, y: 24.8))
        arrow.addLine(to: CGPoint(x: 24.0, y: 30.2))
        arrow.addLine(to: CGPoint(x: 27.0, y: 28.5))
        arrow.addLine(to: CGPoint(x: 23.9, y: 23.2))
        arrow.addLine(to: CGPoint(x: 28.5, y: 22.8))
        arrow.closeSubpath()
        cursorLayer.path = arrow
        CATransaction.commit()
    }

    private func updateAppearance() {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.10)
        if effect == .action {
            outerGlowLayer.fillColor = NSColor.systemRed.withAlphaComponent(0.20).cgColor
            innerGlowLayer.fillColor = NSColor.systemRed.withAlphaComponent(0.16).cgColor
            innerGlowLayer.strokeColor = NSColor.white.withAlphaComponent(0.54).cgColor
            cursorLayer.fillColor = NSColor.systemRed.withAlphaComponent(0.96).cgColor
        } else {
            outerGlowLayer.fillColor = NSColor.systemBlue.withAlphaComponent(0.14).cgColor
            innerGlowLayer.fillColor = NSColor(calibratedWhite: 0.72, alpha: 0.14).cgColor
            innerGlowLayer.strokeColor = NSColor.white.withAlphaComponent(0.42).cgColor
            cursorLayer.fillColor = NSColor(calibratedWhite: 0.58, alpha: 0.90).cgColor
        }
        innerGlowLayer.lineWidth = 0.8
        cursorLayer.strokeColor = NSColor.white.withAlphaComponent(0.94).cgColor
        CATransaction.commit()
    }

    private func updateMotionTilt() {
        let distance = hypot(motionVector.x, motionVector.y)
        let tilt: CGFloat
        if distance < 1 {
            tilt = 0
        } else {
            tilt = min(0.12, max(-0.12, motionVector.x / distance * 0.12))
        }
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.12)
        cursorLayer.setAffineTransform(CGAffineTransform(rotationAngle: tilt))
        CATransaction.commit()
    }

    private func startBreathingAnimation() {
        let opacity = CAKeyframeAnimation(keyPath: "opacity")
        opacity.values = [0.46, 0.92, 0.46]
        opacity.keyTimes = [0, 0.5, 1]
        opacity.duration = 1.55
        opacity.repeatCount = .infinity
        opacity.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        outerGlowLayer.add(opacity, forKey: "computerUseBreathingOpacity")

        let scale = CAKeyframeAnimation(keyPath: "transform.scale")
        scale.values = [0.90, 1.06, 0.90]
        scale.keyTimes = [0, 0.5, 1]
        scale.duration = 1.55
        scale.repeatCount = .infinity
        scale.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        outerGlowLayer.add(scale, forKey: "computerUseBreathingScale")
    }
}
