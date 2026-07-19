/**
 * Rank and lightly personalize assistant prompt templates from onboarding profile.
 * Pure helpers — no React / window.
 */

import type { ComponentType } from "react";

import { t } from "../../../../i18n";
import { canonicalizeProfileOptionValue } from "../../shared/personalization/profile-option-aliases";

export type PersonalizationProfileLite = {
  roles?: string[] | null;
  industries?: string[] | null;
  tools?: string[] | null;
  tasks?: string[] | null;
  docPreference?: "data" | "narrative" | "" | null;
};

export type AssistantScenarioLike = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  prompts: string[];
};

export type PersonalizedAssistantScenario = AssistantScenarioLike & {
  /** True when score is above the personalization threshold. */
  recommended: boolean;
  score: number;
};

function normalizeList(values: string[] | null | undefined): string[] {
  if (!values?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = canonicalizeProfileOptionValue(String(raw ?? "").trim());
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Profile task / role / industry / tool signals → scenario score.
 * Higher = more relevant for this user.
 */
const SCENARIO_SIGNALS: Record<
  string,
  {
    tasks?: string[];
    roles?: string[];
    industries?: string[];
    tools?: string[];
    docPreference?: Array<"data" | "narrative">;
  }
> = {
  "daily-dev": {
    tasks: ["code"],
    roles: ["technology"],
    tools: ["codex", "claude-code", "github", "vscode"],
    industries: ["internet", "hardware"],
  },
  "website-dev": {
    tasks: ["code", "content-ops"],
    roles: ["technology", "product"],
    tools: ["vscode", "github"],
  },
  "agent-app": {
    tasks: ["code"],
    roles: ["technology", "product"],
    tools: ["codex", "claude-code"],
  },
  "skill-dev": {
    tasks: ["code"],
    roles: ["technology"],
    tools: ["codex", "claude-code"],
  },
  "ci-cd": {
    tasks: ["code", "quality-check"],
    roles: ["technology"],
    tools: ["github"],
  },
  docs: {
    tasks: ["weekly-report", "meeting-notes", "code"],
    roles: ["technology", "product"],
  },
  slides: {
    tasks: ["weekly-report", "campaign", "content-ops", "sales-pipeline"],
    roles: ["operations", "sales", "management", "product"],
    docPreference: ["narrative"],
  },
  "deep-research": {
    tasks: ["daily-brief", "study-plan", "campaign", "data-analysis"],
    roles: ["product", "operations", "teacher", "student"],
    industries: ["education", "consulting", "media"],
  },
  documents: {
    tasks: [
      "meeting-notes",
      "email-drafting",
      "weekly-report",
      "contract-review",
      "customer-communication",
    ],
    roles: ["operations", "hr", "management", "sales", "finance"],
    docPreference: ["narrative"],
  },
  "data-analysis": {
    tasks: ["data-analysis", "recon", "inventory", "sales-pipeline"],
    roles: ["technology", "operations", "finance", "product"],
    tools: ["excel", "wps"],
    docPreference: ["data"],
  },
  finance: {
    tasks: ["recon", "compliance", "sales-pipeline"],
    roles: ["finance", "management"],
    industries: ["finance"],
  },
};

function scoreScenario(
  scenarioId: string,
  profile: {
    tasks: string[];
    roles: string[];
    industries: string[];
    tools: string[];
    docPreference: "data" | "narrative" | "";
  },
): number {
  const signals = SCENARIO_SIGNALS[scenarioId];
  if (!signals) return 0;
  let score = 0;
  for (const task of signals.tasks ?? []) {
    if (profile.tasks.includes(task)) score += 10;
  }
  for (const role of signals.roles ?? []) {
    if (profile.roles.includes(role)) score += 5;
  }
  for (const industry of signals.industries ?? []) {
    if (profile.industries.includes(industry)) score += 8;
  }
  for (const tool of signals.tools ?? []) {
    if (profile.tools.includes(tool)) score += 3;
  }
  if (
    profile.docPreference &&
    signals.docPreference?.includes(profile.docPreference)
  ) {
    score += 4;
  }
  return score;
}

function profileLabel(
  kind: "industry" | "role" | "task",
  value: string,
): string {
  const key =
    kind === "industry"
      ? `profile.industry_${value.replace(/-/g, "_")}`
      : kind === "role"
        ? `profile.role_${value.replace(/-/g, "_")}`
        : `profile.task_${value.replace(/-/g, "_")}`;
  // t() falls back to key when missing — avoid showing raw keys.
  const label = t(key as never);
  if (!label || label === key || label.startsWith("profile.")) return value;
  return label;
}

/**
 * Light text personalization: ground generic placeholders in the user's domain.
 */
export function personalizePromptText(
  prompt: string,
  profile: PersonalizationProfileLite,
): string {
  const industries = normalizeList(profile.industries);
  const roles = normalizeList(profile.roles);
  const industryLabel = industries[0]
    ? profileLabel("industry", industries[0])
    : "";
  const roleLabel = roles[0] ? profileLabel("role", roles[0]) : "";
  const domain = industryLabel || roleLabel;
  if (!domain) return prompt;

  return prompt
    .replace(/【主题】/g, `【${domain}相关主题】`)
    .replace(/【研究主题】/g, `【${domain}相关课题】`)
    .replace(/【页面主题】/g, `【${domain}相关页面】`)
    .replace(/【功能描述】/g, `【与${domain}相关的功能】`)
    .replace(/【任务场景】/g, `【${domain}任务场景】`)
    .replace(/【行业\/公司】/g, `【${domain}】`)
    .replace(/【核心指标】/g, `【${domain}核心指标】`)
    .replace(/\[topic\]/gi, `[${domain} topic]`)
    .replace(/\[core metrics\]/gi, `[${domain} core metrics]`);
}

/**
 * Reorder scenarios by profile fit and personalize prompt copy.
 * When the profile is empty/skipped, keeps original order with no recommendations.
 */
export function personalizeAssistantScenarios(
  scenarios: readonly AssistantScenarioLike[],
  profile: PersonalizationProfileLite | null | undefined,
): PersonalizedAssistantScenario[] {
  const tasks = normalizeList(profile?.tasks);
  const roles = normalizeList(profile?.roles);
  const industries = normalizeList(profile?.industries);
  const tools = normalizeList(profile?.tools);
  const docPreference =
    profile?.docPreference === "data" || profile?.docPreference === "narrative"
      ? profile.docPreference
      : "";
  const hasSignal =
    tasks.length + roles.length + industries.length + tools.length > 0
    || Boolean(docPreference);

  const ranked = scenarios.map((scenario, index) => {
    const score = hasSignal
      ? scoreScenario(scenario.id, {
          tasks,
          roles,
          industries,
          tools,
          docPreference,
        })
      : 0;
    const prompts = hasSignal
      ? scenario.prompts.map((prompt) =>
          personalizePromptText(prompt, {
            tasks,
            roles,
            industries,
            tools,
            docPreference,
          }),
        )
      : [...scenario.prompts];
    return {
      ...scenario,
      prompts,
      score,
      recommended: false,
      /** stable original index for tie-break */
      _index: index,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a._index - b._index;
  });

  // Mark top matches as recommended (need a real signal).
  const topScore = ranked[0]?.score ?? 0;
  const recommendThreshold = Math.max(8, Math.floor(topScore * 0.55));
  let recommendedCount = 0;
  for (const row of ranked) {
    if (
      hasSignal
      && row.score >= recommendThreshold
      && row.score > 0
      && recommendedCount < 3
    ) {
      row.recommended = true;
      recommendedCount += 1;
    }
  }

  return ranked.map(({ _index: _i, ...rest }) => rest);
}
