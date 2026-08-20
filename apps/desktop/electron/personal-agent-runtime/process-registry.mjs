import path from "node:path";

import { personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { matchProcessStartToken, readProcessStartToken } from "./process-identity.mjs";
import { isProcessTreeAlive, readJsonLikeFile, terminateProcessTreeByPid, writeJsonFile } from "./utils.mjs";

const CLEANUP_GRACE_MS = 1_000;
const DEFAULT_NAMESPACE = "personal-agent-runtime";

const processes = new Map();
const REGISTRY_RELATIVE_PATH = path.join("personal-assistant", "process-registry.json");
let registryWriteQueue = Promise.resolve();
let registryConfig = { filePath: null, namespace: DEFAULT_NAMESPACE };

function normalizeNamespace(value) {
  const normalized = String(value ?? "").trim();
  return normalized || DEFAULT_NAMESPACE;
}

/** Configure the durable process registry for this Electron/runtime process. */
export function configureProcessRegistry(options = {}) {
  const requestedPath = options.filePath ?? options.registryFile ?? null;
  const next = {
    filePath: requestedPath ? path.resolve(String(requestedPath)) : null,
    namespace: normalizeNamespace(options.namespace),
  };
  const changed = next.filePath !== registryConfig.filePath || next.namespace !== registryConfig.namespace;
  registryConfig = next;
  if (changed) {
    processes.clear();
    registryWriteQueue = Promise.resolve();
  }
  return { ...registryConfig };
}

export function processRegistryNamespace() {
  return registryConfig.namespace;
}

export function processRegistryFile() {
  return registryConfig.filePath ?? path.join(personalAgentRuntimeStateRoot(), REGISTRY_RELATIVE_PATH);
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
  const agentId = patchedText(input, current, "agentId") ?? patchedText(input, current, "agent_id");
  return {
    ...current,
    ...input,
    runId,
    pid: Number.isFinite(input.pid) ? input.pid : (Number.isFinite(current.pid) ? current.pid : null),
    pgid: Number.isFinite(input.pgid) ? input.pgid : (Number.isFinite(current.pgid) ? current.pgid : null),
    agentId,
    provider,
    backend,
    conversationId: patchedText(input, current, "conversationId"),
    agentType: textOrNull(input.agentType ?? input.agent_type) ?? textOrNull(current.agentType) ?? "acp",
    command: patchedText(input, current, "command"),
    processStartToken: patchedText(input, current, "processStartToken"),
    status: textOrNull(input.status) ?? textOrNull(current.status) ?? "running",
    staleReason: textOrNull(input.staleReason) ?? textOrNull(current.staleReason),
    startedAt: timestamp(input.startedAt ?? current.startedAt),
    updatedAt: Date.now(),
  };
}

async function readPersistentRegistry() {
  const raw = await readJsonLikeFile(processRegistryFile());
  if (raw?.namespace && raw.namespace !== registryConfig.namespace) {
    return { version: 1, namespace: registryConfig.namespace, processes: [], foreign: true };
  }
  const records = Array.isArray(raw?.processes)
    ? raw.processes.map((item) => normalizeProcessRecord(item)).filter(Boolean)
    : [];
  return { version: 1, namespace: registryConfig.namespace, processes: records, foreign: false };
}

async function writePersistentRegistry(records) {
  const existing = await readJsonLikeFile(processRegistryFile());
  if (existing?.namespace && existing.namespace !== registryConfig.namespace) return;
  await writeJsonFile(processRegistryFile(), { version: 1, namespace: registryConfig.namespace, processes: records });
}

function enqueueRegistryOperation(operation) {
  const result = registryWriteQueue
    .catch(() => undefined)
    .then(operation);
  registryWriteQueue = result.catch(() => undefined);
  return result;
}

function persistRegistryBestEffort() {
  void enqueueRegistryOperation(
    // Resolve the snapshot when this queued write actually runs. Capturing it
    // at registration time can resurrect a stale record that startup cleanup
    // removes before this write reaches the head of the queue.
    () => writePersistentRegistry([...processes.values()]),
  ).catch(() => undefined);
}

export async function flushAgentProcessRegistry() {
  await enqueueRegistryOperation(() => writePersistentRegistry([...processes.values()]));
}

export function registerAgentProcess(input = {}) {
  let record = normalizeProcessRecord(input);
  if (!record) return null;
  if (record.pid && !record.processStartToken) {
    record = normalizeProcessRecord({
      ...record,
      processStartToken: readProcessStartToken(record.pid),
    }, record);
  }
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
  return enqueueRegistryOperation(async () => {
    const markStale = options.markStale !== false;
    const startedBeforeMs = Number(options.startedBeforeMs);
    const startupScoped = Number.isFinite(startedBeforeMs) && startedBeforeMs > 0;
    const registry = await readPersistentRegistry();
    if (registry.foreign) return { processes: [] };
    if (!startupScoped) processes.clear();
    const persisted = new Map(registry.processes.map((record) => [record.runId, record]));
    const recoveredProcesses = [];
    for (const record of registry.processes) {
      if (startupScoped && Number(record.startedAt) >= startedBeforeMs) continue;
      // A process registered after this runtime started owns its in-memory
      // record. Never replace it with a stale snapshot from disk.
      const current = processes.get(record.runId);
      if (startupScoped && current && Number(current.startedAt) >= startedBeforeMs) {
        persisted.set(current.runId, current);
        continue;
      }
      const recovered = markStale
        ? normalizeProcessRecord({ ...record, status: "stale", staleReason: "runtime_restarted" }, record)
        : normalizeProcessRecord(record);
      if (recovered) {
        processes.set(recovered.runId, recovered);
        persisted.set(recovered.runId, recovered);
        recoveredProcesses.push(recovered);
      }
    }
    if (startupScoped) {
      for (const current of processes.values()) {
        if (Number(current.startedAt) >= startedBeforeMs) persisted.set(current.runId, current);
      }
    }
    if (markStale) {
      await writePersistentRegistry(startupScoped ? [...persisted.values()] : [...processes.values()]);
    }
    return { processes: startupScoped ? recoveredProcesses : listAgentProcesses() };
  });
}

export function clearAgentProcesses(options = {}) {
  processes.clear();
  crashHistory.clear();
  if (options.persist !== false) persistRegistryBestEffort();
}

// On startup / shutdown, the registry may still hold processes from a previous
// runtime session that died or restarted mid-run (they were only marked
// `stale` by `recoverAgentProcesses`, never actually reaped). Reap every live
// tree: SIGTERM the whole process group, wait a grace window, then SIGKILL
// whatever is still alive. This mirrors AionUi's
// `cleanupRegisteredAgentProcesses` and is the missing link that lets
// `reconcileOrphanRuns` reclaim "running" runs whose underlying process is
// merely *hung* (pid still alive, e.g. blocked on network) rather than gone.
export async function cleanupRegisteredAgentProcesses(options = {}) {
  return enqueueRegistryOperation(async () => {
    const graceMs = Number(options.graceMs) > 0 ? Number(options.graceMs) : CLEANUP_GRACE_MS;
    const startedBeforeMs = Number(options.startedBeforeMs);
    const startupScoped = Number.isFinite(startedBeforeMs) && startedBeforeMs > 0;
    const registry = await readPersistentRegistry();
    if (registry.foreign) return { killed: [] };
    const survivors = [];
    const killed = [];
    const unverified = [];
    const isAlive = typeof options.isProcessTreeAlive === "function" ? options.isProcessTreeAlive : isProcessTreeAlive;
    const terminate = typeof options.terminateProcessTreeByPid === "function" ? options.terminateProcessTreeByPid : terminateProcessTreeByPid;
    const matchIdentity = typeof options.matchProcessStartToken === "function" ? options.matchProcessStartToken : matchProcessStartToken;
    for (const record of registry.processes) {
      // Deferred startup cleanup must only reap records that predate this
      // runtime. Runs started during the defer window are live work owned by the
      // current process, not restart orphans.
      if (startupScoped && Number(record.startedAt) >= startedBeforeMs) {
        survivors.push(record);
        continue;
      }
      if (isAlive(record)) {
        const identity = matchIdentity(record);
        if (!identity?.matches) {
          const survivor = normalizeProcessRecord({
            ...record,
            status: "stale",
            staleReason: identity?.reason ?? "process_identity_unavailable",
          }, record);
          if (survivor) {
            survivors.push(survivor);
            processes.set(survivor.runId, survivor);
          }
          unverified.push(record.runId);
          continue;
        }
        const termination = await terminate({
          pid: record.pid,
          pgid: record.pgid,
          processStartToken: record.processStartToken,
          graceMs,
        });
        if (termination?.terminated === false) {
          const survivor = normalizeProcessRecord({
            ...record,
            status: "stale",
            staleReason: termination.reason ?? "process_termination_failed",
          }, record);
          if (survivor) {
            survivors.push(survivor);
            processes.set(survivor.runId, survivor);
          }
          unverified.push(record.runId);
          continue;
        }
      }
      // A record that is now dead (or was already dead) has been reaped: drop it
      // from the registry and report it. Anything still alive could not be killed
      // (e.g. insufficient permission) — keep it so we do not lose track of it.
      if (isAlive(record)) {
        survivors.push(record);
      } else {
        killed.push(record.runId);
        processes.delete(record.runId);
      }
    }
    const persisted = new Map(survivors.map((record) => [record.runId, record]));
    if (startupScoped) {
      // A current-session registration may land while an old tree is waiting
      // through its termination grace period. Merge the live in-memory records
      // so this cleanup write cannot erase that concurrent registration.
      for (const current of processes.values()) {
        if (Number(current.startedAt) >= startedBeforeMs) persisted.set(current.runId, current);
      }
    }
    await writePersistentRegistry([...persisted.values()]);
    return { killed, unverified };
  });
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
