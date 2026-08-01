import { APP_NAME } from "../brand";

export default {
  "session_archive.delete": "删除",
  "session_archive.sync": "同步",
  "session_archive.syncing": "同步中…",
  "session_archive.search_placeholder": "搜索归档会话",
  "session_archive.loading": "正在加载归档…",
  "session_archive.load_more": "加载更多",
  "session_archive.loading_more": "正在加载更多…",
  "session_archive.loaded_count": "已加载 {loaded}/{total}",
  "session_archive.loading_messages": "正在加载 transcript…",
  "session_archive.empty": "暂无归档会话",
  "session_archive.empty_hint":
    "这里汇总本机 Claude / Codex / OpenCode / Copilot 等 Agent 的历史记录。个人助理里的对话请到「助手」查看。点同步可重新扫描本地数据。",
  "session_archive.empty_sync_stats":
    "上次同步：发现 {discovered}，写入 {synced}，跳过 {skipped}，失败 {failed}",
  "session_archive.select_session": "选择一个归档会话",
  "session_archive.select_session_hint": "从左侧列表选择会话以预览 transcript",
  "session_archive.no_messages": "这个归档项没有消息",
  "session_archive.role_user": "你",
  "session_archive.role_assistant": "助手",
  "session_archive.role_system": "系统",
  "session_archive.role_tool": "工具",
  "session_archive.message_count": "{count} 条消息",
  "session_archive.resume": "恢复",
} as const;
