import { APP_NAME } from "../brand";

export default {
  "providers.api_key_label": "API密鑰",
  "providers.api_key_required": "API密鑰為必填項",
  "providers.auth_failed": "認證失敗",
  "providers.connect_failed": "連接模型服務商失敗",
  "providers.disabled_in_config_suffix": "並已在引擎配置中禁用。",
  "providers.disconnect_failed": "斷開模型服務商失敗",
  "providers.disconnected_prefix": "已斷開",
  "providers.load_failed": "加載模型服務商失敗",
  "providers.no_oauth_prefix": "沒有可用的OAuth流程：",
  "providers.no_providers_available": "沒有可用的模型服務商",
  "providers.not_connected": "未連接到服務器",
  "providers.not_oauth_flow_prefix": "所選認證方式不是OAuth流程：",
  "providers.oauth_failed": "完成OAuth失敗",
  "providers.oauth_method_required": "OAuth方式為必填項",
  "providers.provider_error": "模型服務商錯誤（{provider}）",
  "providers.provider_id_required": "模型服務商 ID 為必填項",
  "providers.rate_limit_exceeded": "請求頻率超限",
  "providers.removal_unsupported": "此客戶端不支持移除模型服務商認證。",
  "providers.request_failed": "請求失敗",
  "providers.save_api_key_failed": "保存API密鑰失敗",
  "providers.still_connected_suffix":
    "，但工作區仍報告為已連接。請清除殘留的API密鑰或OAuth憑據，然後重啟工作區以完全斷開。",
  "providers.unknown_provider": "未知模型服務商",
  "providers.use_api_key_suffix": "請改用API密鑰。",
} as const;
