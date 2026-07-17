import Foundation

struct AppAuthorizationSettings: Codable, Equatable, Sendable {
    static let currentVersion = 1
    static let defaults = AppAuthorizationSettings(
        version: currentVersion,
        allowedBundleIdentifiers: []
    )

    let version: Int
    let allowedBundleIdentifiers: [String]

    init(version: Int = currentVersion, allowedBundleIdentifiers: [String]) {
        self.version = version
        self.allowedBundleIdentifiers = Self.normalized(allowedBundleIdentifiers)
    }

    var dictionary: [String: Any] {
        [
            "version": version,
            "allowedBundleIdentifiers": allowedBundleIdentifiers,
        ]
    }

    private static func normalized(_ identifiers: [String]) -> [String] {
        Array(Set(identifiers.compactMap { identifier in
            let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        })).sorted()
    }
}

struct AppAuthorizationStore: Sendable {
    let fileURL: URL

    init(fileURL: URL = Self.defaultFileURL()) {
        self.fileURL = fileURL
    }

    func read() throws -> AppAuthorizationSettings {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return .defaults
        }
        let data = try Data(contentsOf: fileURL)
        let decoded = try JSONDecoder().decode(AppAuthorizationSettings.self, from: data)
        return AppAuthorizationSettings(
            version: AppAuthorizationSettings.currentVersion,
            allowedBundleIdentifiers: decoded.allowedBundleIdentifiers
        )
    }

    func allowPersistently(_ bundleIdentifier: String) throws {
        let current = try read()
        try write(AppAuthorizationSettings(
            allowedBundleIdentifiers: current.allowedBundleIdentifiers + [bundleIdentifier]
        ))
    }

    func revoke(_ bundleIdentifier: String) throws {
        let normalized = bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let current = try read()
        try write(AppAuthorizationSettings(
            allowedBundleIdentifiers: current.allowedBundleIdentifiers.filter { $0 != normalized }
        ))
    }

    func clear() throws {
        try write(.defaults)
    }

    private func write(_ settings: AppAuthorizationSettings) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(settings)
        try data.write(to: fileURL, options: .atomic)
    }

    private static func defaultFileURL() -> URL {
        if let override = ProcessInfo.processInfo.environment[
            "ONMYAGENT_COMPUTER_USE_AUTHORIZATION_FILE"
        ]?.trimmingCharacters(in: .whitespacesAndNewlines), !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OnMyAgent", isDirectory: true)
            .appendingPathComponent("ComputerUse", isDirectory: true)
            .appendingPathComponent("app-authorizations.json", isDirectory: false)
    }
}

enum ComputerUseTargetDisposition: Equatable, Sendable {
    case allowed
    case requiresApproval
    case blocked
}

enum ComputerUseTargetPolicy {
    private static let browserBundleIdentifiers: Set<String> = [
        "com.apple.safari",
        "com.brave.browser",
        "com.google.chrome",
        "com.microsoft.edgemac",
        "company.thebrowser.browser",
        "org.mozilla.firefox",
    ]

    private static let blockedBundleIdentifiers: Set<String> = [
        "com.1password.1password",
        "com.apple.keychainaccess",
        "com.apple.loginwindow",
        "com.apple.securityagent",
        "com.bitwarden.desktop",
    ]

    static func disposition(
        bundleIdentifier: String,
        sessionAllowed: Set<String>,
        persistentAllowed: Set<String>
    ) -> ComputerUseTargetDisposition {
        let normalized = normalize(bundleIdentifier)
        if isProtectedBundleIdentifier(normalized) {
            return .blocked
        }
        let normalizedSession = Set(sessionAllowed.map(normalize))
        let normalizedPersistent = Set(persistentAllowed.map(normalize))
        if normalizedSession.contains(normalized) || normalizedPersistent.contains(normalized) {
            return .allowed
        }
        return .requiresApproval
    }

    static func isBlockedBrowserURL(_ rawURL: String) -> Bool {
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowercased = trimmed.lowercased()

        if lowercased.hasPrefix("chrome://password-manager")
            || lowercased.hasPrefix("edge://wallet/passwords")
            || lowercased.hasPrefix("edge://settings/passwords")
            || lowercased.hasPrefix("brave://password-manager")
            || lowercased.hasPrefix("about:logins") {
            return true
        }

        guard let components = URLComponents(string: trimmed),
              let host = components.host?.lowercased() else {
            return false
        }
        return host == "my.1password.com"
            || host.hasSuffix(".my.1password.com")
            || host == "vault.bitwarden.com"
            || host.hasSuffix(".vault.bitwarden.com")
    }

    static func isBrowserBundleIdentifier(_ bundleIdentifier: String) -> Bool {
        browserBundleIdentifiers.contains(normalize(bundleIdentifier))
    }

    private static func isProtectedBundleIdentifier(_ identifier: String) -> Bool {
        if blockedBundleIdentifiers.contains(identifier) {
            return true
        }
        return identifier.hasPrefix("com.apple.securityagent.")
            || identifier.hasPrefix("com.apple.loginwindow.")
            || identifier.contains("1password")
            || identifier.contains("bitwarden")
    }

    private static func normalize(_ identifier: String) -> String {
        identifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
