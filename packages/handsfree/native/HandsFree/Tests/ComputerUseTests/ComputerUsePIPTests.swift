import XCTest
@testable import HandsFreeComputerUse

final class ComputerUsePIPTests: XCTestCase {
    func testPIPIsShownOnlyForBackgroundTargetApps() {
        XCTAssertTrue(ComputerUsePIPPolicy.shouldShow(targetProcessID: 41, frontmostProcessID: 42))
        XCTAssertFalse(ComputerUsePIPPolicy.shouldShow(targetProcessID: 41, frontmostProcessID: 41))
        XCTAssertFalse(ComputerUsePIPPolicy.shouldShow(targetProcessID: 41, frontmostProcessID: nil))
    }
}
