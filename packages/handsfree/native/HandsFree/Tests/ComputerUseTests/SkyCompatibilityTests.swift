import XCTest
@testable import HandsFreeComputerUse

final class SkyCompatibilityTests: XCTestCase {
    func testElementIdentifiersSupportRefsAndNumericIndices() {
        XCTAssertEqual(
            SkyCompatibility.elementTarget("{e42}"),
            SkyElementTarget(ref: "{e42}", index: nil)
        )
        XCTAssertEqual(
            SkyCompatibility.elementTarget("e7"),
            SkyElementTarget(ref: "{e7}", index: nil)
        )
        XCTAssertEqual(
            SkyCompatibility.elementTarget("12"),
            SkyElementTarget(ref: nil, index: 12)
        )
    }

    func testXdotoolKeyAliasesNormalizeToNativeCombos() {
        XCTAssertEqual(SkyCompatibility.keyCombo("super+c"), "command+c")
        XCTAssertEqual(SkyCompatibility.keyCombo("Super+Shift+P"), "command+shift+p")
        XCTAssertEqual(SkyCompatibility.keyCombo("KP_0"), "kp_0")
        XCTAssertEqual(SkyCompatibility.keyCombo("Return"), "return")
    }

    func testMouseButtonsParseAllSkyValues() {
        XCTAssertEqual(SkyCompatibility.mouseButton(nil), .left)
        XCTAssertEqual(SkyCompatibility.mouseButton("left"), .left)
        XCTAssertEqual(SkyCompatibility.mouseButton("right"), .right)
        XCTAssertEqual(SkyCompatibility.mouseButton("middle"), .middle)
        XCTAssertNil(SkyCompatibility.mouseButton("side"))
    }
}
