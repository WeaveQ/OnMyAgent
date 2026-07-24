import { APP_NAME } from "../brand";

export default {
  "providers.api_key_label": "API密钥",
  "providers.api_key_required": "API密钥为必填项",
  "providers.auth_failed": "认证失败",
  "providers.connect_failed": "连接模型服务商失败",
  "providers.disabled_in_config_suffix": "并已在引擎配置中禁用。",
  "providers.disconnect_failed": "断开模型服务商失败",
  "providers.disconnected_prefix": "已断开",
  "providers.load_failed": "加载模型服务商失败",
  "providers.plugin_hook_mismatch": "OpenCode 插件钩子失败（版本/插件不兼容）",
  "providers.plugin_hook_mismatch_hint":
    "请先重载引擎，让 OnMyAgent 使用产品内置 OpenCode。同时把 @opencode-ai/plugin 与 OpenCode 版本对齐（或临时关闭 oh-my-openagent 等第三方插件），然后再试。",
  "providers.no_oauth_prefix": "没有可用的OAuth流程：",
  "providers.no_providers_available": "没有可用的模型服务商",
  "providers.not_connected": "未连接到服务器",
  "providers.not_oauth_flow_prefix": "所选认证方式不是OAuth流程：",
  "providers.oauth_failed": "完成OAuth失败",
  "providers.oauth_method_required": "OAuth方式为必填项",
  "providers.provider_error": "模型服务商错误（{provider}）",
  "providers.provider_id_required": "模型服务商 ID 为必填项",
  "providers.rate_limit_exceeded": "请求频率超限",
  "providers.removal_unsupported": "此客户端不支持移除模型服务商认证。",
  "providers.request_failed": "请求失败",
  "providers.save_api_key_failed": "保存API密钥失败",
  "providers.still_connected_suffix":
    "，但工作区仍报告为已连接。请清除残留的API密钥或OAuth凭据，然后重启工作区以完全断开。",
  "providers.unknown_provider": "未知模型服务商",
  "providers.use_api_key_suffix": "请改用API密钥。",
} as const;
