import type { OpenworkWorkspaceFileContent } from "../../../app/lib/onmyagent-server";
import { t } from "@/i18n";
import type {
  AgentAvatarOption,
  AgentCardItem,
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentTemplate,
} from "../shared/agent-registry-types";
export type { AgentCardItem } from "../shared/agent-registry-types";

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

export const STEP_PERCENT: Record<Exclude<WizardStep, 0>, number> = {
  1: 18,
  2: 36,
  3: 56,
  4: 76,
  5: 100,
};

export const STEP_TITLE: Record<Exclude<WizardStep, 0>, string> = {
  get 1() { return t("agents.step_identity"); },
  get 2() { return t("agents.step_tools"); },
  get 3() { return t("agents.step_skills"); },
  get 4() { return t("agents.step_user_preferences"); },
  get 5() { return t("agents.step_mind"); },
};

export const AVATARS_PER_STYLE = 5;

const GENERATED_AVATAR_PALETTE = [
  { background: "#d7ecf8", foreground: "#16324f", accent: "#6fb3d8" },
  { background: "#e1e2f0", foreground: "#42475f", accent: "#969cc0" },
  { background: "#ffe1c7", foreground: "#6d3b1f", accent: "#efb37a" },
  { background: "#cceaf5", foreground: "#174767", accent: "#62b8d5" },
  { background: "#ddefc8", foreground: "#355a18", accent: "#97c86b" },
];

function localizedTemplateName(id: AgentTemplate["id"]) {
  switch (id) {
    case "blank-agent":
      return t("agents.template_blank_agent_name");
    case "daily-assistant":
      return t("agents.template_daily_assistant_name");
    case "shopify-operator":
      return t("agents.template_shopify_operator_name");
    case "dropshipping-helper":
      return t("agents.template_dropshipping_helper_name");
    case "engineering-helper":
      return t("agents.template_engineering_helper_name");
    case "commerce-expert":
      return t("agents.template_commerce_expert_name");
    case "finance-expert":
      return t("agents.template_finance_expert_name");
    case "product-manager":
      return t("agents.template_product_manager_name");
    case "tl":
      return t("agents.template_tl_name");
    case "design-expert":
      return t("agents.template_design_expert_name");
    case "product-expert":
      return t("agents.template_product_expert_name");
    case "business-expert":
      return t("agents.template_business_expert_name");
    default:
      return null;
  }
}

function localizedTemplateDescription(id: AgentTemplate["id"]) {
  switch (id) {
    case "blank-agent":
      return t("agents.template_blank_agent_desc");
    case "daily-assistant":
      return t("agents.template_daily_assistant_desc");
    case "shopify-operator":
      return t("agents.template_shopify_operator_desc");
    case "dropshipping-helper":
      return t("agents.template_dropshipping_helper_desc");
    case "engineering-helper":
      return t("agents.template_engineering_helper_desc");
    case "commerce-expert":
      return t("agents.template_commerce_expert_desc");
    case "finance-expert":
      return t("agents.template_finance_expert_desc");
    case "product-manager":
      return t("agents.template_product_manager_desc");
    case "tl":
      return t("agents.template_tl_desc");
    case "design-expert":
      return t("agents.template_design_expert_desc");
    case "product-expert":
      return t("agents.template_product_expert_desc");
    case "business-expert":
      return t("agents.template_business_expert_desc");
    default:
      return null;
  }
}

export function normalizeAgentCardItem(item: AgentCardItem) {
  const source = item.kind === "template" ? item.template : item.agent;
  const templateName =
    item.kind === "template" ? localizedTemplateName(item.template.id) : null;
  const templateDescription =
    item.kind === "template" ? localizedTemplateDescription(item.template.id) : null;
  return {
    id: source.id,
    name: templateName ?? source.name,
    description: templateDescription ?? source.description,
    avatarStyle: source.avatarStyle,
    avatarOptionId: source.avatarOptionId,
    customAvatarDataUrl:
      item.kind === "custom" ? item.agent.customAvatarDataUrl : null,
    source,
  };
}

