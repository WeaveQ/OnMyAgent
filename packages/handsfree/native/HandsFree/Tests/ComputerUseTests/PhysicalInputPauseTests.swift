import XCTest
@testable import HandsFreeComputerUse

final class PhysicalInputPauseTests: XCTestCase {
    func testPhysicalInputPausesUntilQuietWindowExpires() {
        var state = PhysicalInputPauseState(quietWindow: 1)
        XCTAssertFalse(state.isPaused(at: 10))
        state.recordPhysicalInput(at: 10)
        XCTAssertTrue(state.isPaused(at: 10.99))
        XCTAssertFalse(state.isPaused(at: 11))
    }

    func testRepeatedInputExtendsPauseWindow() {
        var state = PhysicalInputPauseState(quietWindow: 1)
        state.recordPhysicalInput(at: 10)
        state.recordPhysicalInput(at: 10.8)
        XCTAssertTrue(state.isPaused(at: 11.1))
        XCTAssertFalse(state.isPaused(at: 11.8))
    }
}
