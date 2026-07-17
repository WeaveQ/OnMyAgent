import Foundation

enum MCPToolCatalog {
    static func schemas() -> [[String: Any]] {
        skySchemas() + extensionSchemas()
    }

    private static func skySchemas() -> [[String: Any]] {
        [
            tool(
                name: "list_apps",
                description: "List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days, including details on usage frequency",
                properties: [:],
                readOnly: true
            ),
            tool(
                name: "get_app_state",
                description: "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                ],
                required: ["app"],
                readOnly: true
            ),
            tool(
                name: "click",
                description: "Click an element by index or pixel coordinates from screenshot",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "click_count": integer("Number of clicks. Defaults to 1"),
                    "element_index": string("Element identifier to click"),
                    "mouse_button": enumeration("Mouse button. Defaults to left", values: ["left", "right", "middle"]),
                    "x": number("X coordinate in screenshot pixels"),
                    "y": number("Y coordinate in screenshot pixels"),
                ],
                required: ["app"]
            ),
            tool(
                name: "perform_secondary_action",
                description: "Invoke a secondary accessibility action exposed by an element",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "element_index": string("Element identifier"),
                    "action": string("Secondary accessibility action name"),
                ],
                required: ["app", "element_index", "action"]
            ),
            tool(
                name: "set_value",
                description: "Set the value of a settable accessibility element",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "element_index": string("Element identifier"),
                    "value": string("Value to assign"),
                ],
                required: ["app", "element_index", "value"]
            ),
            tool(
                name: "select_text",
                description: "Select text inside a text element, or place the text cursor before or after it. Provide text exactly as it appears in the accessibility tree, including any Markdown formatting. If the text is not unique, provide surrounding prefix or suffix text to disambiguate it.",
                properties: [
                    "app": string("App name or bundle identifier"),
                    "element_index": string("Text element identifier"),
                    "prefix": string("Optional text immediately before the target"),
                    "selection": enumeration("Selection mode. Defaults to text", values: ["text", "cursor_before", "cursor_after"]),
                    "suffix": string("Optional text immediately after the target"),
                    "text": string("Target text exactly as exposed by accessibility"),
                ],
                required: ["app", "element_index", "text"]
            ),
            tool(
                name: "scroll",
                description: "Scroll an element in a direction by a number of pages",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "direction": string("Scroll direction: up, down, left, or right"),
                    "element_index": string("Element identifier"),
                    "pages": number("Page count. Fractional values are supported. Defaults to 1"),
                ],
                required: ["app", "element_index", "direction"]
            ),
            tool(
                name: "drag",
                description: "Drag from one point to another using pixel coordinates",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "from_x": number("Start X coordinate"),
                    "from_y": number("Start Y coordinate"),
                    "to_x": number("End X coordinate"),
                    "to_y": number("End Y coordinate"),
                ],
                required: ["app", "from_x", "from_y", "to_x", "to_y"]
            ),
            tool(
                name: "press_key",
                description: """
                Press a key or key-combination on the keyboard, including modifier and navigation keys.
                  - This supports xdotool's `key` syntax.
                  - Examples: "a", "Return", "Tab", "super+c", "Up", "KP_0" (for the numpad 0 key).
                """,
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "key": string("Key or key combination, for example Return, super+c, or KP_0"),
                ],
                required: ["app", "key"]
            ),
            tool(
                name: "type_text",
                description: "Type literal text using keyboard input",
                properties: [
                    "app": string("App name, full app path, or unambiguous bundle identifier"),
                    "text": string("Literal text to type"),
                ],
                required: ["app", "text"]
            ),
        ]
    }

    private static func extensionSchemas() -> [[String: Any]] {
        [
            tool(
                name: "snapshot",
                description: "Return a target-window screenshot plus compact semantic AX state using strict background activation by default.",
                properties: [
                    "app": string("Optional running app name. Omit for the frontmost app"),
                    "strict": boolean("Keep actions on background-safe AX/postToPid paths. Defaults to true"),
                ],
                readOnly: true
            ),
            tool(
                name: "perform_action",
                description: "OnMyAgent alias for performing a named AX action.",
                properties: elementProperties(extra: ["action": string("AX action name. Defaults to AXPress")])
            ),
            tool(
                name: "wait",
                description: "Wait for UI to settle.",
                properties: ["milliseconds": number("Wait time. Defaults to 1000")]
            ),
            tool(
                name: "set_strict_mode",
                description: "Enable or disable strict background mode.",
                properties: ["enabled": boolean("Whether strict background mode is enabled")],
                required: ["enabled"]
            ),
            tool(name: "check_permissions", description: "Check Accessibility and Screen Recording permission status.", properties: [:], readOnly: true),
            tool(name: "get_recent_activity", description: "Read privacy-filtered local Skysight summaries when the user has explicitly enabled activity memory.", properties: ["limit": integer("Maximum summaries to return. Defaults to 6")], readOnly: true),
            tool(
                name: "event_stream_start",
                description: "Start recording the user's actions for up to 30 minutes. If a recording is already active, return that active session instead of starting another one.",
                properties: [:]
            ),
            tool(
                name: "event_stream_status",
                description: "Get the current or most recent Record & Replay recording status including paths to metadata and events during the recording.",
                properties: [:],
                readOnly: true
            ),
            tool(
                name: "event_stream_stop",
                description: "Stop the active event stream recording if one is running and return status including paths to metadata and events during the recording.",
                properties: [:],
                idempotent: true
            ),
            tool(
                name: "skysight_start",
                description: "Start Skysight so ChatGPT can answer questions about recent activity.",
                properties: [:]
            ),
            tool(
                name: "skysight_stop",
                description: "Stop Skysight and return the current status.",
                properties: [:],
                idempotent: true
            ),
            tool(
                name: "skysight_status",
                description: "Get Skysight status and paths to recent activity files.",
                properties: [:],
                readOnly: true
            ),
            tool(
                name: "skysight_update_exclusion",
                description: "Add or remove an app, website, or private browsing from Skysight recording.",
                properties: [
                    "operation": enumeration("Whether to add or remove the exclusion", values: ["add", "remove"]),
                    "scope": enumeration("Exclusion kind", values: ["app", "website", "private_browsing"]),
                    "value": string("App bundle identifier or website hostname. Omit for private browsing."),
                ],
                required: ["operation", "scope"],
                idempotent: true
            ),
            tool(
                name: "skysight_list_exclusions",
                description: "List apps, websites, and private browsing excluded from Skysight.",
                properties: [:],
                readOnly: true
            ),
            tool(name: "launch_app", description: "Launch a macOS application by name.", properties: ["name": string("Application name")], required: ["name"]),
            tool(name: "activate_app", description: "Bring a running macOS application to the foreground.", properties: ["name": string("Application name")], required: ["name"]),
            tool(name: "open_url", description: "Open a URL in the default browser or a specified browser.", properties: ["url": string("URL to open"), "app": string("Optional browser application")], required: ["url"]),
            tool(name: "clipboard_read", description: "Read text from the macOS clipboard.", properties: [:], readOnly: true),
            tool(name: "clipboard_write", description: "Write text to the macOS clipboard.", properties: ["text": string("Text to write")], required: ["text"]),
            tool(name: "display_info", description: "Return main-display logical dimensions and scale factor.", properties: [:], readOnly: true),
            tool(name: "cua_screenshot", description: "Capture a logical-size full-screen PNG for CUA loops.", properties: [:], readOnly: true),
            tool(name: "cua_click", description: "Click absolute screen coordinates.", properties: pointProperties(), required: ["x", "y"]),
            tool(name: "cua_double_click", description: "Double-click absolute screen coordinates.", properties: pointProperties(), required: ["x", "y"]),
            tool(name: "cua_move", description: "Move the pointer to absolute screen coordinates.", properties: pointProperties(), required: ["x", "y"]),
            tool(name: "cua_type", description: "Type text into the focused input.", properties: ["text": string("Text to type")], required: ["text"]),
            tool(name: "cua_keypress", description: "Press keys using CUA key names.", properties: ["keys": array(items: ["type": "string"])], required: ["keys"]),
            tool(name: "cua_scroll", description: "Scroll at absolute screen coordinates.", properties: pointProperties(extra: ["scroll_x": number("Horizontal delta"), "scroll_y": number("Vertical delta")]), required: ["x", "y", "scroll_x", "scroll_y"]),
            tool(name: "cua_drag", description: "Drag over an array of [x,y] points.", properties: ["path": array(items: ["type": "array"])], required: ["path"]),
            tool(name: "cua_wait", description: "Wait for UI to settle in a CUA loop.", properties: [:]),
        ]
    }

    private static func tool(
        name: String,
        description: String,
        properties: [String: Any],
        required: [String] = [],
        readOnly: Bool = false,
        idempotent: Bool? = nil
    ) -> [String: Any] {
        var inputSchema: [String: Any] = [
            "type": "object",
            "properties": properties,
            "additionalProperties": false,
        ]
        if !required.isEmpty {
            inputSchema["required"] = required
        }
        return [
            "name": name,
            "description": description,
            "inputSchema": inputSchema,
            "annotations": [
                "destructiveHint": false,
                "idempotentHint": idempotent ?? readOnly,
                "openWorldHint": false,
                "readOnlyHint": readOnly,
            ],
        ]
    }

    private static func string(_ description: String) -> [String: Any] {
        ["type": "string", "description": description]
    }

    private static func number(_ description: String) -> [String: Any] {
        ["type": "number", "description": description]
    }

    private static func integer(_ description: String) -> [String: Any] {
        ["type": "integer", "description": description]
    }

    private static func boolean(_ description: String) -> [String: Any] {
        ["type": "boolean", "description": description]
    }

    private static func enumeration(_ description: String, values: [String]) -> [String: Any] {
        ["type": "string", "description": description, "enum": values]
    }

    private static func array(items: [String: Any]) -> [String: Any] {
        ["type": "array", "items": items]
    }

    private static func pointProperties(extra: [String: Any] = [:]) -> [String: Any] {
        var result: [String: Any] = ["x": number("X coordinate"), "y": number("Y coordinate")]
        result.merge(extra) { _, new in new }
        return result
    }

    private static func elementProperties(extra: [String: Any] = [:]) -> [String: Any] {
        var result: [String: Any] = [
            "ref": string("Semantic ref from snapshot"),
            "snapshot_id": string("Snapshot id from the latest snapshot"),
            "index": number("Element id or zero-based compatibility index"),
        ]
        result.merge(extra) { _, new in new }
        return result
    }
}
