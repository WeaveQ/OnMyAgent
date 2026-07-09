// Legacy CJK value normalizer for onboarding profile fields.
//
// The keys below are historical string values that could arrive from older
// clients or persisted profile records. They are *not* user-visible UI
// strings (those go through i18n/`t()`); they are look-up keys that the
// UI must map back to their canonical option ids. This file is added to
// `scripts/checks/check-i18n-cjk.mjs` fileAllowlist for that reason.

export const legacyProfileOptionValues: Record<string, string> = {
  "技术 / 开发": "technology",
  "产品 / 设计": "product",
  "销售 / 商务": "sales",
  "运营 / 营销": "operations",
  "内容 / 创作": "content",
  "数据 / 智能": "data",
  "金融 / 投资": "finance",
  "OPC / 一人公司": "opc",
  "行政 / HR": "admin",
  管理层: "management",
  "财务 / 法务": "legal",
  互联网: "internet",
  制造: "manufacturing",
  教育: "education",
  金融: "finance",
  医疗: "healthcare",
  零售: "retail",
  飞书: "feishu",
  企微: "wecom",
  钉钉: "dingtalk",
  Excel: "excel",
  WPS: "wps",
  Notion: "notion",
  Codex: "codex",
  "Claude Code": "claude-code",
  代码开发: "code",
  周报: "weekly-report",
  数据分析: "data-analysis",
  客户沟通: "customer-communication",
  会议纪要: "meeting-notes",
  合同审查: "contract-review",
  邮件起草: "email-drafting",
  其他: "other",
};

export function normalizeProfileOptionValue(value: string) {
  return legacyProfileOptionValues[value] ?? value;
}

export function normalizeProfileOptionValues(values: string[]) {
  return Array.from(new Set(values.map(normalizeProfileOptionValue)));
}
