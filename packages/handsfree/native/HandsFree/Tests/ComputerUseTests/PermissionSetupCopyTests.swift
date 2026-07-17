import XCTest
@testable import HandsFreeComputerUse

final class PermissionSetupCopyTests: XCTestCase {
    func testPermissionCopyChoosesChineseVariantsAndEnglishFallback() {
        XCTAssertEqual(ComputerUsePermissionCopy.resolve(["zh-Hans-CN"]).grantAccessibility, "授予辅助功能权限")
        XCTAssertEqual(ComputerUsePermissionCopy.resolve(["zh-Hant-TW"]).grantAccessibility, "授予輔助使用權限")
        XCTAssertEqual(ComputerUsePermissionCopy.resolve(["fr-FR"]).grantAccessibility, "Grant Accessibility")
    }
}
