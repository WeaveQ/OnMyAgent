import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  AutomationAccessMode,
  AutomationAgentSelection,
  AutomationEffectiveRange,
  AutomationModelRef,
  AutomationRunHistoryResult,
  AutomationRunLease,
  AutomationRunSummary,
  AutomationSchedule,
  AutomationScene,
  AutomationTaskInput,
  AutomationTaskItem,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { exists, shortId } from "../core/utils.js";

type AutomationStoreFile = {
  version: 1;
  items: AutomationTaskItem[];
};

type NormalizedAutomationInput = Omit<
  AutomationTaskInput,
  "effectiveRange" | "sourceSessionId" | "workspaceDirectory" | "model" | "agent" | "accessMode"
> & {
  effectiveRange: AutomationEffectiveRange;
  sourceSessionId?: string;
  workspaceDirectory?: string;
  model?: AutomationModelRef;
  agent?: AutomationAgentSelection;
  accessMode?: AutomationAccessMode;
};

export type ClaimedAutomationTask = AutomationTaskItem & { running: AutomationRunLease };

export type AutomationManualRunExecution = {
  sessionId: string;
  groupName: string;
  outputDirectory: string;
};

export type AutomationManualRunResult = {
  task: AutomationTaskItem;
  item: AutomationTaskItem | null;
} & (
  | { ok: true; execution: AutomationManualRunExecution }
  | { ok: false; error: unknown; message: string }
);

const AUTOMATION_ID_PREFIX = "automation-";
const AUTOMATION_LEASE_TTL_MS = 2 * 60 * 60 * 1000;
const AUTOMATION_DUE_GRACE_MS = 2 * 60 * 1000;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 30 * 24 * 60;
const storeLocks = new Map<string, Promise<void>>();

export function parseAutomationPromptCommand(prompt: string): { name: string; arguments: string } | null {
  const match = prompt.trim().match(/^\/([^\s]+)\s*(.*)$/s);
  const name = match?.[1]?.trim();
  if (!name) return null;
  return { name, arguments: match?.[2]?.trim() ?? "" };
}

export function automationStorePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent", "automations.json");
}

export async function listAutomations(workspaceRoot: string): Promise<AutomationTaskItem[]> {
  const store = await readAutomationStore(workspaceRoot);
  return store.items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAutomationRuns(
  workspaceRoot: string,
  id: string,
): Promise<AutomationRunHistoryResult> {
  const store = await readAutomationStore(workspaceRoot);
  const item = findAutomationTaskOrThrow(store, id);
  return {
    item,
    runs: item.runs,
    total: item.runs.length,
  };
}

export async function createAutomation(
  workspaceRoot: string,
  input: unknown,
): Promise<AutomationTaskItem> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const now = Date.now();
    const normalized = normalizeAutomationInput(input);
    const enabled = normalized.enabled ?? true;
    const item: AutomationTaskItem = {
      id: `${AUTOMATION_ID_PREFIX}${shortId()}`,
      ...normalized,
      enabled,
      createdAt: now,
      updatedAt: now,
      nextRunAt: enabled ? nextRunAt(normalized.schedule, now, normalized.effectiveRange) : null,
      running: null,
      lastRun: null,
      runs: [],
    };
    const store = await readAutomationStore(workspaceRoot);
    store.items.push(item);
    await writeAutomationStore(workspaceRoot, store);
    return item;
  });
}

export async function updateAutomation(
  workspaceRoot: string,
  id: string,
  input: Record<string, unknown>,
): Promise<AutomationTaskItem> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new ApiError(404, "automation_not_found", "Automation task not found");
    }

    const current = store.items[index];
    const normalized = normalizeAutomationInput({
      scene: input.scene ?? current.scene,
      title: input.title ?? current.title,
      prompt: input.prompt ?? current.prompt,
      sourceSessionId: "sourceSessionId" in input ? input.sourceSessionId : current.sourceSessionId,
      workspaceDirectory: "workspaceDirectory" in input ? input.workspaceDirectory : current.workspaceDirectory,
      model: "model" in input ? input.model : current.model,
      agent: "agent" in input ? input.agent : current.agent,
      accessMode: "accessMode" in input ? input.accessMode : current.accessMode,
      schedule: input.schedule ?? current.schedule,
      effectiveRange: input.effectiveRange ?? current.effectiveRange,
      enabled: input.enabled ?? current.enabled,
    });
    const enabled = normalized.enabled ?? current.enabled;
    const updated: AutomationTaskItem = {
      ...current,
      ...normalized,
      enabled,
      updatedAt: Date.now(),
      nextRunAt: enabled ? nextRunAt(normalized.schedule, Date.now(), normalized.effectiveRange) : null,
      running: enabled ? current.running : null,
    };
    store.items[index] = updated;
    await writeAutomationStore(workspaceRoot, store);
    return updated;
  });
}

