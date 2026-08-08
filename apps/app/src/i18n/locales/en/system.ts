import { APP_NAME } from "../brand";

export default {
  "system.reload_body_agents":
    "Agents load at startup. Reload to make updated agents available.",
  "system.reload_body_commands":
    "Commands load at startup. Reload to make updated commands available.",
  "system.reload_body_config":
    "Workspace configuration is read at startup. Reload to apply changes.",
  "system.reload_body_default": `${APP_NAME} detected changes that need a reload to take effect.`,
  "system.reload_body_mcp":
    "Connectors load at startup. Reload to activate the new connection.",
  "system.reload_body_mixed": `${APP_NAME} detected configuration changes. Reload to apply them.`,
  "system.reload_body_plugins":
    "Plugins load at startup. Reload to apply configuration changes.",
  "system.reload_body_skills":
    "Skill discovery may be cached. Reload to make newly installed skills available.",
  "system.reload_failed": "Couldn’t apply the changes. Try reloading again.",
  "system.reload_required": "Reload to apply changes",
  "system.reload_unavailable": "Reload isn’t available for this workspace.",
  "system.stop_active_runs_before_reset": "Stop active runs before resetting.",
  "system.server_unhealthy": "Server reported unhealthy status.",
  "system.boot_preparing_workspace": "Starting OnMyAgent…",
  "system.boot_loading_workspaces": "Loading your workspaces…",
  "system.boot_starting_server": "Starting the local service…",
  "system.boot_activating_workspace": "Activating your workspace…",
  "system.boot_ready": "Ready",
  "system.boot_error": "Something went wrong",
  "system.boot_start_runtime_failed":
    "Could not start OnMyAgent. Try quitting and opening the app again.",
  "system.boot_server_not_ready":
    "The local service did not finish starting. Quit OnMyAgent and open it again.",
  "system.boot_config_invalid":
    "Local engine config is invalid (often incomplete MCP entries). Try “Repair engine config”, then retry.",
  "system.boot_download_latest_hint":
    "If this keeps happening, download the latest version:",
  "system.boot_retry": "Try again",
  "system.boot_open_config_dir": "Open config folder",
  "system.boot_repair_config": "Repair engine config",
  "system.boot_repair_working": "Repairing…",
  "system.boot_repair_done": "Repaired and backed up old config — try again",
  "system.boot_repair_failed":
    "Automatic repair failed. Open the config folder and check manually",
  "system.error_action_retry": "Try again",
  "system.error_action_reload_app": "Restart app",
  "system.error_action_open_ai_settings": "Open model settings",
  "system.error_not_connected_title": "Not connected",
  "system.error_not_connected_body":
    "The workspace service is offline. Wait a moment and try again, or reopen the app.",
  "system.error_providers_load_title": "Couldn’t load providers",
  "system.error_providers_load_body":
    "Check your network and workspace connection, then try again.",
  "system.error_connect_provider_title": "Couldn’t connect model provider",
  "system.error_connect_provider_body":
    "Check the API key, sign-in, or network, then try again. Keys stay on your machine.",
  "system.error_remote_workspace_title": "Remote workspace unavailable",
  "system.error_remote_workspace_body":
    "Can’t reach this remote workspace. Check the address and network, then retry.",
  "system.error_request_title": "Request failed",
  "system.error_request_body": "Something went wrong. Please try again.",
  "system.load_opening": "Opening…",
  "system.load_session_route": "Loading workspace…",
  "system.load_settings_route": "Loading settings…",
  "system.load_welcome_route": "Preparing onboarding…",
  "system.load_settings_chunk": "Opening settings…",
  "system.load_welcome_chunk": "Opening onboarding…",
  "system.load_settings_tab": "Loading page…",
  "system.load_settings_ai": "Loading providers…",
  "system.load_session_refresh": "Refreshing workspace…",
  "system.load_session_workspace": "Switching workspace…",
  "system.starting_workspace": "Starting your workspace…",
  "system.starting_another_workspace": "Starting another workspace…",
  "system.start_workspace_failed":
    "Could not start the selected workspace. Try another workspace or restart the app.",
  "system.action_returned_error": "That action did not complete. Please try again.",
  "system.control_mode_off": "Control mode is off.",
  "system.control_open_ai_settings_desc": "Navigate to AI provider settings.",
  "system.control_open_command_palette": "Open the command palette",
  "system.control_open_command_palette_desc": "Open the in-app command palette so the next choice is visible.",
  "system.control_open_folders_settings_desc": "Navigate to authorized folders and file access settings.",
  "system.control_open_general_settings": "Open general settings",
  "system.control_open_general_settings_desc": "Navigate to general settings.",
  "system.control_open_personal_settings": "Open personal settings",
  "system.control_open_personal_settings_desc":
    "Name, tone, custom instructions, and work handbook.",
  "system.control_open_memory_settings": "Open memory settings",
  "system.control_open_memory_settings_desc":
    "Conversation memory, pending confirmations, and saved facts.",
  "system.control_open_sessions": "Open sessions",
  "system.control_open_sessions_desc": "Navigate to the main session view.",
  "system.control_ready": "Ready. A controller can inspect and run visible actions.",
  "system.control_user_cancelled": "User cancelled action.",
  "system.control_open_provider_settings": "Open provider settings",
  "system.control_open_folders_settings": "Open authorized folder settings",
} as const;
