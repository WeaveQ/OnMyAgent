import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  automationStorePath,
  bindAutomationRunSession,
  claimDueAutomation,
  claimManualAutomation,
  createAutomation,
  listAutomationRuns,
  listAutomations,
  nextRunAt,
  parseAutomationPromptCommand,
  recordOverlappingAutomationSkips,
  recordAutomationRun,
  reconcileAutomationRunSuccess,
  runAutomationManually,
  updateAutomation,
} from "../src/services/automations.js";

function localDateString(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

describe("automations", () => {
  test("parses slash commands selected from automation prompt tools", () => {
    expect(parseAutomationPromptCommand("/review inspect the latest changes")).toEqual({
      name: "review",
      arguments: "inspect the latest changes",
    });
    expect(parseAutomationPromptCommand("Summarize the latest changes")).toBeNull();
  });

  test("creates and persists workspace automation tasks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));

    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Daily report",
      prompt: "Summarize today's work.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    expect(task.id).toStartWith("automation-");
    expect(task.enabled).toBe(true);
    expect(task.nextRunAt).toBeNumber();
    expect(task.running).toBeNull();
    expect(task.runs).toEqual([]);

    const listed = await listAutomations(workspace);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: task.id,
      scene: "office",
      title: "Daily report",
      prompt: "Summarize today's work.",
    });

    const raw = await readFile(automationStorePath(workspace), "utf8");
    expect(JSON.parse(raw).items[0].id).toBe(task.id);
  });

  test("updates enabled state and records run summary", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "code",
      title: "Review changes",
      prompt: "Review repository changes.",
      schedule: { mode: "interval", day: "daily", time: "09:00" },
    });

    const disabled = await updateAutomation(workspace, task.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.nextRunAt).toBeNull();

    const updated = await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "manual",
      ranAt: 123,
      sessionId: "ses_123",
    });
    expect(updated?.lastRun).toEqual({
      status: "success",
      source: "manual",
      ranAt: 123,
      sessionId: "ses_123",
    });
    expect(updated?.runs).toEqual([{
      status: "success",
      source: "manual",
      ranAt: 123,
      sessionId: "ses_123",
    }]);
  });

  test("keeps complete run history newest first", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "History",
      prompt: "Track history.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    for (let index = 0; index < 12; index += 1) {
      await recordAutomationRun(workspace, task.id, {
        status: "success",
        source: "scheduled",
        ranAt: index,
        sessionId: `ses_${index}`,
      });
    }

    const listed = await listAutomations(workspace);
    expect(listed[0]?.runs).toHaveLength(12);
    expect(listed[0]?.runs[0]).toMatchObject({ ranAt: 11, sessionId: "ses_11" });
    expect(listed[0]?.runs[11]).toMatchObject({ ranAt: 0, sessionId: "ses_0" });
  });

  test("lists run history for one automation", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "History detail",
      prompt: "Show history.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    await recordAutomationRun(workspace, task.id, {
      status: "failed",
      source: "manual",
      ranAt: 101,
      error: "manual failure",
    });
    await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "scheduled",
      ranAt: 102,
      sessionId: "ses_history",
    });

    const history = await listAutomationRuns(workspace, task.id);
    expect(history.item.id).toBe(task.id);
    expect(history.total).toBe(2);
    expect(history.runs).toEqual([
      { status: "success", source: "scheduled", ranAt: 102, sessionId: "ses_history" },
      { status: "failed", source: "manual", ranAt: 101, error: "manual failure" },
    ]);
  });

  test("records successful manual automation execution", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Manual success",
      prompt: "Run manually.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    const result = await runAutomationManually(workspace, task.id, async (automation) => {
      expect(automation.id).toBe(task.id);
      expect(automation.title).toBe("Manual success");
      expect(automation.prompt).toBe("Run manually.");
      return {
        sessionId: "ses_manual_success",
        groupName: "自动化任务-2026-06-23-09-00-00",
        outputDirectory: join(workspace, "自动化任务-2026-06-23-09-00-00"),
      };
    });

    expect(result.ok).toBe(true);
    expect(result.task.id).toBe(task.id);
    expect(result.item?.lastRun).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_manual_success",
      groupName: "自动化任务-2026-06-23-09-00-00",
    });
    expect((await listAutomationRuns(workspace, task.id)).runs[0]).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_manual_success",
    });
  });

  test("records failed manual automation execution without swallowing the error", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Manual failure",
      prompt: "Fail manually.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const failure = new Error("manual runner failed");

    const result = await runAutomationManually(workspace, task.id, async () => {
      throw failure;
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(failure);
    expect(result.message).toBe("manual runner failed");
    expect(result.item?.lastRun).toMatchObject({
      status: "failed",
      source: "manual",
      error: "manual runner failed",
    });
    expect((await listAutomationRuns(workspace, task.id)).runs[0]).toMatchObject({
      status: "failed",
      source: "manual",
      error: "manual runner failed",
    });
  });

  test("normalizes legacy run records without source", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Legacy",
      prompt: "Read legacy records.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const raw = JSON.parse(await readFile(automationStorePath(workspace), "utf8"));
    raw.items[0] = {
      ...raw.items[0],
      lastRun: { status: "success", ranAt: 100, sessionId: "legacy-last" },
      runs: [
        { status: "success", ranAt: 100, sessionId: "legacy-last" },
        { status: "failed", ranAt: 90, error: "legacy-error" },
      ],
    };
    await Bun.write(automationStorePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);

    const listed = await listAutomations(workspace);
    expect(listed[0]?.id).toBe(task.id);
    expect(listed[0]?.lastRun?.source).toBe("scheduled");
    expect(listed[0]?.runs.map((run) => run.source)).toEqual(["scheduled", "scheduled"]);
  });

  test("normalizes persisted run history order without truncating it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Persisted history",
      prompt: "Read persisted history.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const raw = JSON.parse(await readFile(automationStorePath(workspace), "utf8"));
    raw.items[0] = {
      ...raw.items[0],
      runs: Array.from({ length: 12 }, (_, index) => ({
        status: "success",
        source: "scheduled",
        ranAt: index,
        sessionId: `persisted_${index}`,
      })).reverse(),
    };
    await Bun.write(automationStorePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);

    const listed = await listAutomations(workspace);
    expect(listed[0]?.id).toBe(task.id);
    expect(listed[0]?.runs).toHaveLength(12);
    expect(listed[0]?.runs[0]?.sessionId).toBe("persisted_11");
    expect(listed[0]?.runs[11]?.sessionId).toBe("persisted_0");
  });

  test("rejects persisted automations with out-of-range schedule times", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Bad time",
      prompt: "Invalid persisted time.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const raw = JSON.parse(await readFile(automationStorePath(workspace), "utf8"));
    raw.items[0] = {
      ...raw.items[0],
      id: task.id,
      schedule: { mode: "weekly", day: "daily", time: "24:00" },
    };
    await Bun.write(automationStorePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);

    expect(await listAutomations(workspace)).toEqual([]);
  });

  test("updates task content and schedule", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Draft report",
      prompt: "Draft it.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    const updated = await updateAutomation(workspace, task.id, {
      title: "Final report",
      prompt: "Finalize it.",
      schedule: { mode: "weekly", day: "weekly", time: "17:30" },
    });

    expect(updated).toMatchObject({
      id: task.id,
      title: "Final report",
      prompt: "Finalize it.",
      schedule: { mode: "weekly", day: "weekly", time: "17:30" },
    });
    expect(updated.nextRunAt).toBeNumber();

    const listed = await listAutomations(workspace);
    expect(listed[0]).toMatchObject({
      id: task.id,
      title: "Final report",
      prompt: "Finalize it.",
    });
  });

  test("persists workspace, model, agent, and access mode selections", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const selectedWorkspace = join(workspace, "selected-workspace");
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Configured task",
      prompt: "Run with selected context.",
      workspaceDirectory: selectedWorkspace,
      model: { providerID: "openai", modelID: "gpt-test" },
      agent: {
        id: "finance-expert",
        name: "金融专家",
        description: "Finance helper",
        systemPrompt: "Act as a finance expert.",
        tools: { websearch: true, bash: false },
        model: { providerID: "anthropic", modelID: "claude-test" },
      },
      accessMode: "full",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    expect(task.workspaceDirectory).toBe(selectedWorkspace);
    expect(task.model).toEqual({ providerID: "openai", modelID: "gpt-test" });
    expect(task.agent).toMatchObject({
      id: "finance-expert",
      name: "金融专家",
      tools: { websearch: true, bash: false },
      model: { providerID: "anthropic", modelID: "claude-test" },
    });
    expect(task.accessMode).toBe("full");

    const updated = await updateAutomation(workspace, task.id, {
      workspaceDirectory: "",
      model: { providerID: "google", modelID: "gemini-test" },
      agent: null,
      accessMode: "default",
    });
    expect(updated.workspaceDirectory).toBeUndefined();
    expect(updated.model).toEqual({ providerID: "google", modelID: "gemini-test" });
    expect(updated.agent).toBeUndefined();
    expect(updated.accessMode).toBe("default");

    const listed = await listAutomations(workspace);
    expect(listed[0]?.model).toEqual({ providerID: "google", modelID: "gemini-test" });
    expect(listed[0]?.agent).toBeUndefined();
    expect(listed[0]?.accessMode).toBe("default");
  });

  test("persists and updates effective date ranges", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Date range",
      prompt: "Respect dates.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
      effectiveRange: { startDate: "2026-06-23", endDate: "2026-06-30" },
    });

    expect(task.effectiveRange).toEqual({ startDate: "2026-06-23", endDate: "2026-06-30" });

    const updated = await updateAutomation(workspace, task.id, {
      effectiveRange: { endDate: "2026-07-01" },
    });
    expect(updated.effectiveRange).toEqual({ endDate: "2026-07-01" });

    const listed = await listAutomations(workspace);
    expect(listed[0]?.effectiveRange).toEqual({ endDate: "2026-07-01" });
  });

  test("rejects invalid effective date ranges", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));

    await expect(createAutomation(workspace, {
      scene: "office",
      title: "Invalid dates",
      prompt: "Do not save.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
      effectiveRange: { startDate: "2026-07-02", endDate: "2026-07-01" },
    })).rejects.toThrow("Automation effective range start date must be before end date");

    await expect(createAutomation(workspace, {
      scene: "office",
      title: "Invalid date",
      prompt: "Do not save.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
      effectiveRange: { startDate: "2026-02-30" },
    })).rejects.toThrow("Automation effective date must be YYYY-MM-DD");
  });

  test("does not claim automations before their effective start date", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Future start",
      prompt: "Wait until active.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
      effectiveRange: { startDate: localDateString(startDate) },
    });

    const beforeStart = startDate.getTime() - 1;
    expect(await claimDueAutomation(workspace, beforeStart)).toBeNull();

    const afterStart = startDate.getTime() + 9 * 60 * 60 * 1000 + 60 * 1000;
    const claimed = await claimDueAutomation(workspace, afterStart);
    expect(claimed?.id).toBe(task.id);
  });

  test("stops scheduling after effective end date", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(0, 0, 0, 0);
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "End date",
      prompt: "Stop after end.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
      effectiveRange: { endDate: localDateString(endDate) },
    });

    const runAt = endDate.getTime() + 9 * 60 * 60 * 1000 + 60 * 1000;
    const claimed = await claimDueAutomation(workspace, runAt);
    expect(claimed?.id).toBe(task.id);

    const recorded = await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "scheduled",
      ranAt: runAt + 5 * 60 * 1000,
      sessionId: "ses_end_date",
    }, claimed?.running.leaseId);
    expect(recorded?.nextRunAt).toBeNull();

    const nextClaim = await claimDueAutomation(workspace, endDate.getTime() + 34 * 60 * 60 * 1000);
    expect(nextClaim).toBeNull();
  });

  test("does not catch up missed daily runs when repairing schedule state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Morning news",
      prompt: "Send news.",
      schedule: { mode: "weekly", day: "daily", time: "08:35" },
    });
    const missedAt = new Date(2026, 5, 24, 8, 35, 0, 0).getTime();
    const now = new Date(2026, 5, 24, 22, 50, 0, 0).getTime();
    const raw = JSON.parse(await readFile(automationStorePath(workspace), "utf8"));
    raw.items[0] = {
      ...raw.items[0],
      id: task.id,
      nextRunAt: missedAt,
    };
    await Bun.write(automationStorePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);

    expect(await claimDueAutomation(workspace, now)).toBeNull();
    const listed = await listAutomations(workspace);
    expect(listed[0]?.nextRunAt).toBe(new Date(2026, 5, 25, 8, 35, 0, 0).getTime());
    expect(listed[0]?.running).toBeNull();
    expect(listed[0]?.runs).toEqual([]);
  });

  test("repairs missing daily next run to the next future occurrence without running immediately", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Evening words",
      prompt: "Send words.",
      schedule: { mode: "weekly", day: "daily", time: "17:01" },
    });
    const now = new Date(2026, 5, 24, 22, 50, 0, 0).getTime();
    const raw = JSON.parse(await readFile(automationStorePath(workspace), "utf8"));
    raw.items[0] = {
      ...raw.items[0],
      id: task.id,
      nextRunAt: null,
    };
    await Bun.write(automationStorePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);

    expect(await claimDueAutomation(workspace, now)).toBeNull();
    const listed = await listAutomations(workspace);
    expect(listed[0]?.nextRunAt).toBe(new Date(2026, 5, 25, 17, 1, 0, 0).getTime());
  });

  test("claims scheduled runs that are due inside the scheduler grace window", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Grace window",
      prompt: "Run near due time.",
      schedule: { mode: "weekly", day: "daily", time: "17:01" },
    });
    const dueAt = new Date(2026, 5, 24, 17, 1, 0, 0).getTime();
    const now = dueAt + 60 * 1000;
    const raw = JSON.parse(await readFile(automationStorePath(workspace), "utf8"));
    raw.items[0] = {
      ...raw.items[0],
      id: task.id,
      nextRunAt: dueAt,
    };
    await Bun.write(automationStorePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);

    const claimed = await claimDueAutomation(workspace, now);
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.running.scheduledForAt).toBe(dueAt);
  });

  test("claims due automation and advances next run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Run now",
      prompt: "Run now.",
      schedule: { mode: "interval", day: "daily", time: "09:00" },
    });

    await updateAutomation(workspace, task.id, {
      schedule: { mode: "interval", day: "daily", time: "09:00" },
    });

    const firstDueAt = (task.nextRunAt ?? Date.now()) + 60 * 1000;
    const claimed = await claimDueAutomation(workspace, firstDueAt);
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.running.leaseId).toBeString();
    expect(claimed?.running.attempt).toBe(1);
    const duplicateClaim = await claimDueAutomation(workspace, firstDueAt);
    expect(duplicateClaim).toBeNull();

    const ranAt = firstDueAt;
    const claimedNextRunAt = claimed?.nextRunAt;
    const recorded = await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "scheduled",
      ranAt,
      sessionId: "ses_claimed",
    }, claimed?.running.leaseId);
    expect(recorded?.running).toBeNull();
    expect(claimed?.nextRunAt).toBeGreaterThan(Date.now());
    expect(recorded?.nextRunAt).toBe(claimedNextRunAt);
  });

  test("uses configured interval and allowed weekdays", () => {
    const monday = new Date(2026, 5, 22, 9, 0, 0, 0).getTime();
    const everyTwoHours = nextRunAt({
      mode: "interval",
      day: "daily",
      time: "09:00",
      intervalMinutes: 120,
      weekdays: [1, 2, 3, 4, 5],
    }, monday);
    expect(everyTwoHours).toBe(new Date(2026, 5, 22, 11, 0, 0, 0).getTime());

    const fridayEvening = new Date(2026, 5, 26, 23, 0, 0, 0).getTime();
    const nextWorkday = nextRunAt({
      mode: "interval",
      day: "daily",
      time: "09:00",
      intervalMinutes: 120,
      weekdays: [1, 2, 3, 4, 5],
    }, fridayEvening);
    expect(nextWorkday).toBe(new Date(2026, 5, 29, 1, 0, 0, 0).getTime());

    const impossibleWeekday = nextRunAt({
      mode: "interval",
      day: "daily",
      time: "09:00",
      intervalMinutes: 7 * 24 * 60,
      weekdays: [1],
    }, fridayEvening);
    expect(impossibleWeekday).toBeNull();
  });

  test("calculates daily weekly biweekly monthly and yearly cycles", () => {
    const beforeTime = new Date(2026, 0, 15, 8, 0, 0, 0).getTime();
    const atTime = new Date(2026, 0, 15, 9, 0, 0, 0).getTime();
    const schedule = {
      mode: "weekly" as const,
      time: "09:00",
    };

    expect(nextRunAt({ ...schedule, day: "daily" }, beforeTime))
      .toBe(new Date(2026, 0, 15, 9, 0, 0, 0).getTime());
    expect(nextRunAt({ ...schedule, day: "weekly" }, atTime))
      .toBe(new Date(2026, 0, 22, 9, 0, 0, 0).getTime());
    expect(nextRunAt({ ...schedule, day: "biweekly" }, atTime))
      .toBe(new Date(2026, 0, 29, 9, 0, 0, 0).getTime());

    const monthEnd = new Date(2026, 0, 31, 9, 0, 0, 0).getTime();
    expect(nextRunAt({ ...schedule, day: "monthly" }, monthEnd))
      .toBe(new Date(2026, 1, 28, 9, 0, 0, 0).getTime());

    const leapDay = new Date(2028, 1, 29, 9, 0, 0, 0).getTime();
    expect(nextRunAt({ ...schedule, day: "yearly" }, leapDay))
      .toBe(new Date(2029, 1, 28, 9, 0, 0, 0).getTime());
  });

  test("uses the configured one-time execution timestamp", () => {
    const from = new Date(2026, 5, 22, 9, 0, 0, 0).getTime();
    const onceAt = new Date(2026, 5, 23, 15, 30, 0, 0).getTime();
    expect(nextRunAt({
      mode: "once",
      day: "daily",
      time: "15:30",
      onceAt,
    }, from)).toBe(onceAt);
    expect(nextRunAt({
      mode: "once",
      day: "daily",
      time: "15:30",
      onceAt,
    }, onceAt)).toBeNull();
  });

  test("binds the created session to the active run lease", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Running session",
      prompt: "Run visibly.",
      schedule: { mode: "interval", day: "daily", time: "09:00", intervalMinutes: 60 },
    });
    const claimed = await claimDueAutomation(workspace, (task.nextRunAt ?? Date.now()) + 60 * 1000);
    const bound = claimed
      ? await bindAutomationRunSession(
          workspace,
          task.id,
          claimed.running.leaseId,
          "ses_running",
          "自动化任务-2026-06-23-12-00-00",
          join(workspace, "自动化任务-2026-06-23-12-00-00"),
        )
      : null;
    expect(bound?.running?.sessionId).toBe("ses_running");
    expect(bound?.running?.groupName).toBe("自动化任务-2026-06-23-12-00-00");
    expect(bound?.running?.outputDirectory).toBe(
      join(workspace, "自动化任务-2026-06-23-12-00-00"),
    );
    expect((await listAutomations(workspace))[0]?.running?.sessionId).toBe("ses_running");
  });

  test("moves a manual run into running state without advancing the schedule", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Manual running",
      prompt: "Run now.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const claimed = await claimManualAutomation(workspace, task.id, 100);

    expect(claimed.nextRunAt).toBe(task.nextRunAt);
    expect(claimed.running).toMatchObject({
      startedAt: 100,
      scheduledForAt: 100,
      attempt: 1,
    });

    const recorded = await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "manual",
      ranAt: 200,
      sessionId: "ses_manual",
    }, claimed.running.leaseId);
    expect(recorded?.running).toBeNull();
    expect(recorded?.nextRunAt).toBe(task.nextRunAt);
  });

  test("reconciles a failed run when its session later produced output", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Reconcile",
      prompt: "Finish later.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    await recordAutomationRun(workspace, task.id, {
      status: "failed",
      source: "scheduled",
      ranAt: 300,
      sessionId: "ses_reconcile",
      groupName: "自动化任务-2026-06-23-10-00-00",
      outputDirectory: join(workspace, "自动化任务-2026-06-23-10-00-00"),
      error: "OpenCode completed without assistant output",
    });

    const reconciled = await reconcileAutomationRunSuccess(workspace, task.id, 300);
    expect(reconciled?.lastRun).toEqual({
      status: "success",
      source: "scheduled",
      ranAt: 300,
      sessionId: "ses_reconcile",
      groupName: "自动化任务-2026-06-23-10-00-00",
      outputDirectory: join(workspace, "自动化任务-2026-06-23-10-00-00"),
    });
  });

  test("records skipped occurrences while the same automation is running", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Avoid overlap",
      prompt: "Run without overlap.",
      schedule: {
        mode: "interval",
        day: "daily",
        time: "09:00",
        intervalMinutes: 5,
      },
    });
    const firstDueAt = (task.nextRunAt ?? Date.now()) + 1;
    const claimed = await claimDueAutomation(workspace, firstDueAt);
    const nextOccurrence = claimed?.nextRunAt;
    expect(nextOccurrence).toBeNumber();

    const skippedAt = (nextOccurrence ?? firstDueAt) + 1;
    const items = await recordOverlappingAutomationSkips(workspace, skippedAt);
    const updated = items.find((item) => item.id === task.id);
    expect(updated?.running?.leaseId).toBe(claimed?.running.leaseId);
    expect(updated?.runs[0]).toMatchObject({
      status: "skipped",
      source: "scheduled",
      ranAt: nextOccurrence,
    });
    expect(updated?.nextRunAt).toBeGreaterThan(skippedAt);
  });

  test("reclaims expired automation leases", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Retry after crash",
      prompt: "Retry safely.",
      schedule: { mode: "interval", day: "daily", time: "09:00" },
    });

    await updateAutomation(workspace, task.id, {
      schedule: { mode: "interval", day: "daily", time: "09:00" },
    });

    const firstClaimTime = (task.nextRunAt ?? Date.now()) + 60 * 1000;
    const firstClaim = await claimDueAutomation(workspace, firstClaimTime);
    expect(firstClaim?.running.attempt).toBe(1);
    const blockedClaim = await claimDueAutomation(workspace, firstClaimTime + 1);
    expect(blockedClaim).toBeNull();

    const retried = await claimDueAutomation(workspace, firstClaimTime + 121 * 60 * 1000);
    expect(retried?.id).toBe(task.id);
    expect(retried?.running.attempt).toBe(2);
    expect(retried?.running.leaseId).not.toBe(firstClaim?.running.leaseId);
  });

  test("disables once automation after claim", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "onmyagent-automations-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Run once",
      prompt: "Run once.",
      schedule: { mode: "once", day: "daily", time: "09:00" },
    });

    const claimed = await claimDueAutomation(workspace, (task.nextRunAt ?? Date.now()) + 60 * 1000);
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.enabled).toBe(true);
    expect(claimed?.nextRunAt).toBeNull();

    const recorded = await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "scheduled",
      ranAt: (task.nextRunAt ?? Date.now()) + 60 * 1000,
      sessionId: "ses_once",
    }, claimed?.running.leaseId);
    expect(recorded?.enabled).toBe(false);
    expect(recorded?.nextRunAt).toBeNull();
    expect(recorded?.running).toBeNull();

    const nextClaim = await claimDueAutomation(workspace, Date.now() + 48 * 60 * 60 * 1000);
    expect(nextClaim).toBeNull();
  });
});
