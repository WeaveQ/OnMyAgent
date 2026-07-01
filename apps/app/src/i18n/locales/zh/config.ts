import { APP_NAME } from "../brand";

export default {
  "config.collaborator_token_disabled_hint":
    "已预存用于远程共享，但远程访问当前已禁用。",
  "config.collaborator_token_label": "协作者令牌",
  "config.collaborator_token_remote_hint":
    "手机或笔记本连接此服务器时的日常远程访问。",
  "config.connection_failed": "连接失败。",
  "config.connection_failed_check": "连接失败。请检查主机URL和令牌。",
  "config.connection_status_updated": "连接状态已更新。",
  "config.connection_successful": "连接成功。",
  "config.copied": "已复制",
  "config.copy": "复制",
  "config.desktop_only_hint":
    "部分配置功能（本地服务器共享 + 消息桥接）需要桌面应用。",
  "config.diagnostics_desc": "复制脱敏的运行时状态用于调试。",
  "config.diagnostics_title": "诊断包",
  "config.engine_reload_desc": "重启此工作区的OpenCode服务器。",
  "config.engine_reload_title": "引擎重新加载",
  "config.host_admin_token_hint":
    "仅限主机内部使用的令牌，用于审批CLI和管理API。请勿在远程应用连接流程中使用。",
  "config.host_admin_token_label": "主机管理员令牌",
  "config.host_local_only": "仅限本地",
  "config.host_offline": "离线",
  "config.host_remote_enabled": "已启用远程",
  "config.local_ip_hint": "在同一Wi-Fi下使用本地IP可获得最快连接。",
  "config.mdns_hint": ".local名称更易记忆，但可能无法在所有网络上解析。",
  "config.messaging_identities_desc":
    "在身份标签页中管理Telegram/Slack身份和路由。",
  "config.messaging_identities_title": "消息身份",
  "config.not_set": "未设置",
  "config.owner_token_disabled_hint": "仅在启用此工作区的远程访问后才有效。",
  "config.owner_token_label": "所有者令牌",
  "config.owner_token_remote_hint":
    "远程客户端需要回答权限提示或执行所有者操作时使用。",
  "config.reload_active_tasks_warning": "重新加载将停止活动任务。",
  "config.reload_availability_hint": `仅本地工作区或已连接的${APP_NAME}服务器支持重新加载。`,
  "config.reload_connect_hint": "连接此工作区后才能重新加载。",
  "config.reload_engine": "重新加载引擎",
  "config.reload_now_desc": "应用配置更新并重新连接会话。",
  "config.reload_now_title": "立即重新加载",
  "config.reloading": "正在重新加载…",
  "config.remote_access_off_hint":
    "远程访问已关闭。请先通过分享工作区启用远程访问，然后再从其他设备连接。",
  "config.resolved_worker_url": "解析后的工作区URL：",
  "config.server_needed_hint": `需要连接${APP_NAME}服务器以同步skills、插件和命令。`,
  "config.server_section_desc": `连接${APP_NAME}服务器。使用URL加服务器管理员提供的协作者或所有者令牌。`,
  "config.server_section_title": `${APP_NAME}服务器`,
  "config.server_sharing_desc":
    "将这些详情分享给受信任的设备。保持服务器在同一网络以获得最快设置。",
  "config.server_sharing_menu_hint":
    "如需每个工作区的分享链接，请使用工作区菜单中的分享…",
  "config.server_sharing_title": `${APP_NAME}服务器共享`,
  "config.server_url_hint": `使用${APP_NAME}服务器提供的URL。本地桌面工作区使用48000-51000范围内的持久高端口。`,
  "config.server_url_input_label": `${APP_NAME}服务器URL`,
  "config.server_url_label": `${APP_NAME}服务器URL`,
  "config.starting_server": "正在启动服务器…",
  "config.status_connected": "已连接",
  "config.status_limited": "受限",
  "config.status_not_connected": "未连接",
  "config.test_connection": "测试连接",
  "config.testing": "正在测试…",
  "config.testing_connection": "正在测试连接…",
  "config.token_hint":
    "可选。粘贴协作者令牌用于日常访问，或在此客户端需要回答权限提示时粘贴所有者令牌。",
  "config.token_label": "协作者或所有者令牌",
  "config.token_placeholder": "粘贴你的令牌",
  "config.unavailable": "不可用",
  "config.worker_id": "工作区ID：",
  "config.workspace_config_desc":
    "这些设置影响所选工作区。仅运行时操作适用于当前连接的工作区。",
  "config.workspace_config_title": "工作区配置",
  "config.workspace_id_prefix": "工作区：",
} as const;
