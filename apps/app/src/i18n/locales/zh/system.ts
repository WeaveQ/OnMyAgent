import { APP_NAME } from "../brand";

export default {
  "system.reload_body_agents":
    "Agent 在启动时加载。重新加载引擎以使更新的 Agent 可用。",
  "system.reload_body_commands":
    "命令在启动时加载。重新加载引擎以使更新的命令可用。",
  "system.reload_body_config":
    "工作区配置在启动时读取。重新加载引擎以应用配置变更。",
  "system.reload_body_default": `${APP_NAME}检测到需要重新加载本地智能体引擎的变更。`,
  "system.reload_body_mcp":
    "MCP 服务器在启动时加载。重新加载引擎以激活新连接。",
  "system.reload_body_mixed": `${APP_NAME}检测到配置变更。重新加载引擎以应用。`,
  "system.reload_body_plugins":
    "插件在启动时加载。重新加载引擎以应用配置变更。",
  "system.reload_body_skills":
    "技能发现状态可能会被缓存。重新加载引擎以使新安装的技能可用。",
  "system.reload_failed": "重新加载引擎失败。",
  "system.reload_required": "需要重新加载",
  "system.reload_unavailable": "此工作区不支持重新加载。",
  "system.stop_active_runs_before_reset": "请先停止活跃的运行再重置。",
  "system.server_unhealthy": "服务器报告状态异常。",
  "system.boot_preparing_workspace": "正在启动 OnMyAgent…",
  "system.boot_activating_workspace": "正在激活你的工作区",
  "system.boot_ready": "已就绪",
  "system.boot_error": "出现问题",
  "system.starting_workspace": "正在启动你的工作区",
  "system.starting_another_workspace": "正在启动另一个工作区",
  "system.start_workspace_failed": "启动所选工作区失败。",
  "system.action_returned_error": "操作返回错误。",
  "system.control_mode_off": "控制模式已关闭。",
  "system.control_open_ai_settings_desc": "前往 AI 模型服务商设置。",
  "system.control_open_command_palette": "打开命令面板",
  "system.control_open_command_palette_desc": "打开应用内命令面板，以便下一步选择可见。",
  "system.control_open_extensions_settings": "打开 MCP 和扩展设置",
  "system.control_open_extensions_settings_desc": "前往扩展和 MCP 设置。",
  "system.control_open_folders_settings_desc": "前往授权文件夹和文件访问设置。",
  "system.control_open_general_settings": "打开通用设置",
  "system.control_open_general_settings_desc": "前往通用设置。",
  "system.control_open_sessions": "打开会话",
  "system.control_open_sessions_desc": "前往主会话视图。",
  "system.control_open_skills_settings_desc": "前往技能设置。",
  "system.control_ready": "已就绪。控制器可以检查并运行可见操作。",
  "system.control_user_cancelled": "用户已取消操作。",
  "system.control_open_skills_settings": "打开技能设置",
  "system.control_open_provider_settings": "打开模型服务商设置",
  "system.control_open_folders_settings": "打开授权文件夹设置",
} as const;
