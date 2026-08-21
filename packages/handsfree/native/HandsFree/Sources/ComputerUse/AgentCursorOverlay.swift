import AppKit
import CoreGraphics
import QuartzCore

enum AgentCursorEffect: Sendable {
    case move
    case action
}

enum AgentCursorActivityState: Sendable {
    case idle
    case loading
    case paused
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
    /// Its 126 pt carrier is presented at the user-tuned two-thirds scale,
    /// leaving the same three-sigma tail around the scaled fog without clipping.
    private static let sourcePanelSize = CGSize(width: 126, height: 126)
    static let panelSize = CGSize(
        width: sourcePanelSize.width * AgentCursorArtwork.displayScale,
        height: sourcePanelSize.height * AgentCursorArtwork.displayScale
    )
    static let hotSpot = CGPoint(x: panelSize.width / 2, y: panelSize.height / 2)

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

    func setActivityState(_ state: AgentCursorActivityState) {
        DispatchQueue.main.async { [weak self] in
            self?.panel?.cursorView.activityState = state
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

        let panel = ensurePanel()
        panel.cursorView.activityState = .idle
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
            panel.cursorView.activityState = .loading
            completion()
            return
        }

        motion = Motion(
            start: start,
            end: point,
            targetBounds: target.bounds,
            startedAt: CACurrentMediaTime(),
            duration: AgentCursorGeometry.animationDuration(from: start, to: point),
            completion: { [weak panel] in
                panel?.cursorView.activityState = .loading
                completion()
            }
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
        panel?.cursorView.activityState = .idle
        let reset = DispatchWorkItem { [weak panel] in
            panel?.cursorView.effect = .move
            panel?.cursorView.activityState = .loading
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
        panel.cursorView.ensureActivityAnimation()
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
    private let fogLayer = AgentCursorFogLayer()
    private let cursorLayer = CAShapeLayer()

    var effect: AgentCursorEffect = .move {
        didSet { updateAppearance() }
    }

    var motionVector: CGPoint = .zero {
        didSet { updateMotionTilt() }
    }

    var activityState: AgentCursorActivityState = .loading {
        didSet { updateActivityAnimation() }
    }

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.masksToBounds = false
        [fogLayer, cursorLayer].forEach {
            $0.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
            layer?.addSublayer($0)
        }
        cursorLayer.lineJoin = .round
        cursorLayer.lineCap = .round
        cursorLayer.lineWidth = 2.15 * AgentCursorArtwork.displayScale
        cursorLayer.shadowColor = NSColor.black.cgColor
        cursorLayer.shadowOpacity = 0.42
        cursorLayer.shadowRadius = 1.6 * AgentCursorArtwork.displayScale
        cursorLayer.shadowOffset = CGSize(
            width: 0,
            height: 0.8 * AgentCursorArtwork.displayScale
        )
        updateLayerGeometry()
        updateAppearance()
        updateActivityAnimation()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        updateLayerGeometry()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        ensureActivityAnimation()
    }

    private func updateLayerGeometry() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        fogLayer.frame = bounds
        fogLayer.setNeedsDisplay()
        cursorLayer.frame = bounds
        let artworkRect = CGRect(
            x: center.x - AgentCursorArtwork.displaySize.width / 2,
            y: center.y - AgentCursorArtwork.displaySize.height / 2,
            width: AgentCursorArtwork.displaySize.width,
            height: AgentCursorArtwork.displaySize.height
        )
        let artworkPath = AgentCursorArtwork.path(in: artworkRect)
        cursorLayer.path = artworkPath
        cursorLayer.shadowPath = artworkPath
        CATransaction.commit()
    }

    private func updateAppearance() {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.10)
        cursorLayer.fillColor = NSColor(
            calibratedRed: effect == .action ? 0.43 : 0.38,
            green: effect == .action ? 0.72 : 0.66,
            blue: effect == .action ? 0.86 : 0.80,
            alpha: 0.96
        ).cgColor
        cursorLayer.strokeColor = NSColor(calibratedWhite: 0.90, alpha: 0.96).cgColor
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

    func ensureActivityAnimation() {
        guard activityState == .loading,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              fogLayer.animation(forKey: "computerUseFogBreathingOpacity") == nil else {
            return
        }
        startBreathingAnimation()
    }

    private func updateActivityAnimation() {
        fogLayer.removeAllAnimations()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer?.opacity = activityState == .paused
            ? AgentCursorBreathingProfile.pausedOpacity
            : 1
        let isLoading = activityState == .loading
        fogLayer.opacity = isLoading
            ? AgentCursorBreathingProfile.loadingFogOpacity
            : AgentCursorBreathingProfile.idleFogOpacity
        fogLayer.setAffineTransform(.identity)
        CATransaction.commit()

        guard isLoading,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
            return
        }
        startBreathingAnimation()
    }

    private func startBreathingAnimation() {
        let fogOpacity = CAKeyframeAnimation(keyPath: "opacity")
        fogOpacity.values = [
            AgentCursorBreathingProfile.idleFogOpacity,
            AgentCursorBreathingProfile.loadingFogOpacity,
            AgentCursorBreathingProfile.idleFogOpacity,
        ]
        fogOpacity.keyTimes = [0, 0.5, 1]
        fogOpacity.duration = AgentCursorBreathingProfile.cycleDuration
        fogOpacity.repeatCount = .infinity
        fogOpacity.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        fogLayer.add(fogOpacity, forKey: "computerUseFogBreathingOpacity")

        let fogScale = CAKeyframeAnimation(keyPath: "transform.scale")
        fogScale.values = [0.92, 1.08, 0.92]
        fogScale.keyTimes = [0, 0.5, 1]
        fogScale.duration = AgentCursorBreathingProfile.cycleDuration
        fogScale.repeatCount = .infinity
        fogScale.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        fogLayer.add(fogScale, forKey: "computerUseFogBreathingScale")
    }
}
