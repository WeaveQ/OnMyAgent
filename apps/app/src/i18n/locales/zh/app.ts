import { APP_NAME } from "../brand";

export default {
  "app.compact_command_desc": "压缩此会话以减少上下文大小。",
  "app.error_audit_load": "加载审计日志失败。",
  "app.error_auth_failed": "认证失败",
  "app.error_command_not_resolved": "命令未解析。",
  "app.error_compact_empty": "暂无可压缩的内容。",
  "app.error_compact_no_session": "请先选择一个有消息的会话再运行/compact。",
  "app.error_compact_no_session_id": "请先选择一个会话再压缩。",
  "app.error_connect_first": "请先连接到此工作区再应用运行时更改。",
  "app.error_remote_worker_connection_failed": "远程工作区连接失败。",
  "app.error_remote_worker_url_missing":
    "远程工作区 URL 缺失。请编辑连接并添加服务器 URL。",
  "app.error_prompt_required": "请输入提示词。",
  "app.error_not_connected": "未连接到服务器",
  "app.error_rate_limit": "请求频率超限",
  "app.error_remote_access": "更新远程访问失败。",
  "app.error_request_failed": "请求失败",
  "app.error_restart_local_worker": "使用更新的共享设置重启本地工作区失败。",
  "app.error_session_name_required": "会话名称为必填项",
  "app.local_disabled_reason":
    "本地工作区需在桌面应用中创建。远程和共享工作区仍可正常使用。",
  "app.model_behavior_title": "模型行为",
  "app.plugins_hint_readonly": `${APP_NAME}服务器对插件为只读模式。`,
  "app.reload_later": "稍后",
  "app.reload_now": "立即重新加载",
  "app.reload_stop_tasks": "重新加载并停止任务",
  "app.skills_hint_readonly": `${APP_NAME}服务器对skills为只读模式。请在高级设置中添加主机令牌以启用安装。`,
  "app.unknown_error": "未知错误",
  "app.error_load_tasks": "加载任务失败",
} as const;
