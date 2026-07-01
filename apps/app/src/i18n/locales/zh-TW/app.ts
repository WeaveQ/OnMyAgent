import { APP_NAME } from "../brand";

export default {
  "app.compact_command_desc": "壓縮此會話以減少上下文大小。",
  "app.error_audit_load": "加載審計日誌失敗。",
  "app.error_auth_failed": "認證失敗",
  "app.error_command_not_resolved": "命令未解析。",
  "app.error_compact_empty": "暫無可壓縮的內容。",
  "app.error_compact_no_session": "請先選擇一個有消息的會話再運行/compact。",
  "app.error_compact_no_session_id": "請先選擇一個會話再壓縮。",
  "app.error_connect_first": "請先連接到此工作區再應用運行時更改。",
  "app.error_remote_worker_connection_failed": "遠程工作區連接失敗。",
  "app.error_remote_worker_url_missing":
    "遠程工作區 URL 缺失。請編輯連接並添加服務器 URL。",
  "app.error_prompt_required": "請輸入提示詞。",
  "app.error_not_connected": "未連接到服務器",
  "app.error_rate_limit": "請求頻率超限",
  "app.error_remote_access": "更新遠程訪問失敗。",
  "app.error_request_failed": "請求失敗",
  "app.error_restart_local_worker": "使用更新的共享設置重啟本地工作區失敗。",
  "app.error_session_name_required": "會話名稱為必填項",
  "app.local_disabled_reason":
    "本地工作區需在桌面應用中創建。遠程和共享工作區仍可正常使用。",
  "app.model_behavior_title": "模型行為",
  "app.plugins_hint_readonly": `${APP_NAME}服務器對插件為只讀模式。`,
  "app.reload_later": "稍後",
  "app.reload_now": "立即重新加載",
  "app.reload_stop_tasks": "重新加載並停止任務",
  "app.skills_hint_readonly": `${APP_NAME}服務器對skills為只讀模式。請在高級設置中添加主機令牌以啟用安裝。`,
  "app.unknown_error": "未知錯誤",
  "app.error_load_tasks": "加載任務失敗",
} as const;
