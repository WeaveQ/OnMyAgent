import { APP_NAME } from "../brand";

export default {
  "context_panel.add_button": "添加",
  "context_panel.add_folder_button": "添加文件夹",
  "context_panel.add_folder_hint":
    "添加文件夹以允许此工作区读写其根目录以外的文件。",
  "context_panel.adding_button": "添加中…",
  "context_panel.always_available": "不能移除工作区根文件夹",
  "context_panel.authorized_folders": "已授权文件夹",
  "context_panel.authorized_folders_desc":
    "授予此工作区访问权限，以读取和编辑根目录之外的文件夹。",
  "context_panel.authorized_folders_no_access": `连接可写的${APP_NAME}服务器工作区以编辑已授权文件夹。`,
  "context_panel.browse_button": "浏览",
  "context_panel.config_access_unavailable": `此工作区无法访问${APP_NAME}服务器配置。`,
  "context_panel.config_read_only": `${APP_NAME}服务器对工作区配置为只读连接。`,
  "context_panel.folder_already_authorized": "文件夹已授权。",
  "context_panel.folders_updated": "已授权文件夹已更新。",
  "context_panel.input_placeholder": "输入要授权的文件夹路径…",
  "context_panel.no_external_folders": "暂无已授权的外部文件夹",
  "context_panel.no_mcp": "未加载MCP服务器。",
  "context_panel.no_server_workspace": "未选择活动的服务器工作区。",
  "context_panel.no_skills": "未加载技能。",
  "context_panel.preserving_entries": "保留{count}条非文件夹权限条目。",
  "context_panel.preserving_entry": "保留1条非文件夹权限条目。",
  "context_panel.remove_folder": "移除{name}",
  "context_panel.saving_folders": "正在保存已授权文件夹…",
  "context_panel.server_disconnected": `${APP_NAME}服务器已断开连接。`,
  "context_panel.workspace_root_available": "工作区根目录已可用。",
  "context_panel.workspace_root_badge": "工作区根目录",
  "context_panel.writable_workspace_required": `需要可写的${APP_NAME}服务器工作区才能更新已授权文件夹。`,
} as const;
