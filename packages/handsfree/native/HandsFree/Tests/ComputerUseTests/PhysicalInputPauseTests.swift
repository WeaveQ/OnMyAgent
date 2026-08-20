import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

final class PhysicalInputPauseTests: XCTestCase {
    func testOnlyHardwareSourcedEventsCountAsPhysicalInput() {
        XCTAssertTrue(PhysicalInputClassifier.isPhysical(sourcePID: 0))
        XCTAssertTrue(PhysicalInputClassifier.isPhysical(sourcePID: -1))
        XCTAssertFalse(PhysicalInputClassifier.isPhysical(sourcePID: 42))
        XCTAssertFalse(PhysicalInputClassifier.isPhysical(sourcePID: getpid()))
    }

    func testWindowTrackingMotionAtTheSameCursorLocationIsIgnored() {
        XCTAssertFalse(PhysicalInputClassifier.pointerMoved(
            from: CGPoint(x: 120, y: 240),
            to: CGPoint(x: 120.25, y: 240.25)
        ))
        XCTAssertTrue(PhysicalInputClassifier.pointerMoved(
            from: CGPoint(x: 120, y: 240),
            to: CGPoint(x: 122, y: 240)
        ))
    }

    func testPhysicalInputPausesUntilQuietWindowExpires() {
        var state = PhysicalInputPauseState(quietWindow: 1)
        XCTAssertFalse(state.isPaused(at: 10))
        state.recordPhysicalInput(at: 10)
        XCTAssertTrue(state.isPaused(at: 10.99))
        XCTAssertFalse(state.isPaused(at: 11))
    }

    func testPhysicalInputDoesNotPauseIndependentVirtualInput() {
        XCTAssertFalse(PhysicalInputPausePolicy.shouldPause(
            strictMode: true,
            physicalInputIsActive: true
        ))
        XCTAssertTrue(PhysicalInputPausePolicy.shouldPause(
            strictMode: false,
            physicalInputIsActive: true
        ))
        XCTAssertFalse(PhysicalInputPausePolicy.shouldPause(
            strictMode: false,
            physicalInputIsActive: false
        ))
    }

    func testRepeatedInputExtendsPauseWindow() {
        var state = PhysicalInputPauseState(quietWindow: 1)
        state.recordPhysicalInput(at: 10)
        state.recordPhysicalInput(at: 10.8)
        XCTAssertTrue(state.isPaused(at: 11.1))
        XCTAssertFalse(state.isPaused(at: 11.8))
    }
}
