import { APP_NAME } from "../brand";

export default {
  "model_picker.chat_model_desc":
    "选择此对话的模型。如果模型支持推理配置，可在其卡片上进行设置。",
  "model_picker.chat_model_title": "对话模型",
  "model_picker.connect_provider_hint": "连接此模型服务商以浏览和保存模型",
  "model_picker.default_model_desc":
    "选择新对话的默认模型，然后在其卡片上微调推理配置后点击完成。",
  "model_picker.default_model_title": "默认模型",
  "model_picker.model_count": "{count}个模型",
  "model_picker.more_providers": "更多模型服务商",
  "model_picker.no_results": "没有匹配的模型。",
  "model_picker.no_models_connect_provider": "暂无可用模型。请先连接模型服务商。",
  "model_picker.other_connected_models": "其他已连接的模型",
  "model_picker.recommended": "推荐",
  "model_picker.search_placeholder": "搜索模型服务商和模型...",
  "model_picker.session_model_desc": "为此会话选择模型。",
  "model_picker.model_count_one": "{count} 个模型",
  "model_picker.model_count_other": "{count} 个模型",
  "model_picker.provider_default_available_title": "可用默认模型",
  "model_picker.provider_default_available_desc":
    `${APP_NAME} 建议使用 {model}，可一键设为默认（不会自动覆盖当前选择）。`,
  "model_picker.provider_default_apply": "设为默认",
} as const;
