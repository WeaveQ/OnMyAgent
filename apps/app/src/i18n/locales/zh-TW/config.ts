import { APP_NAME } from "../brand";

export default {
  "config.collaborator_token_disabled_hint":
    "已預存用於遠程共享，但遠程訪問當前已禁用。",
  "config.collaborator_token_label": "協作者令牌",
  "config.collaborator_token_remote_hint":
    "手機或筆記本連接此服務器時的日常遠程訪問。",
  "config.connection_failed": "連接失敗。",
  "config.connection_failed_check": "連接失敗。請檢查主機URL和令牌。",
  "config.connection_status_updated": "連接狀態已更新。",
  "config.connection_successful": "連接成功。",
  "config.copied": "已複製",
  "config.copy": "複製",
  "config.desktop_only_hint":
    "部分配置功能（本地服務器共享 + 消息橋接）需要桌面應用。",
  "config.diagnostics_desc": "複製脫敏的運行時狀態用於調試。",
  "config.diagnostics_title": "診斷包",
  "config.engine_reload_desc": "重啟此工作區的OpenCode服務器。",
  "config.engine_reload_title": "引擎重新加載",
  "config.host_admin_token_hint":
    "僅限主機內部使用的令牌，用於審批CLI和管理API。請勿在遠程應用連接流程中使用。",
  "config.host_admin_token_label": "主機管理員令牌",
  "config.host_local_only": "僅限本地",
  "config.host_offline": "離線",
  "config.host_remote_enabled": "已啟用遠程",
  "config.local_ip_hint": "在同一Wi-Fi下使用本地IP可獲得最快連接。",
  "config.mdns_hint": ".local名稱更易記憶，但可能無法在所有網絡上解析。",
  "config.messaging_identities_desc":
    "在身份標籤頁中管理Telegram/Slack身份和路由。",
  "config.messaging_identities_title": "消息身份",
  "config.not_set": "未設置",
  "config.owner_token_disabled_hint": "僅在啟用此工作區的遠程訪問後才有效。",
  "config.owner_token_label": "所有者令牌",
  "config.owner_token_remote_hint":
    "遠程客戶端需要回答權限提示或執行所有者操作時使用。",
  "config.reload_active_tasks_warning": "重新加載將停止活動任務。",
  "config.reload_availability_hint": `僅本地工作區或已連接的${APP_NAME}服務器支持重新加載。`,
  "config.reload_connect_hint": "連接此工作區後才能重新加載。",
  "config.reload_engine": "重新加載引擎",
  "config.reload_now_desc": "應用配置更新並重新連接會話。",
  "config.reload_now_title": "立即重新加載",
  "config.reloading": "正在重新加載…",
  "config.remote_access_off_hint":
    "遠程訪問已關閉。請先通過分享工作區啟用遠程訪問，然後再從其他設備連接。",
  "config.resolved_worker_url": "解析後的工作區URL：",
  "config.server_needed_hint": `需要連接${APP_NAME}服務器以同步skills、插件和命令。`,
  "config.server_section_desc": `連接${APP_NAME}服務器。使用URL加服務器管理員提供的協作者或所有者令牌。`,
  "config.server_section_title": `${APP_NAME}服務器`,
  "config.server_sharing_desc":
    "將這些詳情分享給受信任的設備。保持服務器在同一網絡以獲得最快設置。",
  "config.server_sharing_menu_hint":
    "如需每個工作區的分享鏈接，請使用工作區菜單中的分享…",
  "config.server_sharing_title": `${APP_NAME}服務器共享`,
  "config.server_url_hint": `使用${APP_NAME}服務器提供的URL。本地桌面工作區使用48000-51000範圍內的持久高端口。`,
  "config.server_url_input_label": `${APP_NAME}服務器URL`,
  "config.server_url_label": `${APP_NAME}服務器URL`,
  "config.starting_server": "正在啟動服務器…",
  "config.status_connected": "已連接",
  "config.status_limited": "受限",
  "config.status_not_connected": "未連接",
  "config.test_connection": "測試連接",
  "config.testing": "正在測試…",
  "config.testing_connection": "正在測試連接…",
  "config.token_hint":
    "可選。粘貼協作者令牌用於日常訪問，或在此客戶端需要回答權限提示時粘貼所有者令牌。",
  "config.token_label": "協作者或所有者令牌",
  "config.token_placeholder": "粘貼你的令牌",
  "config.unavailable": "不可用",
  "config.worker_id": "工作區ID：",
  "config.workspace_config_desc":
    "這些設置影響所選工作區。僅運行時操作適用於當前連接的工作區。",
  "config.workspace_config_title": "工作區配置",
  "config.workspace_id_prefix": "工作區：",
} as const;