export async function deleteAutomation(workspaceRoot: string, id: string): Promise<void> {
  await withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    const nextItems = store.items.filter((item) => item.id !== id);
    if (nextItems.length === store.items.length) {
      throw new ApiError(404, "automation_not_found", "Automation task not found");
    }
    await writeAutomationStore(workspaceRoot, { ...store, items: nextItems });
  });
}

export async function claimDueAutomation(
  workspaceRoot: string,
  now = Date.now(),
): Promise<ClaimedAutomationTask | null> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    let storeChanged = false;
    let item = selectClaimableAutomation(store.items, now);
    if (!item) {
      storeChanged = refreshDueAutomationSchedules(store, now);
      item = selectClaimableAutomation(store.items, now);
    }
    if (!item) {
      if (storeChanged) await writeAutomationStore(workspaceRoot, store);
      return null;
    }

    const index = store.items.findIndex((entry) => entry.id === item.id);
    const reclaiming = Boolean(item.running && item.running.expiresAt <= now);
    const scheduledForAt = reclaiming
      ? item.running?.scheduledForAt ?? now
      : item.nextRunAt ?? now;
    const running: AutomationRunLease = {
      leaseId: shortId(),
      startedAt: now,
      expiresAt: now + AUTOMATION_LEASE_TTL_MS,
      attempt: item.running ? item.running.attempt + 1 : 1,
      scheduledForAt,
    };
    const claimed: ClaimedAutomationTask = {
      ...item,
      nextRunAt: reclaiming
        ? item.nextRunAt
        : item.schedule.mode === "once"
          ? null
          : nextRunAt(item.schedule, scheduledForAt, item.effectiveRange),
      running,
      updatedAt: now,
    };
    store.items[index] = claimed;
    await writeAutomationStore(workspaceRoot, store);
    return claimed;
  });
}

export async function claimManualAutomation(
  workspaceRoot: string,
  id: string,
  now = Date.now(),
): Promise<ClaimedAutomationTask> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new ApiError(404, "automation_not_found", "Automation task not found");
    }
    const current = store.items[index];
    if (current.running) {
      throw new ApiError(409, "automation_running", "Automation task is already running");
    }
    const claimed: ClaimedAutomationTask = {
      ...current,
      running: {
        leaseId: shortId(),
        startedAt: now,
        expiresAt: now + AUTOMATION_LEASE_TTL_MS,
        attempt: 1,
        scheduledForAt: now,
      },
      updatedAt: now,
    };
    store.items[index] = claimed;
    await writeAutomationStore(workspaceRoot, store);
    return claimed;
  });
}

export async function runAutomationManually(
  workspaceRoot: string,
  id: string,
  execute: (
    task: AutomationTaskItem,
    onStarted: (execution: AutomationManualRunExecution) => Promise<void>,
  ) => Promise<AutomationManualRunExecution>,
): Promise<AutomationManualRunResult> {
  const task = await claimManualAutomation(workspaceRoot, id);
  const ranAt = Date.now();
  let execution: AutomationManualRunExecution | null = null;
  try {
    execution = await execute(task, async (started) => {
      await bindAutomationRunSession(
        workspaceRoot,
        task.id,
        task.running.leaseId,
        started.sessionId,
        started.groupName,
        started.outputDirectory,
      );
    });
    const item = await recordAutomationRun(workspaceRoot, task.id, {
      status: "success",
      source: "manual",
      ranAt,
      sessionId: execution.sessionId,
      groupName: execution.groupName,
      outputDirectory: execution.outputDirectory,
    }, task.running.leaseId);
    return { ok: true, task, item, execution };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const item = await recordAutomationRun(workspaceRoot, task.id, {
      status: "failed",
      source: "manual",
      ranAt,
      error: message,
      ...(execution ? {
        sessionId: execution.sessionId,
        groupName: execution.groupName,
        outputDirectory: execution.outputDirectory,
      } : {}),
    }, task.running.leaseId);
    return { ok: false, task, item, error, message };
  }
}

