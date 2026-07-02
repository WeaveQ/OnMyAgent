import path from "node:path";

import { personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { readJsonLikeFile, writeJsonFile } from "./utils.mjs";

const processes = new Map();
const REGISTRY_RELATIVE_PATH = path.join("personal-assistant", "process-registry.json");
let registryWriteQueue = Promise.resolve();

export function processRegistryFile() {
  return path.join(personalAgentRuntimeStateRoot(), REGISTRY_RELATIVE_PATH);
}

function key(runId) {
  return String(runId ?? "").trim();
}

function textOrNull(value) {
  return String(value ?? "").trim() || null;
}

function timestamp(value) {
  return Number(value) || Date.now();
}

function patchedText(input, current, keyName) {
  if (!Object.prototype.hasOwnProperty.call(input, keyName)) return textOrNull(current[keyName]);
  return textOrNull(input[keyName]) ?? textOrNull(current[keyName]);
}

function normalizeProcessRecord(input = {}, current = {}) {
  const runId = key(input.runId ?? current.runId);
  if (!runId) return null;
  const provider = textOrNull(input.provider ?? input.backend) ?? textOrNull(current.provider ?? current.backend);
  const backend = textOrNull(input.backend ?? input.provider) ?? textOrNull(current.backend ?? current.provider);
  return {
    ...current,
    ...input,
    runId,
    pid: Number.isFinite(input.pid) ? input.pid : (Number.isFinite(current.pid) ? current.pid : null),
    pgid: Number.isFinite(input.pgid) ? input.pgid : (Number.isFinite(current.pgid) ? current.pgid : null),
    provider,
    backend,
    conversationId: patchedText(input, current, "conversationId"),
    agentType: textOrNull(input.agentType ?? input.agent_type) ?? textOrNull(current.agentType) ?? "acp",
    command: patchedText(input, current, "command"),
    status: textOrNull(input.status) ?? textOrNull(current.status) ?? "running",
    staleReason: textOrNull(input.staleReason) ?? textOrNull(current.staleReason),
    startedAt: timestamp(input.startedAt ?? current.startedAt),
    updatedAt: Date.now(),
  };
}

async function readPersistentRegistry() {
  const raw = await readJsonLikeFile(processRegistryFile());
  const records = Array.isArray(raw?.processes)
    ? raw.processes.map((item) => normalizeProcessRecord(item)).filter(Boolean)
    : [];
  return { version: 1, processes: records };
}

async function writePersistentRegistry(records) {
  await writeJsonFile(processRegistryFile(), { version: 1, processes: records });
}

function persistRegistryBestEffort() {
  const records = [...processes.values()];
  registryWriteQueue = registryWriteQueue
    .catch(() => undefined)
    .then(() => writePersistentRegistry(records))
    .catch(() => undefined);
}

export async function flushAgentProcessRegistry() {
  const records = [...processes.values()];
  registryWriteQueue = registryWriteQueue
    .catch(() => undefined)
    .then(() => writePersistentRegistry(records));
  await registryWriteQueue;
}

export function registerAgentProcess(input = {}) {
  const record = normalizeProcessRecord(input);
  if (!record) return null;
  processes.set(record.runId, record);
  persistRegistryBestEffort();
  return record;
}

export function updateAgentProcess(runId, patch = {}) {
  const id = key(runId);
  const current = processes.get(id);
  if (!current) return null;
  const updated = normalizeProcessRecord({ ...patch, runId: id }, current);
  processes.set(id, updated);
  persistRegistryBestEffort();
  return updated;
}

export function unregisterAgentProcess(runId) {
  const id = key(runId);
  const current = processes.get(id) ?? null;
  processes.delete(id);
  persistRegistryBestEffort();
  return current;
}

export function getAgentProcess(runId) {
  return processes.get(key(runId)) ?? null;
}

export function listAgentProcesses(filter = {}) {
  const provider = String(filter.provider ?? "").trim();
  const conversationId = String(filter.conversationId ?? "").trim();
  return [...processes.values()].filter((item) => {
    if (provider && item.provider !== provider) return false;
    if (conversationId && item.conversationId !== conversationId) return false;
    return true;
  });
}

export async function recoverAgentProcesses(options = {}) {
  const markStale = options.markStale !== false;
  const registry = await readPersistentRegistry();
  processes.clear();
  for (const record of registry.processes) {
    const recovered = markStale
      ? normalizeProcessRecord({ ...record, status: "stale", staleReason: "runtime_restarted" }, record)
      : normalizeProcessRecord(record);
    if (recovered) processes.set(recovered.runId, recovered);
  }
  if (markStale) await writePersistentRegistry([...processes.values()]);
  return { processes: listAgentProcesses() };
}

export function clearAgentProcesses(options = {}) {
  processes.clear();
  crashHistory.clear();
  if (options.persist !== false) persistRegistryBestEffort();
}

// Crash restart policy: 3 restarts inside a 60s window with exponential
// backoff. Exceeding the budget marks the process `error` and stops.
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASH_RESTARTS = 3;
const crashHistory = new Map();

export function crashRestartBackoffMs(attempt) {
  // attempt is 1-based: 1 -> 1s, 2 -> 2s, 3 -> 4s.
  const n = Math.max(1, Number(attempt) || 1);
  return 1_000 * 2 ** (n - 1);
}

/**
 * Record a crash for a run and decide whether it should be restarted.
 * Returns { shouldRestart, attempt, backoffMs, restartsInWindow }.
 * When the crash budget is exceeded the process record is marked `error`.
 */
export function recordAgentCrash(runId, options = {}) {
  const id = key(runId);
  if (!id) return { shouldRestart: false, attempt: 0, backoffMs: 0, restartsInWindow: 0 };
  const now = timestamp(options.now);
  const previous = crashHistory.get(id) ?? [];
  const recent = previous.filter((ts) => now - ts < CRASH_WINDOW_MS);
  recent.push(now);
  crashHistory.set(id, recent);
  const attempt = recent.length;
  if (attempt > MAX_CRASH_RESTARTS) {
    const current = processes.get(id);
    if (current) {
      processes.set(id, normalizeProcessRecord({ status: "error", staleReason: "crash_restart_exhausted" }, current));
      persistRegistryBestEffort();
    }
    return { shouldRestart: false, attempt, backoffMs: 0, restartsInWindow: recent.length };
  }
  const current = processes.get(id);
  if (current) {
    processes.set(id, normalizeProcessRecord({ status: "restarting", staleReason: `crash_restart_${attempt}` }, current));
    persistRegistryBestEffort();
  }
  return { shouldRestart: true, attempt, backoffMs: crashRestartBackoffMs(attempt), restartsInWindow: recent.length };
}

export function clearAgentCrashHistory(runId) {
  if (runId === undefined) {
    crashHistory.clear();
    return;
  }
  crashHistory.delete(key(runId));
}
