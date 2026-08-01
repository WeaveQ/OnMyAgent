import { APP_NAME } from "../brand";

export default {
  "session_archive.delete": "Delete",
  "session_archive.sync": "Sync",
  "session_archive.syncing": "Syncing...",
  "session_archive.search_placeholder": "Search archived sessions",
  "session_archive.loading": "Loading archive...",
  "session_archive.load_more": "Load more",
  "session_archive.loading_more": "Loading more...",
  "session_archive.loaded_count": "Loaded {loaded}/{total}",
  "session_archive.loading_messages": "Loading transcript...",
  "session_archive.empty": "No archived sessions yet",
  "session_archive.empty_hint":
    "This panel indexes local Claude / Codex / OpenCode / Copilot agent history. Personal assistant chats live under Assistant. Click Sync to rescan this machine.",
  "session_archive.empty_sync_stats":
    "Last sync: discovered {discovered}, synced {synced}, skipped {skipped}, failed {failed}",
  "session_archive.select_session": "Select an archived session",
  "session_archive.select_session_hint": "Pick a session from the list to preview its transcript",
  "session_archive.no_messages": "No messages in this archive entry",
  "session_archive.role_user": "You",
  "session_archive.role_assistant": "Assistant",
  "session_archive.role_system": "System",
  "session_archive.role_tool": "Tool",
  "session_archive.message_count": "{count} messages",
  "session_archive.resume": "Resume",
} as const;