export async function recordAutomationRun(
  workspaceRoot: string,
  id: string,
  lastRun: AutomationRunSummary,
  leaseId?: string,
): Promise<AutomationTaskItem | null> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = store.items[index];
    if (leaseId && current.running?.leaseId !== leaseId) {
      return current;
    }
    const nextEnabled = leaseId && current.schedule.mode === "once" ? false : current.enabled;
    const nextRunAtValue = leaseId && nextEnabled && lastRun.source === "scheduled" && current.effectiveRange.endDate
      ? nextRunAt(current.schedule, lastRun.ranAt, current.effectiveRange)
      : leaseId && !nextEnabled
        ? null
        : current.nextRunAt;
    const item = {
      ...current,
      enabled: nextEnabled,
      nextRunAt: nextRunAtValue,
      running: leaseId ? null : current.running,
      lastRun,
      runs: [lastRun, ...current.runs],
      updatedAt: Date.now(),
    };
    store.items[index] = item;
    await writeAutomationStore(workspaceRoot, store);
    return item;
  });
}

export async function reconcileAutomationRunSuccess(
  workspaceRoot: string,
  id: string,
  ranAt: number,
): Promise<AutomationTaskItem | null> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = store.items[index];
    const runIndex = current.runs.findIndex((run) => run.ranAt === ranAt);
    if (runIndex < 0 || current.runs[runIndex]?.status !== "failed") return current;
    const previous = current.runs[runIndex];
    const reconciled: AutomationRunSummary = {
      status: "success",
      source: previous.source,
      ranAt: previous.ranAt,
      sessionId: previous.sessionId,
      groupName: previous.groupName,
      outputDirectory: previous.outputDirectory,
    };
    const runs = current.runs.slice();
    runs[runIndex] = reconciled;
    const item: AutomationTaskItem = {
      ...current,
      lastRun: current.lastRun?.ranAt === ranAt ? reconciled : current.lastRun,
      runs,
      updatedAt: Date.now(),
    };
    store.items[index] = item;
    await writeAutomationStore(workspaceRoot, store);
    return item;
  });
}

export async function bindAutomationRunSession(
  workspaceRoot: string,
  id: string,
  leaseId: string,
  sessionId: string,
  groupName: string,
  outputDirectory: string,
): Promise<AutomationTaskItem | null> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = store.items[index];
    if (current.running?.leaseId !== leaseId) return current;
    const item: AutomationTaskItem = {
      ...current,
      running: {
        ...current.running,
        sessionId,
        groupName,
        outputDirectory,
      },
      updatedAt: Date.now(),
    };
    store.items[index] = item;
    await writeAutomationStore(workspaceRoot, store);
    return item;
  });
}

export async function recordOverlappingAutomationSkips(
  workspaceRoot: string,
  now = Date.now(),
): Promise<AutomationTaskItem[]> {
  return withAutomationStoreLock(workspaceRoot, async () => {
    const store = await readAutomationStore(workspaceRoot);
    let changed = false;

    store.items = store.items.map((item) => {
      if (!item.enabled || !item.running || item.running.expiresAt <= now) return item;
      let nextRunAtValue = item.nextRunAt;
      const skipped: AutomationRunSummary[] = [];
      let guard = 0;

      while (nextRunAtValue != null && nextRunAtValue <= now && guard < 100) {
        skipped.push({
          status: "skipped",
          source: "scheduled",
          ranAt: nextRunAtValue,
          error: "Skipped because the previous automation run is still running",
        });
        nextRunAtValue = nextRunAt(item.schedule, nextRunAtValue, item.effectiveRange);
        guard += 1;
      }

      if (skipped.length === 0) return item;
      changed = true;
      const newestFirst = skipped.reverse();
      return {
        ...item,
        nextRunAt: nextRunAtValue,
        lastRun: newestFirst[0] ?? item.lastRun,
        runs: [...newestFirst, ...item.runs],
        updatedAt: now,
      };
    });

    if (changed) await writeAutomationStore(workspaceRoot, store);
    return store.items;
  });
}

