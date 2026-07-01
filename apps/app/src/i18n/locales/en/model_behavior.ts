import { APP_NAME } from "../brand";

export default {
  "model_behavior.desc_builtin":
    "This model decides its own reasoning path and does not expose profiles here.",
  "model_behavior.desc_generic": "Use the {label} profile.",
  "model_behavior.desc_high": "Spend more time reasoning before answering.",
  "model_behavior.desc_high_anthropic":
    "Use the standard extended-thinking budget.",
  "model_behavior.desc_low": "Use a lighter reasoning pass before answering.",
  "model_behavior.desc_low_google":
    "Use a lighter reasoning budget for quicker responses.",
  "model_behavior.desc_max": "Use the provider's deepest reasoning profile.",
  "model_behavior.desc_max_anthropic":
    "Use the largest extended-thinking budget available.",
  "model_behavior.desc_medium": "Balance speed and reasoning depth.",
  "model_behavior.desc_minimal": "Use a very small amount of reasoning.",
  "model_behavior.desc_none": "Favor speed with the lightest reasoning path.",
  "model_behavior.desc_standard":
    "This model does not expose extra reasoning controls.",
  "model_behavior.label_balanced": "Balanced",
  "model_behavior.label_builtin": "Built in",
  "model_behavior.label_deep": "Deep",
  "model_behavior.label_extended": "Extended",
  "model_behavior.label_fast": "Fast",
  "model_behavior.label_light": "Light",
  "model_behavior.label_maximum": "Maximum",
  "model_behavior.label_quick": "Quick",
  "model_behavior.label_standard": "Standard",
  "model_behavior.title_builtin_reasoning": "Built-in reasoning",
  "model_behavior.title_extended_thinking": "Extended thinking",
  "model_behavior.title_reasoning_budget": "Reasoning budget",
  "model_behavior.title_reasoning_effort": "Reasoning effort",
  "model_behavior.title_standard_generation": "Standard generation",
} as const;
