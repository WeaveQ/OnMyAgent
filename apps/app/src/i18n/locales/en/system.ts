import { APP_NAME } from "../brand";

export default {
  "system.reload_body_agents":
    "Agents load at startup. Reload the engine to make updated agents available.",
  "system.reload_body_commands":
    "Commands load at startup. Reload the engine to make updated commands available.",
  "system.reload_body_config":
    "Workspace configuration is read at startup. Reload the engine to apply changes.",
  "system.reload_body_default": `${APP_NAME} detected changes that require reloading the local agent engine.`,
  "system.reload_body_mcp":
    "MCP servers load at startup. Reload the engine to activate the new connection.",
  "system.reload_body_mixed": `${APP_NAME} detected configuration changes. Reload the engine to apply them.`,
  "system.reload_body_plugins":
    "Plugins load at startup. Reload the engine to apply configuration changes.",
  "system.reload_body_skills":
    "Skill discovery may be cached. Reload the engine to make newly installed skills available.",
  "system.reload_failed": "Failed to reload the engine.",
  "system.reload_required": "Reload required",
  "system.reload_unavailable": "Reload is unavailable for this worker.",
  "system.stop_active_runs_before_reset": "Stop active runs before resetting.",
  "system.server_unhealthy": "Server reported unhealthy status.",
  "system.boot_preparing_workspace": "Starting OnMyAgent…",
  "system.boot_activating_workspace": "Activating your workspace",
  "system.boot_ready": "Ready",
  "system.boot_error": "Something went wrong",
  "system.starting_workspace": "Starting your workspace",
  "system.starting_another_workspace": "Starting another workspace",
  "system.start_workspace_failed": "Failed to start the selected workspace.",
  "system.action_returned_error": "Action returned an error.",
  "system.control_mode_off": "Control mode is off.",
  "system.control_open_ai_settings_desc": "Navigate to AI provider settings.",
  "system.control_open_command_palette": "Open the command palette",
  "system.control_open_command_palette_desc": "Open the in-app command palette so the next choice is visible.",
  "system.control_open_extensions_settings": "Open MCP and extension settings",
  "system.control_open_extensions_settings_desc": "Navigate to extension and MCP settings.",
  "system.control_open_folders_settings_desc": "Navigate to authorized folders and file access settings.",
  "system.control_open_general_settings": "Open general settings",
  "system.control_open_general_settings_desc": "Navigate to general settings.",
  "system.control_open_sessions": "Open sessions",
  "system.control_open_sessions_desc": "Navigate to the main session view.",
  "system.control_open_skills_settings_desc": "Navigate to skills settings.",
  "system.control_ready": "Ready. A controller can inspect and run visible actions.",
  "system.control_user_cancelled": "User cancelled action.",
  "system.control_open_skills_settings": "Open skills settings",
  "system.control_open_provider_settings": "Open provider settings",
  "system.control_open_folders_settings": "Open authorized folder settings",
} as const;