export function nextRunAt(
  schedule: AutomationSchedule,
  from = Date.now(),
  effectiveRange: AutomationEffectiveRange = {},
): number | null {
  const [hour, minute] = parseTime(schedule.time);
  const startAt = effectiveDateStartAt(effectiveRange.startDate);
  const endAt = effectiveDateEndAt(effectiveRange.endDate);
  const base = startAt != null && from < startAt ? startAt : from;
  if (endAt != null && base > endAt) return null;
  if (schedule.mode === "interval") {
    const intervalMinutes = schedule.intervalMinutes ?? 60;
    const intervalMs = intervalMinutes * 60 * 1000;
    let intervalNext = base + intervalMs;
    const weekdays = schedule.weekdays ?? [];
    const possibleWeeklyOccurrences = 10_080 / greatestCommonDivisor(intervalMinutes, 10_080);
    let checkedOccurrences = 0;
    while (
      weekdays.length > 0 &&
      !weekdays.includes(normalizedWeekday(intervalNext)) &&
      checkedOccurrences < possibleWeeklyOccurrences
    ) {
      intervalNext += intervalMs;
      checkedOccurrences += 1;
    }
    if (
      weekdays.length > 0 &&
      !weekdays.includes(normalizedWeekday(intervalNext))
    ) return null;
    return endAt != null && intervalNext > endAt ? null : intervalNext;
  }
  if (schedule.mode === "once" && schedule.onceAt != null) {
    if (schedule.onceAt <= from) return null;
    if (startAt != null && schedule.onceAt < startAt) return null;
    return endAt != null && schedule.onceAt > endAt ? null : schedule.onceAt;
  }

  const next = nextCycleOccurrence(schedule.day, base, hour, minute);
  let timestamp = next.getTime();
  if (schedule.mode === "once") {
    return endAt != null && timestamp > endAt ? null : timestamp;
  }
  return endAt != null && timestamp > endAt ? null : timestamp;
}

function nextCycleOccurrence(
  cycle: AutomationSchedule["day"],
  base: number,
  hour: number,
  minute: number,
) {
  const candidate = new Date(base);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() > base) return candidate;

  if (cycle === "daily") {
    candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }
  if (cycle === "weekly" || cycle === "biweekly") {
    candidate.setDate(candidate.getDate() + (cycle === "weekly" ? 7 : 14));
    return candidate;
  }
  if (cycle === "monthly") {
    const targetDay = candidate.getDate();
    candidate.setDate(1);
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(Math.min(targetDay, daysInMonth(candidate.getFullYear(), candidate.getMonth())));
    return candidate;
  }

  const targetMonth = candidate.getMonth();
  const targetDay = candidate.getDate();
  candidate.setDate(1);
  candidate.setFullYear(candidate.getFullYear() + 1);
  candidate.setMonth(targetMonth);
  candidate.setDate(Math.min(targetDay, daysInMonth(candidate.getFullYear(), targetMonth)));
  return candidate;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function refreshDueAutomationSchedules(store: AutomationStoreFile, now: number): boolean {
  let changed = false;
  for (const entry of store.items) {
    if (!entry.enabled || entry.running) continue;
    const stale = entry.nextRunAt != null && entry.nextRunAt < now - AUTOMATION_DUE_GRACE_MS;
    const next = entry.nextRunAt == null || stale
      ? nextRunAt(entry.schedule, now, entry.effectiveRange)
      : entry.nextRunAt;
    if (next === entry.nextRunAt) continue;
    entry.nextRunAt = next;
    entry.updatedAt = now;
    changed = true;
  }
  return changed;
}

