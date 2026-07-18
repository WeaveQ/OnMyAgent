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
  { value: "design", get label() { return t("profile.role_design"); } },
  { value: "data", get label() { return t("profile.role_data"); } },
  { value: "sales", get label() { return t("profile.role_sales"); } },
  { value: "operations", get label() { return t("profile.role_operations"); } },
  { value: "content", get label() { return t("profile.role_content"); } },
  { value: "marketing", get label() { return t("profile.role_marketing"); } },
  { value: "supply-chain", get label() { return t("profile.role_supply_chain"); } },
  { value: "logistics-ops", get label() { return t("profile.role_logistics_ops"); } },
  { value: "warehouse", get label() { return t("profile.role_warehouse"); } },
  { value: "finance", get label() { return t("profile.role_finance"); } },
  { value: "legal", get label() { return t("profile.role_legal"); } },
  { value: "hr", get label() { return t("profile.role_hr"); } },
  { value: "customer-success", get label() { return t("profile.role_customer_success"); } },
  { value: "procurement", get label() { return t("profile.role_procurement"); } },
  { value: "quality", get label() { return t("profile.role_quality"); } },
  { value: "manufacturing-eng", get label() { return t("profile.role_manufacturing_eng"); } },
  { value: "teacher", get label() { return t("profile.role_teacher"); } },
  { value: "research", get label() { return t("profile.role_research"); } },
  { value: "management", get label() { return t("profile.role_management"); } },
  { value: "admin", get label() { return t("profile.role_admin"); } },
  { value: "opc", get label() { return t("profile.role_opc"); } },
  { value: "student", get label() { return t("profile.role_student"); } },
  { value: "other", get label() { return t("profile.other"); } },
];

/**
 * Industry options for onboarding / settings memory.
 * Excluded by product: healthcare, energy, real-estate, food/agriculture as primary industries.
 */
export const industryOptions: ProfileOption[] = [
  // Tech
  { value: "internet", get label() { return t("profile.industry_internet"); } },
  { value: "software", get label() { return t("profile.industry_software"); } },
  { value: "ai", get label() { return t("profile.industry_ai"); } },
  { value: "cloud", get label() { return t("profile.industry_cloud"); } },
  { value: "cybersecurity", get label() { return t("profile.industry_cybersecurity"); } },
  { value: "semiconductors", get label() { return t("profile.industry_semiconductors"); } },
  { value: "hardware", get label() { return t("profile.industry_hardware"); } },
  { value: "telecom", get label() { return t("profile.industry_telecom"); } },
  { value: "gaming", get label() { return t("profile.industry_gaming"); } },
  { value: "digital-entertainment", get label() { return t("profile.industry_digital_entertainment"); } },
  // Commerce
  { value: "retail", get label() { return t("profile.industry_retail"); } },
  { value: "ecommerce", get label() { return t("profile.industry_ecommerce"); } },
  { value: "cross-border", get label() { return t("profile.industry_cross_border"); } },
  { value: "livestream", get label() { return t("profile.industry_livestream"); } },
  { value: "fmcg", get label() { return t("profile.industry_fmcg"); } },
  { value: "fashion", get label() { return t("profile.industry_fashion"); } },
  { value: "beauty", get label() { return t("profile.industry_beauty"); } },
  { value: "local-life", get label() { return t("profile.industry_local_life"); } },
  { value: "fnb", get label() { return t("profile.industry_fnb"); } },
  { value: "hospitality", get label() { return t("profile.industry_hospitality"); } },
  // Logistics & manufacturing
  { value: "logistics", get label() { return t("profile.industry_logistics"); } },
  { value: "warehousing", get label() { return t("profile.industry_warehousing"); } },
  { value: "express", get label() { return t("profile.industry_express"); } },
  { value: "freight", get label() { return t("profile.industry_freight"); } },
  { value: "cold-chain", get label() { return t("profile.industry_cold_chain"); } },
  { value: "customs-trade", get label() { return t("profile.industry_customs_trade"); } },
  { value: "procurement", get label() { return t("profile.industry_procurement"); } },
  { value: "manufacturing", get label() { return t("profile.industry_manufacturing"); } },
  { value: "automotive", get label() { return t("profile.industry_automotive"); } },
  { value: "electronics-mfg", get label() { return t("profile.industry_electronics_mfg"); } },
  { value: "machinery", get label() { return t("profile.industry_machinery"); } },
  { value: "chemicals", get label() { return t("profile.industry_chemicals"); } },
  { value: "materials", get label() { return t("profile.industry_materials"); } },
  // Content & media
  { value: "media", get label() { return t("profile.industry_media"); } },
  { value: "content-creation", get label() { return t("profile.industry_content_creation"); } },
  { value: "advertising", get label() { return t("profile.industry_advertising"); } },
  { value: "short-video", get label() { return t("profile.industry_short_video"); } },
  { value: "livestream-media", get label() { return t("profile.industry_livestream_media"); } },
  { value: "publishing", get label() { return t("profile.industry_publishing"); } },
  { value: "film-tv", get label() { return t("profile.industry_film_tv"); } },
  // Finance & professional (no healthcare)
  { value: "finance", get label() { return t("profile.industry_finance"); } },
  { value: "banking", get label() { return t("profile.industry_banking"); } },
  { value: "securities", get label() { return t("profile.industry_securities"); } },
  { value: "insurance", get label() { return t("profile.industry_insurance"); } },
  { value: "asset-management", get label() { return t("profile.industry_asset_management"); } },
  { value: "fintech", get label() { return t("profile.industry_fintech"); } },
  { value: "accounting", get label() { return t("profile.industry_accounting"); } },
  { value: "legal-services", get label() { return t("profile.industry_legal_services"); } },
  { value: "consulting", get label() { return t("profile.industry_consulting"); } },
  { value: "hr-services", get label() { return t("profile.industry_hr_services"); } },
  // Education & public
  { value: "education", get label() { return t("profile.industry_education"); } },
  { value: "k12", get label() { return t("profile.industry_k12"); } },
  { value: "higher-ed", get label() { return t("profile.industry_higher_ed"); } },
  { value: "vocational", get label() { return t("profile.industry_vocational"); } },
  { value: "edtech", get label() { return t("profile.industry_edtech"); } },
  { value: "training", get label() { return t("profile.industry_training"); } },
  { value: "government", get label() { return t("profile.industry_government"); } },
  { value: "public-service", get label() { return t("profile.industry_public_service"); } },
  { value: "nonprofit", get label() { return t("profile.industry_nonprofit"); } },
  // Travel & lifestyle (no real-estate / food-primary)
  { value: "travel", get label() { return t("profile.industry_travel"); } },
  { value: "transport-passenger", get label() { return t("profile.industry_transport_passenger"); } },
  { value: "aviation", get label() { return t("profile.industry_aviation"); } },
  { value: "sports", get label() { return t("profile.industry_sports"); } },
  // Solo / other
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
