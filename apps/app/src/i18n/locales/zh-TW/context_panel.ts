import { APP_NAME } from "../brand";

export default {
  "context_panel.add_button": "添加",
  "context_panel.add_folder_button": "添加文件夾",
  "context_panel.add_folder_hint":
    "添加文件夾以允許此工作區讀寫其根目錄以外的文件。",
  "context_panel.adding_button": "添加中…",
  "context_panel.always_available": "不能移除工作區根文件夾",
  "context_panel.authorized_folders": "已授權文件夾",
  "context_panel.authorized_folders_desc":
    "授予此工作區訪問權限，以讀取和編輯根目錄之外的文件夾。",
  "context_panel.authorized_folders_no_access": `連接可寫的${APP_NAME}服務器工作區以編輯已授權文件夾。`,
  "context_panel.browse_button": "瀏覽",
  "context_panel.config_access_unavailable": `此工作區無法訪問${APP_NAME}服務器配置。`,
  "context_panel.config_read_only": `${APP_NAME}服務器對工作區配置為只讀連接。`,
  "context_panel.folder_already_authorized": "文件夾已授權。",
  "context_panel.folders_updated": "已授權文件夾已更新。",
  "context_panel.input_placeholder": "輸入要授權的文件夾路徑…",
  "context_panel.no_external_folders": "暫無已授權的外部文件夾",
  "context_panel.no_mcp": "未加載MCP服務器。",
  "context_panel.no_server_workspace": "未選擇活動的服務器工作區。",
  "context_panel.no_skills": "未加載技能。",
  "context_panel.preserving_entries": "保留{count}條非文件夾權限條目。",
  "context_panel.preserving_entry": "保留1條非文件夾權限條目。",
  "context_panel.remove_folder": "移除{name}",
  "context_panel.saving_folders": "正在保存已授權文件夾…",
  "context_panel.server_disconnected": `${APP_NAME}服務器已斷開連接。`,
  "context_panel.workspace_root_available": "工作區根目錄已可用。",
  "context_panel.workspace_root_badge": "工作區根目錄",
  "context_panel.writable_workspace_required": `需要可寫的${APP_NAME}服務器工作區才能更新已授權文件夾。`,
} as const;
