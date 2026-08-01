import { APP_NAME } from "../brand";

export default {
  "session_archive.delete": "刪除",
  "session_archive.sync": "同步",
  "session_archive.syncing": "同步中…",
  "session_archive.search_placeholder": "搜索歸檔會話",
  "session_archive.loading": "正在加載歸檔…",
  "session_archive.load_more": "加載更多",
  "session_archive.loading_more": "正在加載更多…",
  "session_archive.loaded_count": "已加載 {loaded}/{total}",
  "session_archive.loading_messages": "正在加載 transcript…",
  "session_archive.empty": "暫無歸檔會話",
  "session_archive.empty_hint":
    "這裡匯總本機 Claude / Codex / OpenCode / Copilot 等 Agent 的歷史記錄。個人助理對話請到「助手」查看。點同步可重新掃描本機資料。",
  "session_archive.empty_sync_stats":
    "上次同步：發現 {discovered}，寫入 {synced}，跳過 {skipped}，失敗 {failed}",
  "session_archive.select_session": "選擇一個歸檔會話",
  "session_archive.select_session_hint": "從左側列表選擇會話以預覽 transcript",
  "session_archive.no_messages": "這個歸檔項沒有消息",
  "session_archive.role_user": "你",
  "session_archive.role_assistant": "助手",
  "session_archive.role_system": "系統",
  "session_archive.role_tool": "工具",
  "session_archive.message_count": "{count} 條消息",
  "session_archive.resume": "恢復",
} as const;
