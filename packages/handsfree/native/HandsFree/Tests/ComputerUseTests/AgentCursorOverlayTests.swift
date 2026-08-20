import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

final class AgentCursorOverlayTests: XCTestCase {
    func testHotSpotRoundTripsThroughAppKitCoordinateSpace() {
        let target = CGPoint(x: 487, y: 543)
        let frame = AgentCursorGeometry.panelFrame(
            for: target,
            mainDisplayHeight: 900
        )

        XCTAssertEqual(frame.origin.x, 470, accuracy: 0.001)
        XCTAssertEqual(frame.origin.y, 340, accuracy: 0.001)
        let roundTrip = AgentCursorGeometry.topLeftGlobalPoint(
            for: frame,
            mainDisplayHeight: 900
        )
        XCTAssertEqual(roundTrip.x, target.x, accuracy: 0.001)
        XCTAssertEqual(roundTrip.y, target.y, accuracy: 0.001)
    }

    func testSecondaryDisplayCoordinatesDoNotDoubleApplyScreenOrigin() {
        let frame = AgentCursorGeometry.panelFrame(
            for: CGPoint(x: 1_600, y: 240),
            mainDisplayHeight: 900
        )

        XCTAssertEqual(frame.origin.x, 1_583, accuracy: 0.001)
        XCTAssertEqual(frame.origin.y, 643, accuracy: 0.001)
    }

    func testCursorMovementUsesBoundedVisibleAnimation() {
        XCTAssertEqual(
            AgentCursorGeometry.animationDuration(
                from: CGPoint(x: 0, y: 0),
                to: CGPoint(x: 20, y: 0)
            ),
            0.18,
            accuracy: 0.001
        )
        XCTAssertEqual(
            AgentCursorGeometry.animationDuration(
                from: CGPoint(x: 0, y: 0),
                to: CGPoint(x: 2_000, y: 0)
            ),
            0.48,
            accuracy: 0.001
        )
    }

    func testLongMovementUsesAVisibleCurvedPathInsideTheTargetWindow() {
        let start = CGPoint(x: 100, y: 100)
        let end = CGPoint(x: 500, y: 300)
        let bounds = CGRect(x: 80, y: 80, width: 460, height: 260)
        let midpoint = AgentCursorGeometry.motionPoint(
            from: start,
            to: end,
            progress: 0.5,
            constrainedTo: bounds
        )

        XCTAssertNotEqual(midpoint.y, 200, accuracy: 0.001)
        XCTAssertTrue(bounds.contains(midpoint))
        XCTAssertEqual(
            AgentCursorGeometry.motionPoint(
                from: start,
                to: end,
                progress: 1,
                constrainedTo: bounds
            ),
            end
        )
    }

    func testTargetWindowStateRejectsAnotherProcessAndPreservesWindowLayer() throws {
        let target = try XCTUnwrap(AgentCursorTarget(
            pid: 321,
            windowNumber: 654,
            bounds: CGRect(x: 100, y: 120, width: 640, height: 480)
        ))
        let info: [String: Any] = [
            kCGWindowNumber as String: NSNumber(value: 654),
            kCGWindowOwnerPID as String: NSNumber(value: 321),
            kCGWindowBounds as String: [
                "X": NSNumber(value: 100),
                "Y": NSNumber(value: 120),
                "Width": NSNumber(value: 640),
                "Height": NSNumber(value: 480),
            ],
            kCGWindowLayer as String: NSNumber(value: 3),
            kCGWindowIsOnscreen as String: NSNumber(value: true),
        ]

        let state = try XCTUnwrap(AgentCursorTargetWindowState.parse(info, target: target))
        XCTAssertEqual(state.layer, 3)
        XCTAssertTrue(state.isOnScreen)

        var wrongProcess = info
        wrongProcess[kCGWindowOwnerPID as String] = NSNumber(value: 999)
        XCTAssertNil(AgentCursorTargetWindowState.parse(wrongProcess, target: target))
    }
}
