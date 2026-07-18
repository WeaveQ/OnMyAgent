import { describe, expect, test } from "bun:test";

import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplatesForScene,
  isAutomationScheduleTime,
} from "../src/react-app/domains/messaging/automation-model";

// Keep form helpers smoke-tested via source string contracts — full form validation
// lives in automation-page.tsx and is exercised through product UI.

describe("automation templates", () => {
  test("keeps office and code scene templates separated", () => {
    const officeTemplates = getAutomationTemplatesForScene("office");
    const codeTemplates = getAutomationTemplatesForScene("code");

    expect(officeTemplates.length).toBeGreaterThan(0);
    expect(codeTemplates.length).toBeGreaterThan(0);
    expect(officeTemplates.every((template) => template.category === "office" || template.category === "shared")).toBe(true);
    expect(codeTemplates.every((template) => template.category === "code" || template.category === "shared")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "logistics-dispatch-brief")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "logistics-weekly-ops-report")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "daily-ai-news")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "weekly-work-report")).toBe(true);
    expect(officeTemplates.some((template) => template.id === "meeting-prep")).toBe(true);
    expect(officeTemplates.filter((template) => template.id.startsWith("logistics-")).length).toBeGreaterThanOrEqual(4);
    expect(officeTemplates.filter((template) => !template.id.startsWith("logistics-")).length).toBeGreaterThanOrEqual(4);
    expect(officeTemplates.some((template) => template.id === "code-daily-review")).toBe(false);
    expect(codeTemplates.some((template) => template.id === "code-daily-review")).toBe(true);
    expect(codeTemplates.some((template) => template.id === "logistics-dispatch-brief")).toBe(false);
  });

  test("defines prompt and description keys for every built-in template", () => {
    for (const template of AUTOMATION_TEMPLATES) {
      expect(template.titleKey).toStartWith("automation.template_");
      expect(template.descriptionKey).toStartWith("automation.template_");
      expect(template.promptKey).toStartWith("automation.template_");
      expect(isAutomationScheduleTime(template.defaultSchedule.time)).toBe(true);
    }
  });

  test("office logistics templates resolve title keys in zh locale catalog", async () => {
    const zh = await import("../src/i18n/locales/zh/automation");
    const officeTemplates = getAutomationTemplatesForScene("office");
    for (const template of officeTemplates) {
      const title = (zh.default as Record<string, string>)[template.titleKey];
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
      const desc = (zh.default as Record<string, string>)[template.descriptionKey];
      expect(typeof desc).toBe("string");
      const prompt = (zh.default as Record<string, string>)[template.promptKey];
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(20);
    }
  });

  test("validates schedule time strings", () => {
    expect(isAutomationScheduleTime("00:00")).toBe(true);
    expect(isAutomationScheduleTime("09:30")).toBe(true);
    expect(isAutomationScheduleTime("23:59")).toBe(true);
    expect(isAutomationScheduleTime("24:00")).toBe(false);
    expect(isAutomationScheduleTime("12:60")).toBe(false);
    expect(isAutomationScheduleTime("9:30")).toBe(false);
    expect(isAutomationScheduleTime("noon")).toBe(false);
  });
});
