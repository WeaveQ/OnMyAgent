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

        XCTAssertEqual(frame.origin.x, 445, accuracy: 0.001)
        XCTAssertEqual(frame.origin.y, 315, accuracy: 0.001)
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

        XCTAssertEqual(frame.origin.x, 1_558, accuracy: 0.001)
        XCTAssertEqual(frame.origin.y, 618, accuracy: 0.001)
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

    func testLoadingBreathingProfileMatchesCodexFogCursorMeasurements() {
        XCTAssertEqual(AgentCursorBreathingProfile.fogRadius, 21, accuracy: 0.001)
        XCTAssertEqual(AgentCursorBreathingProfile.cycleDuration, 1.369863013698, accuracy: 0.000_001)
        XCTAssertEqual(AgentCursorBreathingProfile.idleFogGain, 0.16, accuracy: 0.001)
        XCTAssertEqual(AgentCursorBreathingProfile.loadingFogGain, 0.24, accuracy: 0.001)
        XCTAssertEqual(AgentCursorBreathingProfile.pausedOpacity, 0.5, accuracy: 0.001)
    }

    func testCursorPresentationIsOneThirdSmallerWithoutMovingItsHotSpot() {
        XCTAssertEqual(AgentCursorArtwork.displayScale, 2.0 / 3.0, accuracy: 0.001)
        XCTAssertEqual(AgentCursorArtwork.displaySize.width, 14, accuracy: 0.001)
        XCTAssertEqual(AgentCursorArtwork.displaySize.height, 14.666_667, accuracy: 0.001)
        XCTAssertEqual(AgentCursorBreathingProfile.displayFogRadius, 14, accuracy: 0.001)
        XCTAssertEqual(AgentCursorGeometry.panelSize.width, 84, accuracy: 0.001)
        XCTAssertEqual(AgentCursorGeometry.panelSize.height, 84, accuracy: 0.001)
        XCTAssertEqual(AgentCursorGeometry.hotSpot.x, 42, accuracy: 0.001)
        XCTAssertEqual(AgentCursorGeometry.hotSpot.y, 42, accuracy: 0.001)
    }

    func testAgentCursorArtworkUsesCodexVectorBounds() {
        let rect = CGRect(origin: .zero, size: AgentCursorArtwork.size)
        let bounds = AgentCursorArtwork.path(in: rect).boundingBoxOfPath

        XCTAssertGreaterThan(bounds.width, 18)
        XCTAssertGreaterThan(bounds.height, 19)
        XCTAssertLessThanOrEqual(bounds.maxX, rect.maxX)
        XCTAssertLessThanOrEqual(bounds.maxY, rect.maxY)
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
