/** @jsxImportSource react */
import { FilterChip } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
export {
  normalizeProfileOptionValue,
  normalizeProfileOptionValues,
} from "./legacy-profile-options";

export type ProfileOption = {
  value: string;
  label: string;
};

/**
 * Collapsed role taxonomy (~12). Near-duplicates merged:
 * product+design, ops+content+marketing, sales+CS, SC+logistics+warehouse,
 * finance+legal, hr+admin, mfg+quality, teacher+research.
 */
export const roleOptions: ProfileOption[] = [
  { value: "technology", get label() { return t("profile.role_technology"); } },
  { value: "product", get label() { return t("profile.role_product"); } },
  { value: "sales", get label() { return t("profile.role_sales"); } },
  { value: "operations", get label() { return t("profile.role_operations"); } },
  { value: "supply-chain", get label() { return t("profile.role_supply_chain"); } },
  { value: "finance", get label() { return t("profile.role_finance"); } },
  { value: "hr", get label() { return t("profile.role_hr"); } },
  { value: "manufacturing-eng", get label() { return t("profile.role_manufacturing_eng"); } },
  { value: "teacher", get label() { return t("profile.role_teacher"); } },
  { value: "management", get label() { return t("profile.role_management"); } },
  { value: "opc", get label() { return t("profile.role_opc"); } },
  { value: "student", get label() { return t("profile.role_student"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

/**
 * Collapsed industry taxonomy (~14). Excluded by product:
 * healthcare, energy, real-estate, food/agriculture as primary industries.
 */
export const industryOptions: ProfileOption[] = [
  { value: "internet", get label() { return t("profile.industry_internet"); } },
  { value: "hardware", get label() { return t("profile.industry_hardware"); } },
  { value: "gaming", get label() { return t("profile.industry_gaming"); } },
  { value: "ecommerce", get label() { return t("profile.industry_ecommerce"); } },
  { value: "logistics", get label() { return t("profile.industry_logistics"); } },
  { value: "manufacturing", get label() { return t("profile.industry_manufacturing"); } },
  { value: "media", get label() { return t("profile.industry_media"); } },
  { value: "finance", get label() { return t("profile.industry_finance"); } },
  { value: "consulting", get label() { return t("profile.industry_consulting"); } },
  { value: "education", get label() { return t("profile.industry_education"); } },
  { value: "government", get label() { return t("profile.industry_government"); } },
  { value: "travel", get label() { return t("profile.industry_travel"); } },
  { value: "opc-general", get label() { return t("profile.industry_opc_general"); } },
  { value: "student", get label() { return t("profile.industry_student"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

export const toolOptions: ProfileOption[] = [
  { value: "feishu", get label() { return t("profile.tool_feishu"); } },
  { value: "wecom", get label() { return t("profile.tool_wecom"); } },
  { value: "dingtalk", get label() { return t("profile.tool_dingtalk"); } },
  { value: "excel", label: "Excel" },
  { value: "wps", label: "WPS" },
  { value: "notion", label: "Notion" },
  { value: "github", label: "GitHub" },
  { value: "vscode", label: "VS Code" },
  { value: "codex", label: "Codex" },
  { value: "claude-code", get label() { return t("profile.tool_claude_code"); } },
  { value: "figma", label: "Figma" },
  { value: "canva", label: "Canva" },
  { value: "xiaohongshu", get label() { return t("profile.tool_xiaohongshu"); } },
  { value: "douyin", get label() { return t("profile.tool_douyin"); } },
  { value: "bilibili", get label() { return t("profile.tool_bilibili"); } },
  { value: "wechat-oa", get label() { return t("profile.tool_wechat_oa"); } },
  { value: "erp", get label() { return t("profile.tool_erp"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

/** Habit tasks — light merge of near-duplicates kept as discrete jobs. */
export const taskOptions: ProfileOption[] = [
  { value: "code", get label() { return t("profile.task_code"); } },
  { value: "weekly-report", get label() { return t("profile.task_weekly_report"); } },
  { value: "daily-brief", get label() { return t("profile.task_daily_brief"); } },
  { value: "data-analysis", get label() { return t("profile.task_data_analysis"); } },
  { value: "customer-communication", get label() { return t("profile.task_customer_communication"); } },
  { value: "meeting-notes", get label() { return t("profile.task_meeting_notes"); } },
  { value: "contract-review", get label() { return t("profile.task_contract_review"); } },
  { value: "email-drafting", get label() { return t("profile.task_email_drafting"); } },
  { value: "content-ops", get label() { return t("profile.task_content_ops"); } },
  { value: "campaign", get label() { return t("profile.task_campaign"); } },
  { value: "dispatch", get label() { return t("profile.task_dispatch"); } },
  { value: "recon", get label() { return t("profile.task_recon"); } },
  { value: "inventory", get label() { return t("profile.task_inventory"); } },
  { value: "quality-check", get label() { return t("profile.task_quality_check"); } },
  { value: "sales-pipeline", get label() { return t("profile.task_sales_pipeline"); } },
  { value: "hiring", get label() { return t("profile.task_hiring"); } },
  { value: "compliance", get label() { return t("profile.task_compliance"); } },
  { value: "study-plan", get label() { return t("profile.task_study_plan"); } },
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
 * Multi-select chip for onboarding / profile.
 * - plain: free-float filter style (idle = plain label)
 * - soft: selectable pill with muted surface when idle (welcome form)
 * Defaults to chipLg for full-page readability.
 */
export function ToggleChip(props: {
  label: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
  size?: "chip" | "chipLg";
  /** `soft` = bordered muted idle pill (onboarding). */
  surface?: "plain" | "soft";
}) {
  const surface = props.surface ?? "plain";
  return (
    <FilterChip
      label={props.label}
      selected={props.selected}
      onClick={props.onClick}
      size={props.size ?? "chipLg"}
      className={cn(
        surface === "soft" &&
          !props.selected &&
          "border border-dls-border/70 bg-dls-surface-muted text-dls-secondary hover:border-dls-border hover:bg-dls-list-hover hover:text-dls-text",
        surface === "soft" &&
          props.selected &&
          "border border-dls-accent/35 bg-dls-accent/12 text-dls-text shadow-none",
        props.className,
      )}
    />
  );
}

export function FieldLabel(props: { children: React.ReactNode; className?: string }) {
  return (
    <label
      className={cn(
        "flex flex-col gap-1.5 text-sm font-medium leading-5 text-dls-secondary",
        props.className,
      )}
    >
      {props.children}
    </label>
  );
}

/** Group label above a chip row inside onboarding cards. */
export function ChipGroupLabel(props: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-col gap-1", props.className)}>
      <div className="text-sm font-medium text-dls-text">{props.children}</div>
      {props.hint ? (
        <div className="text-xs leading-5 text-dls-secondary">{props.hint}</div>
      ) : null}
    </div>
  );
}
