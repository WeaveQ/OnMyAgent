import { APP_NAME } from "../brand";

export default {
  "workspace_list.add_workspace": "Add workspace",
  "workspace_list.connected": "Connected",
  "workspace_list.connected_loaded_tasks_one":
    "Connected. Loaded {count} task.",
  "workspace_list.custom_providers_restricted_message":
    "Your organization administrator has disabled adding custom providers.",
  "workspace_list.custom_providers_restricted_title":
    "Adding custom providers is disabled",
  "workspace_list.connected_loaded_tasks_other":
    "Connected. Loaded {count} tasks.",
  "workspace_list.connecting": "Connecting...",
  "workspace_list.delete_session": "Delete session",
  "workspace_list.edit_connection": "Edit connection",
  "workspace_list.edit_name": "Edit name",
  "workspace_list.hide_child_sessions": "Hide child sessions",
  "workspace_list.recover": "Recover",
  "workspace_list.remove_confirm":
    "Remove this workspace from the sidebar? Sessions and files on disk are preserved.",
  "workspace_list.export_config_picker_title": "Choose where to export {workspace}",
  "workspace_list.not_found_route_error": "Workspace was not found. Select a new workspace from the sidebar.",
  "workspace_list.remove_workspace": "Remove workspace",
  "workspace_list.restricted_workspaces_message":
    "Your organization administrator has restricted access to adding additional workspaces.",
  "workspace_list.restricted_workspaces_title":
    "Additional workspaces are restricted",
  "workspace_list.rename_session": "Rename session",
  "workspace_list.remote_worker_unavailable": "Remote worker unavailable",
  "workspace_list.remote_worker_unavailable_hint": `${APP_NAME} can't load tasks from this worker until the connection is fixed.`,
  "workspace_list.reveal_explorer": "Reveal in Explorer",
  "workspace_list.reveal_file_manager": "Show in Files",
  "workspace_list.reveal_finder": "Reveal in Finder",
  "workspace_list.session_actions": "Session actions",
  "workspace_list.session_active": "Session active",
  "workspace_list.session_streaming": "Session streaming",
  "workspace_list.share": "Share...",
  "workspace_list.show_child_sessions": "Show child sessions",
  "workspace_list.show_more": "Show {count} more",
  "workspace_list.show_more_fallback": "Show more",
  "workspace_list.loading_remote_tasks": "Loading tasks from remote worker...",
  "workspace_list.test_connection": "Test connection",
  "workspace_list.unavailable": "Unavailable",
  "workspace_list.workspace_fallback": "Workspace",
  "workspace_list.workspace_options": "Workspace options",
} as const;
