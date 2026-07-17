import CoreGraphics
import XCTest
@testable import HandsFreeComputerUse

final class InputCompatibilityTests: XCTestCase {
    func testMouseButtonsMapToMatchingCoreGraphicsEvents() {
        XCTAssertEqual(ComputerMouseButton.left.cgButton, .left)
        XCTAssertEqual(ComputerMouseButton.left.downEventType, .leftMouseDown)
        XCTAssertEqual(ComputerMouseButton.left.upEventType, .leftMouseUp)
        XCTAssertEqual(ComputerMouseButton.left.dragEventType, .leftMouseDragged)

        XCTAssertEqual(ComputerMouseButton.right.cgButton, .right)
        XCTAssertEqual(ComputerMouseButton.right.downEventType, .rightMouseDown)
        XCTAssertEqual(ComputerMouseButton.right.upEventType, .rightMouseUp)
        XCTAssertEqual(ComputerMouseButton.right.dragEventType, .rightMouseDragged)

        XCTAssertEqual(ComputerMouseButton.middle.cgButton, .center)
        XCTAssertEqual(ComputerMouseButton.middle.downEventType, .otherMouseDown)
        XCTAssertEqual(ComputerMouseButton.middle.upEventType, .otherMouseUp)
        XCTAssertEqual(ComputerMouseButton.middle.dragEventType, .otherMouseDragged)
    }

    func testClickCountIsKeptWithinSupportedBounds() {
        XCTAssertEqual(MouseInputGeometry.clickCount(0), 1)
        XCTAssertEqual(MouseInputGeometry.clickCount(1), 1)
        XCTAssertEqual(MouseInputGeometry.clickCount(3), 3)
        XCTAssertEqual(MouseInputGeometry.clickCount(99), 4)
    }

    func testLinearDragPathIncludesBothEndpoints() {
        let path = MouseInputGeometry.linearPath(
            from: CGPoint(x: 10, y: 20),
            to: CGPoint(x: 30, y: 40),
            segments: 4
        )
        XCTAssertEqual(path.count, 5)
        XCTAssertEqual(path.first, CGPoint(x: 10, y: 20))
        XCTAssertEqual(path[2], CGPoint(x: 20, y: 30))
        XCTAssertEqual(path.last, CGPoint(x: 30, y: 40))
    }

    func testFractionalPagesRoundToScrollLines() {
        XCTAssertEqual(MouseInputGeometry.scrollLines(pages: 0), 1)
        XCTAssertEqual(MouseInputGeometry.scrollLines(pages: 0.5), 3)
        XCTAssertEqual(MouseInputGeometry.scrollLines(pages: 1), 5)
        XCTAssertEqual(MouseInputGeometry.scrollLines(pages: 2.25), 11)
    }
}
