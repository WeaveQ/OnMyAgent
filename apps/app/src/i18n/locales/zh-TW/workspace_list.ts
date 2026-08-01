import { APP_NAME } from "../brand";

export default {
  "workspace_list.delete_session": "刪除會話",
  "workspace_list.edit_connection": "編輯連接",
  "workspace_list.recover": "恢復",
  "workspace_list.restricted_workspaces_message":
    "你的組織管理員已限制添加額外工作區。",
  "workspace_list.restricted_workspaces_title": "已限制添加額外工作區",
  "workspace_list.rename_session": "重命名會話",
  "workspace_list.remote_worker_unavailable": "遠程工作區不可用",
  "workspace_list.remote_worker_unavailable_hint": `連接修復前，${APP_NAME} 無法從這個遠程工作區加載任務。`,
  "workspace_list.show_more": "顯示更多{count}個",
  "workspace_list.show_more_fallback": "顯示更多",
  "workspace_list.test_connection": "測試連接",
  "workspace_list.workspace_fallback": "工作區",
  "workspace_list.connected": "已連接",
  "workspace_list.connected_loaded_tasks_one":
    "已連接。已加載 {count} 個任務。",
  "workspace_list.custom_providers_restricted_message":
    "你的組織管理員已禁用添加自定義模型服務商。",
  "workspace_list.custom_providers_restricted_title": "已禁用添加自定義模型服務商",
  "workspace_list.connected_loaded_tasks_other":
    "已連接。已加載 {count} 個任務。",
  "workspace_list.remove_confirm":
    "要從側邊欄移除此工作區嗎？磁盤上的會話和文件會保留。",
  "workspace_list.export_config_picker_title": "選擇 {workspace} 的導出位置",
  "workspace_list.not_found_route_error": "未找到工作區。請從側邊欄選擇新的工作區。",
  "workspace_list.session_active": "會話活躍中",
  "workspace_list.session_streaming": "會話響應中",
  "workspace_list.loading_remote_tasks": "正在從遠程工作區加載任務…",
} as const;
