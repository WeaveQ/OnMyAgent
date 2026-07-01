import path from "node:path";

import { personalAgentRoot } from "./runtime-state.mjs";
import { readJsonLikeFile, runId, writeJsonFile } from "./utils.mjs";

export const HEARTBEAT_MIN_INTERVAL_MINUTES = 5;
const MAX_RUN_HISTORY = 50;

export function heartbeatFile(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), "heartbeats.json");
}

export function computeNextIntervalRunAt(fromMs, intervalMinutes) {
  const minutes = normalizeIntervalMinutes(intervalMinutes);
  return Number(fromMs) + minutes * 60_000;
}

export function normalizeIntervalMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return HEARTBEAT_MIN_INTERVAL_MINUTES;
  return Math.max(HEARTBEAT_MIN_INTERVAL_MINUTES, Math.floor(n));
}

function normalizeApprovalMode(value) {
  return value === "auto" || value === "read-only-auto" || value === "ask" ? value : "ask";
}

function normalizeAgent(value) {
  if (!value || typeof value !== "object") return null;
  const provider = String(value.provider ?? "").trim();
  const id = String(value.id ?? provider ?? "").trim();
  if (!provider) return null;
  return {
    ...value,
    id: id || provider,
    provider,
  };
}

function normalizeRun(item) {
  if (!item || typeof item !== "object") return null;
  const runIdValue = String(item.runId ?? "").trim();
  const idValue = String(item.id ?? runIdValue).trim() || `heartbeat-run-${runId()}`;
  const status = String(item.status ?? "").trim();
  const startedAt = Number(item.startedAt) || Number(item.queuedAt) || Date.now();
  return {
    id: idValue,
    runId: runIdValue || null,
    status: status || "missing",
    startedAt,
    finishedAt: Number(item.finishedAt) || null,
    error: String(item.error ?? "").trim() || null,
    output: String(item.output ?? "").trim() || "",
  };
}

export function normalizeHeartbeatJob(item, now = Date.now()) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id ?? "").trim();
  const prompt = String(item.prompt ?? "").trim();
  const agent = normalizeAgent(item.agent);
  if (!id || !prompt || !agent) return null;
  const createdAt = Number(item.createdAt) || now;
  const updatedAt = Number(item.updatedAt) || createdAt;
  const intervalMinutes = normalizeIntervalMinutes(item.schedule?.intervalMinutes ?? item.intervalMinutes);
  const runs = Array.isArray(item.runs) ? item.runs.map(normalizeRun).filter(Boolean).slice(0, MAX_RUN_HISTORY) : [];
  const lastRun = normalizeRun(item.lastRun) ?? runs[0] ?? null;
  return {
    id,
    title: String(item.title ?? "").trim() || "Heartbeat",
    prompt,
    sessionContext: String(item.sessionContext ?? "").trim() || null,
    agent,
    conversationId: String(item.conversationId ?? "").trim() || null,
    approvalMode: normalizeApprovalMode(item.approvalMode),
    enabled: item.enabled !== false,
    schedule: {
      mode: "interval",
      intervalMinutes,
      timezone: String(item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "").trim() || null,
    },
    createdAt,
    updatedAt,
    nextRunAt: Number(item.nextRunAt) || computeNextIntervalRunAt(updatedAt, intervalMinutes),
    running: item.running && typeof item.running === "object" ? {
      runId: String(item.running.runId ?? "").trim() || null,
      claimedAt: Number(item.running.claimedAt) || now,
    } : null,
    lastRun,
    runs,
  };
}

async function readState(workspaceRoot) {
  const raw = await readJsonLikeFile(heartbeatFile(workspaceRoot));
  const jobs = Array.isArray(raw?.jobs)
    ? raw.jobs.map((item) => normalizeHeartbeatJob(item)).filter(Boolean)
    : [];
  return { version: 1, jobs };
}

async function writeState(workspaceRoot, state) {
  await writeJsonFile(heartbeatFile(workspaceRoot), {
    version: 1,
    jobs: state.jobs,
  });
}

export async function listHeartbeatJobs(workspaceRoot) {
  const state = await readState(workspaceRoot);
  return [...state.jobs].sort((a, b) => a.createdAt - b.createdAt);
}

