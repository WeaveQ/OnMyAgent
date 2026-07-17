import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit

actor MCPServer {
    private let runtime = ComputerUseRuntime()
    private let input = InputService()
    private let appCatalog = AppCatalog()
    private let accessibility = AccessibilityService()
    private let appAuthorization = AppAuthorizationController()
    private let recordAndReplay = RecordAndReplayController()
    private let skysight = SkysightController()
    private let activityStore = ComputerUseActivityStore()
    private var cuaSnapshotFrontmostPID: pid_t?
    private var deliveredInstructionBundleIdentifiers: Set<String> = []

    func run() async {
        log("Computer Use server starting")
        try? activityStore.update(phase: .ready, app: nil, reason: nil)
        while let line = readLine(strippingNewline: true) {
            guard !line.isEmpty else { continue }
            guard let data = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                log("Invalid JSON-RPC line")
                continue
            }

            let id = json["id"]
            let method = json["method"] as? String ?? ""
            let params = json["params"] as? [String: Any] ?? [:]

            switch method {
            case "initialize":
                respond(id: id, result: [
                    "protocolVersion": "2025-03-26",
                    "capabilities": ["tools": [:]],
                    "serverInfo": [
                        "name": "onmyagent-computer-use",
                        "version": ComputerUseInstallStatus.detect().helperVersion,
                    ],
                ])
            case "notifications/initialized":
                break
            case "tools/list":
                respond(id: id, result: ["tools": toolSchemas()])
            case "tools/call":
                let name = params["name"] as? String ?? ""
                let args = params["arguments"] as? [String: Any] ?? [:]
                let content = await executeTool(name: name, args: args)
                respond(id: id, result: ["content": content])
            default:
                if id != nil {
                    respondError(id: id, code: -32601, message: "Method not found: \(method)")
                }
            }
        }
        _ = try? recordAndReplay.stop(reason: "mcp_ended")
        await MainActor.run { ComputerUsePIPOverlay.shared.hide() }
        try? activityStore.update(phase: .inactive, app: nil, reason: nil)
    }

    private func toolSchemas() -> [[String: Any]] {
        MCPToolCatalog.schemas()
    }

    private func executeTool(name: String, args: [String: Any]) async -> [[String: Any]] {
        do {
            let skyActionNames: Set<String> = [
                "click", "perform_secondary_action", "set_value", "select_text",
                "scroll", "drag", "press_key", "type_text",
            ]
            if skyActionNames.contains(name) {
                try await runtime.validateAppSession(appName: args["app"] as? String)
                try? activityStore.update(phase: .running, app: args["app"] as? String, reason: nil)
            }
            switch name {
            case "snapshot", "get_app_state":
                return try await snapshotResult(args: args)
            case "click":
                let target = SkyCompatibility.elementTarget(args["element_index"] as? String)
                let metadata = try await runtime.click(
                    snapshotID: snapshotIDArg(args),
                    ref: args["ref"] as? String ?? target.ref,
                    index: intArg(args, "index") ?? target.index,
                    imageX: doubleArg(args, "x"),
                    imageY: doubleArg(args, "y"),
                    clickCount: intArg(args, "click_count") ?? 1,
                    mouseButton: SkyCompatibility.mouseButton(args["mouse_button"] as? String) ?? .left,
                    strict: boolArg(args, "strict")
                )
                return jsonResult(metadata.dictionary)
            case "drag":
                let metadata = try await runtime.drag(
                    snapshotID: snapshotIDArg(args),
                    fromImageX: doubleArg(args, "from_x") ?? 0,
                    fromImageY: doubleArg(args, "from_y") ?? 0,
                    toImageX: doubleArg(args, "to_x") ?? 0,
                    toImageY: doubleArg(args, "to_y") ?? 0,
                    strict: boolArg(args, "strict")
                )
                return jsonResult(metadata.dictionary)
            case "type_text":
                let metadata = try await runtime.typeText(snapshotID: snapshotIDArg(args), text: args["text"] as? String ?? "", strict: boolArg(args, "strict"))
                return jsonResult(metadata.dictionary)
            case "press_key":
                let rawKey = args["key"] as? String ?? args["combo"] as? String ?? ""
                let metadata = try await runtime.pressKey(snapshotID: snapshotIDArg(args), combo: SkyCompatibility.keyCombo(rawKey), strict: boolArg(args, "strict"))
                return jsonResult(metadata.dictionary)
            case "scroll":
                let target = SkyCompatibility.elementTarget(args["element_index"] as? String)
                let metadata = try await runtime.scroll(
                    snapshotID: snapshotIDArg(args),
                    ref: args["ref"] as? String ?? target.ref,
                    index: intArg(args, "index") ?? target.index,
                    direction: args["direction"] as? String,
                    pages: doubleArg(args, "pages") ?? 1,
                    imageX: doubleArg(args, "x"),
                    imageY: doubleArg(args, "y"),
                    strict: boolArg(args, "strict")
                )
                return jsonResult(metadata.dictionary)
            case "set_value":
                let target = SkyCompatibility.elementTarget(args["element_index"] as? String)
                let metadata = try await runtime.setValue(
                    snapshotID: snapshotIDArg(args),
                    ref: args["ref"] as? String ?? target.ref,
                    index: intArg(args, "index") ?? target.index,
                    value: args["value"] as? String ?? ""
                )
                return jsonResult(metadata.dictionary)
            case "select_text":
                let target = SkyCompatibility.elementTarget(args["element_index"] as? String)
                let selectionValue = args["selection"] as? String ?? args["selection_type"] as? String
                let metadata = try await runtime.selectText(
                    snapshotID: snapshotIDArg(args),
                    ref: args["ref"] as? String ?? target.ref,
                    index: intArg(args, "index") ?? target.index,
                    text: args["text"] as? String ?? "",
                    prefix: args["prefix"] as? String,
                    suffix: args["suffix"] as? String,
                    selection: TextSelectionMode(skyValue: selectionValue)
                )
                return jsonResult(metadata.dictionary)
            case "perform_action", "perform_secondary_action":
                let target = SkyCompatibility.elementTarget(args["element_index"] as? String)
                let metadata = try await runtime.performAction(
                    snapshotID: snapshotIDArg(args),
                    ref: args["ref"] as? String ?? target.ref,
                    index: intArg(args, "index") ?? target.index,
                    action: args["action"] as? String ?? kAXPressAction
                )
                return jsonResult(metadata.dictionary)
            case "wait":
                let metadata = await runtime.wait(milliseconds: intArg(args, "milliseconds") ?? 1000)
                return jsonResult(metadata.dictionary)
            case "set_strict_mode":
                let metadata = await runtime.setStrictMode(boolArg(args, "enabled") ?? true)
                return jsonResult(metadata.dictionary)
            case "check_permissions":
                return jsonResult(checkPermissions())
            case "get_recent_activity":
                let settings = (try? SkysightSettingsStore().read()) ?? .defaults
                guard settings.enabled else {
                    return jsonResult(["ok": false, "enabled": false, "summaries": []])
                }
                let summaries = try SkysightStore().recentSummaries(
                    limit: min(max(intArg(args, "limit") ?? 6, 1), 24)
                )
                return jsonResult(["ok": true, "enabled": true, "summaries": summaries])
            case "event_stream_start":
                return try await jsonResult(recordAndReplay.start().dictionary)
            case "event_stream_status":
                return jsonResult(
                    try recordAndReplay.status()?.dictionary
                        ?? ["ok": true, "state": "none"]
                )
            case "event_stream_stop":
                return jsonResult(
                    try recordAndReplay.stop()?.dictionary
                        ?? ["ok": true, "state": "none"]
                )
            case "skysight_start":
                return try await jsonResult(skysight.start())
            case "skysight_stop":
                return try jsonResult(skysight.stop())
            case "skysight_status":
                return try jsonResult(skysight.status())
            case "skysight_update_exclusion":
                return try jsonResult(skysight.updateExclusion(args: args))
            case "skysight_list_exclusions":
                return try jsonResult(skysight.listExclusions())
            case "launch_app":
                return try await jsonResult(handleLaunchApp(args: args))
            case "activate_app":
                return jsonResult(handleActivateApp(args: args))
            case "list_apps":
                return jsonResult(["apps": appCatalog.descriptors().map(\.dictionary)])
            case "open_url":
                return try await jsonResult(handleOpenURL(args: args))
            case "clipboard_read":
                return jsonResult(["ok": true, "text": NSPasteboard.general.string(forType: .string) ?? ""])
            case "clipboard_write":
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(args["text"] as? String ?? "", forType: .string)
                return jsonResult(["ok": true])
            case "display_info":
                return jsonResult(displayInfo())
            case "cua_screenshot":
                return try await cuaScreenshotResult()
            case "cua_click":
                try validateCuaSnapshotFresh()
                AgentCursorOverlay.shared.show(at: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0))
                try await input.click(point: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0))
                return jsonResult(["ok": true])
            case "cua_double_click":
                try validateCuaSnapshotFresh()
                AgentCursorOverlay.shared.show(at: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0))
                try await input.click(point: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0), clickCount: 2)
                return jsonResult(["ok": true])
            case "cua_move":
                try validateCuaSnapshotFresh()
                AgentCursorOverlay.shared.show(at: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0))
                try input.moveMouse(point: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0))
                return jsonResult(["ok": true])
            case "cua_type":
                try validateCuaSnapshotFresh()
                try input.typeText(args["text"] as? String ?? "")
                return jsonResult(["ok": true])
            case "cua_keypress":
                try validateCuaSnapshotFresh()
                try input.pressKey(cuaKeysToCombo(args["keys"] as? [String] ?? []))
                return jsonResult(["ok": true])
            case "cua_scroll":
                try validateCuaSnapshotFresh()
                AgentCursorOverlay.shared.show(at: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0))
                try input.scroll(
                    point: CGPoint(x: intArg(args, "x") ?? 0, y: intArg(args, "y") ?? 0),
                    deltaX: Int32(intArg(args, "scroll_x") ?? 0),
                    deltaY: Int32(-(intArg(args, "scroll_y") ?? 0))
                )
                return jsonResult(["ok": true])
            case "cua_drag":
                try validateCuaSnapshotFresh()
                let path = parsePointPath(args["path"])
                if let first = path.first {
                    AgentCursorOverlay.shared.show(at: first)
                }
                try await input.drag(path: path)
                return jsonResult(["ok": true])
            case "cua_wait":
                try await Task.sleep(nanoseconds: 1_000_000_000)
                return jsonResult(["ok": true])
            default:
                return jsonResult(["ok": false, "error": "Unknown tool: \(name)"])
            }
        } catch {
            if case ComputerUseError.physicalInputPaused = error {
                try? activityStore.update(
                    phase: .paused,
                    app: args["app"] as? String,
                    reason: "physical_input"
                )
            }
            return jsonResult(errorPayload(error))
        }
    }

    private func snapshotResult(args: [String: Any]) async throws -> [[String: Any]] {
        let application = try await applicationForAuthorization(appName: args["app"] as? String)
        try await appAuthorization.authorize(application)
        let snapshot = try await runtime.snapshot(appName: args["app"] as? String, strict: boolArg(args, "strict"))
        await MainActor.run {
            ComputerUsePIPOverlay.shared.update(
                appName: snapshot.appName,
                processID: snapshot.pid,
                imageData: snapshot.screenshotData
            )
        }
        try? activityStore.update(phase: .running, app: snapshot.appName, reason: nil)
        var payload = snapshotPayload(snapshot)
        if let settle = await runtime.uiSettleMetadata() {
            payload["settle"] = settle
        }
        guard let text = jsonString(payload) else {
            return textResult("Failed to serialize semantic AX snapshot.")
        }
        return [
            ["type": "image", "data": snapshot.screenshotData.base64EncodedString(), "mimeType": snapshot.screenshotMimeType],
            ["type": "text", "text": text],
        ]
    }

    private func snapshotPayload(_ snapshot: AppSnapshot) -> [String: Any] {
        let elements = snapshot.elements.map { element -> [String: Any] in
            var dict = element.dictionary
            let imagePoint = snapshot.screenshotMeta.toImage(point: element.frame.center)
            dict["center"] = [
                "screenX": Int(element.frame.center.x),
                "screenY": Int(element.frame.center.y),
                "imageX": Int(imagePoint.x),
                "imageY": Int(imagePoint.y),
            ]
            return dict
        }

        var result: [String: Any] = [
            "ok": true,
            "semanticAXVersion": 1,
            "snapshotId": snapshot.id,
            "snapshot_id": snapshot.id,
            "observation": snapshot.observation,
            "app": snapshot.appName,
            "pid": Int(snapshot.pid),
            "windowTitle": snapshot.windowTitle ?? "",
            "screenshot": snapshot.screenshotMeta.dictionary,
            "execution": [
                "strictMode": snapshot.strictMode,
                "backgroundActivated": snapshot.backgroundActivated,
                "defaultPath": snapshot.strictMode ? "accessibility_then_background_cgevent" : "accessibility_then_foreground_fallback",
            ],
            "elements": elements,
            "hint": "Use refs like {e1}. Prefer AX-capable refs; strict mode rejects foreground fallback and reports path metadata after every action.",
        ]
        if !snapshot.recentActions.isEmpty {
            result["recentActions"] = snapshot.recentActions
        }
        if !snapshot.addedLabels.isEmpty || !snapshot.removedLabels.isEmpty {
            result["stateDelta"] = ["added": snapshot.addedLabels, "removed": snapshot.removedLabels]
        }
        if let windowNumber = snapshot.windowNumber {
            result["windowNumber"] = windowNumber
        }
        let application = NSRunningApplication(processIdentifier: snapshot.pid)
        let bundleIdentifier = application?.bundleIdentifier
        let instructionKey = bundleIdentifier?.lowercased()
            ?? snapshot.appName.lowercased()
        if !deliveredInstructionBundleIdentifiers.contains(instructionKey),
           let guidance = AppGuidance.instructions(
               bundleIdentifier: bundleIdentifier,
               appName: snapshot.appName
           ) {
            result["appSpecificInstructions"] = guidance
            deliveredInstructionBundleIdentifiers.insert(instructionKey)
        }
        return result
    }

    private func checkPermissions() -> [String: Any] {
        ComputerUsePermissions.status().dictionary
    }

    private func handleActivateApp(args: [String: Any]) -> [String: Any] {
        let name = args["name"] as? String ?? ""
        guard let app = try? appCatalog.runningApplication(named: name) else {
            return ["ok": false, "error": "App '\(name)' is not running."]
        }
        app.activate()
        return ["ok": true, "app": app.localizedName ?? name]
    }

    private func handleLaunchApp(args: [String: Any]) async throws -> [String: Any] {
        let name = (args["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return ["ok": false, "error": "App name is required."] }
        let wasRunning = (try? appCatalog.runningApplication(named: name)) != nil
        let app = try await appCatalog.ensureRunning(named: name, activates: true)
        return ["ok": true, "app": app.localizedName ?? name, "alreadyRunning": wasRunning]
    }

    private func handleOpenURL(args: [String: Any]) async throws -> [String: Any] {
        guard let rawURL = args["url"] as? String, let url = URL(string: rawURL) else {
            return ["ok": false, "error": "Invalid URL."]
        }
        if ComputerUseTargetPolicy.isBlockedBrowserURL(rawURL) {
            throw ComputerUseError.blockedBrowserURL
        }
        if let appName = args["app"] as? String, !appName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let appURL = applicationURL(named: appName) else {
                return ["ok": false, "error": "App '\(appName)' was not found."]
            }
            _ = try await NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: NSWorkspace.OpenConfiguration())
            return ["ok": true]
        }
        return ["ok": NSWorkspace.shared.open(url)]
    }

    private func displayInfo() -> [String: Any] {
        guard let screen = NSScreen.main else { return ["ok": false, "error": "No main screen."] }
        return [
            "ok": true,
            "width": Int(screen.frame.width),
            "height": Int(screen.frame.height),
            "scale_factor": screen.backingScaleFactor,
        ]
    }

    private func cuaScreenshotResult() async throws -> [[String: Any]] {
        guard let screen = NSScreen.main else { throw ComputerUseError.screenshotFailed }
        guard let frontmostApplication = NSWorkspace.shared.frontmostApplication else {
            throw ComputerUseError.noFrontmostApplication
        }
        try await appAuthorization.authorize(frontmostApplication)
        if let url = accessibility.currentBrowserURL(application: frontmostApplication),
           ComputerUseTargetPolicy.isBlockedBrowserURL(url) {
            cuaSnapshotFrontmostPID = nil
            throw ComputerUseError.blockedBrowserURL
        }
        cuaSnapshotFrontmostPID = frontmostApplication.processIdentifier
        let cgImage = await screenCaptureKitDisplayImage() ?? CGWindowListCreateImage(CGRect.null, .optionOnScreenOnly, kCGNullWindowID, [.bestResolution])
        guard let cgImage else {
            throw ComputerUseError.screenshotFailed
        }
        let logicalWidth = Int(screen.frame.width)
        let logicalHeight = Int(screen.frame.height)
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: logicalWidth,
            pixelsHigh: logicalHeight,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else {
            throw ComputerUseError.screenshotFailed
        }
        rep.size = NSSize(width: logicalWidth, height: logicalHeight)
        guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
            throw ComputerUseError.screenshotFailed
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
            .draw(in: NSRect(x: 0, y: 0, width: logicalWidth, height: logicalHeight))
        NSGraphicsContext.restoreGraphicsState()
        guard let png = rep.representation(using: .png, properties: [:]) else {
            throw ComputerUseError.screenshotFailed
        }
        return [
            ["type": "text", "text": jsonString(["ok": true, "width": logicalWidth, "height": logicalHeight]) ?? "{\"ok\":true}"],
            ["type": "image", "data": png.base64EncodedString(), "mimeType": "image/png"],
        ]
    }

    private func screenCaptureKitDisplayImage() async -> CGImage? {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { return nil }
            let configuration = SCStreamConfiguration()
            configuration.width = display.width
            configuration.height = display.height
            configuration.showsCursor = true
            let filter = SCContentFilter(display: display, excludingWindows: [])
            return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } catch {
            return nil
        }
    }

    private func runningApps() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    }

    private func applicationForAuthorization(appName: String?) async throws -> NSRunningApplication {
        guard let appName = appName?.trimmingCharacters(in: .whitespacesAndNewlines),
              !appName.isEmpty else {
            guard let frontmostApplication = NSWorkspace.shared.frontmostApplication else {
                throw ComputerUseError.noFrontmostApplication
            }
            return frontmostApplication
        }
        return try await appCatalog.ensureRunning(named: appName, activates: false)
    }

    private func runningApp(named name: String) -> NSRunningApplication? {
        let needle = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return runningApps().first { $0.localizedName?.lowercased() == needle }
            ?? runningApps().first { $0.localizedName?.lowercased().contains(needle) == true }
    }

    private func applicationURL(named name: String) -> URL? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId(for: trimmed)) {
            return url
        }
        if let path = NSWorkspace.shared.fullPath(forApplication: trimmed) {
            return URL(fileURLWithPath: path)
        }
        let candidates = [
            "/Applications/\(trimmed).app",
            "/System/Applications/\(trimmed).app",
            "/Applications/Utilities/\(trimmed).app",
            NSString(string: "~/Applications/\(trimmed).app").expandingTildeInPath,
        ]
        return candidates.map(URL.init(fileURLWithPath:)).first { FileManager.default.fileExists(atPath: $0.path) }
    }

    private func bundleId(for appName: String) -> String {
        switch appName.lowercased() {
        case "safari": return "com.apple.Safari"
        case "google chrome", "chrome": return "com.google.Chrome"
        case "arc": return "company.thebrowser.Browser"
        case "microsoft edge", "edge": return "com.microsoft.edgemac"
        case "brave", "brave browser": return "com.brave.Browser"
        case "slack": return "com.tinyspeck.slackmacgap"
        default: return ""
        }
    }

    private func cuaKeysToCombo(_ keys: [String]) -> String {
        keys.map { key in
            switch key.lowercased() {
            case "ctrl", "control": return "command"
            case "meta", "super", "win", "cmd": return "command"
            case "alt": return "option"
            case "arrowup": return "up"
            case "arrowdown": return "down"
            case "arrowleft": return "left"
            case "arrowright": return "right"
            case "backspace": return "delete"
            case " ": return "space"
            default: return key.lowercased()
            }
        }.joined(separator: "+")
    }

    private func parsePointPath(_ raw: Any?) -> [CGPoint] {
        guard let pairs = raw as? [[Any]] else { return [] }
        return pairs.compactMap { pair in
            guard pair.count >= 2 else { return nil }
            let x = valueAsDouble(pair[0])
            let y = valueAsDouble(pair[1])
            guard let x, let y else { return nil }
            return CGPoint(x: x, y: y)
        }
    }

    private func validateCuaSnapshotFresh() throws {
        guard let snapshotPID = cuaSnapshotFrontmostPID else {
            throw ComputerUseError.staleSnapshot("CUA action requires a screenshot first.")
        }
        let currentPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        guard currentPID == snapshotPID else {
            throw ComputerUseError.staleSnapshot("The user changed focus since the last CUA screenshot. Capture a new screenshot before acting.")
        }
    }

    private func valueAsDouble(_ value: Any) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? String { return Double(value) }
        return nil
    }

    private func respond(id: Any?, result: Any) {
        var response: [String: Any] = ["jsonrpc": "2.0", "result": result]
        if let id { response["id"] = id }
        writeLine(response)
    }

    private func respondError(id: Any?, code: Int, message: String) {
        var response: [String: Any] = ["jsonrpc": "2.0", "error": ["code": code, "message": message]]
        if let id { response["id"] = id }
        writeLine(response)
    }

    private func writeLine(_ object: [String: Any]) {
        guard let text = jsonString(object) else { return }
        print(text)
    }

    private func textResult(_ text: String) -> [[String: Any]] {
        [["type": "text", "text": text]]
    }

    private func jsonResult(_ payload: [String: Any]) -> [[String: Any]] {
        textResult(jsonString(payload) ?? "{\"ok\":false,\"error\":\"Failed to serialize result.\"}")
    }

    private func jsonString(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else {
            return nil
        }
        return text
    }

    private func errorPayload(_ error: Error) -> [String: Any] {
        let message = error.localizedDescription
        var payload: [String: Any] = ["ok": false, "error": message]
        if case ComputerUseError.staleSnapshot = error {
            payload["staleSnapshot"] = true
            payload["retryable"] = false
            payload["requiredNextAction"] = "snapshot"
            payload["hint"] = "Take a fresh snapshot before retrying. Do not repeat the same action against stale UI state."
        }
        if case ComputerUseError.appAuthorizationDenied = error {
            payload["authorizationDenied"] = true
            payload["retryable"] = false
        }
        if case ComputerUseError.protectedApplication = error {
            payload["protectedTarget"] = true
            payload["retryable"] = false
        }
        if case ComputerUseError.blockedBrowserURL = error {
            payload["disallowedURL"] = true
            payload["retryable"] = false
        }
        if case ComputerUseError.recordingStartDeclined = error {
            payload["recordingStartDeclined"] = true
            payload["retryable"] = false
        }
        if message.localizedCaseInsensitiveContains("accessibility") {
            payload["permissionNeeded"] = "accessibility"
        }
        if message.localizedCaseInsensitiveContains("screenshot") || message.localizedCaseInsensitiveContains("screen recording") {
            payload["permissionNeeded"] = "screen-recording"
        }
        return payload
    }

    private func log(_ message: String) {
        fputs("[ComputerUse] \(message)\n", stderr)
    }

    private func intArg(_ args: [String: Any], _ key: String) -> Int? {
        if let value = args[key] as? Int { return value }
        if let value = args[key] as? Double { return Int(value) }
        if let value = args[key] as? String { return Int(value) }
        return nil
    }

    private func doubleArg(_ args: [String: Any], _ key: String) -> Double? {
        if let value = args[key] as? Double { return value }
        if let value = args[key] as? Int { return Double(value) }
        if let value = args[key] as? String { return Double(value) }
        return nil
    }

    private func boolArg(_ args: [String: Any], _ key: String) -> Bool? {
        if let value = args[key] as? Bool { return value }
        if let value = args[key] as? String {
            if value == "true" { return true }
            if value == "false" { return false }
        }
        return nil
    }

    private func snapshotIDArg(_ args: [String: Any]) -> String? {
        args["snapshot_id"] as? String ?? args["snapshotId"] as? String
    }
}
