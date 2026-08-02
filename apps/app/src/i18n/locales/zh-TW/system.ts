import { APP_NAME } from "../brand";

export default {
  "system.reload_body_agents":
    "Agent 在啟動時載入。請重新載入以使更新的 Agent 可用。",
  "system.reload_body_commands":
    "命令在啟動時載入。請重新載入以使更新的命令可用。",
  "system.reload_body_config":
    "工作區配置在啟動時讀取。請重新載入以應用變更。",
  "system.reload_body_default": `${APP_NAME}檢測到需要重新載入後才能生效的變更。`,
  "system.reload_body_mcp":
    "連接器在啟動時載入。請重新載入以啟用新連接。",
  "system.reload_body_mixed": `${APP_NAME}檢測到配置變更。請重新載入以應用。`,
  "system.reload_body_plugins":
    "插件在啟動時載入。請重新載入以應用配置變更。",
  "system.reload_body_skills":
    "技能發現狀態可能會被快取。請重新載入以使新安裝的技能可用。",
  "system.reload_failed": "無法應用變更，請再試一次重新載入。",
  "system.reload_required": "需要重新載入以應用變更",
  "system.reload_unavailable": "此工作區暫不支援重新載入。",
  "system.stop_active_runs_before_reset": "請先停止活躍的運行再重置。",
  "system.server_unhealthy": "服務器報告狀態異常。",
  "system.boot_preparing_workspace": "正在啟動 OnMyAgent…",
  "system.boot_loading_workspaces": "正在載入工作區…",
  "system.boot_starting_server": "正在啟動本地服務…",
  "system.boot_activating_workspace": "正在啟用你的工作區…",
  "system.boot_ready": "已就緒",
  "system.boot_error": "出了點問題",
  "system.boot_start_runtime_failed":
    "無法啟動 OnMyAgent。請退出後重新開啟應用再試。",
  "system.boot_server_not_ready":
    "本地服務未完成啟動。請退出 OnMyAgent 後重新開啟。",
  "system.boot_download_latest_hint": "若反覆出現，請下載最新版本：",
  "system.boot_retry": "再試一次",
  "system.error_action_retry": "再試一次",
  "system.error_action_reload_app": "重新開啟應用",
  "system.error_action_open_ai_settings": "開啟模型設定",
  "system.error_not_connected_title": "未連線",
  "system.error_not_connected_body":
    "工作區服務目前不可用。請稍候再試，或重新開啟應用。",
  "system.error_providers_load_title": "無法載入服務商",
  "system.error_providers_load_body":
    "請檢查網路與工作區連線後重試。",
  "system.error_connect_provider_title": "無法連接模型服務商",
  "system.error_connect_provider_body":
    "請檢查 API 金鑰、登入狀態或網路後重試。金鑰只保存在本機。",
  "system.error_remote_workspace_title": "遠端工作區不可用",
  "system.error_remote_workspace_body":
    "無法連上此遠端工作區。請檢查位址與網路後重試。",
  "system.error_request_title": "請求失敗",
  "system.error_request_body": "出了點問題，請重試。",
  "system.load_opening": "正在開啟…",
  "system.load_session_route": "正在載入工作區…",
  "system.load_settings_route": "正在載入設定…",
  "system.load_welcome_route": "正在準備入門引導…",
  "system.load_settings_chunk": "正在開啟設定…",
  "system.load_welcome_chunk": "正在開啟入門引導…",
  "system.load_settings_tab": "正在載入頁面…",
  "system.load_settings_ai": "正在載入服務商…",
  "system.load_session_refresh": "正在重新整理工作區…",
  "system.load_session_workspace": "正在切換工作區…",
  "system.starting_workspace": "正在啟動你的工作區…",
  "system.starting_another_workspace": "正在啟動另一個工作區…",
  "system.start_workspace_failed":
    "無法啟動所選工作區。請換一個工作區，或重新啟動應用後再試。",
  "system.action_returned_error": "操作未完成，請重試。",
  "system.control_mode_off": "控制模式已關閉。",
  "system.control_open_ai_settings_desc": "前往 AI 模型服務商設置。",
  "system.control_open_command_palette": "打開命令面板",
  "system.control_open_command_palette_desc": "打開應用內命令面板，以便下一步選擇可見。",
  "system.control_open_folders_settings_desc": "前往授權文件夾和文件訪問設置。",
  "system.control_open_general_settings": "打開通用設置",
  "system.control_open_general_settings_desc": "前往通用設置。",
  "system.control_open_personal_settings": "打開個人設置",
  "system.control_open_personal_settings_desc": "稱呼、語氣、自訂指令與工作手冊。",
  "system.control_open_memory_settings": "打開記憶設置",
  "system.control_open_memory_settings_desc": "對話記憶、待確認條目與已保存事實。",
  "system.control_open_sessions": "打開會話",
  "system.control_open_sessions_desc": "前往主會話視圖。",
  "system.control_ready": "已就緒。控制器可以檢查並運行可見操作。",
  "system.control_user_cancelled": "用戶已取消操作。",
  "system.control_open_provider_settings": "打開模型服務商設置",
  "system.control_open_folders_settings": "打開授權文件夾設置",
} as const;