function selectClaimableAutomation(items: AutomationTaskItem[], now: number): AutomationTaskItem | undefined {
  return items
    .filter((entry) => (
      entry.running?.expiresAt != null && entry.running.expiresAt <= now
    ) || (
      entry.enabled &&
      entry.nextRunAt != null &&
      entry.nextRunAt <= now &&
      (entry.nextRunAt >= now - AUTOMATION_DUE_GRACE_MS || Boolean(entry.effectiveRange.endDate)) &&
      !entry.running
    ))
    .sort((a, b) => (
      (a.running?.scheduledForAt ?? a.nextRunAt ?? 0) -
      (b.running?.scheduledForAt ?? b.nextRunAt ?? 0)
    ))[0];
}

function findAutomationTaskOrThrow(store: AutomationStoreFile, id: string): AutomationTaskItem {
  const item = store.items.find((entry) => entry.id === id);
  if (!item) {
    throw new ApiError(404, "automation_not_found", "Automation task not found");
  }
  return item;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function normalizeAutomationInput(input: unknown): NormalizedAutomationInput {
  if (!isRecord(input)) {
    throw new ApiError(400, "invalid_automation", "Automation input is required");
  }
  const scene = normalizeScene(input.scene);
  const title = normalizeRequiredString(input.title, "invalid_automation_title", "Automation title is required");
  const prompt = normalizeRequiredString(input.prompt, "invalid_automation_prompt", "Automation prompt is required");
  if (!title) {
    throw new ApiError(400, "invalid_automation_title", "Automation title is required");
  }
  if (!prompt) {
    throw new ApiError(400, "invalid_automation_prompt", "Automation prompt is required");
  }
  return {
    scene,
    title,
    prompt,
    sourceSessionId: normalizeOptionalString(input.sourceSessionId),
    workspaceDirectory: normalizeOptionalAbsolutePath(input.workspaceDirectory),
    model: normalizeAutomationModel(input.model),
    agent: normalizeAutomationAgent(input.agent),
    accessMode: normalizeAutomationAccessMode(input.accessMode),
    schedule: normalizeSchedule(input.schedule),
    effectiveRange: normalizeEffectiveRange(input.effectiveRange),
    enabled: normalizeOptionalBoolean(input.enabled),
  };
}

function normalizeScene(value: unknown): AutomationScene {
  if (value === "office" || value === "code") return value;
  throw new ApiError(400, "invalid_automation_scene", "Automation scene must be office or code");
}

function normalizeSchedule(schedule: unknown): AutomationSchedule {
  if (!isRecord(schedule)) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation schedule is required");
  }
  const mode = schedule.mode;
  if (mode !== "weekly" && mode !== "interval" && mode !== "once") {
    throw new ApiError(400, "invalid_automation_schedule", "Automation schedule mode is invalid");
  }
  const day = schedule.day;
  if (
    day !== "daily" &&
    day !== "weekly" &&
    day !== "biweekly" &&
    day !== "monthly" &&
    day !== "yearly"
  ) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation schedule day is invalid");
  }
  const time = normalizeRequiredString(schedule.time, "invalid_automation_schedule", "Automation schedule time must be HH:mm");
  parseTime(time);
  const intervalMinutes = normalizeIntervalMinutes(schedule.intervalMinutes, mode);
  const weekdays = normalizeWeekdays(schedule.weekdays);
  const onceAt = normalizeOnceAt(schedule.onceAt, mode);
  const timezone = typeof schedule.timezone === "string" ? schedule.timezone.trim() : "";
  return {
    mode,
    day,
    time,
    ...(intervalMinutes ? { intervalMinutes } : {}),
    ...(weekdays.length > 0 ? { weekdays } : {}),
    ...(onceAt ? { onceAt } : {}),
    timezone: timezone || undefined,
  };
}

function normalizeIntervalMinutes(value: unknown, mode: AutomationSchedule["mode"]): number | undefined {
  if (mode !== "interval") return undefined;
  if (value === undefined) return 60;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_INTERVAL_MINUTES ||
    value > MAX_INTERVAL_MINUTES
  ) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation interval is invalid");
  }
  return value;
}

