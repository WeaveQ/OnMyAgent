import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

final class BackgroundInteractionInvariantTests: XCTestCase {
    func testAcceptsUnchangedForegroundAppAndCursor() throws {
        let baseline = BackgroundInteractionBaseline(
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40, y: 80)
        )

        XCTAssertNoThrow(try BackgroundInteractionInvariant.validate(
            baseline: baseline,
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40, y: 80)
        ))
    }

    func testRejectsForegroundAppChange() {
        let baseline = BackgroundInteractionBaseline(
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40, y: 80)
        )

        XCTAssertThrowsError(try BackgroundInteractionInvariant.validate(
            baseline: baseline,
            frontmostPID: 200,
            cursorPosition: CGPoint(x: 40, y: 80)
        ))
    }

    func testRejectsSystemCursorMovement() {
        let baseline = BackgroundInteractionBaseline(
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40, y: 80)
        )

        XCTAssertThrowsError(try BackgroundInteractionInvariant.validate(
            baseline: baseline,
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 42, y: 80)
        ))
    }

    func testAllowsSubpixelCursorJitter() throws {
        let baseline = BackgroundInteractionBaseline(
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40, y: 80)
        )

        XCTAssertNoThrow(try BackgroundInteractionInvariant.validate(
            baseline: baseline,
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40.25, y: 79.75)
        ))
    }

    func testAllowsIndependentUserCursorMovementWhenPhysicalInputWasObserved() throws {
        let baseline = BackgroundInteractionBaseline(
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 40, y: 80)
        )

        XCTAssertNoThrow(try BackgroundInteractionInvariant.validate(
            baseline: baseline,
            frontmostPID: 100,
            cursorPosition: CGPoint(x: 240, y: 380),
            physicalInputIsActive: true
        ))
    }
}
