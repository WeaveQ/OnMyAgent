import Foundation

struct ComputerUsePermissionCopy: Sendable {
    let setupTitle: String
    let setupSubtitle: String
    let done: String
    let accessibility: String
    let accessibilityDescription: String
    let grantAccessibility: String
    let screenRecording: String
    let screenRecordingDescription: String
    let requestScreenRecording: String
    let openPrivacy: String
    let dragMe: String
    let dragHint: String
    let granted: String
    let needed: String
    let screenRecordingList: String

    static var current: ComputerUsePermissionCopy {
        resolve(Locale.preferredLanguages)
    }

    static func resolve(_ preferredLanguages: [String]) -> ComputerUsePermissionCopy {
        let language = preferredLanguages.first?.lowercased() ?? "en"
        if language.hasPrefix("zh-hant") || language.hasPrefix("zh-tw") || language.hasPrefix("zh-hk") {
            return traditionalChinese
        }
        if language.hasPrefix("zh") { return simplifiedChinese }
        return english
    }

    private static let english = ComputerUsePermissionCopy(
        setupTitle: "Computer Use Setup",
        setupSubtitle: "Grant two permissions so agents can see and control apps in the background.",
        done: "Done — Return to OnMyAgent",
        accessibility: "Accessibility",
        accessibilityDescription: "Allows agents to interact with UI controls, click buttons, and type text entirely in the background.",
        grantAccessibility: "Grant Accessibility",
        screenRecording: "Screen Recording",
        screenRecordingDescription: "Lets agents see what is on screen. If macOS does not prompt automatically, drag the app icon below into the Screen Recording list.",
        requestScreenRecording: "Request Screen Recording",
        openPrivacy: "Open Privacy & Security",
        dragMe: "Drag me",
        dragHint: "Drag this icon into the Screen Recording list in Privacy & Security, then enable it.",
        granted: "Granted",
        needed: "Needed",
        screenRecordingList: "Screen Recording\nlist"
    )

    private static let simplifiedChinese = ComputerUsePermissionCopy(
        setupTitle: "设置 Computer Use",
        setupSubtitle: "授予两项权限，让智能体可以在后台查看和控制应用。",
        done: "完成 — 返回 OnMyAgent",
        accessibility: "辅助功能",
        accessibilityDescription: "允许智能体在后台操作界面控件、点击按钮和输入文字。",
        grantAccessibility: "授予辅助功能权限",
        screenRecording: "屏幕录制",
        screenRecordingDescription: "允许智能体查看屏幕内容。如果 macOS 没有自动提示，请将下方应用图标拖入屏幕录制列表。",
        requestScreenRecording: "请求屏幕录制权限",
        openPrivacy: "打开隐私与安全性",
        dragMe: "拖动我",
        dragHint: "将此图标拖入“隐私与安全性”的屏幕录制列表，然后启用它。",
        granted: "已授予",
        needed: "需要授权",
        screenRecordingList: "屏幕录制\n列表"
    )

    private static let traditionalChinese = ComputerUsePermissionCopy(
        setupTitle: "設定 Computer Use",
        setupSubtitle: "授予兩項權限，讓智慧代理可以在背景查看與控制應用程式。",
        done: "完成 — 返回 OnMyAgent",
        accessibility: "輔助使用",
        accessibilityDescription: "允許智慧代理在背景操作介面控制項、點擊按鈕與輸入文字。",
        grantAccessibility: "授予輔助使用權限",
        screenRecording: "螢幕錄製",
        screenRecordingDescription: "允許智慧代理查看螢幕內容。如果 macOS 沒有自動提示，請將下方應用程式圖示拖入螢幕錄製清單。",
        requestScreenRecording: "要求螢幕錄製權限",
        openPrivacy: "開啟隱私權與安全性",
        dragMe: "拖曳我",
        dragHint: "將此圖示拖入「隱私權與安全性」的螢幕錄製清單，然後啟用它。",
        granted: "已授予",
        needed: "需要授權",
        screenRecordingList: "螢幕錄製\n清單"
    )
}
