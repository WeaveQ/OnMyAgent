/** @jsxImportSource react */
import { FilterChip } from "@/components/ui/action-row";
import { t } from "@/i18n";
export {
  normalizeProfileOptionValue,
  normalizeProfileOptionValues,
} from "./legacy-profile-options";

export type ProfileOption = {
  value: string;
  label: string;
};

export const roleOptions: ProfileOption[] = [
  { value: "technology", get label() { return t("profile.role_technology"); } },
  { value: "product", get label() { return t("profile.role_product"); } },
  { value: "sales", get label() { return t("profile.role_sales"); } },
  { value: "operations", get label() { return t("profile.role_operations"); } },
  { value: "content", get label() { return t("profile.role_content"); } },
  { value: "data", get label() { return t("profile.role_data"); } },
  { value: "finance", get label() { return t("profile.role_finance"); } },
  { value: "opc", get label() { return t("profile.role_opc"); } },
  { value: "admin", get label() { return t("profile.role_admin"); } },
  { value: "management", get label() { return t("profile.role_management"); } },
  { value: "legal", get label() { return t("profile.role_legal"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

export const industryOptions: ProfileOption[] = [
  { value: "internet", get label() { return t("profile.industry_internet"); } },
  { value: "manufacturing", get label() { return t("profile.industry_manufacturing"); } },
  { value: "education", get label() { return t("profile.industry_education"); } },
  { value: "finance", get label() { return t("profile.industry_finance"); } },
  { value: "healthcare", get label() { return t("profile.industry_healthcare"); } },
  { value: "retail", get label() { return t("profile.industry_retail"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

export const toolOptions: ProfileOption[] = [
  { value: "feishu", get label() { return t("profile.tool_feishu"); } },
  { value: "wecom", get label() { return t("profile.tool_wecom"); } },
  { value: "dingtalk", get label() { return t("profile.tool_dingtalk"); } },
  { value: "excel", label: "Excel" },
  { value: "wps", label: "WPS" },
  { value: "notion", label: "Notion" },
  { value: "codex", label: "Codex" },
  { value: "claude-code", get label() { return t("profile.tool_claude_code"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

export const taskOptions: ProfileOption[] = [
  { value: "code", get label() { return t("profile.task_code"); } },
  { value: "weekly-report", get label() { return t("profile.task_weekly_report"); } },
  { value: "data-analysis", get label() { return t("profile.task_data_analysis"); } },
  { value: "customer-communication", get label() { return t("profile.task_customer_communication"); } },
  { value: "meeting-notes", get label() { return t("profile.task_meeting_notes"); } },
  { value: "contract-review", get label() { return t("profile.task_contract_review"); } },
  { value: "email-drafting", get label() { return t("profile.task_email_drafting"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

/** 16 classic MBTI types (single-select). */
export const mbtiOptions = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP",
] as const;

export const mbtiSelectItems = mbtiOptions.map((value) => ({
  label: value,
  value,
}));

/**
 * Soft filter / multi-select chip (image-1 style):
 * selected = solid elevated pill; idle = plain label, no border.
 */
export function ToggleChip(props: {
  label: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <FilterChip
      label={props.label}
      selected={props.selected}
      onClick={props.onClick}
      className={props.className}
    />
  );
}

export function FieldLabel(props: { children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium leading-4 text-dls-secondary">
      {props.children}
    </label>
  );
}
