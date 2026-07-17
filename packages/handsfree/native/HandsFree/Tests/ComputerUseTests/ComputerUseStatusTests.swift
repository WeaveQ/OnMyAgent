import XCTest
@testable import HandsFreeComputerUse

final class ComputerUseStatusTests: XCTestCase {
    func testStatusDictionaryIncludesVersionAndProtocol() {
        let status = ComputerUseInstallStatus(
            helperVersion: "1.2.3",
            protocolVersion: 1
        )
        let dictionary = status.dictionary
        XCTAssertEqual(dictionary["helperVersion"] as? String, "1.2.3")
        XCTAssertEqual(dictionary["protocolVersion"] as? Int, 1)
    }

    func testDetectReadsPackagedBundleHandshake() {
        let status = ComputerUseInstallStatus.detect(infoDictionary: [
            "CFBundleShortVersionString": "9.8.7",
            "OnMyAgentComputerUseProtocolVersion": 3,
        ])
        XCTAssertEqual(status.helperVersion, "9.8.7")
        XCTAssertEqual(status.protocolVersion, 3)
    }
}
