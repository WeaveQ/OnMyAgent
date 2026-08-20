import CoreGraphics

enum AccessibilityFrameResolver {
    static func resolve(
        rawFrame: CGRect,
        parentFrame: CGRect?,
        hitMatchesElement: (CGPoint) -> Bool
    ) -> CGRect {
        if hitMatchesElement(center(of: rawFrame)) {
            return rawFrame
        }
        guard let parentFrame,
              parentFrame.contains(center(of: rawFrame)) else {
            return rawFrame
        }

        let flippedFrame = verticallyFlipped(rawFrame, within: parentFrame)
        guard hitMatchesElement(center(of: flippedFrame)) else {
            return rawFrame
        }
        return flippedFrame
    }

    static func verticallyFlipped(_ frame: CGRect, within parentFrame: CGRect) -> CGRect {
        CGRect(
            x: frame.minX,
            y: parentFrame.minY + parentFrame.maxY - frame.maxY,
            width: frame.width,
            height: frame.height
        )
    }

    static func center(of frame: CGRect) -> CGPoint {
        CGPoint(x: frame.midX, y: frame.midY)
    }
}
