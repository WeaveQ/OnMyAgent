import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

final class AccessibilityFrameResolverTests: XCTestCase {
    func testKeepsRawFrameWhenItsCenterHitsTheElement() {
        let rawFrame = CGRect(x: 100, y: 120, width: 40, height: 30)
        let resolved = AccessibilityFrameResolver.resolve(
            rawFrame: rawFrame,
            parentFrame: CGRect(x: 80, y: 80, width: 300, height: 240),
            hitMatchesElement: { $0 == CGPoint(x: 120, y: 135) }
        )

        XCTAssertEqual(resolved, rawFrame)
    }

    func testFlipsAChildInsideItsParentOnlyWhenHitTestingConfirmsIt() {
        let parentFrame = CGRect(x: 113, y: 64, width: 905, height: 677)
        let rawFrame = CGRect(x: 442, y: 180, width: 55, height: 55)
        let expected = CGRect(x: 442, y: 570, width: 55, height: 55)

        let resolved = AccessibilityFrameResolver.resolve(
            rawFrame: rawFrame,
            parentFrame: parentFrame,
            hitMatchesElement: { $0 == CGPoint(x: 469.5, y: 597.5) }
        )

        XCTAssertEqual(resolved, expected)
    }

    func testKeepsRawFrameWhenNeitherCoordinateSystemHitsTheElement() {
        let rawFrame = CGRect(x: 442, y: 180, width: 55, height: 55)
        let resolved = AccessibilityFrameResolver.resolve(
            rawFrame: rawFrame,
            parentFrame: CGRect(x: 113, y: 64, width: 905, height: 677),
            hitMatchesElement: { _ in false }
        )

        XCTAssertEqual(resolved, rawFrame)
    }
}
