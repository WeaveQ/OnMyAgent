import { describe, expect, test } from "bun:test";

import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplatesForScene,
  isAutomationScheduleTime,
} from "../src/react-app/domains/messaging/automation-model";

describe("automation templates", () => {
  test("ships office-only templates (code scene removed)", () => {
    const officeTemplates = getAutomationTemplatesForScene("office");

    expect(officeTemplates.length).toBeGreaterThan(0);
    expect(
      officeTemplates.every(
        (template) => template.category === "office" || template.category === "shared",
      ),
    ).toBe(true);
    expect(AUTOMATION_TEMPLATES.every((template) => template.category !== "code")).toBe(
      true,
    );
    expect(officeTemplates.some((template) => template.id === "logistics-dispatch-brief")).toBe(
      true,
    );
    expect(officeTemplates.some((template) => template.id === "logistics-weekly-ops-report")).toBe(
      true,
    );
    expect(officeTemplates.some((template) => template.id === "daily-ai-news")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "weekly-work-report")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "meeting-prep")).toBe(true);
    expect(
      officeTemplates.filter((template) => template.id.startsWith("logistics-")).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      officeTemplates.filter((template) => !template.id.startsWith("logistics-")).length,
    ).toBeGreaterThanOrEqual(4);
    expect(officeTemplates.some((template) => template.id.startsWith("code-"))).toBe(false);
  });

  test("defines prompt and description keys for every built-in template", () => {
    for (const template of AUTOMATION_TEMPLATES) {
      expect(template.titleKey).toStartWith("automation.template_");
      expect(template.descriptionKey).toStartWith("automation.template_");
      expect(template.promptKey).toStartWith("automation.template_");
      expect(isAutomationScheduleTime(template.defaultSchedule.time)).toBe(true);
    }
  });
});
