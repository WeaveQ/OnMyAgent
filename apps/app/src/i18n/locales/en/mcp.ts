import { APP_NAME } from "../brand";

export default {
  "mcp.disable_app": "Disable",
  "mcp.enable_app": "Enable",
  "mcp.reloading_status": "Reloading MCP servers…",
  "mcp.toggle_failed": "Failed to update MCP enabled state.",
  "mcp.toggle_requires_server": `Connect to an ${APP_NAME} server to enable or disable MCPs.`,
  "mcp.add_modal_subtitle":
    "Connect a custom MCP server by URL or local command.",
  "mcp.add_modal_title": "Add Custom App",
  "mcp.add_server_button": "Add App",
  "mcp.advanced": "Advanced",
  "mcp.advanced_settings": "Advanced settings",
  "mcp.advanced_settings_hint":
    "Edit config files and manage connections manually.",
  "mcp.app_connected": "app connected",
  "mcp.apps_connected": "apps connected",
  "mcp.apps_subtitle": `Connect your favorite tools so ${APP_NAME} can use them on your behalf.`,
  "mcp.apps_title": "Apps",
  "mcp.auth.already_connected": "Already Connected",
  "mcp.auth.already_connected_description":
    "{server} is already authenticated and ready to use.",
  "mcp.auth.applying_changes_body":
    "We are restarting the worker so the new MCP is ready to authenticate.",
  "mcp.auth.applying_changes_title": "Applying changes before sign-in",
  "mcp.auth.authorization_link": "Authorization link",
  "mcp.auth.authorization_still_required":
    "Authorization is still required. Try again to restart the flow.",
  "mcp.auth.callback_invalid":
    "Paste the callback URL or the code parameter to finish OAuth.",
  "mcp.auth.callback_label": "Callback URL or code",
  "mcp.auth.callback_placeholder":
    "http://127.0.0.1:19876/mcp/oauth/callback?code=...",
  "mcp.auth.cancel": "Cancel",
  "mcp.auth.client_registration_required":
    "Client registration is required before OAuth can continue.",
  "mcp.auth.complete_connection": "Complete connection",
  "mcp.auth.configured_previously":
    "The MCP may have been configured globally or in a previous session. You can close this modal and start using the MCP tools right away.",
  "mcp.auth.connect_server": "Connect {server}",
  "mcp.auth.copied": "Copied",
  "mcp.auth.copy_link": "Copy link",
  "mcp.auth.done": "Done",
  "mcp.auth.failed_to_start_oauth": "Failed to start OAuth flow",
  "mcp.auth.follow_browser_steps":
    "Follow the authorization steps in the browser.",
  "mcp.auth.force_stop": "Force stop",
  "mcp.auth.force_stopping": "Stopping...",
  "mcp.auth.im_done": "I'm done",
  "mcp.auth.invalid_refresh_token":
    "The OAuth refresh token is invalid or expired. Reauthorize to continue.",
  "mcp.auth.manual_finish_hint":
    "Paste the callback URL (localhost:19876) or just the code to finish connecting.",
  "mcp.auth.manual_finish_title": "Remote server?",
  "mcp.auth.oauth_completed_reload":
    "OAuth completed. Reload the engine to activate the MCP.",
  "mcp.auth.oauth_failed": "OAuth authentication failed.",
  "mcp.auth.oauth_not_supported_hint":
    "This could mean:\n• The MCP server doesn't advertise OAuth capabilities\n• The engine needs to reload to discover server capabilities\n• Try: opencode mcp auth {server} from the CLI",
  "mcp.auth.open_browser_signin": "We'll open your browser to finish sign-in.",
  "mcp.auth.port_forward_hint":
    "Tip: forward the callback port if needed: ssh -L 19876:127.0.0.1:19876 user@host",
  "mcp.auth.reauth_action": "Reauthorize OAuth",
  "mcp.auth.reauth_cli_hint": "Run: opencode mcp auth {server}",
  "mcp.auth.reauth_failed": "Reauthorization failed.",
  "mcp.auth.reauth_remote_hint":
    "Reauthorize from the machine running this worker.",
  "mcp.auth.reauth_running": "Reauthorizing...",
  "mcp.auth.reload_blocked":
    "Reload is paused while a session is running. Stop the run to finish setup.",
  "mcp.auth.reload_engine_retry": "Apply changes and retry",
  "mcp.auth.reload_failed": "Failed to reload the worker before sign-in.",
  "mcp.auth.reload_notice": `For this to take effect, ${APP_NAME} needs to refresh the worker service. This can interrupt a running session.`,
  "mcp.auth.reload_remote_confirm": `For this to take effect, ${APP_NAME} needs to refresh the worker service. This might stop your running session. Continue?`,
  "mcp.auth.reopen_browser_link": "Click here to re-open the browser",
  "mcp.auth.request_timed_out": "Request timed out.",
  "mcp.auth.retry": "Retry",
  "mcp.auth.retry_now": "Retry Now",
  "mcp.auth.server_disabled":
    "This MCP server is disabled. Enable it and try again.",
  "mcp.auth.step1_description":
    "We'll launch {server}'s sign-in flow automatically.",
  "mcp.auth.step1_title": "Opening your browser",
  "mcp.auth.step2_description": "Sign in and approve access when prompted.",
  "mcp.auth.step2_title": `Authorize ${APP_NAME}`,
  "mcp.auth.step3_description":
    "We'll finish connecting as soon as authorization completes.",
  "mcp.auth.step3_title": "Return here when you're done",
  "mcp.auth.try_reload_engine": "{message}. Try reloading the engine first.",
  "mcp.auth.waiting_authorization":
    "Waiting for authorization to complete in your browser...",
  "mcp.auth.waiting_for_conversation_body":
    "We will redirect you to authenticate as soon as possible.",
  "mcp.auth.waiting_for_conversation_title":
    "Waiting for conversation to complete",
  "mcp.auth.waiting_for_session": "Waiting for {session} to finish working",
  "mcp.available_apps": "Available apps",
  "mcp.cap_signin": "Account sign-in",
  "mcp.cap_tools": "AI tools",
  "mcp.config_file": "Config file",
  "mcp.config_load_failed": "Couldn't load the config file",
  "mcp.config_not_loaded": "Not loaded yet",
  "mcp.connect": "Connect",
  "mcp.connect_failed": "Couldn't connect. Try again.",
  "mcp.connect_server_first": "Connect to the server first.",
  "mcp.connected": "Connected",
  "mcp.connected_badge": "Connected",
  "mcp.connection_failed": "Connection issue — try again",
  "mcp.connection_type": "Connection",
  "mcp.custom_app_cta_hint":
    "Connect your own MCP server, internal tool, or hosted app.",
  "mcp.desktop_required": "Apps require the desktop app.",
  "mcp.docs_link": "Learn more",
  "mcp.file_not_found": "Config file not created yet",
  "mcp.friendly_status_issue": "Issue",
  "mcp.friendly_status_needs_signin": "Sign in needed",
  "mcp.friendly_status_offline": "Offline",
  "mcp.friendly_status_paused": "Paused",
  "mcp.friendly_status_ready": "Ready",
  "mcp.last_synced": "Synced",
  "mcp.login_action": "Sign in",
  "mcp.login_hint": "Connect your account to finish setting up this app.",
  "mcp.login_unavailable": `This app does not support sign-in from ${APP_NAME}.`,
  "mcp.logout_action": "Log out",
  "mcp.logout_failed": "Failed to log out.",
  "mcp.logout_hint":
    "Removes stored OAuth credentials. You'll need to sign in again.",
  "mcp.logout_label": "OAuth",
  "mcp.logout_modal_message":
    "This will remove stored OAuth credentials for {server}. You'll need to sign in again to use this app.",
  "mcp.logout_modal_title": "Log out of this app?",
  "mcp.logout_success": "Logged out of {server}.",
  "mcp.logout_working": "Logging out...",
  "mcp.name_required": "Enter a server name.",
  "mcp.no_apps_hint": "Connect one above to get started.",
  "mcp.no_apps_yet": "No apps connected yet",
  "mcp.oauth": "Sign in",
  "mcp.oauth_optional_hint":
    "Uses OAuth in the browser to connect your account.",
  "mcp.oauth_optional_label": "This app requires sign-in",
  "mcp.one_click_connect": "One-click connect",
  "mcp.open_file": "Open file",
  "mcp.opening_label": "Opening...",
  "mcp.pick_workspace_error": "Choose a workspace folder first.",
  "mcp.pick_workspace_first": "Choose a workspace folder first.",
  "mcp.quick_connect_context7_desc": "Search product docs with richer context.",
  "mcp.quick_connect_context7_title": "Context7",
  "mcp.quick_connect_linear_desc": "Plan sprints and ship tickets faster.",
  "mcp.quick_connect_linear_title": "Linear",
  "mcp.quick_connect_notion_desc":
    "Pages, databases, and project docs in sync.",
  "mcp.quick_connect_notion_title": "Notion",
  "mcp.quick_connect_onmyagent_cloud_desc":
    'Manage your org, workers, skills, providers, and team config from chat. Try: "List all workers in my org" or "Push this skill to the team."',
  "mcp.quick_connect_onmyagent_cloud_title": `${APP_NAME} Cloud Control`,
  "mcp.quick_connect_onmyagent_ui_desc": `Let agents see and drive the ${APP_NAME} app. Navigate sessions, type into the composer, open settings. Try: "Take a snapshot of what I see" or "Create a new session and type hello."`,
  "mcp.quick_connect_onmyagent_ui_title": `${APP_NAME} UI Control`,
  "mcp.quick_connect_sentry_desc":
    "Track releases and resolve production errors.",
  "mcp.quick_connect_sentry_title": "Sentry",
  "mcp.quick_connect_stripe_desc":
    "Inspect payments, invoices, and subscriptions.",
  "mcp.quick_connect_stripe_title": "Stripe",
  "mcp.reload_banner_blocked_hint": "Stop the running task to activate.",
  "mcp.remote_workspace_url_hint":
    "Remote workers connect fastest with URL-based MCP servers.",
  "mcp.remove_app": "Remove",
  "mcp.remove_failed": "Couldn't remove the app.",
  "mcp.remove_modal_message":
    "Are you sure you want to remove {server}? You can always add it back later.",
  "mcp.remove_modal_title": "Remove app",
  "mcp.reveal_config_failed": "Couldn't open the config file",
  "mcp.reveal_in_finder": "Show in Finder",
  "mcp.scope_global": "All workspaces",
  "mcp.scope_project": "This workspace",
  "mcp.server_command": "Command",
  "mcp.server_command_hint": "The shell command to start the server.",
  "mcp.server_command_placeholder":
    "npx -y @modelcontextprotocol/server-sequential-thinking",
  "mcp.server_name": "App name",
  "mcp.server_name_placeholder": "github-copilot",
  "mcp.server_type": "Type",
  "mcp.server_url": "Server URL",
  "mcp.server_url_placeholder": "https://api.githubcopilot.com/mcp/",
  "mcp.sign_in_section_label": "Sign-in",
  "mcp.tap_to_connect": "Tap to connect",
  "mcp.technical_details": "Technical details",
  "mcp.type_cloud": "Cloud (sign in with your account)",
  "mcp.type_local": "Local (runs on this device)",
  "mcp.type_local_cmd": "Local (command)",
  "mcp.type_remote": "Remote (URL)",
  "mcp.url_or_command_required":
    "Enter a URL for remote or a command for local servers.",
  "mcp.your_apps": "Your apps",
} as const;
