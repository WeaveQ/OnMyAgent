import { APP_NAME } from "../brand";

export default {
  "workspace_list.delete_session": "删除会话",
  "workspace_list.edit_connection": "编辑连接",
  "workspace_list.recover": "恢复",
  "workspace_list.restricted_workspaces_message":
    "你的组织管理员已限制添加额外工作区。",
  "workspace_list.restricted_workspaces_title": "已限制添加额外工作区",
  "workspace_list.rename_session": "重命名会话",
  "workspace_list.remote_worker_unavailable": "远程工作区不可用",
  "workspace_list.remote_worker_unavailable_hint": `连接修复前，${APP_NAME} 无法从这个远程工作区加载任务。`,
  "workspace_list.show_more": "显示更多{count}个",
  "workspace_list.show_more_fallback": "显示更多",
  "workspace_list.test_connection": "测试连接",
  "workspace_list.workspace_fallback": "工作区",
  "workspace_list.connected": "已连接",
  "workspace_list.connected_loaded_tasks_one":
    "已连接。已加载 {count} 个任务。",
  "workspace_list.custom_providers_restricted_message":
    "你的组织管理员已禁用添加自定义模型服务商。",
  "workspace_list.custom_providers_restricted_title": "已禁用添加自定义模型服务商",
  "workspace_list.connected_loaded_tasks_other":
    "已连接。已加载 {count} 个任务。",
  "workspace_list.remove_confirm":
    "要从侧边栏移除此工作区吗？磁盘上的会话和文件会保留。",
  "workspace_list.export_config_picker_title": "选择 {workspace} 的导出位置",
  "workspace_list.not_found_route_error": "未找到工作区。请从侧边栏选择新的工作区。",
  "workspace_list.session_active": "会话活跃中",
  "workspace_list.session_streaming": "会话响应中",
  "workspace_list.loading_remote_tasks": "正在从远程工作区加载任务…",
} as const;
