/**
 * Pure profile → PersonalizationPlan. No I/O.
 * Scoring: industry > role > task > tool.
 */

import {
  FORBIDDEN_VERTICAL_IDS,
  PERSONALIZATION_VERTICALS,
  type PersonalizationVertical,
  type PersonalizationVerticalId,
  isForbiddenVerticalId,
} from "./verticals";

export type PersonalizationProfileSnapshot = {
  roles?: string[] | null;
  industries?: string[] | null;
  tools?: string[] | null;
  tasks?: string[] | null;
};

export type PersonalizationExpertRec = {
  packageName: string;
  priority: number;
  autoInstall: boolean;
};

export type PersonalizationAutomationRec = {
  templateId: string;
  priority: number;
  autoCreate: boolean;
};

export type PersonalizationPlan = {
  primaryVerticalId: PersonalizationVerticalId;
  secondaryVerticalIds: PersonalizationVerticalId[];
  workbench: "office" | "code";
  experts: PersonalizationExpertRec[];
  automations: PersonalizationAutomationRec[];
  /** Max 3 template ids suggested for default auto-create. */
  defaultAutoCreateTemplateIds: string[];
  /** Single expert package suggested for default auto-install. */
  defaultAutoInstallExpert: string | null;
  scores: Record<string, number>;
};

const DEFAULT_VERTICAL: PersonalizationVerticalId = "software-product";

/** Manufacturing + operations (or logistics-ops roles) may surface logistics. */
function manufacturingBoostsLogistics(profile: PersonalizationProfileSnapshot): boolean {
  const industries = normalizeList(profile.industries);
  const roles = normalizeList(profile.roles);
  const tasks = normalizeList(profile.tasks);
  if (!industries.includes("manufacturing")) return false;
  return (
    roles.some((r) =>
      ["operations", "logistics-ops", "supply-chain", "warehouse", "procurement"].includes(r),
    ) || tasks.some((t) => ["dispatch", "recon", "inventory", "daily-brief"].includes(t))
  );
}

