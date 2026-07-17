import XCTest
@testable import HandsFreeComputerUse

final class MCPToolCatalogTests: XCTestCase {
    private let skyRequired: [String: Set<String>] = [
        "list_apps": [],
        "get_app_state": ["app"],
        "click": ["app"],
        "perform_secondary_action": ["app", "element_index", "action"],
        "set_value": ["app", "element_index", "value"],
        "select_text": ["app", "element_index", "text"],
        "scroll": ["app", "element_index", "direction"],
        "drag": ["app", "from_x", "from_y", "to_x", "to_y"],
        "press_key": ["app", "key"],
        "type_text": ["app", "text"],
    ]

    func testSkySchemasMatchObservedCodexContract() throws {
        let schemas = MCPToolCatalog.schemas()
        let byName = Dictionary(uniqueKeysWithValues: schemas.compactMap { schema -> (String, [String: Any])? in
            guard let name = schema["name"] as? String else { return nil }
            return (name, schema)
        })

        XCTAssertTrue(Set(skyRequired.keys).isSubset(of: Set(byName.keys)))

        for (name, required) in skyRequired {
            let schema = try XCTUnwrap(byName[name], "Missing Sky tool \(name)")
            let input = try XCTUnwrap(schema["inputSchema"] as? [String: Any])
            XCTAssertEqual(input["additionalProperties"] as? Bool, false, name)
            XCTAssertEqual(Set(input["required"] as? [String] ?? []), required, name)

            let annotations = try XCTUnwrap(schema["annotations"] as? [String: Bool])
            XCTAssertEqual(annotations["destructiveHint"], false, name)
            XCTAssertEqual(annotations["openWorldHint"], false, name)
            let isReadOnly = name == "list_apps" || name == "get_app_state"
            XCTAssertEqual(annotations["readOnlyHint"], isReadOnly, name)
            XCTAssertEqual(annotations["idempotentHint"], isReadOnly, name)
        }
    }

    func testOnMyAgentExtensionToolsRemainAvailable() {
        let names = Set(MCPToolCatalog.schemas().compactMap { $0["name"] as? String })
        let extensions: Set<String> = [
            "snapshot", "perform_action", "wait", "set_strict_mode", "check_permissions",
            "launch_app", "activate_app", "open_url", "clipboard_read", "clipboard_write",
            "display_info", "cua_screenshot", "cua_click", "cua_double_click", "cua_move",
            "cua_type", "cua_keypress", "cua_scroll", "cua_drag", "cua_wait",
        ]
        XCTAssertTrue(extensions.isSubset(of: names))
    }

    func testRecordAndReplaySchemasMatchObservedCodexContract() throws {
        let schemas = MCPToolCatalog.schemas()
        let byName = Dictionary(uniqueKeysWithValues: schemas.compactMap { schema -> (String, [String: Any])? in
            guard let name = schema["name"] as? String else { return nil }
            return (name, schema)
        })
        let expected: [String: (readOnly: Bool, idempotent: Bool)] = [
            "event_stream_start": (false, false),
            "event_stream_status": (true, true),
            "event_stream_stop": (false, true),
        ]
        for (name, flags) in expected {
            let schema = try XCTUnwrap(byName[name], name)
            let input = try XCTUnwrap(schema["inputSchema"] as? [String: Any])
            XCTAssertEqual(input["additionalProperties"] as? Bool, false, name)
            XCTAssertEqual((input["properties"] as? [String: Any])?.count, 0, name)
            let annotations = try XCTUnwrap(schema["annotations"] as? [String: Bool])
            XCTAssertEqual(annotations["readOnlyHint"], flags.readOnly, name)
            XCTAssertEqual(annotations["idempotentHint"], flags.idempotent, name)
            XCTAssertEqual(annotations["openWorldHint"], false, name)
            XCTAssertEqual(annotations["destructiveHint"], false, name)
        }
    }

    func testSkysightSchemasMatchObservedCodexContract() throws {
        let schemas = MCPToolCatalog.schemas()
        let byName = Dictionary(uniqueKeysWithValues: schemas.compactMap { schema -> (String, [String: Any])? in
            guard let name = schema["name"] as? String else { return nil }
            return (name, schema)
        })
        let expected: [String: (description: String, required: Set<String>, readOnly: Bool)] = [
            "skysight_start": (
                "Start Skysight so ChatGPT can answer questions about recent activity.",
                [],
                false
            ),
            "skysight_stop": (
                "Stop Skysight and return the current status.",
                [],
                false
            ),
            "skysight_status": (
                "Get Skysight status and paths to recent activity files.",
                [],
                true
            ),
            "skysight_update_exclusion": (
                "Add or remove an app, website, or private browsing from Skysight recording.",
                ["operation", "scope"],
                false
            ),
            "skysight_list_exclusions": (
                "List apps, websites, and private browsing excluded from Skysight.",
                [],
                true
            ),
        ]
        for (name, contract) in expected {
            let schema = try XCTUnwrap(byName[name], name)
            XCTAssertEqual(schema["description"] as? String, contract.description, name)
            let input = try XCTUnwrap(schema["inputSchema"] as? [String: Any])
            XCTAssertEqual(input["additionalProperties"] as? Bool, false, name)
            XCTAssertEqual(Set(input["required"] as? [String] ?? []), contract.required, name)
            let annotations = try XCTUnwrap(schema["annotations"] as? [String: Bool])
            XCTAssertEqual(annotations["readOnlyHint"], contract.readOnly, name)
            XCTAssertEqual(annotations["openWorldHint"], false, name)
            XCTAssertEqual(annotations["destructiveHint"], false, name)
        }
    }
}
