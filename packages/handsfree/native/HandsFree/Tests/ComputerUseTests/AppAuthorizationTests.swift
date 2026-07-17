import Foundation
import XCTest
@testable import HandsFreeComputerUse

final class AppAuthorizationTests: XCTestCase {
    func testPromptCopyChoosesChineseVariantsAndEnglishFallback() {
        XCTAssertEqual(
            AppAuthorizationPromptCopy.resolve(["zh-Hans-CN"]).allowOnce,
            "仅本次允许"
        )
        XCTAssertEqual(
            AppAuthorizationPromptCopy.resolve(["zh-Hant-TW"]).alwaysAllow,
            "永遠允許"
        )
        XCTAssertEqual(
            AppAuthorizationPromptCopy.resolve(["fr-FR"]).deny,
            "Don’t Allow"
        )
    }

    func testStorePersistsSortedUniqueBundleIdentifiersAndSupportsRevocation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = root.appendingPathComponent("app-authorizations.json")
        defer { try? FileManager.default.removeItem(at: root) }

        let store = AppAuthorizationStore(fileURL: file)
        XCTAssertEqual(try store.read(), .defaults)

        try store.allowPersistently("com.apple.Safari")
        try store.allowPersistently("com.google.Chrome")
        try store.allowPersistently("com.apple.Safari")
        XCTAssertEqual(
            try store.read().allowedBundleIdentifiers,
            ["com.apple.Safari", "com.google.Chrome"]
        )

        try store.revoke("com.apple.Safari")
        XCTAssertEqual(try store.read().allowedBundleIdentifiers, ["com.google.Chrome"])
        try store.clear()
        XCTAssertEqual(try store.read(), .defaults)
    }

    func testPolicyRequiresApprovalUnlessBundleIsSessionOrPersistentlyAllowed() {
        XCTAssertEqual(
            ComputerUseTargetPolicy.disposition(
                bundleIdentifier: "com.apple.Safari",
                sessionAllowed: [],
                persistentAllowed: []
            ),
            .requiresApproval
        )
        XCTAssertEqual(
            ComputerUseTargetPolicy.disposition(
                bundleIdentifier: "com.apple.Safari",
                sessionAllowed: ["com.apple.Safari"],
                persistentAllowed: []
            ),
            .allowed
        )
        XCTAssertEqual(
            ComputerUseTargetPolicy.disposition(
                bundleIdentifier: "com.apple.Safari",
                sessionAllowed: [],
                persistentAllowed: ["com.apple.Safari"]
            ),
            .allowed
        )
    }

    func testPolicyAlwaysBlocksSystemSecurityAndPasswordManagerTargets() {
        for bundleIdentifier in [
            "com.apple.loginwindow",
            "com.apple.SecurityAgent",
            "com.apple.keychainaccess",
            "com.1password.1password",
            "com.bitwarden.desktop",
        ] {
            XCTAssertEqual(
                ComputerUseTargetPolicy.disposition(
                    bundleIdentifier: bundleIdentifier,
                    sessionAllowed: [bundleIdentifier],
                    persistentAllowed: [bundleIdentifier]
                ),
                .blocked
            )
        }
    }

    func testBrowserPolicyBlocksCredentialAndInternalPasswordPages() {
        for url in [
            "chrome://password-manager/passwords",
            "edge://wallet/passwords",
            "about:logins",
            "https://my.1password.com/",
            "https://vault.bitwarden.com/",
        ] {
            XCTAssertTrue(ComputerUseTargetPolicy.isBlockedBrowserURL(url), url)
        }
        XCTAssertFalse(ComputerUseTargetPolicy.isBlockedBrowserURL("https://example.com/"))
        XCTAssertFalse(ComputerUseTargetPolicy.isBlockedBrowserURL("https://github.com/settings/profile"))
    }

    func testBrowserPolicyRecognizesSupportedBrowserBundleIdentifiers() {
        for bundleIdentifier in [
            "com.apple.Safari",
            "com.google.Chrome",
            "com.microsoft.edgemac",
            "com.brave.Browser",
            "company.thebrowser.Browser",
            "org.mozilla.firefox",
        ] {
            XCTAssertTrue(
                ComputerUseTargetPolicy.isBrowserBundleIdentifier(bundleIdentifier),
                bundleIdentifier
            )
        }
        XCTAssertFalse(ComputerUseTargetPolicy.isBrowserBundleIdentifier("com.apple.TextEdit"))
    }
}
