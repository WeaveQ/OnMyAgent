import XCTest
@testable import HandsFreeComputerUse

final class UISettlerTests: XCTestCase {
    func testNeverSettlesBeforeOneSecondBaseline() {
        var state = UISettleState()
        XCTAssertEqual(state.observe(elapsed: 0, fingerprint: 1, isLoading: false), .waiting)
        XCTAssertEqual(state.observe(elapsed: 0.99, fingerprint: 1, isLoading: false), .waiting)
        XCTAssertEqual(state.observe(elapsed: 1.0, fingerprint: 1, isLoading: false), .settled)
    }

    func testLoadingExtendsWaitUntilIndicatorClears() {
        var state = UISettleState()
        XCTAssertEqual(state.observe(elapsed: 0, fingerprint: 1, isLoading: true), .waiting)
        XCTAssertEqual(state.observe(elapsed: 1.2, fingerprint: 1, isLoading: true), .waiting)
        XCTAssertEqual(state.observe(elapsed: 1.3, fingerprint: 1, isLoading: false), .settled)
    }

    func testChangedTreeRequiresDebounceStability() {
        var state = UISettleState()
        _ = state.observe(elapsed: 0, fingerprint: 1, isLoading: false)
        XCTAssertEqual(state.observe(elapsed: 1.0, fingerprint: 2, isLoading: false), .waiting)
        XCTAssertEqual(state.observe(elapsed: 1.19, fingerprint: 2, isLoading: false), .waiting)
        XCTAssertEqual(state.observe(elapsed: 1.25, fingerprint: 2, isLoading: false), .settled)
    }

    func testFiveSecondTimeoutWinsOverPersistentLoading() {
        var state = UISettleState()
        _ = state.observe(elapsed: 0, fingerprint: 1, isLoading: true)
        XCTAssertEqual(state.observe(elapsed: 5, fingerprint: 2, isLoading: true), .timedOut)
    }
}