function normalizeWeekdays(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation weekdays are invalid");
  }
  const weekdays = Array.from(new Set(value));
  if (!weekdays.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7)) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation weekdays are invalid");
  }
  return weekdays.sort((left, right) => left - right);
}

function normalizeOnceAt(value: unknown, mode: AutomationSchedule["mode"]): number | undefined {
  if (mode !== "once") return undefined;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation one-time date is invalid");
  }
  return value;
}

function normalizeEffectiveRange(value: unknown): AutomationEffectiveRange {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_automation_effective_range", "Automation effective range is invalid");
  }
  const startDate = normalizeOptionalDate(value.startDate, "invalid_automation_effective_range");
  const endDate = normalizeOptionalDate(value.endDate, "invalid_automation_effective_range");
  const startAt = effectiveDateStartAt(startDate);
  const endAt = effectiveDateEndAt(endDate);
  if (startAt != null && endAt != null && startAt > endAt) {
    throw new ApiError(400, "invalid_automation_effective_range", "Automation effective range start date must be before end date");
  }
  return compactEffectiveRange(startDate, endDate);
}

function normalizeRequiredString(value: unknown, code: string, message: string): string {
  if (typeof value !== "string") {
    throw new ApiError(400, code, message);
  }
  return value.trim();
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new ApiError(400, "invalid_automation_enabled", "Automation enabled must be a boolean");
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_automation_source_session", "Automation source session must be a string");
  }
  return value.trim() || undefined;
}

function normalizeOptionalAbsolutePath(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_automation_workspace", "Automation workspace directory must be a path");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isAbsolute(trimmed)) {
    throw new ApiError(400, "invalid_automation_workspace", "Automation workspace directory must be absolute");
  }
  return trimmed;
}

function normalizeAutomationModel(value: unknown): AutomationModelRef | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_automation_model", "Automation model is invalid");
  }
  const providerID = typeof value.providerID === "string" ? value.providerID.trim() : "";
  const modelID = typeof value.modelID === "string" ? value.modelID.trim() : "";
  if (!providerID || !modelID) {
    throw new ApiError(400, "invalid_automation_model", "Automation model providerID and modelID are required");
  }
  return { providerID, modelID };
}

function normalizeAutomationAgent(value: unknown): AutomationAgentSelection | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_automation_agent", "Automation agent is invalid");
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!id || !name) {
    throw new ApiError(400, "invalid_automation_agent", "Automation agent id and name are required");
  }
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const systemPrompt = typeof value.systemPrompt === "string" ? value.systemPrompt.trim() : "";
  const tools = normalizeAutomationTools(value.tools);
  const model = normalizeAutomationModel(value.model);
  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(tools ? { tools } : {}),
    ...(model ? { model } : {}),
  };
}

function normalizeAutomationTools(value: unknown): Record<string, boolean> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_automation_agent", "Automation agent tools are invalid");
  }
  const entries = Object.entries(value).flatMap(([key, entryValue]) => {
    const tool = key.trim();
    if (!tool) return [];
    if (typeof entryValue !== "boolean") {
      throw new ApiError(400, "invalid_automation_agent", "Automation agent tool values must be boolean");
    }
    return [[tool, entryValue] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeAutomationAccessMode(value: unknown): AutomationAccessMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "default" || value === "full") return value;
  throw new ApiError(400, "invalid_automation_access_mode", "Automation access mode is invalid");
}

function normalizeOptionalDate(value: unknown, code: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, code, "Automation effective date must be YYYY-MM-DD");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (effectiveDateStartAt(trimmed) === null) {
    throw new ApiError(400, code, "Automation effective date must be YYYY-MM-DD");
  }
  return trimmed;
}

function parseTime(value: string): [number, number] {
  const parsed = parseAutomationScheduleTime(value);
  if (!parsed) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation schedule time must be HH:mm");
  }
  return parsed;
}

function parseAutomationScheduleTime(value: string): [number, number] | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return [hour, minute];
}

