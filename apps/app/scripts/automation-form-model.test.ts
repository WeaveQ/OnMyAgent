/**
 * Contract tests for shipped automation form helpers (no page mount).
 */
import { describe, expect, test } from "bun:test";

import {
  createEmptyFormState,
  formStateFromAutomation,
  hasAutomationModel,
  intervalMinutes,
  intervalParts,
  isFormValid,
  isScheduleValid,
  nextRunLabel,
  onceAt,
  optimizeAutomationPrompt,
  scheduleLabel,
  workspaceDirectoryLabel,
} from "../src/react-app/domains/messaging/automation-form-model";

describe("automation form model (shipped)", () => {
  test("createEmptyFormState defaults and hasAutomationModel", () => {
    const empty = createEmptyFormState(null);
    expect(empty.frequencyMode).toBe("weekly");
    expect(empty.time).toBe("09:00");
    expect(hasAutomationModel(null)).toBe(false);
    expect(hasAutomationModel({ providerID: "p", modelID: "m" })).toBe(true);
    expect(hasAutomationModel({ providerID: "  ", modelID: "m" })).toBe(false);
  });

  test("intervalParts and intervalMinutes round-trip hours and days", () => {
    expect(intervalParts(120)).toEqual({ intervalValue: "2", intervalUnit: "hours" });
    expect(intervalParts(24 * 60)).toEqual({ intervalValue: "1", intervalUnit: "days" });
    expect(intervalParts(45)).toEqual({ intervalValue: "45", intervalUnit: "minutes" });

    const form = {
      ...createEmptyFormState({ providerID: "p", modelID: "m" }),
      frequencyMode: "interval" as const,
      intervalValue: "2",
      intervalUnit: "hours" as const,
      weekdays: [1, 2, 3, 4, 5],
    };
    expect(intervalMinutes(form)).toBe(120);
    expect(isScheduleValid(form)).toBe(true);
  });

  test("once schedule requires future timestamp", () => {
    const now = new Date("2030-06-15T12:00:00").getTime();
    const past = {
      ...createEmptyFormState({ providerID: "p", modelID: "m" }),
      title: "t",
      prompt: "p",
      frequencyMode: "once" as const,
      onceDate: "2030-06-14",
      time: "09:00",
    };
    expect(onceAt(past)).toBeLessThan(now);
    expect(isScheduleValid(past, now)).toBe(false);
    expect(isFormValid(past, now)).toBe(false);

    const future = { ...past, onceDate: "2030-06-16", time: "10:00" };
    expect(isScheduleValid(future, now)).toBe(true);
    expect(isFormValid(future, now)).toBe(true);
  });

  test("formStateFromAutomation maps schedule and range", () => {
    const form = formStateFromAutomation({
      id: "a1",
      title: "Daily dig",
      prompt: "summarize",
      scene: "office",
      enabled: true,
      createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      workspaceDirectory: "/ws",
      model: { providerID: "oc", modelID: "auto" },
      accessMode: "full",
      schedule: {
        mode: "interval",
        day: "daily",
        time: "08:00",
        intervalMinutes: 90,
        weekdays: [1, 3, 5],
      },
      effectiveRange: { startDate: "2026-01-01", endDate: "2026-12-31" },
      runs: [],
    });
    expect(form.title).toBe("Daily dig");
    expect(form.intervalValue).toBe("90");
    expect(form.intervalUnit).toBe("minutes");
    expect(form.weekdays).toEqual([1, 3, 5]);
    expect(form.accessMode).toBe("full");
  });

  test("scheduleLabel and nextRunLabel use real helpers", () => {
    expect(
      scheduleLabel({
        mode: "interval",
        day: "daily",
        time: "09:00",
        intervalMinutes: 120,
      }),
    ).toMatch(/2/);
    const paused = nextRunLabel(
      {
        id: "x",
        title: "t",
        prompt: "p",
        scene: "office",
        enabled: false,
        createdAt: 0,
        schedule: { mode: "weekly", day: "daily", time: "09:00" },
        effectiveRange: {},
        runs: [],
      },
      Date.now(),
    );
    expect(typeof paused).toBe("string");
    expect(paused.length).toBeGreaterThan(0);
  });

  test("optimizeAutomationPrompt structures free text and skips already-optimized", () => {
    const copy = {
      heading: "# Optimized",
      sectionGoal: "## Goal",
      alreadyMarker: "Optimized",
      sectionOutput: "## Output",
      outputStructure: "- structure",
      outputPlaceholder: "- placeholder",
      outputNextSteps: "- next",
      sectionConstraints: "## Constraints",
      constraintNoFabricate: "- no fabricate",
      constraintConfirmRisk: "- confirm risk",
    };
    const raw = "Write a market brief every morning.";
    const next = optimizeAutomationPrompt(raw, copy);
    expect(next).toContain("# Optimized");
    expect(next).toContain(raw);
    expect(optimizeAutomationPrompt(next, copy)).toBe(next);
  });

  test("workspaceDirectoryLabel falls back for empty path", () => {
    expect(workspaceDirectoryLabel("")).toBeTruthy();
    expect(workspaceDirectoryLabel("/Users/me/project")).toBe("project");
  });
});
