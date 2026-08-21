import CoreGraphics

/// Stable product behavior shared by the strict runtime, MCP adapter, cursor,
/// and regression guard. Changes to these values require an intentional
/// Computer Use contract update; see `packages/handsfree/AGENTS.md`.
enum ComputerUseBehaviorContract {
    static let compatibilityToolsEnvironmentKey = "ONMYAGENT_COMPUTER_USE_COMPAT_TOOLS"
    static let compatibilityToolsEnabledValue = "1"
    static let strictModeByDefault = true
    static let hardwareCursorTolerance: CGFloat = 0.5
    static let cursorPresentationScale: CGFloat = 2.0 / 3.0

    static let skyToolNames: Set<String> = [
        "list_apps",
        "get_app_state",
        "click",
        "perform_secondary_action",
        "set_value",
        "select_text",
        "scroll",
        "drag",
        "press_key",
        "type_text",
    ]

    /// The default Sky profile is always strict, even if an MCP caller sends an
    /// undeclared `strict: false` argument. Only the explicit compatibility
    /// profile may select foreground fallback behavior.
    static func requestedStrictMode(
        profile: MCPToolProfile,
        requested: Bool?
    ) -> Bool? {
        profile == .sky ? strictModeByDefault : requested
    }
}
