// Legacy CJK value normalizer for onboarding profile fields.
//
// The keys below are historical string values that could arrive from older
// clients or persisted profile records. They are *not* user-visible UI
// strings (those go through i18n/`t()`); they are look-up keys that the
// UI must map back to their canonical option ids. This file is added to
// `scripts/checks/check-i18n-cjk.mjs` fileAllowlist for that reason.

import {
  canonicalizeProfileOptionValue,
  canonicalizeProfileOptionValues,
} from "../../shared";

/** Historical CJK / label → canonical option id. */
export const legacyProfileOptionValues: Record<string, string> = {
  "技术 / 开发": "technology",
  "产品 / 设计": "product",
  产品: "product",
  设计: "product",
  "销售 / 商务": "sales",
  "销售 / 客户": "sales",
  "客户成功 / 客服": "sales",
  客户成功: "sales",
  "运营 / 营销": "operations",
  "运营 / 市场": "operations",
  "运营 / 市场 / 内容": "operations",
  "内容 / 创作": "operations",
  市场投放: "operations",
  "数据 / 智能": "technology",
  数据: "technology",
  "技术 / 开发 / 数据": "technology",
  "技术 / 开发": "technology",
  "供应链 / 物流": "supply-chain",
  供应链: "supply-chain",
  "财务 / 合规": "finance",
  "财务 / 法务": "finance",
  "金融 / 投资": "finance",
  财务: "finance",
  法务合规: "finance",
  "行政 / HR": "hr",
  行政: "hr",
  人力资源: "hr",
  "制造 / 质量": "manufacturing-eng",
  "工艺 / 制造工程": "manufacturing-eng",
  "教育 / 教研": "teacher",
  "教师 / 教研": "teacher",
  "研究 / 分析师": "teacher",
  管理层: "management",
  "创始人 / 管理层": "management",
  "OPC / 一人公司": "opc",
  互联网: "internet",
  "软件 / SaaS": "internet",
  制造: "manufacturing",
  教育: "education",
  金融: "finance",
  零售: "ecommerce",
  电商: "ecommerce",
  医疗: "healthcare",
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
  const fromCjk = legacyProfileOptionValues[value];
  return canonicalizeProfileOptionValue(fromCjk ?? value);
}

export function normalizeProfileOptionValues(values: string[]) {
  return Array.from(new Set(values.map(normalizeProfileOptionValue)));
}

// Re-export id-level canonicalizer for callers that already have English ids.
export { canonicalizeProfileOptionValues };
