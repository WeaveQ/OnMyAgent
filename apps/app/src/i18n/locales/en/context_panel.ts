import { APP_NAME } from "../brand";

export default {
  "context_panel.add_button": "Add",
  "context_panel.add_folder_button": "Add folder",
  "context_panel.add_folder_hint":
    "Add a folder to let this workspace read and edit files outside its root directory.",
  "context_panel.adding_button": "Adding...",
  "context_panel.always_available": "Workspace root folder can't be removed",
  "context_panel.authorized_folders": "Authorized folders",
  "context_panel.authorized_folders_desc":
    "Grant this workspace access to read and edit files in directories outside of its root.",
  "context_panel.authorized_folders_no_access": `Connect to a writable ${APP_NAME} server workspace to edit authorized folders.`,
  "context_panel.browse_button": "Browse",
  "context_panel.config_access_unavailable": `${APP_NAME} server config access is unavailable for this workspace.`,
  "context_panel.config_read_only": `${APP_NAME} server is connected read-only for workspace config.`,
  "context_panel.folder_already_authorized": "Folder is already authorized.",
  "context_panel.folders_updated": "Authorized folders updated.",
  "context_panel.input_placeholder": "Type a folder path to authorize...",
  "context_panel.no_external_folders": "No external folders authorized",
  "context_panel.no_mcp": "No MCP servers loaded.",
  "context_panel.no_server_workspace":
    "No active server workspace is selected.",
  "context_panel.no_skills": "No skills loaded.",
  "context_panel.preserving_entries":
    "Preserving {count} non-folder permission entries.",
  "context_panel.preserving_entry": "Preserving 1 non-folder permission entry.",
  "context_panel.remove_folder": "Remove {name}",
  "context_panel.saving_folders": "Saving authorized folders...",
  "context_panel.server_disconnected": `${APP_NAME} server is disconnected.`,
  "context_panel.workspace_root_available":
    "Workspace root is already available.",
  "context_panel.workspace_root_badge": "Workspace root",
  "context_panel.writable_workspace_required": `A writable ${APP_NAME} server workspace is required to update authorized folders.`,
} as const;
