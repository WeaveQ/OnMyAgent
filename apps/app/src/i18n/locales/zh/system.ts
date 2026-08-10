import { APP_NAME } from "../brand";

export default {
  "system.reload_body_agents":
    "Agent 在启动时加载。请重新加载以使更新的 Agent 可用。",
  "system.reload_body_commands":
    "命令在启动时加载。请重新加载以使更新的命令可用。",
  "system.reload_body_config":
    "工作区配置在启动时读取。请重新加载以应用变更。",
  "system.reload_body_default": `${APP_NAME}检测到需要重新加载后才能生效的变更。`,
  "system.reload_body_mcp":
    "连接器在启动时加载。请重新加载以激活新连接。",
  "system.reload_body_mixed": `${APP_NAME}检测到配置变更。请重新加载以应用。`,
  "system.reload_body_plugins":
    "插件在启动时加载。请重新加载以应用配置变更。",
  "system.reload_body_skills":
    "技能发现状态可能会被缓存。请重新加载以使新安装的技能可用。",
  "system.reload_failed": "无法应用变更，请再试一次重新加载。",
  "system.reload_required": "需要重新加载以应用变更",
  "system.reload_unavailable": "此工作区暂不支持重新加载。",
  "system.stop_active_runs_before_reset": "请先停止活跃的运行再重置。",
  "system.server_unhealthy": "服务器报告状态异常。",
  "system.boot_preparing_workspace": "正在启动 OnMyAgent…",
  "system.boot_loading_workspaces": "正在加载工作区…",
  "system.boot_starting_server": "正在启动本地服务…",
  "system.boot_activating_workspace": "正在激活你的工作区…",
  "system.boot_ready": "即将就绪",
  "system.boot_error": "出了点问题",
  "system.boot_start_runtime_failed":
    "无法启动 OnMyAgent。请退出后重新打开应用再试。",
  "system.boot_server_not_ready":
    "本地服务未完成启动。请退出 OnMyAgent 后重新打开。",
  "system.boot_config_invalid":
    "本地引擎配置无效（常见于 MCP 条目不完整）。可先「修复引擎配置」再重试。",
  "system.boot_package_missing":
    "当前安装缺少运行所需的组件（打包异常）。重试通常无效，请升级到最新版本。",
  "system.boot_download_latest_hint": "若反复出现，请下载最新版本：",
  "system.boot_retry": "再试一次",
  "system.boot_open_config_dir": "打开配置目录",
  "system.boot_repair_config": "修复引擎配置",
  "system.boot_repair_working": "正在修复…",
  "system.boot_repair_done": "已修复并备份旧配置，请再试一次",
  "system.boot_repair_failed": "自动修复失败，请打开配置目录手动检查",
  "system.error_action_retry": "再试一次",
  "system.error_action_reload_app": "重新打开应用",
  "system.error_action_open_ai_settings": "打开模型设置",
  "system.error_not_connected_title": "未连接",
  "system.error_not_connected_body":
    "工作区服务当前不可用。请稍等再试，或重新打开应用。",
  "system.error_providers_load_title": "无法加载服务商",
  "system.error_providers_load_body":
    "请检查网络与工作区连接后重试。",
  "system.error_connect_provider_title": "无法连接模型服务商",
  "system.error_connect_provider_body":
    "请检查 API 密钥、登录状态或网络后重试。密钥只保存在本机。",
  "system.error_remote_workspace_title": "远程工作区不可用",
  "system.error_remote_workspace_body":
    "无法连接该远程工作区。请检查地址与网络后重试。",
  "system.error_request_title": "请求失败",
  "system.error_request_body": "出了点问题，请重试。",
  "system.load_opening": "正在打开…",
  "system.load_session_route": "正在加载工作区…",
  "system.load_settings_route": "正在加载设置…",
  "system.load_welcome_route": "正在准备入门引导…",
  "system.load_settings_chunk": "正在打开设置…",
  "system.load_welcome_chunk": "正在打开入门引导…",
  "system.load_settings_tab": "正在加载页面…",
  "system.load_settings_ai": "正在加载服务商…",
  "system.load_session_refresh": "正在刷新工作区…",
  "system.load_session_workspace": "正在切换工作区…",
  "system.starting_workspace": "正在启动你的工作区…",
  "system.starting_another_workspace": "正在启动另一个工作区…",
  "system.start_workspace_failed":
    "无法启动所选工作区。请换一个工作区，或重启应用后再试。",
  "system.action_returned_error": "操作未完成，请重试。",
  "system.control_mode_off": "控制模式已关闭。",
  "system.control_open_ai_settings_desc": "前往 AI 模型服务商设置。",
  "system.control_open_command_palette": "打开命令面板",
  "system.control_open_command_palette_desc": "打开应用内命令面板，以便下一步选择可见。",
  "system.control_open_folders_settings_desc": "前往授权文件夹和文件访问设置。",
  "system.control_open_general_settings": "打开通用设置",
  "system.control_open_general_settings_desc": "前往通用设置。",
  "system.control_open_personal_settings": "打开个人设置",
  "system.control_open_personal_settings_desc": "称呼、语气、自定义指令与工作手册。",
  "system.control_open_memory_settings": "打开记忆设置",
  "system.control_open_memory_settings_desc": "对话记忆、待确认条目与已保存事实。",
  "system.control_open_sessions": "打开会话",
  "system.control_open_sessions_desc": "前往主会话视图。",
  "system.control_ready": "已就绪。控制器可以检查并运行可见操作。",
  "system.control_user_cancelled": "用户已取消操作。",
  "system.control_open_provider_settings": "打开模型服务商设置",
  "system.control_open_folders_settings": "打开授权文件夹设置",
} as const;
