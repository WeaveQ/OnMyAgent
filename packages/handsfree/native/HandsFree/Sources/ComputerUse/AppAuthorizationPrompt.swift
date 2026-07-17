import AppKit
import Foundation

struct AppAuthorizationPromptCopy: Sendable {
    let titleFormat: String
    let message: String
    let allowOnce: String
    let alwaysAllow: String
    let deny: String

    static var current: AppAuthorizationPromptCopy {
        resolve(Locale.preferredLanguages)
    }

    static func resolve(_ preferredLanguages: [String]) -> AppAuthorizationPromptCopy {
        let language = preferredLanguages.first?.lowercased() ?? "en"
        if language.hasPrefix("zh-hant") || language.hasPrefix("zh-tw") || language.hasPrefix("zh-hk") {
            return traditionalChinese
        }
        if language.hasPrefix("zh") { return simplifiedChinese }
        return english
    }

    func title(appName: String) -> String {
        String(format: titleFormat, appName)
    }

    private static let english = AppAuthorizationPromptCopy(
        titleFormat: "Allow OnMyAgent to use %@?",
        message: "Computer Use wants to view and control this app. Choose whether to allow it for this Computer Use session or remember it for future sessions.",
        allowOnce: "Allow Once",
        alwaysAllow: "Always Allow",
        deny: "Don’t Allow"
    )

    private static let simplifiedChinese = AppAuthorizationPromptCopy(
        titleFormat: "允许 OnMyAgent 使用 %@？",
        message: "Computer Use 想要查看并控制此应用。你可以仅允许当前 Computer Use 会话使用，或为以后会话记住此选择。",
        allowOnce: "仅本次允许",
        alwaysAllow: "始终允许",
        deny: "不允许"
    )

    private static let traditionalChinese = AppAuthorizationPromptCopy(
        titleFormat: "允許 OnMyAgent 使用 %@？",
        message: "Computer Use 想要查看並控制此應用程式。你可以只允許目前的 Computer Use 工作階段使用，或為未來的工作階段記住此選擇。",
        allowOnce: "僅允許一次",
        alwaysAllow: "永遠允許",
        deny: "不允許"
    )
}

enum AppAuthorizationPromptDecision: Sendable {
    case allowOnce
    case alwaysAllow
    case deny
}

enum AppAuthorizationPrompt {
    @MainActor
    static func request(appName: String) -> AppAuthorizationPromptDecision {
        let copy = AppAuthorizationPromptCopy.current
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = copy.title(appName: appName)
        alert.informativeText = copy.message
        alert.addButton(withTitle: copy.allowOnce)
        alert.addButton(withTitle: copy.alwaysAllow)
        alert.addButton(withTitle: copy.deny)
        let previousFrontmostApplication = NSWorkspace.shared.frontmostApplication
        NSApplication.shared.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        if previousFrontmostApplication?.isTerminated == false {
            previousFrontmostApplication?.activate()
        }
        switch response {
        case .alertFirstButtonReturn:
            return .allowOnce
        case .alertSecondButtonReturn:
            return .alwaysAllow
        default:
            return .deny
        }
    }
}

final class AppAuthorizationController {
    private let store: AppAuthorizationStore
    private var sessionAllowedBundleIdentifiers: Set<String> = []

    init(store: AppAuthorizationStore = AppAuthorizationStore()) {
        self.store = store
    }

    func authorize(_ application: NSRunningApplication) async throws {
        guard let bundleIdentifier = application.bundleIdentifier else {
            throw ComputerUseError.appAuthorizationDenied(
                application.localizedName ?? "Unknown app"
            )
        }
        let settings = try store.read()
        switch ComputerUseTargetPolicy.disposition(
            bundleIdentifier: bundleIdentifier,
            sessionAllowed: sessionAllowedBundleIdentifiers,
            persistentAllowed: Set(settings.allowedBundleIdentifiers)
        ) {
        case .allowed:
            return
        case .blocked:
            throw ComputerUseError.protectedApplication(bundleIdentifier)
        case .requiresApproval:
            break
        }

        let appName = application.localizedName ?? bundleIdentifier
        switch await AppAuthorizationPrompt.request(appName: appName) {
        case .allowOnce:
            sessionAllowedBundleIdentifiers.insert(bundleIdentifier)
        case .alwaysAllow:
            try store.allowPersistently(bundleIdentifier)
            sessionAllowedBundleIdentifiers.insert(bundleIdentifier)
        case .deny:
            throw ComputerUseError.appAuthorizationDenied(appName)
        }
    }
}