export async function createHeartbeatJob(workspaceRoot, input = {}, now = Date.now()) {
  const state = await readState(workspaceRoot);
  const intervalMinutes = normalizeIntervalMinutes(input.schedule?.intervalMinutes ?? input.intervalMinutes);
  const job = normalizeHeartbeatJob({
    id: `heartbeat-${runId()}`,
    title: input.title,
    prompt: input.prompt,
    sessionContext: input.sessionContext,
    agent: input.agent,
    conversationId: input.conversationId,
    approvalMode: input.approvalMode,
    enabled: input.enabled ?? true,
    schedule: { mode: "interval", intervalMinutes, timezone: input.schedule?.timezone },
    createdAt: now,
    updatedAt: now,
    nextRunAt: input.enabled === false ? computeNextIntervalRunAt(now, intervalMinutes) : now + intervalMinutes * 60_000,
    running: null,
    runs: [],
  }, now);
  if (!job) throw new Error("invalid heartbeat job");
  state.jobs.push(job);
  await writeState(workspaceRoot, state);
  return job;
}

export async function updateHeartbeatJob(workspaceRoot, jobId, patch = {}, now = Date.now()) {
  const state = await readState(workspaceRoot);
  const index = state.jobs.findIndex((job) => job.id === String(jobId ?? ""));
  if (index < 0) return null;
  const current = state.jobs[index];
  const intervalMinutes = normalizeIntervalMinutes(patch.schedule?.intervalMinutes ?? current.schedule.intervalMinutes);
  const merged = normalizeHeartbeatJob({
    ...current,
    ...patch,
    id: current.id,
    agent: patch.agent ?? current.agent,
    schedule: { ...current.schedule, ...patch.schedule, mode: "interval", intervalMinutes },
    updatedAt: now,
    nextRunAt: patch.nextRunAt ?? (patch.schedule ? computeNextIntervalRunAt(now, intervalMinutes) : current.nextRunAt),
    running: current.running,
    lastRun: current.lastRun,
    runs: current.runs,
  }, now);
  if (!merged) throw new Error("invalid heartbeat job update");
  state.jobs[index] = merged;
  await writeState(workspaceRoot, state);
  return merged;
}

export async function deleteHeartbeatJob(workspaceRoot, jobId) {
  const state = await readState(workspaceRoot);
  const nextJobs = state.jobs.filter((job) => job.id !== String(jobId ?? ""));
  if (nextJobs.length === state.jobs.length) return { ok: false, missing: true };
  await writeState(workspaceRoot, { ...state, jobs: nextJobs });
  return { ok: true };
}

export async function claimDueHeartbeatJobs(workspaceRoot, now = Date.now(), leaseTtlMs = 30 * 60_000) {
  const state = await readState(workspaceRoot);
  const claimed = [];
  let changed = false;
  for (const job of state.jobs) {
    const leaseActive = job.running?.claimedAt && now - job.running.claimedAt < leaseTtlMs;
    if (!job.enabled || leaseActive || job.nextRunAt > now) continue;
    job.running = { runId: null, claimedAt: now };
    job.updatedAt = now;
    claimed.push(job);
    changed = true;
  }
  if (changed) await writeState(workspaceRoot, state);
  return claimed;
}

export async function markHeartbeatRunStarted(workspaceRoot, jobId, runIdValue, now = Date.now()) {
  const state = await readState(workspaceRoot);
  const job = state.jobs.find((item) => item.id === String(jobId ?? ""));
  if (!job) return null;
  job.running = { runId: String(runIdValue ?? "").trim() || null, claimedAt: job.running?.claimedAt ?? now };
  job.updatedAt = now;
  await writeState(workspaceRoot, state);
  return job;
}

export async function recordHeartbeatRun(workspaceRoot, jobId, run, now = Date.now()) {
  const state = await readState(workspaceRoot);
  const job = state.jobs.find((item) => item.id === String(jobId ?? ""));
  if (!job) return null;
  const entry = normalizeRun({
    id: `heartbeat-run-${runId()}`,
    runId: run?.runId,
    status: run?.status ?? "missing",
    startedAt: run?.startedAt ?? now,
    finishedAt: run?.finishedAt ?? now,
    error: run?.error ?? run?.errorInfo?.message ?? null,
    output: run?.output ?? "",
  });
  job.running = null;
  job.lastRun = entry;
  job.runs = [entry, ...job.runs].slice(0, MAX_RUN_HISTORY);
  job.nextRunAt = computeNextIntervalRunAt(now, job.schedule.intervalMinutes);
  job.updatedAt = now;
  await writeState(workspaceRoot, state);
  return job;
}

export async function listHeartbeatRuns(workspaceRoot, jobId) {
  const jobs = await listHeartbeatJobs(workspaceRoot);
  const job = jobs.find((item) => item.id === String(jobId ?? ""));
  return job?.runs ?? [];
}