function normalizeList(values: string[] | null | undefined): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    // Never accept forbidden industry tokens as profile input for scoring paths
    // that only exist for removed verticals.
    if (
      v === "healthcare" ||
      v === "energy" ||
      v === "new-energy" ||
      v === "real-estate" ||
      v === "property-mgmt" ||
      v === "construction" ||
      v === "agriculture" ||
      v === "aquaculture" ||
      v === "food-beverage"
    ) {
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

function scoreVertical(
  vertical: PersonalizationVertical,
  profile: PersonalizationProfileSnapshot,
): number {
  const industries = normalizeList(profile.industries);
  const roles = normalizeList(profile.roles);
  const tasks = normalizeList(profile.tasks);
  const tools = normalizeList(profile.tools);

  let score = 0;
  for (const industry of industries) {
    if (vertical.industries.includes(industry)) score += 10;
  }
  for (const role of roles) {
    if (vertical.roles.includes(role)) score += 5;
  }
  for (const task of tasks) {
    if (vertical.tasks.includes(task)) score += 3;
  }
  for (const tool of tools) {
    if (vertical.tools.includes(tool)) score += 2;
  }

  // Heuristic: manufacturing + ops-ish → logistics-supply
  if (
    vertical.id === "logistics-supply" &&
    manufacturingBoostsLogistics(profile)
  ) {
    score += 8;
  }

  // Default pull toward software when only technology role is set
  if (
    vertical.id === "software-product" &&
    roles.includes("technology") &&
    industries.length === 0
  ) {
    score += 4;
  }

  // OPC role alone
  if (vertical.id === "solo-opc" && roles.includes("opc") && industries.length === 0) {
    score += 6;
  }

  return score;
}

function pickWorkbench(
  vertical: PersonalizationVertical,
  profile: PersonalizationProfileSnapshot,
): "office" | "code" {
  const roles = normalizeList(profile.roles);
  const tasks = normalizeList(profile.tasks);
  const tools = normalizeList(profile.tools);
  if (tasks.includes("code") || tools.includes("codex") || tools.includes("claude-code")) {
    return "code";
  }
  if (roles.includes("technology") && vertical.defaultWorkbench === "code") {
    return "code";
  }
  return vertical.defaultWorkbench;
}

/**
 * Build a ranked personalization plan from an onboarding/settings profile snapshot.
 */
export function buildPersonalizationPlan(
  profile: PersonalizationProfileSnapshot,
  options?: { maxAutoCreate?: number; maxExperts?: number },
): PersonalizationPlan {
  const maxAutoCreate = options?.maxAutoCreate ?? 3;
  const maxExperts = options?.maxExperts ?? 6;

  const scored = PERSONALIZATION_VERTICALS.map((vertical) => ({
    vertical,
    score: scoreVertical(vertical, profile),
  })).sort((a, b) => b.score - a.score || a.vertical.id.localeCompare(b.vertical.id));

  const scores: Record<string, number> = {};
  for (const row of scored) scores[row.vertical.id] = row.score;

  const top = scored[0];
  const primaryVertical =
    top && top.score > 0
      ? top.vertical
      : PERSONALIZATION_VERTICALS.find((v) => v.id === DEFAULT_VERTICAL) ??
        PERSONALIZATION_VERTICALS[0];

  if (isForbiddenVerticalId(primaryVertical.id)) {
    throw new Error(`Forbidden vertical selected: ${primaryVertical.id}`);
  }

  const secondaryVerticalIds = scored
    .filter((row) => row.vertical.id !== primaryVertical.id && row.score > 0)
    .slice(0, 2)
    .map((row) => row.vertical.id);

  // Merge secondary template hints at lower priority for ranking diversity
  const templatePriority = new Map<string, number>();
  primaryVertical.templateIds.forEach((id, index) => {
    templatePriority.set(id, 100 - index);
  });
  for (const secId of secondaryVerticalIds) {
    const sec = PERSONALIZATION_VERTICALS.find((v) => v.id === secId);
    sec?.templateIds.forEach((id, index) => {
      const prev = templatePriority.get(id) ?? 0;
      templatePriority.set(id, Math.max(prev, 40 - index));
    });
  }

  // Task-based boosts for shared templates
  const tasks = normalizeList(profile.tasks);
  if (tasks.includes("weekly-report")) {
    templatePriority.set(
      "weekly-work-report",
      (templatePriority.get("weekly-work-report") ?? 0) + 15,
    );
  }
  if (tasks.includes("meeting-notes")) {
    templatePriority.set("meeting-prep", (templatePriority.get("meeting-prep") ?? 0) + 15);
  }
  if (tasks.includes("code")) {
    templatePriority.set(
      "code-daily-review",
      (templatePriority.get("code-daily-review") ?? 0) + 20,
    );
  }
  if (tasks.includes("dispatch")) {
    for (const id of [
      "logistics-dispatch-brief",
      "logistics-exception-followup",
      "logistics-in-transit-risk",
    ]) {
      templatePriority.set(id, (templatePriority.get(id) ?? 0) + 12);
    }
  }
  if (tasks.includes("recon")) {
    templatePriority.set(
      "logistics-recon-reminder",
      (templatePriority.get("logistics-recon-reminder") ?? 0) + 12,
    );
  }

  const automations: PersonalizationAutomationRec[] = [...templatePriority.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([templateId, priority], index) => ({
      templateId,
      priority,
      autoCreate: index < maxAutoCreate,
    }));

  const defaultAutoCreateTemplateIds = automations
    .filter((item) => item.autoCreate)
    .map((item) => item.templateId);

  const experts: PersonalizationExpertRec[] = primaryVertical.featuredExperts
    .slice(0, maxExperts)
    .map((packageName, index) => ({
      packageName,
      priority: 100 - index,
      autoInstall: index === 0,
    }));

  return {
    primaryVerticalId: primaryVertical.id,
    secondaryVerticalIds,
    workbench: pickWorkbench(primaryVertical, profile),
    experts,
    automations,
    defaultAutoCreateTemplateIds,
    defaultAutoInstallExpert: experts[0]?.packageName ?? null,
    scores,
  };
}

export function listPersonalizationVerticalIds(): PersonalizationVerticalId[] {
  return PERSONALIZATION_VERTICALS.map((v) => v.id);
}

export function assertNoForbiddenVerticalsInCatalog(): void {
  for (const vertical of PERSONALIZATION_VERTICALS) {
    if (isForbiddenVerticalId(vertical.id)) {
      throw new Error(`Catalog contains forbidden vertical: ${vertical.id}`);
    }
  }
  for (const forbidden of FORBIDDEN_VERTICAL_IDS) {
    if (PERSONALIZATION_VERTICALS.some((v) => v.id === forbidden)) {
      throw new Error(`Forbidden id present: ${forbidden}`);
    }
  }
}
