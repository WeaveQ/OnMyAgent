/**
 * Pure readers for automations.json rows (deserialize only).
 * Kept separate so automations.ts stays under the file-size baseline.
 */
import { isAbsolute } from "node:path";
import type {
  AutomationAccessMode,
  AutomationAgentSelection,
  AutomationEffectiveRange,
  AutomationModelRef,
  AutomationRunLease,
  AutomationRunSummary,
  AutomationSchedule,
  AutomationTaskItem,
} from "@onmyagent/types/server";
import {
  compactEffectiveRange,
  effectiveDateEndAt,
  effectiveDateStartAt,
  parseAutomationScheduleTime,
} from "./automation-next-run.js";

const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 30 * 24 * 60;

export function readAutomationTaskItem(value: unknown): AutomationTaskItem[] {
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
    scene: "office",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
