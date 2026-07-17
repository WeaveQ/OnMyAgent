import { APP_NAME } from "../brand";

export default {
  "config.collaborator_token_disabled_hint":
    "Stored in advance for remote sharing, but remote access is currently disabled.",
  "config.collaborator_token_label": "Collaborator token",
  "config.collaborator_token_remote_hint":
    "Routine remote access for phones or laptops connecting to this server.",
  "config.connection_failed": "Connection failed.",
  "config.connection_failed_check":
    "Connection failed. Check the host URL and token.",
  "config.connection_status_updated": "Connection status updated.",
  "config.connection_successful": "Connection successful.",
  "config.copied": "Copied",
  "config.copy": "Copy",
  "config.desktop_only_hint":
    "Some config features (local server sharing + messaging bridge) require the desktop app.",
  "config.diagnostics_desc": "Copy sanitized runtime state for debugging.",
  "config.diagnostics_title": "Diagnostics bundle",
  "config.engine_reload_desc":
    "Restart the agent engine for this workspace.",
  "config.engine_reload_title": "Engine reload",
  "config.host_admin_token_hint":
    "Internal host-only token for approvals CLI and admin APIs. Do not use this in the remote app connect flow.",
  "config.host_admin_token_label": "Host admin token",
  "config.host_local_only": "Local only",
  "config.host_offline": "Offline",
  "config.host_remote_enabled": "Remote enabled",
  "config.local_ip_hint":
    "Use your local IP on the same Wi-Fi for the fastest connection.",
  "config.mdns_hint":
    ".local names are easier to remember but may not resolve on all networks.",
  "config.messaging_identities_desc":
    "Manage Telegram/Slack identities and routing in the Identities tab.",
  "config.messaging_identities_title": "Messaging identities",
  "config.not_set": "Not set",
  "config.owner_token_disabled_hint":
    "Only relevant after you enable remote access for this worker.",
  "config.owner_token_label": "Owner token",
  "config.owner_token_remote_hint":
    "Use this when a remote client needs to answer permission prompts or take owner-only actions.",
  "config.reload_active_tasks_warning": "Reloading will stop active tasks.",
  "config.reload_availability_hint": `Reloading is only available for local workers or connected ${APP_NAME} servers.`,
  "config.reload_connect_hint": "Connect to this worker to reload.",
  "config.reload_engine": "Reload engine",
  "config.reload_now_desc":
    "Applies config updates and reconnects your session.",
  "config.reload_now_title": "Reload now",
  "config.reloading": "Reloading...",
  "config.remote_access_off_hint":
    "Remote access is off. Use Share workspace to enable it before connecting from another machine.",
  "config.resolved_worker_url": "Resolved worker URL:",
  "config.server_needed_hint": `${APP_NAME} server connection needed to sync skills, plugins, and commands.`,
  "config.server_section_desc": `Connect to an ${APP_NAME} server. Use the URL plus a collaborator or owner token from your server admin.`,
  "config.server_section_title": `${APP_NAME} server`,
  "config.server_sharing_desc":
    "Share these details with a trusted device. Keep the server on the same network for the fastest setup.",
  "config.server_sharing_menu_hint":
    "For per-workspace sharing links, use Share... in the workspace menu.",
  "config.server_sharing_title": `${APP_NAME} server sharing`,
  "config.server_url_hint": `Use the URL shared by your ${APP_NAME} server. Local desktop workers reuse a persistent high port in the 48000-51000 range.`,
  "config.server_url_input_label": `${APP_NAME} server URL`,
  "config.server_url_label": `${APP_NAME} Server URL`,
  "config.starting_server": "Starting server…",
  "config.status_connected": "Connected",
  "config.status_limited": "Limited",
  "config.status_not_connected": "Not connected",
  "config.test_connection": "Test connection",
  "config.testing": "Testing...",
  "config.testing_connection": "Testing connection...",
  "config.token_hint":
    "Optional. Paste a collaborator token for routine access or an owner token when this client must answer permission prompts.",
  "config.token_label": "Collaborator or owner token",
  "config.token_placeholder": "Paste your token",
  "config.unavailable": "Unavailable",
  "config.worker_id": "Worker ID:",
  "config.workspace_config_desc":
    "These settings affect the selected workspace. Runtime-only actions apply to whichever workspace is currently connected.",
  "config.workspace_config_title": "Workspace config",
  "config.workspace_id_prefix": "Workspace:",
} as const;
