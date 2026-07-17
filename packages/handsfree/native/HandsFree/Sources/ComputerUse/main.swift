/// Computer Use: semantic AX and background-safe macOS computer use.
///
/// Three modes:
///   mcp       — run the MCP server over stdio
///   --check   — print permission status as JSON to stdout and exit
///   --status  — print permission, protocol, and optional lock-control status
///   (default) — open the permission setup GUI

import AppKit
import Foundation

setbuf(stdout, nil)

let args = CommandLine.arguments
let subcommand = args.count >= 2 ? args[1] : ""
let detailCommand = args.count >= 3 ? args[2] : ""

switch subcommand {
case "mcp":
    if ProcessInfo.processInfo.environment["ONMYAGENT_COMPUTER_USE_CURSOR_OVERLAY"] == "0" {
        let server = MCPServer()
        await server.run()
    } else {
        await runMCPServerWithOverlay()
    }
case "--check":
    // Fresh process → fresh TCC read → always accurate.
    let status = ComputerUsePermissions.status()
    let json = "{\"ok\":\(status.ok),\"accessibility\":\(status.accessibility),\"screenRecording\":\(status.screenRecording)}"
    print(json)
    exit(0)
case "--status":
    let permissions = ComputerUsePermissions.status()
    var status = ComputerUseInstallStatus.detect().dictionary
    status["ok"] = permissions.ok
    status["accessibility"] = permissions.accessibility
    status["screenRecording"] = permissions.screenRecording
    let activityStore = ComputerUseActivityStore()
    status["activity"] = (try? activityStore.read().dictionary)
        ?? ComputerUseActivitySnapshot(
            phase: .inactive,
            app: nil,
            reason: nil,
            processID: nil,
            updatedAt: Date()
        ).dictionary
    let skysightSettings = (try? SkysightSettingsStore().read()) ?? .defaults
    status["skysight"] = [
        "enabled": skysightSettings.enabled,
        "paused": skysightSettings.paused,
        "recording": SkysightRecorderLease.isRunning(),
        "retentionDays": skysightSettings.retentionDays,
        "exclusions": skysightSettings.exclusions.map(\.dictionary),
    ]
    status["appAuthorizations"] = ((try? AppAuthorizationStore().read()) ?? .defaults).dictionary
    let data = try JSONSerialization.data(withJSONObject: status, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    exit(0)
case "skysight":
    let settings = SkysightSettingsStore()
    switch detailCommand {
    case "record":
        try await SkysightRecorder(settingsStore: settings).run()
    case "enable":
        try settings.setEnabled(true)
        print("{\"ok\":true,\"enabled\":true}")
    case "disable":
        try settings.setEnabled(false)
        print("{\"ok\":true,\"enabled\":false}")
    case "pause":
        try settings.setPaused(true)
        print("{\"ok\":true,\"paused\":true}")
    case "resume":
        try settings.setPaused(false)
        print("{\"ok\":true,\"paused\":false}")
    case "status":
        let current = try settings.read()
        let data = try JSONSerialization.data(
            withJSONObject: [
                "ok": true,
                "enabled": current.enabled,
                "paused": current.paused,
                "retentionDays": current.retentionDays,
                "exclusions": current.exclusions.map(\.dictionary),
            ],
            options: [.sortedKeys]
        )
        print(String(decoding: data, as: UTF8.self))
    case "context":
        let summaries = try SkysightStore().recentSummaries()
        let data = try JSONSerialization.data(withJSONObject: ["summaries": summaries], options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    case "clear":
        try SkysightStore().clearActivityData()
        print("{\"ok\":true}")
    case "exclusions":
        let current = try settings.read()
        let data = try JSONSerialization.data(
            withJSONObject: [
                "ok": true,
                "exclusions": current.exclusions.map(\.dictionary),
            ],
            options: [.sortedKeys]
        )
        print(String(decoding: data, as: UTF8.self))
    case "exclude":
        guard args.count >= 5,
              let operation = SkysightExclusionOperation(rawValue: args[3]),
              let scope = SkysightExclusionScope(rawValue: args[4]) else {
            throw ComputerUseError.invalidCommand(
                "skysight exclude <add|remove> <app|website|private_browsing> [value]"
            )
        }
        let value = args.count >= 6 ? args[5] : nil
        if scope != .privateBrowsing, value?.isEmpty != false {
            throw ComputerUseError.invalidCommand("skysight exclusion value is required")
        }
        try settings.updateExclusion(
            operation: operation,
            exclusion: SkysightExclusion(scope: scope, value: value)
        )
        print("{\"ok\":true}")
    default:
        throw ComputerUseError.invalidCommand("skysight \(detailCommand)")
    }
case "authorization":
    let store = AppAuthorizationStore()
    switch detailCommand {
    case "status":
        var payload = try store.read().dictionary
        payload["ok"] = true
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    case "revoke":
        guard args.count >= 4 else {
            throw ComputerUseError.invalidCommand("authorization revoke <bundle-identifier>")
        }
        try store.revoke(args[3])
        print("{\"ok\":true}")
    case "clear":
        try store.clear()
        print("{\"ok\":true}")
    default:
        throw ComputerUseError.invalidCommand("authorization \(detailCommand)")
    }
case "appshot":
    switch detailCommand {
    case "capture":
        let result = try await AppshotCaptureStore().capture(publishEvent: false)
        let data = try JSONSerialization.data(withJSONObject: result.dictionary, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    case "monitor":
        AppshotShortcutMonitor().run()
    default:
        throw ComputerUseError.invalidCommand("appshot \(detailCommand)")
    }
default:
    await runPermissionSetupApp()
}

@MainActor
func runMCPServerWithOverlay() async {
    NSApplication.shared.setActivationPolicy(.accessory)
    let server = MCPServer()
    Task.detached {
        await server.run()
        await MainActor.run {
            NSApplication.shared.terminate(nil)
        }
    }
    NSApplication.shared.run()
}

@MainActor
func runPermissionSetupApp() async {
    NSApplication.shared.setActivationPolicy(.regular)
    let appDelegate = PermissionSetupAppDelegate()
    NSApplication.shared.delegate = appDelegate
    NSApplication.shared.run()
}
