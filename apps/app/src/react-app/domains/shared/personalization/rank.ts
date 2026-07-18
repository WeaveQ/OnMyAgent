/**
 * Pure helpers: rank automation templates / experts for a personalization plan.
 */

import type { PersonalizationPlan } from "./plan";

export type RankableTemplate = {
  id: string;
  verticalIds?: string[];
  roleTags?: string[];
  taskTags?: string[];
};

/**
 * Stable rank: recommended (from plan.automations order) first, then the rest
 * in original order. Scene filtering is caller's responsibility.
 */
export function rankTemplatesForPlan<T extends RankableTemplate>(
  templates: readonly T[],
  plan: PersonalizationPlan | null,
): { recommended: T[]; rest: T[] } {
  if (!plan) {
    return { recommended: [], rest: [...templates] };
  }
  const byId = new Map(templates.map((item) => [item.id, item]));
  const recommended: T[] = [];
  const seen = new Set<string>();
  for (const rec of plan.automations) {
    const hit = byId.get(rec.templateId);
    if (!hit || seen.has(hit.id)) continue;
    recommended.push(hit);
    seen.add(hit.id);
  }
  const rest = templates.filter((item) => !seen.has(item.id));
  return { recommended, rest };
}

export function planFingerprint(plan: PersonalizationPlan): string {
  return [
    plan.primaryVerticalId,
    plan.workbench,
    plan.defaultAutoCreateTemplateIds.join(","),
    plan.defaultAutoInstallExpert ?? "",
  ].join("|");
}

export const PERSONALIZATION_APPLIED_STORAGE_KEY =
  "onmyagent.personalization.appliedPlan.v1";

export function readAppliedPlanFingerprint(
  workspaceId: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSONALIZATION_APPLIED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const value = parsed[workspaceId];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function writeAppliedPlanFingerprint(
  workspaceId: string,
  fingerprint: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PERSONALIZATION_APPLIED_STORAGE_KEY);
    const parsed =
      raw && typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, string>)
        : {};
    parsed[workspaceId] = fingerprint;
    window.localStorage.setItem(
      PERSONALIZATION_APPLIED_STORAGE_KEY,
      JSON.stringify(parsed),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function shouldOfferPersonalizationApply(
  workspaceId: string,
  plan: PersonalizationPlan | null,
): boolean {
  if (!plan || !workspaceId.trim()) return false;
  if (plan.defaultAutoCreateTemplateIds.length === 0 && !plan.defaultAutoInstallExpert) {
    return false;
  }
  const applied = readAppliedPlanFingerprint(workspaceId);
  return applied !== planFingerprint(plan);
}