export function describeRequestError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function readWorkspaceFileUpdatedAt(result: OpenworkWorkspaceFileContent) {
  return typeof result.updatedAt === "number" ? result.updatedAt : null;
}

export function nextStep(step: WizardStep): WizardStep {
  switch (step) {
    case 0:
      return 1;
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 5;
    case 5:
      return 5;
  }
}

export function previousStep(step: WizardStep): WizardStep {
  switch (step) {
    case 5:
      return 4;
    case 4:
      return 3;
    case 3:
      return 2;
    case 2:
      return 1;
    case 1:
      return 0;
    case 0:
      return 0;
  }
}

export function nextStepTitle(step: WizardStep) {
  const next = nextStep(step);
  if (next === 0) return "";
  return STEP_TITLE[next];
}

export function createGeneratedAvatarOption(
  style: AgentAvatarOption["style"],
  page: number,
  index: number,
): AgentAvatarOption {
  const ordinal = page * AVATARS_PER_STYLE + index + 1;
  const palette =
    GENERATED_AVATAR_PALETTE[
      (page * AVATARS_PER_STYLE + index) % GENERATED_AVATAR_PALETTE.length
    ];
  return {
    id: `generated:${style}:${page}:${index}`,
    style,
    label: `${style}-${ordinal}`,
    initials: style.slice(0, 2),
    background: palette.background,
    foreground: palette.foreground,
    accent: palette.accent,
  };
}

export function parseGeneratedAvatarOptionId(id: string) {
  const match = /^generated:(像素风|冒险家|机器人|洛蕾莱):(\d+):(\d+)$/.exec(
    id,
  );
  if (!match) return null;
  const style = match[1] as AgentAvatarOption["style"];
  const page = Number.parseInt(match[2], 10);
  const index = Number.parseInt(match[3], 10);
  if (Number.isNaN(page) || Number.isNaN(index)) return null;
  return { style, page, index };
}

export function buildVisibleAvatarOptions(
  registry: AgentRegistry,
  style: AgentAvatarOption["style"],
  page: number,
) {
  if (page === 0) {
    const defaults = registry.avatars
      .filter((item) => item.style === style)
      .slice(0, AVATARS_PER_STYLE);
    const filled = [...defaults];
    while (filled.length < AVATARS_PER_STYLE) {
      filled.push(createGeneratedAvatarOption(style, 0, filled.length));
    }
    return filled;
  }
  return Array.from({ length: AVATARS_PER_STYLE }, (_, index) =>
    createGeneratedAvatarOption(style, page, index),
  );
}

export function avatarSeed(option: AgentAvatarOption, fallbackSeed?: string) {
  return option.label || fallbackSeed || option.id;
}

export function matchesAgentSearch(item: AgentCardItem, query: string) {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return true;
  const haystack =
    item.kind === "template"
      ? `${item.template.name} ${item.template.description}`.toLowerCase()
      : `${item.agent.name} ${item.agent.description}`.toLowerCase();
  return haystack.includes(lowered);
}

export function isAgentTemplateVisible(template: AgentTemplate) {
  return template.showInOverview;
}

export function isAgentTemplateWizardVisible(template: AgentTemplate) {
  return (
    template.id === "blank-agent" ||
    template.showInWizard
  );
}

export function buildGroupedSkills(input: {
  skills: readonly AgentSkillItem[];
  search: string;
  scopeOrder: string[];
}) {
  const map = new Map<string, AgentSkillItem[]>();
  const lowered = input.search.trim().toLowerCase();
  for (const skill of input.skills) {
    if (!skill.enabled) continue;
    if (lowered) {
      const haystack =
        `${skill.category} ${skill.group} ${skill.name} ${skill.description}`.toLowerCase();
      if (!haystack.includes(lowered)) continue;
    }
    const key = skill.category;
    const list = map.get(key) ?? [];
    list.push(skill);
    map.set(key, list);
  }
  const entries = Array.from(map.entries()).map(([key, skills]) => ({
    category: key,
    group: "",
    skills,
  }));
  entries.sort((a, b) => {
    const ai = input.scopeOrder.indexOf(a.category);
    const bi = input.scopeOrder.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return entries;
}