function effectiveDateStartAt(value?: string): number | null {
  if (!value) return null;
  const parsed = parseEffectiveDate(value);
  if (!parsed) return null;
  const [year, month, day] = parsed;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function effectiveDateEndAt(value?: string): number | null {
  if (!value) return null;
  const parsed = parseEffectiveDate(value);
  if (!parsed) return null;
  const [year, month, day] = parsed;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function parseEffectiveDate(value: string): [number, number, number] | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

function compactEffectiveRange(
  startDate: string | undefined,
  endDate: string | undefined,
): AutomationEffectiveRange {
  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

async function readAutomationStore(workspaceRoot: string): Promise<AutomationStoreFile> {
  const path = automationStorePath(workspaceRoot);
  if (!(await exists(path))) {
    return { version: 1, items: [] };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    const items = isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items.flatMap(readAutomationTaskItem) : [];
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

async function writeAutomationStore(workspaceRoot: string, store: AutomationStoreFile): Promise<void> {
  const path = automationStorePath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${shortId()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

async function withAutomationStoreLock<T>(workspaceRoot: string, action: () => Promise<T>): Promise<T> {
  const path = automationStorePath(workspaceRoot);
  const previous = storeLocks.get(path) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  storeLocks.set(path, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (storeLocks.get(path) === queued) {
      storeLocks.delete(path);
    }
  }
}

function readAutomationTaskItem(value: unknown): AutomationTaskItem[] {
  if (!isRecord(value)) return [];
  const record = value;
  const lastRun = readAutomationRunSummary(record.lastRun);
  if (!(
    typeof record.id === "string" &&
    (record.scene === "office" || record.scene === "code") &&
    typeof record.title === "string" &&
    typeof record.prompt === "string" &&
    typeof record.enabled === "boolean" &&
    typeof record.createdAt === "number" &&
    typeof record.updatedAt === "number" &&
    isAutomationSchedule(record.schedule) &&
    (record.nextRunAt === null || typeof record.nextRunAt === "number") &&
    (record.lastRun === null || lastRun !== null)
  )) {
    return [];
  }
  const runs = (Array.isArray(record.runs)
    ? record.runs.flatMap((run) => {
      const summary = readAutomationRunSummary(run);
      return summary ? [summary] : [];
    })
    : lastRun
      ? [lastRun]
      : [])
    .sort((a, b) => b.ranAt - a.ranAt);
  return [{
    id: record.id,
    scene: record.scene,
    title: record.title,
    prompt: record.prompt,
    ...(typeof record.sourceSessionId === "string" && record.sourceSessionId.trim()
      ? { sourceSessionId: record.sourceSessionId.trim() }
      : {}),
    ...(readAutomationWorkspaceDirectory(record.workspaceDirectory)
      ? { workspaceDirectory: readAutomationWorkspaceDirectory(record.workspaceDirectory) }
      : {}),
    ...(readAutomationModel(record.model) ? { model: readAutomationModel(record.model) } : {}),
    ...(readAutomationAgent(record.agent) ? { agent: readAutomationAgent(record.agent) } : {}),
    ...(readAutomationAccessMode(record.accessMode) ? { accessMode: readAutomationAccessMode(record.accessMode) } : {}),
    schedule: record.schedule,
    effectiveRange: readAutomationEffectiveRange(record.effectiveRange),
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nextRunAt: record.nextRunAt,
    running: readAutomationRunLease(record.running),
    lastRun,
    runs,
  }];
}

function readAutomationWorkspaceDirectory(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && isAbsolute(value.trim())
    ? value.trim()
    : undefined;
}

function readAutomationModel(value: unknown): AutomationModelRef | undefined {
  if (!isRecord(value)) return undefined;
  const providerID = typeof value.providerID === "string" ? value.providerID.trim() : "";
  const modelID = typeof value.modelID === "string" ? value.modelID.trim() : "";
  return providerID && modelID ? { providerID, modelID } : undefined;
}

function readAutomationAgent(value: unknown): AutomationAgentSelection | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!id || !name) return undefined;
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const systemPrompt = typeof value.systemPrompt === "string" ? value.systemPrompt.trim() : "";
  const tools = isRecord(value.tools)
    ? Object.fromEntries(
      Object.entries(value.tools).filter((entry): entry is [string, boolean] => (
        typeof entry[0] === "string" &&
        entry[0].trim().length > 0 &&
        typeof entry[1] === "boolean"
      )),
    )
    : undefined;
  const model = readAutomationModel(value.model);
  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
    ...(model ? { model } : {}),
  };
}

function readAutomationAccessMode(value: unknown): AutomationAccessMode | undefined {
  return value === "default" || value === "full" ? value : undefined;
}

function readAutomationEffectiveRange(value: unknown): AutomationEffectiveRange {
  if (!isRecord(value)) return {};
  const startDate = typeof value.startDate === "string" && effectiveDateStartAt(value.startDate) !== null
    ? value.startDate
    : undefined;
  const endDate = typeof value.endDate === "string" && effectiveDateEndAt(value.endDate) !== null
    ? value.endDate
    : undefined;
  const startAt = effectiveDateStartAt(startDate);
  const endAt = effectiveDateEndAt(endDate);
  if (startAt != null && endAt != null && startAt > endAt) return {};
  return compactEffectiveRange(startDate, endDate);
}

function readAutomationRunLease(value: unknown): AutomationRunLease | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  if (typeof value.leaseId !== "string") return null;
  if (typeof value.startedAt !== "number") return null;
  if (typeof value.expiresAt !== "number") return null;
  if (typeof value.attempt !== "number") return null;
  if (typeof value.scheduledForAt !== "number") return null;
  if (!(value.sessionId === undefined || typeof value.sessionId === "string")) return null;
  if (!(value.groupName === undefined || typeof value.groupName === "string")) return null;
  if (!(value.outputDirectory === undefined || typeof value.outputDirectory === "string")) return null;
  return {
    leaseId: value.leaseId,
    startedAt: value.startedAt,
    expiresAt: value.expiresAt,
    attempt: value.attempt,
    scheduledForAt: value.scheduledForAt,
    sessionId: value.sessionId,
    groupName: value.groupName,
    outputDirectory: value.outputDirectory,
  };
}

function isAutomationSchedule(value: unknown): value is AutomationSchedule {
  if (!isRecord(value)) return false;
  if (typeof value.time !== "string") return false;
  if (!(
    (value.mode === "weekly" || value.mode === "interval" || value.mode === "once") &&
    (
      value.day === "daily" ||
      value.day === "weekly" ||
      value.day === "biweekly" ||
      value.day === "monthly" ||
      value.day === "yearly"
    ) &&
    parseAutomationScheduleTime(value.time) !== null &&
    (value.timezone === undefined || typeof value.timezone === "string")
  )) return false;
  if (!(value.intervalMinutes === undefined || (
    typeof value.intervalMinutes === "number" &&
    Number.isInteger(value.intervalMinutes) &&
    value.intervalMinutes >= MIN_INTERVAL_MINUTES &&
    value.intervalMinutes <= MAX_INTERVAL_MINUTES
  ))) return false;
  if (!(value.onceAt === undefined || typeof value.onceAt === "number")) return false;
  if (!(value.weekdays === undefined || (
    Array.isArray(value.weekdays) &&
    value.weekdays.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7)
  ))) return false;
  return true;
}

function readAutomationRunSummary(value: unknown): AutomationRunSummary | null {
  if (!isRecord(value)) return null;
  if (!(value.status === "success" || value.status === "failed" || value.status === "skipped")) return null;
  if (typeof value.ranAt !== "number") return null;
  if (!(value.source === undefined || value.source === "scheduled" || value.source === "manual")) return null;
  if (!(value.sessionId === undefined || typeof value.sessionId === "string")) return null;
  if (!(value.groupName === undefined || typeof value.groupName === "string")) return null;
  if (!(value.outputDirectory === undefined || typeof value.outputDirectory === "string")) return null;
  if (!(value.error === undefined || typeof value.error === "string")) return null;
  return {
    status: value.status,
    source: value.source ?? "scheduled",
    ranAt: value.ranAt,
    sessionId: value.sessionId,
    groupName: value.groupName,
    outputDirectory: value.outputDirectory,
    error: value.error,
  };
}

function normalizedWeekday(timestamp: number): number {
  const day = new Date(timestamp).getDay();
  return day === 0 ? 7 : day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
