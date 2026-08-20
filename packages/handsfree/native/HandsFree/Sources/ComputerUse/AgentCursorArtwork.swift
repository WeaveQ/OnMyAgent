import AppKit
import CoreGraphics

/// Vector artwork reconstructed from Codex's `AgentCursor.path(in:)`.
///
/// Codex does not ship the runtime cursor as an image asset. The visible
/// pointer is a SwiftUI `Shape`; these normalized Bezier coordinates are the
/// constants used by that shape in `SkyComputerUseService`.
enum AgentCursorArtwork {
    /// User-tuned presentation size: one third smaller than Codex's source
    /// measurements while preserving the same vector proportions.
    static let displayScale: CGFloat = 2.0 / 3.0
    static let size = CGSize(width: 21, height: 22)
    static let displaySize = CGSize(
        width: size.width * displayScale,
        height: size.height * displayScale
    )

    static func path(in rect: CGRect) -> CGPath {
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
        }

        let path = CGMutablePath()
        path.move(to: point(0.00599, 0.15864))
        path.addCurve(
            to: point(0.15158, 0.00627),
            control1: point(-0.02364, 0.06456),
            control2: point(0.06169, -0.02474)
        )
        path.addLine(to: point(0.87634, 0.25652))
        path.addCurve(
            to: point(0.88794, 0.48095),
            control1: point(0.97594, 0.29096),
            control2: point(0.98340, 0.43547)
        )
        path.addLine(to: point(0.59343, 0.62108))
        path.addLine(to: point(0.45955, 0.92925))
        path.addCurve(
            to: point(0.24510, 0.91717),
            control1: point(0.41611, 1.02925),
            control2: point(0.27801, 1.02146)
        )
        path.closeSubpath()
        return path
    }
}

enum AgentCursorBreathingProfile {
    /// Values reconstructed from Codex's `FogCursorViewModel` and
    /// `CursorView`: 21 pt radial fog, loading opacity 0.16...0.24, and a
    /// 0.684931506849 second half-cycle.
    static let fogRadius: CGFloat = 21
    static let displayFogRadius = fogRadius * AgentCursorArtwork.displayScale
    static let halfCycleDuration: TimeInterval = 0.684931506849
    static let cycleDuration: TimeInterval = halfCycleDuration * 2
    static let fogBaseOpacity: Float = 0.58
    static let idleFogGain: Float = 0.16
    static let loadingFogGain: Float = 0.24
    static let idleFogOpacity = fogBaseOpacity + idleFogGain
    static let loadingFogOpacity = fogBaseOpacity + loadingFogGain
    static let pausedOpacity: Float = 0.5
}

/// Core Animation's radial gradient clamps transparent color stops on some
/// macOS releases. Drawing the radial mask explicitly keeps Codex's soft
/// three-sigma fog tail instead of producing a visible circular edge.
final class AgentCursorFogLayer: CALayer {
    override init() {
        super.init()
        needsDisplayOnBoundsChange = true
    }

    override init(layer: Any) {
        super.init(layer: layer)
        needsDisplayOnBoundsChange = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(in context: CGContext) {
        let fogBlue = NSColor(calibratedRed: 0.19, green: 0.64, blue: 0.91, alpha: 1)
        let colors = [
            fogBlue.withAlphaComponent(0.85).cgColor,
            fogBlue.withAlphaComponent(0.68).cgColor,
            fogBlue.withAlphaComponent(0.36).cgColor,
            fogBlue.withAlphaComponent(0.14).cgColor,
            fogBlue.withAlphaComponent(0).cgColor,
        ] as CFArray
        let locations: [CGFloat] = [0, 0.30, 0.58, 0.80, 1]
        guard let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: colors,
            locations: locations
        ) else {
            return
        }
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        context.drawRadialGradient(
            gradient,
            startCenter: center,
            startRadius: 0,
            endCenter: center,
            endRadius: min(bounds.width, bounds.height) / 2,
            options: []
        )
    }
}
