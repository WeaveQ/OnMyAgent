import { APP_NAME } from "../brand";

export default {
  "app.compact_command_desc": "Summarize this session to reduce context size.",
  "app.error_audit_load": "Failed to load audit log.",
  "app.error_auth_failed": "Authentication failed",
  "app.error_command_not_resolved": "Command was not resolved.",
  "app.error_compact_empty": "Nothing to compact yet.",
  "app.error_compact_no_session":
    "Select a session with messages before running /compact.",
  "app.error_compact_no_session_id": "Select a session before compacting.",
  "app.error_connect_first":
    "Connect to this worker before applying runtime changes.",
  "app.error_remote_worker_connection_failed": "Remote worker connection failed.",
  "app.error_remote_worker_url_missing":
    "Remote worker URL is missing. Edit connection and add a server URL.",
  "app.error_prompt_required": "Prompt is required.",
  "app.error_not_connected": "Not connected to a server",
  "app.error_rate_limit": "Rate limit exceeded",
  "app.error_remote_access": "Failed to update remote access.",
  "app.error_request_failed": "Request failed",
  "app.error_restart_local_worker":
    "Failed to restart the local worker with the updated sharing setting.",
  "app.error_session_name_required": "Session name is required",
  "app.local_disabled_reason":
    "Create local workspaces in the desktop app. Remote and shared workspaces still work here.",
  "app.model_behavior_title": "Model behavior",
  "app.plugins_hint_readonly": `${APP_NAME} server is read-only for plugins.`,
  "app.reload_later": "Later",
  "app.reload_now": "Reload now",
  "app.reload_stop_tasks": "Reload & Stop Tasks",
  "app.skills_hint_readonly": `${APP_NAME} server is read-only for skills. Add a host token in Advanced to enable installs.`,
  "app.unknown_error": "Unknown error",
  "app.error_load_tasks": "Failed to load tasks",
} as const;
