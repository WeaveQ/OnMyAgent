import Foundation
import IOKit.pwr_mgt

final class DisplaySleepAssertion: @unchecked Sendable {
    private var identifier = IOPMAssertionID(0)

    func acquire() throws {
        guard identifier == 0 else { return }
        var newIdentifier = IOPMAssertionID(0)
        let result = IOPMAssertionCreateWithName(
            kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            "OnMyAgent Computer Use app session" as CFString,
            &newIdentifier
        )
        guard result == kIOReturnSuccess else {
            throw ComputerUseError.powerAssertionFailed(result)
        }
        identifier = newIdentifier
    }

    func release() {
        guard identifier != 0 else { return }
        IOPMAssertionRelease(identifier)
        identifier = 0
    }

    deinit {
        release()
    }
}
