import Foundation

struct ComputerUseInstallStatus: Equatable, Sendable {
    static let currentHelperVersion = "0.1.0"
    static let currentProtocolVersion = 1

    let helperVersion: String
    let protocolVersion: Int

    static func detect(infoDictionary: [String: Any]? = Bundle.main.infoDictionary) -> ComputerUseInstallStatus {
        return ComputerUseInstallStatus(
            helperVersion: infoDictionary?["CFBundleShortVersionString"] as? String
                ?? currentHelperVersion,
            protocolVersion: infoDictionary?["OnMyAgentComputerUseProtocolVersion"] as? Int
                ?? currentProtocolVersion
        )
    }

    var dictionary: [String: Any] {
        [
            "helperVersion": helperVersion,
            "protocolVersion": protocolVersion,
        ]
    }
}
