/**
 * Build createAutomation payloads from templates (pure; no network).
 * Does not import messaging domain — callers pass template-shaped objects.
 */

import type { AutomationTaskInput } from "@onmyagent/types";
import type { PersonalizationPlan } from "./plan";

export type PersonalizationTemplateLike = {
  id: string;
  titleKey: string;
  promptKey: string;
  defaultSchedule: {
    mode: AutomationTaskInput["schedule"]["mode"];
    day: AutomationTaskInput["schedule"]["day"];
    time: string;
  };
};

export type AutomationSceneInput = AutomationTaskInput["scene"];

export function automationPayloadFromTemplate(
  scene: AutomationSceneInput,
  template: PersonalizationTemplateLike,
  resolveText: (key: string) => string,
): AutomationTaskInput {
  return {
    scene,
    title: resolveText(template.titleKey),
    prompt: resolveText(template.promptKey),
    workspaceDirectory: null,
    model: null,
    agent: null,
    accessMode: "default",
    schedule: {
      mode: template.defaultSchedule.mode,
      day: template.defaultSchedule.day,
      time: template.defaultSchedule.time,
    },
    enabled: true,
  };
}

/**
 * Select templates to auto-create: plan.defaultAutoCreateTemplateIds that exist
 * in `templates` and are not already present by id in `existingTemplateIds`.
 */
export function selectTemplatesToCreate<T extends PersonalizationTemplateLike>(
  plan: PersonalizationPlan,
  templates: readonly T[],
  existingTemplateIdsOrTitles: ReadonlySet<string>,
): T[] {
  const byId = new Map(templates.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const id of plan.defaultAutoCreateTemplateIds) {
    const template = byId.get(id);
    if (!template) continue;
    if (
      existingTemplateIdsOrTitles.has(id) ||
      existingTemplateIdsOrTitles.has(template.titleKey)
    ) {
      continue;
    }
    out.push(template);
  }
  return out;
}
