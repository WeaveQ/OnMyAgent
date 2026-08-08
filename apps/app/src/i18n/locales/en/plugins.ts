import { APP_NAME } from "../brand";

export default {
  "plugins.add": "Add",
  "plugins.missing_client": "Missing client",
  "plugins.missing_workspace": "Missing workspace",
  "plugins.remove": "Remove",
  "plugins.artifact_title": "File tools",
  "plugins.artifact_tab": "Connectors",
  "plugins.artifact_description":
    "Browser and document / spreadsheet / PDF capabilities shipped with the app. Toggle individually.",
  "plugins.custom_connector": "Custom connector",
  "plugins.custom_connector_title": "MCP services",
  "plugins.custom_connector_subtitle": "Install MCP servers to extend AI with more tools",
  "plugins.custom_connector_search": "Search servers…",
  "plugins.custom_connector_hub": "MCP Hub",
  "plugins.custom_connector_configure": "Configure MCP",
  "plugins.custom_connector_empty_title": "No MCP servers yet",
  "plugins.custom_connector_empty_desc": "Use Configure to add an MCP server",
  "plugins.custom_connector_configure_cta": "Configure",
  "plugins.custom_connector_back": "Back to MCP list",
  "plugins.custom_connector_mine": "My MCP",
  "plugins.custom_connector_mine_count": "{count} connectors",
  "plugins.custom_connector_summary_enabled": "{count} enabled",
  "plugins.custom_connector_summary_failed": "{count} failed",
  "plugins.custom_connector_type_tool": "Tools",
  "plugins.custom_connector_type_local": "Local command",
  "plugins.custom_connector_type_remote": "Remote",
  "plugins.custom_connector_reconnect": "Reconnect",
  "plugins.custom_connector_reconnecting": "Reconnecting…",
  "plugins.custom_connector_guide": "Guide",
  "plugins.custom_connector_copy_log": "Copy log",
  "plugins.custom_connector_save": "Save",
  "plugins.custom_connector_cancel": "Cancel",
  "plugins.custom_connector_invalid_json": "Invalid JSON. Please fix and try again.",
  "plugins.custom_connector_save_failed": "Could not save. Please try again.",
  "plugins.custom_connector_saved": "MCP config saved",
  "plugins.custom_connector_load_failed": "Could not load MCP config.",
  "plugins.custom_connector_desktop_only": "Custom connectors require the desktop app.",
  "plugins.custom_connector_reload_title": "Engine reload required",
  "plugins.custom_connector_reload_desc":
    "MCP config was saved and your connector list was updated. Reload the engine so the assistant can use the new connectors (no full app restart).",
  "plugins.custom_connector_reload_now": "Reload now",
  "plugins.artifact_loading": "Loading artifact plugins",
  "plugins.artifact_detail_loading": "Loading plugin details",
  "plugins.artifact_empty": "No artifact plugins are available.",
  "plugins.artifact_load_error": "Artifact plugins could not be loaded. Check the local server and try again.",
  "plugins.artifact_update_error": "The change could not be saved. Your previous setting was restored.",
  "plugins.artifact_open": "View details",
  "plugins.artifact_enabled": "Enabled",
  "plugins.artifact_disabled": "Disabled",
  "plugins.artifact_enable_action": "Enable",
  "plugins.artifact_disable_action": "Disable",
  "plugins.artifact_plugin_toggle": "Toggle plugin",
  "plugins.artifact_card_toggle": "Toggle {name}",
  "plugins.artifact_skill_toggle": "Toggle {name} skill",
  "plugins.artifact_starter_prompts": "Try it this way",
  "plugins.artifact_skills": "Skills",
  "plugins.artifact_excel_unavailable": "Excel Live is unavailable until a live provider is registered.",
  "plugins.artifact_plugin_browser_name": "Browser",
  "plugins.artifact_plugin_browser_desc":
    "Open pages in OnMyAgent’s built-in browser: navigate, click, type, and screenshot—great for local apps.",
  "plugins.artifact_plugin_browser_long":
    "Open and control the built-in browser—navigate, click, type, inspect pages, and take screenshots. Best for local pages and automation that does not need a real Chrome login. System plugin: always installed, on by default, not uninstallable. Complements BrowserSkill (real Chrome/Edge).",
  "plugins.artifact_plugin_browser_system": "System plugin — cannot be uninstalled",
  "plugins.artifact_plugin_browser_prompt_1": "Open localhost and verify the landing page.",
  "plugins.artifact_plugin_browser_prompt_2":
    "Click through this checkout flow in the in-app browser.",
  "plugins.artifact_plugin_browser_prompt_3":
    "Take a screenshot of the current in-app browser tab.",
  "plugins.artifact_plugin_documents_name": "Documents",
  "plugins.artifact_plugin_documents_desc":
    "Create and revise local Word (DOCX): draft reports, restructure, and review in chat.",
  "plugins.artifact_plugin_documents_long":
    "Read, create, edit, and review local Word (DOCX)—draft reports from notes, turn outlines into sections, and suggest focused edits. Ideal for weekly updates, proposals, and specs.",
  "plugins.artifact_plugin_documents_prompt_1": "Draft a polished DOCX report from my notes.",
  "plugins.artifact_plugin_documents_prompt_2":
    "Review this Word document and suggest focused edits.",
  "plugins.artifact_plugin_documents_prompt_3":
    "Turn this outline into a well-structured document.",
  "plugins.artifact_plugin_pdf_name": "PDF",
  "plugins.artifact_plugin_pdf_desc":
    "Read, summarize, and produce PDFs—extract insights, make handouts, check layout.",
  "plugins.artifact_plugin_pdf_long":
    "Read, create, extract, and verify PDFs—summarize findings, produce handouts, and check layout. Turn notes or web material into shareable PDF drafts.",
  "plugins.artifact_plugin_pdf_prompt_1": "Summarize the key findings in this PDF.",
  "plugins.artifact_plugin_pdf_prompt_2": "Create a clean PDF handout from this content.",
  "plugins.artifact_plugin_pdf_prompt_3": "Inspect these PDF pages for layout problems.",
  "plugins.artifact_plugin_spreadsheets_name": "Spreadsheets",
  "plugins.artifact_plugin_spreadsheets_desc":
    "Build and analyze spreadsheets: clean data, formulas, summaries, and trends.",
  "plugins.artifact_plugin_spreadsheets_long":
    "Create, read, analyze, and edit workbooks—clean data, write or verify formulas, and surface summaries and trends. Useful for reports, reconciliation, and turning raw tables into structured sheets.",
  "plugins.artifact_plugin_spreadsheets_prompt_1": "Build a clear spreadsheet from this raw data.",
  "plugins.artifact_plugin_spreadsheets_prompt_2":
    "Analyze this workbook and highlight useful trends.",
  "plugins.artifact_plugin_spreadsheets_prompt_3":
    "Update the formulas and verify the calculated results.",
  "plugins.sample_section_title": "Recommended",
  "plugins.sample_section_hint":
    "Curated third-party connectors. Install them to extend capabilities.",
  "plugins.recommend_badge": "Preview",
  "plugins.connector_connect_title": "Connect {name}",
  "plugins.connector_setup_title": "Set up {name}",
  "plugins.connector_try_it": "Try it",
  "plugins.connector_unbind": "Unbind",
  "plugins.connector_connect_preview_note":
    "One-click install is coming soon. Try the examples below in chat first.",
  "plugins.connector_ipc_restart_hint":
    "The desktop main process is missing the latest connector IPC. Fully quit OnMyAgent and restart (a page reload is not enough).",
  "plugins.connector_ipc_restart_short": "Restart desktop app",
  "plugins.connector_error_short": "Connection issue",
  "plugins.sample_tencent_meeting_name": "Tencent Meeting",
  "plugins.sample_tencent_meeting_desc":
    "Create, query, and manage Tencent Meetings from chat. Start meetings quickly, check your schedule, and manage attendees.",
  "plugins.sample_tencent_meeting_prompt_1":
    "Create a 1-hour meeting tomorrow at 3pm titled Weekly Review",
  "plugins.sample_tencent_meeting_prompt_2": "List all of my meetings for today",
  "plugins.sample_tencent_meeting_prompt_3": "Cancel tomorrow's Weekly Review meeting",
  "plugins.sample_wecom_name": "WeCom",
  "plugins.sample_wecom_desc":
    "Connect WeCom for messages, contacts, and calendar collaboration.",
  "plugins.sample_wecom_prompt_1": "Send this afternoon's meeting notes to the project group",
  "plugins.sample_wecom_prompt_2": "Look up Zhang San's department and email",
  "plugins.sample_wecom_prompt_3":
    "Remind the sales group to submit this week's opportunity sheet by Friday",
  "plugins.filter_all": "All",
  "plugins.filter_builtin": "Built-in",
  "plugins.filter_recommended": "Recommended",
  "plugins.builtin_section_title": "Built-in",
  "plugins.builtin_section_hint": "Built-in capabilities, ready to use.",
  "plugins.officecli_section_title": "Optional enhancements",
  "plugins.officecli_section_hint":
    "Install OfficeCLI when you need it. The files stay in the user directory, so the desktop installer stays small; new regular and expert sessions can use it immediately after installation.",
  "plugins.officecli_title": "OfficeCLI",
  "plugins.officecli_description":
    "Create, analyze, and edit Word, Excel, and PowerPoint files in chat.",
  "plugins.officecli_prompt_1":
    "Turn these meeting notes into a Word weekly report with clear headings.",
  "plugins.officecli_prompt_2":
    "Open this Excel file, summarize monthly sales, and flag outlier rows.",
  "plugins.officecli_prompt_3":
    "Build an 8-slide PPT from this outline with titles, bullets, and speaker notes.",
  "plugins.officecli_checking": "Checking OfficeCLI status",
  "plugins.officecli_not_installed_hint": "Not installed yet. Install it to enable the tool.",
  "plugins.officecli_installed_hint": "Version {version} is installed and ready for new sessions.",
  "plugins.officecli_update_hint": "Version {installed} is installed; update to {latest}.",
  "plugins.officecli_install": "Install",
  "plugins.officecli_update": "Update",
  "plugins.officecli_retry": "Retry",
  "plugins.officecli_uninstall": "Uninstall",
  "plugins.officecli_uninstall_title": "Uninstall OfficeCLI?",
  "plugins.officecli_uninstall_message":
    "This removes the local OfficeCLI runtime and its session skill. You can install it again later.",
  "plugins.officecli_desktop_only": "Available on desktop",
  "plugins.officecli_unsupported_hint": "Not supported on this system",
  "plugins.officecli_status_checking": "Checking",
  "plugins.officecli_status_error": "Retry needed",
  "plugins.officecli_status_installing": "Installing",
  "plugins.officecli_status_installed": "Installed",
  "plugins.officecli_status_not_installed": "Not installed",
  "plugins.officecli_status_uninstalling": "Uninstalling",
  "plugins.officecli_status_unsupported": "Unsupported",
  "plugins.officecli_status_update_available": "Update available",
  "plugins.officecli_status_updating": "Updating",
  "plugins.officecli_progress_checking": "Checking version",
  "plugins.officecli_progress_downloading_manifest": "Getting release information",
  "plugins.officecli_progress_downloading_binary": "Downloading runtime",
  "plugins.officecli_progress_downloading_skill": "Downloading instructions",
  "plugins.officecli_progress_downloading_skills_pack": "Downloading advanced skills",
  "plugins.officecli_progress_verifying": "Verifying files",
  "plugins.officecli_progress_installing": "Installing locally",
  "plugins.officecli_progress_refreshing_skills": "Refreshing session capabilities",
  "plugins.officecli_progress_uninstalling": "Removing local files",
  "plugins.officecli_error_hint": "OfficeCLI could not be installed or updated. Check the network and try again.",
  "plugins.larkcli_title": "Feishu",
  "plugins.larkcli_description":
    "Connect Feishu/Lark for chat, calendar, docs, sheets, tasks, and approvals.",
  "plugins.larkcli_prompt_1":
    "In the Feishu group Product Weekly, send a bot notice: meeting today 15:00 in Room 3F with last week's materials",
  "plugins.larkcli_prompt_2":
    "Find a 2-hour free slot next week for me, Alice, and Bob, create a Q2 planning meeting, invite them, and book a room",
  "plugins.larkcli_prompt_3":
    "Add a row to Feishu Base Task Tracker: title=Q2 launch review, owner=Alice, due=2026-05-20, status=in progress",
  "plugins.larkcli_checking": "Checking Feishu CLI status",
  "plugins.larkcli_not_installed_hint": "Not installed yet. Install it to enable the tool.",
  "plugins.larkcli_installed_hint": "Version {version} is installed and ready for new sessions.",
  "plugins.larkcli_update_hint": "Version {installed} is installed; update to {latest}.",
  "plugins.larkcli_install": "Install",
  "plugins.larkcli_update": "Update",
  "plugins.larkcli_retry": "Retry",
  "plugins.larkcli_uninstall": "Uninstall",
  "plugins.larkcli_uninstall_title": "Uninstall Feishu CLI?",
  "plugins.larkcli_uninstall_message":
    "This removes the local lark-cli runtime and its session skills. You can install it again later.",
  "plugins.larkcli_desktop_only": "Available on desktop",
  "plugins.larkcli_unsupported_hint": "Not supported on this system",
  "plugins.larkcli_status_checking": "Checking",
  "plugins.larkcli_status_error": "Retry needed",
  "plugins.larkcli_status_installing": "Installing",
  "plugins.larkcli_status_installed": "Installed",
  "plugins.larkcli_status_not_installed": "Not installed",
  "plugins.larkcli_status_uninstalling": "Uninstalling",
  "plugins.larkcli_status_unsupported": "Unsupported",
  "plugins.larkcli_status_update_available": "Update available",
  "plugins.larkcli_status_updating": "Updating",
  "plugins.larkcli_progress_checking": "Checking version",
  "plugins.larkcli_progress_downloading_manifest": "Getting release information",
  "plugins.larkcli_progress_downloading_binary": "Downloading runtime",
  "plugins.larkcli_progress_downloading_skill": "Downloading instructions",
  "plugins.larkcli_progress_downloading_skills_pack": "Downloading skill packages",
  "plugins.larkcli_progress_verifying": "Verifying files",
  "plugins.larkcli_progress_installing": "Installing locally",
  "plugins.larkcli_progress_refreshing_skills": "Refreshing session capabilities",
  "plugins.larkcli_progress_uninstalling": "Removing local files",
  "plugins.larkcli_error_hint": "Feishu CLI could not be installed or updated. Check the network and try again.",
  "plugins.larkcli_badge_disconnected": "Not connected",
  "plugins.larkcli_badge_connected": "Connected",
  "plugins.larkcli_badge_logged_in": "Signed in",
  "plugins.larkcli_connect": "Connect",
  "plugins.larkcli_go_login": "Sign in",
  "plugins.larkcli_disconnect": "Disconnect",
  "plugins.larkcli_disconnect_title": "Disconnect Feishu CLI?",
  "plugins.larkcli_disconnect_message":
    "This signs out the user session and clears local app credentials. It does not delete the app on the Feishu Open Platform.",
  "plugins.larkcli_connect_title": "Connect Feishu",
  "plugins.larkcli_connect_subtitle": "Complete app authorization first, then continue with sign-in authorization.",
  "plugins.larkcli_step_config": "App authorization",
  "plugins.larkcli_step_login": "Sign-in authorization",
  "plugins.larkcli_tab_qr": "Scan to authorize",
  "plugins.larkcli_tab_manual": "Manual authorization",
  "plugins.larkcli_qr_howto_title": "How to authorize",
  "plugins.larkcli_qr_step1": "Option 1: Scan with the Feishu app to create the app and authorize automatically.",
  "plugins.larkcli_qr_step2_prefix": "Option 2: Click ",
  "plugins.larkcli_qr_step2_link": "create and authorize the app in the browser",
  "plugins.larkcli_qr_step2_suffix": ".",
  "plugins.larkcli_qr_step3": "After app authorization, you will continue to user sign-in automatically.",
  "plugins.larkcli_qr_waiting": "Waiting for scan to authorize the app…",
  "plugins.larkcli_qr_not_ready": "App credentials not detected yet. Finish the scan, then continue.",
  "plugins.larkcli_open_in_browser": "Open in browser",
  "plugins.larkcli_open_browser_app_auth": "Open in browser for app authorization",
  "plugins.larkcli_manual_steps_title": "Steps",
  "plugins.larkcli_manual_credentials_title": "App credentials",
  "plugins.larkcli_manual_step1_prefix": "Open",
  "plugins.larkcli_open_platform": "Feishu Open Platform",
  "plugins.larkcli_manual_step1_suffix": " → create a custom app",
  "plugins.larkcli_manual_step2": "Copy App ID and App Secret from credentials",
  "plugins.larkcli_manual_step3": "Permissions → batch enable → paste CLI scope list",
  "plugins.larkcli_copy_scopes": "Copy CLI scopes",
  "plugins.larkcli_scopes_copied": "Copied",
  "plugins.larkcli_manual_step4": "Create a version and publish (check availability)",
  "plugins.larkcli_manual_step5": "Enter App ID and App Secret below",
  "plugins.larkcli_continue": "Continue",
  "plugins.larkcli_skip_for_now": "Skip for now",
  "plugins.larkcli_login_howto_title": "How to authorize",
  "plugins.larkcli_login_step1":
    "Option 1: Scan with Feishu to sign in and access or operate your related data.",
  "plugins.larkcli_login_step2_prefix": "Option 2: ",
  "plugins.larkcli_login_step2_link": "open the browser for sign-in authorization",
  "plugins.larkcli_login_step2_suffix": ".",
  "plugins.larkcli_login_waiting": "Waiting for scan to complete sign-in…",
  "plugins.tencent_docs_title": "Tencent Docs",
  "plugins.tencent_docs_description":
    "Manage Tencent Docs sheets, documents, and slides with natural language.",
  "plugins.tencent_docs_prompt_1":
    "Create an online sheet in Tencent Docs with columns Name, Department, Hire date, and fill sample rows",
  "plugins.tencent_docs_prompt_2":
    "Open my most recently edited Tencent Doc and summarize the main points",
  "plugins.tencent_docs_prompt_3":
    "In a Tencent Docs sheet, find all rows where Sales > 100,000 and sort by amount descending",
  "plugins.tencent_docs_prompt_4":
    "Turn these meeting notes into a Tencent Doc, sectioned by agenda with owners and due dates",
  "plugins.tencent_docs_connected_note":
    "Connected. Use Try it or an example below in chat (new session or engine reload may be required).",
  "plugins.tencent_docs_checking": "Checking Tencent Docs status",
  "plugins.tencent_docs_desktop_only": "Available on desktop",
  "plugins.tencent_docs_badge_disconnected": "Not connected",
  "plugins.tencent_docs_badge_authorizing": "Authorizing",
  "plugins.tencent_docs_badge_connected": "Connected",
  "plugins.tencent_docs_badge_error": "Retry needed",
  "plugins.tencent_docs_connect": "Connect",
  "plugins.tencent_docs_retry": "Retry",
  "plugins.tencent_docs_disconnect": "Disconnect",
  "plugins.tencent_docs_disconnect_title": "Disconnect Tencent Docs?",
  "plugins.tencent_docs_disconnect_message":
    "This removes local authorization, OpenCode MCP entries, and the managed Tencent Docs skill. You can authorize again later.",
  "plugins.tencent_docs_intro_title": "Connect Tencent Docs as an AI knowledge base",
  "plugins.tencent_docs_intro_body":
    "After authorization, OnMyAgent can read your docs when you start a task—summaries, Q&A, and automated document creation and management.",
  "plugins.tencent_docs_scope_heading": "Permissions requested",
  "plugins.tencent_docs_scope_read_title": "Read documents and content",
  "plugins.tencent_docs_scope_read_desc":
    "Read your files, folders, and document content of all types",
  "plugins.tencent_docs_scope_edit_title": "Edit and manage files",
  "plugins.tencent_docs_scope_edit_desc":
    "View, edit, create, and manage documents on your behalf",
  "plugins.tencent_docs_go_authorize": "Continue to authorize",
  "plugins.tencent_docs_privacy_note":
    "OnMyAgent only uses data while running your AI tasks and protects your privacy",
  "plugins.tencent_docs_connect_title": "Finish Tencent Docs authorization",
  "plugins.tencent_docs_connect_subtitle":
    "The Tencent Docs login/authorization page opened in your system browser. Follow the prompts (WeChat login, QQ login, or an Authorize button).",
  "plugins.tencent_docs_waiting": "Waiting for browser authorization…",
  "plugins.tencent_docs_waiting_hint":
    "This dialog closes automatically when authorization succeeds. If the browser did not open, use the button below.",
  "plugins.tencent_docs_open_browser": "Reopen authorization page",
  "plugins.tencent_docs_cancel": "Cancel",
  "plugins.tencent_docs_error_hint":
    "Tencent Docs authorization failed. Check the network and try again.",
  "plugins.tencent_docs_hint_disconnected":
    "Not connected yet. Connect and authorize to enable tools in new sessions.",
  "plugins.tencent_docs_hint_connected":
    "Connected. New regular sessions can use Tencent Docs tools and the skill.",
  "plugins.baidu_drive_title": "Baidu Netdisk",
  "plugins.baidu_drive_description":
    "Connect Baidu Netdisk to search, organize, and download cloud files.",
  "plugins.baidu_drive_prompt_1":
    "Search my Baidu Netdisk for recently uploaded PDFs and list the top 10 by modified time",
  "plugins.baidu_drive_prompt_2":
    "List folders in the Baidu Netdisk root and roughly how many files each contains",
  "plugins.baidu_drive_prompt_3":
    "Find documents whose names contain “contract” in Baidu Netdisk and summarize names and paths",
  "plugins.baidu_drive_prompt_4":
    "Upload report.pdf from my Desktop to the “Work” folder on Baidu Netdisk",
  "plugins.baidu_drive_connected_note":
    "Connected. Use Try it or an example below in chat (new session or engine reload may be required).",
  "plugins.baidu_drive_desktop_only": "Available on desktop",
  "plugins.baidu_drive_connect": "Connect",
  "plugins.baidu_drive_retry": "Retry",
  "plugins.baidu_drive_disconnect": "Disconnect",
  "plugins.baidu_drive_disconnect_title": "Disconnect Baidu Netdisk?",
  "plugins.baidu_drive_disconnect_message":
    "This removes local authorization and the OpenCode MCP entry. You can connect again later.",
  "plugins.baidu_drive_connect_title": "Finish Baidu Netdisk authorization",
  "plugins.baidu_drive_connect_subtitle":
    "The Baidu account authorization page opened in your system browser. Sign in and confirm, then return to OnMyAgent.",
  "plugins.baidu_drive_waiting": "Waiting for browser authorization…",
  "plugins.baidu_drive_waiting_hint":
    "This dialog closes automatically when authorization succeeds. If the browser did not open, use the button below.",
  "plugins.baidu_drive_open_browser": "Reopen authorization page",
  "plugins.baidu_drive_cancel": "Cancel",
  "plugins.baidu_drive_error_hint":
    "Baidu Netdisk connection failed. Check the network or access token and try again.",
  "plugins.baidu_drive_token_hint":
    "Product OAuth is not configured; connect by pasting a Baidu Netdisk access_token.",
  "plugins.baidu_drive_token_title": "Paste Baidu Netdisk access token",
  "plugins.baidu_drive_token_subtitle":
    "Paste an access_token from the Baidu Open Platform to register the official Netdisk MCP.",
  "plugins.baidu_drive_token_label": "Access Token",
  "plugins.baidu_drive_token_placeholder": "Paste access_token…",
  "plugins.baidu_drive_token_help":
    "The token is stored only on this device for the official MCP: https://mcp-pan.baidu.com/sse",
  "plugins.baidu_drive_token_submit": "Connect",
  "plugins.kdocs_title": "Kingsoft Docs",
  "plugins.kdocs_description":
    "Connect Kingsoft Docs (WPS) for online sheets and documents.",
  "plugins.kdocs_prompt_1":
    "Create a weekly report smart doc in Kingsoft Docs with done items and risks",
  "plugins.kdocs_prompt_2":
    "Search my recently edited Kingsoft Docs and list titles with links",
  "plugins.kdocs_prompt_3":
    "Summarize this month’s expense entries in a Kingsoft Docs sheet by category",
  "plugins.kdocs_prompt_4":
    "Write this Markdown into a Kingsoft Doc and return a share link",
  "plugins.kdocs_connected_note":
    "Connected. Use Try it or an example below in chat (new session or engine reload may be required).",
  "plugins.kdocs_desktop_only": "Available on desktop",
  "plugins.kdocs_connect": "Connect",
  "plugins.kdocs_retry": "Retry",
  "plugins.kdocs_disconnect": "Disconnect",
  "plugins.kdocs_disconnect_title": "Disconnect Kingsoft Docs?",
  "plugins.kdocs_disconnect_message":
    "This removes the local token and OpenCode MCP entry. You can connect again later.",
  "plugins.kdocs_cancel": "Cancel",
  "plugins.kdocs_error_hint":
    "Kingsoft Docs connection failed. Check the access token and try again.",
  "plugins.kdocs_token_hint":
    "Connect by pasting an access token from Kingsoft Docs / WPS Open Platform.",
  "plugins.kdocs_token_title": "Paste Kingsoft Docs access token",
  "plugins.kdocs_token_subtitle":
    "Paste the token below to register the official Skill Hub MCP.",
  "plugins.kdocs_token_label": "Access Token",
  "plugins.kdocs_token_placeholder": "Paste access token…",
  "plugins.kdocs_token_help":
    "The token is stored only on this device. MCP: https://mcp-center.wps.cn/skill_hub/mcp",
  "plugins.kdocs_token_submit": "Connect",
  "plugins.dingtalk_title": "DingTalk",
  "plugins.dingtalk_description":
    "Connect DingTalk for contacts, calendar, todos, and robot messages.",
  "plugins.dingtalk_prompt_1":
    "Look up a coworker named Zhang San in DingTalk contacts",
  "plugins.dingtalk_prompt_2": "List my DingTalk calendar events for tomorrow",
  "plugins.dingtalk_prompt_3":
    "Create a DingTalk todo: submit the weekly report by Friday",
  "plugins.dingtalk_prompt_4":
    "Send a short notice to the test group via DingTalk robot",
  "plugins.dingtalk_connected_note":
    "Connected. Use Try it or an example below in chat (new session or engine reload may be required).",
  "plugins.dingtalk_desktop_only": "Available on desktop",
  "plugins.dingtalk_connect": "Connect",
  "plugins.dingtalk_retry": "Retry",
  "plugins.dingtalk_disconnect": "Disconnect",
  "plugins.dingtalk_disconnect_title": "Disconnect DingTalk?",
  "plugins.dingtalk_disconnect_message":
    "This removes local credentials and the OpenCode MCP entry. You can connect again later.",
  "plugins.dingtalk_cancel": "Cancel",
  "plugins.dingtalk_error_hint":
    "DingTalk connection failed. Check Client ID / Secret and app permissions.",
  "plugins.dingtalk_cred_hint":
    "Create an app on the DingTalk Open Platform and enter Client ID and Client Secret.",
  "plugins.dingtalk_cred_title": "Configure DingTalk app credentials",
  "plugins.dingtalk_cred_subtitle":
    "Credentials are under App credentials on the Open Platform. We register a local MCP via npx dingtalk-mcp.",
  "plugins.dingtalk_client_id_label": "Client ID",
  "plugins.dingtalk_client_id_placeholder": "App Client ID",
  "plugins.dingtalk_client_secret_label": "Client Secret",
  "plugins.dingtalk_client_secret_placeholder": "App Client Secret",
  "plugins.dingtalk_cred_help":
    "Default profiles: contacts, calendar, todos, robot messaging. Grant matching API permissions on the app.",
  "plugins.dingtalk_cred_submit": "Connect",
  "plugins.wecom_title": "WeCom",
  "plugins.wecom_description":
    "Connect WeCom for messages, contacts, and calendar.",
  "plugins.wecom_prompt_1": "Look up a coworker named Zhang San in WeCom contacts",
  "plugins.wecom_prompt_2": "List my WeCom calendar events for tomorrow",
  "plugins.wecom_prompt_3":
    "Create a WeCom todo: submit the weekly report by Friday",
  "plugins.wecom_prompt_4": "Send this afternoon’s meeting notes to the project group",
  "plugins.wecom_connected_note":
    "Connected. Use Try it or an example below in chat (new session or engine reload may be required).",
  "plugins.wecom_desktop_only": "Available on desktop",
  "plugins.wecom_connect": "Scan to connect",
  "plugins.wecom_retry": "Retry",
  "plugins.wecom_disconnect": "Disconnect",
  "plugins.wecom_disconnect_title": "Disconnect WeCom?",
  "plugins.wecom_disconnect_message":
    "This removes local wecom-cli credentials and the managed skill. You can connect again later.",
  "plugins.wecom_cancel": "Cancel",
  "plugins.wecom_error_hint":
    "WeCom connection failed. Check the network, rescan, or try Bot ID / Secret.",
  "plugins.wecom_connect_hint":
    "Prefer WeCom QR authorization; or use smart-bot Bot ID and Secret.",
  "plugins.wecom_connect_title": "Finish WeCom authorization",
  "plugins.wecom_connect_subtitle":
    "The WeCom QR page opened. Scan with WeCom to confirm, then return to OnMyAgent.",
  "plugins.wecom_waiting": "Waiting for WeCom QR authorization…",
  "plugins.wecom_waiting_hint":
    "This dialog closes automatically when authorization succeeds. Reopen the page if needed.",
  "plugins.wecom_open_browser": "Reopen authorization page",
  "plugins.wecom_use_credentials": "Use Bot ID / Secret instead",
  "plugins.wecom_cred_title": "Enter WeCom bot credentials",
  "plugins.wecom_cred_subtitle":
    "Get Bot ID and Secret from the WeCom Open Platform / smart bot details.",
  "plugins.wecom_bot_id_label": "Bot ID",
  "plugins.wecom_bot_id_placeholder": "Paste Bot ID",
  "plugins.wecom_secret_label": "Secret",
  "plugins.wecom_secret_placeholder": "Paste Secret",
  "plugins.wecom_cred_help":
    "Credentials are stored for official wecom-cli under a managed config dir. QR is usually more reliable.",
  "plugins.wecom_cred_submit": "Connect",
  "plugins.tencent_meeting_title": "Tencent Meeting",
  "plugins.tencent_meeting_description":
    "Create and manage Tencent Meeting: schedule, calendars, and smart minutes.",
  "plugins.tencent_meeting_prompt_1":
    "Create a 1-hour meeting tomorrow at 3 PM titled Weekly review",
  "plugins.tencent_meeting_prompt_2": "List all my Tencent Meetings for today",
  "plugins.tencent_meeting_prompt_3": "Cancel tomorrow’s Weekly review meeting",
  "plugins.tencent_meeting_prompt_4":
    "Get the smart minutes from yesterday’s product review meeting",
  "plugins.tencent_meeting_connected_note":
    "Connected. Use Try it or an example below in chat (new session or engine reload may be required).",
  "plugins.tencent_meeting_desktop_only": "Available on desktop",
  "plugins.tencent_meeting_connect": "Connect",
  "plugins.tencent_meeting_retry": "Retry",
  "plugins.tencent_meeting_disconnect": "Disconnect",
  "plugins.tencent_meeting_disconnect_title": "Disconnect Tencent Meeting?",
  "plugins.tencent_meeting_disconnect_message":
    "This removes the local token and OpenCode MCP entry. You can connect again later.",
  "plugins.tencent_meeting_cancel": "Cancel",
  "plugins.tencent_meeting_error_hint":
    "Tencent Meeting connection failed. Check the token and try again.",
  "plugins.tencent_meeting_token_hint":
    "Sign in with a personal account on the Tencent Meeting AI Skill page and copy your token.",
  "plugins.tencent_meeting_token_title": "Paste Tencent Meeting token",
  "plugins.tencent_meeting_token_subtitle":
    "Open the AI Skill page, sign in with a personal account, then paste the token below.",
  "plugins.tencent_meeting_token_label": "Token",
  "plugins.tencent_meeting_token_placeholder": "Paste token…",
  "plugins.tencent_meeting_token_help":
    "The token is stored only on this device. MCP: https://mcp.meeting.tencent.com/mcp/wemeet-open/v1",
  "plugins.tencent_meeting_open_token_page": "Open token page",
  "plugins.tencent_meeting_token_submit": "Connect",
} as const;
