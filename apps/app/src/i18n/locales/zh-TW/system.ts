import { APP_NAME } from "../brand";

export default {
  "system.reload_body_agents":
    "Agent 在啟動時加載。重新加載引擎以使更新的 Agent 可用。",
  "system.reload_body_commands":
    "命令在啟動時加載。重新加載引擎以使更新的命令可用。",
  "system.reload_body_config":
    "工作區配置在啟動時讀取。重新加載引擎以應用配置變更。",
  "system.reload_body_default": `${APP_NAME}檢測到需要重新加載本地智能體引擎的變更。`,
  "system.reload_body_mcp":
    "MCP 服務器在啟動時加載。重新加載引擎以激活新連接。",
  "system.reload_body_mixed": `${APP_NAME}檢測到配置變更。重新加載引擎以應用。`,
  "system.reload_body_plugins":
    "插件在啟動時加載。重新加載引擎以應用配置變更。",
  "system.reload_body_skills":
    "技能發現狀態可能會被緩存。重新加載引擎以使新安裝的技能可用。",
  "system.reload_failed": "重新加載引擎失敗。",
  "system.reload_required": "需要重新加載",
  "system.reload_unavailable": "此工作區不支持重新加載。",
  "system.stop_active_runs_before_reset": "請先停止活躍的運行再重置。",
  "system.server_unhealthy": "服務器報告狀態異常。",
  "system.boot_preparing_workspace": "正在準備工作區",
  "system.boot_activating_workspace": "正在激活你的工作區",
  "system.boot_ready": "已就緒",
  "system.boot_error": "出現問題",
  "system.starting_workspace": "正在啟動你的工作區",
  "system.starting_another_workspace": "正在啟動另一個工作區",
  "system.start_workspace_failed": "啟動所選工作區失敗。",
  "system.action_returned_error": "操作返回錯誤。",
  "system.control_mode_off": "控制模式已關閉。",
  "system.control_open_ai_settings_desc": "前往 AI 模型服務商設置。",
  "system.control_open_command_palette": "打開命令面板",
  "system.control_open_command_palette_desc": "打開應用內命令面板，以便下一步選擇可見。",
  "system.control_open_extensions_settings": "打開 MCP 和擴展設置",
  "system.control_open_extensions_settings_desc": "前往擴展和 MCP 設置。",
  "system.control_open_folders_settings_desc": "前往授權文件夾和文件訪問設置。",
  "system.control_open_general_settings": "打開通用設置",
  "system.control_open_general_settings_desc": "前往通用設置。",
  "system.control_open_sessions": "打開會話",
  "system.control_open_sessions_desc": "前往主會話視圖。",
  "system.control_open_skills_settings_desc": "前往技能設置。",
  "system.control_ready": "已就緒。控制器可以檢查並運行可見操作。",
  "system.control_user_cancelled": "用戶已取消操作。",
  "system.control_open_skills_settings": "打開技能設置",
  "system.control_open_provider_settings": "打開模型服務商設置",
  "system.control_open_folders_settings": "打開授權文件夾設置",
} as const;
