// @ts-check

import { taskOrchestratorOperationsDiagnosticsSchema } from "@onmyagent/types/task-orchestrator";

/**
 * Secret-free Task Center operations projector.
 *
 * This module intentionally accepts plain snapshots and does not read the
 * filesystem, inspect processes, or retain provider payloads. The caller is
 * responsible for obtaining the run/process/health snapshots from the
 * durable store; this projector only returns bounded operational facts.
 */

const DEFAULT_MAX_BYTES = 24 * 1024;
const MIN_MAX_BYTES = 1_024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_TEXT = 240;
const MAX_STATES = 24;
const MAX_PIDS = 32;
const ACTIVE_PROCESS_STATES = new Set(["starting", "running", "stopping", "active"]);
const PROCESS_STATES = new Set([
  "starting",
  "running",
  "stopping",
  "active",
  "exited",
  "failed",
  "cancelled",
  "stopped",
  "terminated",
  "tombstoned",
  "stale",
  "missing",
  "unknown",
]);
const ATTEMPT_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "waiting-approval",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value) {
  return isRecord(value) ? value : {};
}

function finiteInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function resolveNow(value) {
  try {
    const candidate = typeof value === "function" ? value() : (value ?? Date.now());
    return finiteInteger(candidate, Date.now());
  } catch {
    return Date.now();
  }
}

function boundedText(value, max = MAX_TEXT) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text || text.length > max) return text ? text.slice(0, max) : null;
  return text;
}

function safeRawText(value, max = MAX_TEXT) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const text = raw.trim();
  if (!text || text.length > max) return text ? text.slice(0, max) : null;
  return text;
}

function safeIdentifier(value) {
  const text = safeRawText(value, MAX_TEXT);
  if (!text || text.length > MAX_TEXT || /[\\/]/.test(text) || !/^[A-Za-z0-9._:-]+$/.test(text)) return null;
  if (/^(?:\.|\.\.|.*(?:secret|token|password|api[_-]?key|authorization).*)$/i.test(text)) return null;
  return text;
}

function safeProviderText(value) {
  const text = safeRawText(value, MAX_TEXT);
  if (!text) return null;
  if (/https?:\/\/|bearer\s|authorization|api[_-]?key|secret|token|password|private[_-]?key|\b(?:workdir|cwd|home|pathname)\b/i.test(text)) return null;
  // Provider diagnostics are labels, not paths.  Reject all separators so
  // relative traversal and basename leaks cannot cross the projector.
  if (/[\\/]/.test(text) || /^(?:~|\.{1,2})(?:$|[\\/])/.test(text) || /^[A-Za-z]:/.test(text)) return null;
  return text;
}

function ageMs(at, now) {
  const timestamp = finiteInteger(at);
  if (timestamp === null) return null;
  return Math.max(0, now - timestamp);
}

function idFrom(value) {
  return safeIdentifier(value);
}

function runFromInput(input) {
  const root = record(input);
  const snapshot = record(root.snapshot);
  return record(root.run ?? snapshot.run ?? (snapshot.status ? snapshot : null));
}

function attemptsFor(run, input) {
  const root = record(input);
  const explicit = Array.isArray(root.attempts) ? root.attempts : [];
  const entries = [
    ...(Array.isArray(run.primaryAttempts) ? run.primaryAttempts.map((attempt) => ({ attempt, kind: "primary" })) : []),
    ...(Array.isArray(run.workerAttempts) ? run.workerAttempts.map((attempt) => ({ attempt, kind: "worker" })) : []),
    ...(Array.isArray(run.checkerAttempts) ? run.checkerAttempts.map((attempt) => ({ attempt, kind: "checker" })) : []),
    ...explicit.map((attempt) => ({ attempt, kind: String(attempt?.kind ?? "unknown") })),
  ].filter((entry) => isRecord(entry.attempt));
  const seen = new Set();
  return entries.filter((entry) => {
    const id = idFrom(entry.attempt.id);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "blocked", "cancelled"]);
const ACTIVE_ATTEMPT_STATUSES = new Set(["pending", "ready", "running", "waiting-approval"]);

function attemptTimestamp(attempt) {
  return finiteInteger(attempt.finishedAt ?? attempt.updatedAt ?? attempt.startedAt ?? attempt.createdAt, -1) ?? -1;
}

function attemptKindRank(kind) {
  return kind === "primary" ? 3 : kind === "checker" ? 2 : kind === "worker" ? 1 : 0;
}

function isActiveAttempt(entry) {
  const status = String(entry.attempt.status ?? "").trim().toLowerCase();
  if (ACTIVE_ATTEMPT_STATUSES.has(status)) return true;
  // A lease is stronger evidence than an unrecognized status, provided the
  // status is not terminal. This keeps an active leased attempt visible when
  // a provider reports a transient state we do not yet understand.
  return Boolean(idFrom(entry.attempt.leaseId)) && !TERMINAL_ATTEMPT_STATUSES.has(status);
}

function currentAttempt(run, input) {
  const entries = attemptsFor(run, input);
  const attempts = entries.map((entry) => entry.attempt);
  const root = record(input);
  const requestedId = idFrom(run.currentAttemptId ?? run.primaryAttemptId);
  const explicit = isRecord(root.attempt) ? { attempt: root.attempt, kind: String(root.attempt.kind ?? "unknown") } : null;
  const candidates = explicit && isActiveAttempt(explicit) ? [explicit, ...entries] : entries;
  const active = candidates.filter(isActiveAttempt);
  if (active.length) {
    active.sort((left, right) => {
      const leftStatus = String(left.attempt.status ?? "").toLowerCase();
      const rightStatus = String(right.attempt.status ?? "").toLowerCase();
      const statusRank = (status) => status === "running" ? 4 : status === "waiting-approval" ? 3 : status === "ready" ? 2 : status === "pending" ? 1 : 0;
      return statusRank(rightStatus) - statusRank(leftStatus)
        || attemptKindRank(right.kind) - attemptKindRank(left.kind)
        || Number(Boolean(idFrom(right.attempt.leaseId))) - Number(Boolean(idFrom(left.attempt.leaseId)))
        || attemptTimestamp(right.attempt) - attemptTimestamp(left.attempt)
        || String(left.attempt.id ?? "").localeCompare(String(right.attempt.id ?? ""));
    });
    return active[0].attempt;
  }
  const terminal = candidates.filter((entry) => !isActiveAttempt(entry));
  terminal.sort((left, right) => attemptTimestamp(right.attempt) - attemptTimestamp(left.attempt)
    || attemptKindRank(right.kind) - attemptKindRank(left.kind)
    || String(left.attempt.id ?? "").localeCompare(String(right.attempt.id ?? "")));
  // A terminal currentAttemptId is only a tie-breaker when timestamps are
  // equal; latest relevant attempt wins deterministically on completed runs.
  if (requestedId) {
    const requested = terminal.find((entry) => idFrom(entry.attempt.id) === requestedId);
    if (requested && attemptTimestamp(requested.attempt) >= attemptTimestamp(terminal[0]?.attempt)) return requested.attempt;
  }
  return terminal[0]?.attempt ?? attempts[0] ?? null;
}

function terminalReason(run) {
  const status = String(run.status ?? "").trim().toLowerCase();
  const error = String(run.error ?? currentAttempt(run, {})?.error ?? "").toLowerCase();
  if (status === "paused" || run.pause?.status === "paused" || run.pause?.state === "paused" || /\brun[_ -]?paused\b/.test(error)) return {
    code: "RUN_PAUSED",
    category: "paused",
    message: "The task run is paused and can be resumed.",
  };
  if (status === "succeeded" || status === "completed") return {
    code: "RUN_SUCCEEDED",
    category: "completed",
    message: "Task run completed.",
  };
  if (status === "cancelled" || /\bcancelled\b|\bcanceled\b/.test(error)) return {
    code: "TASK_CANCELLED",
    category: "cancelled",
    message: "Task run was cancelled.",
  };
  if (/desktop (?:shut|restart)|supervisor.*(?:restart|shutdown)|not replayed/.test(error)) return {
    code: "SUPERVISOR_INTERRUPTED",
    category: "lifecycle",
    message: "The desktop stopped during an active task attempt.",
  };
  if (/timed?\s*out|timeout|deadline|wall[- ]clock/.test(error)) return {
    code: "TASK_RUNTIME_TIMEOUT",
    category: "timeout",
    message: "The task runtime deadline was exceeded.",
  };
  if (/approval|permission|waiting[- ]approval/.test(error) || status === "waiting-approval") return {
    code: "APPROVAL_REQUIRED",
    category: "approval",
    message: "The task is waiting for an approval decision.",
  };
  if (/side effect|unknown outcome|reconcile/.test(error)) return {
    code: "SIDE_EFFECT_UNCERTAIN",
    category: "safety",
    message: "A provider side effect has an uncertain outcome.",
  };
  if (/lease|stale|fence/.test(error)) return {
    code: "LEASE_LOST",
    category: "orchestration",
    message: "The task attempt lease is no longer current.",
  };
  if (/sqlite|database|storage|disk|no space|write failure|persist/.test(error)) return {
    code: "TASK_STORAGE_ERROR",
    category: "storage",
    message: "The task state could not be persisted safely.",
  };
  if (/provider|personal|acp|agent/.test(error)) return {
    code: "PROVIDER_ERROR",
    category: "provider",
    message: "The local provider attempt failed.",
  };
  if (status === "blocked") return {
    code: "TASK_BLOCKED",
    category: "blocked",
    message: "The task run is blocked and requires recovery or review.",
  };
  if (["failed", "error"].includes(status)) return {
    code: "TASK_FAILED",
    category: "failure",
    message: "The task run failed.",
  };
  if (["queued", "running", "checkpointing", "pausing", "backoff"].includes(status)) return {
    code: "RUN_ACTIVE",
    category: "active",
    message: "The task run is still active.",
  };
  return {
    code: "RUN_UNKNOWN",
    category: "unknown",
    message: "The task run state is unavailable.",
  };
}

function attemptDiagnostics(run, input, now) {
  const attempt = currentAttempt(run, input);
  if (!attempt) return {
    attemptId: null,
    status: "unknown",
    leaseId: null,
    leaseAgeMs: null,
    leaseExpiresAt: null,
    progressAt: null,
    progressAgeMs: null,
  };
  const statusValue = String(attempt.status ?? "unknown").trim().toLowerCase();
  const status = ATTEMPT_STATUSES.has(statusValue) ? statusValue : "unknown";
  const leaseId = idFrom(attempt.leaseId);
  const leaseStartedAt = attempt.leaseAcquiredAt ?? attempt.leaseStartedAt ?? (leaseId ? attempt.startedAt : null);
  const explicitLeaseExpiry = finiteInteger(attempt.leaseExpiresAt ?? attempt.leaseExpires ?? attempt.expiresAt);
  const startedAt = finiteInteger(leaseStartedAt);
  const timeoutMs = finiteInteger(attempt.timeoutMs);
  const derivedLeaseExpiry = leaseId !== null && startedAt !== null && timeoutMs !== null
    && startedAt <= Number.MAX_SAFE_INTEGER - timeoutMs
    ? startedAt + timeoutMs
    : null;
  const progressAt = finiteInteger(
    attempt.progressAt
      ?? attempt.lastProgressAt
      ?? record(attempt.progress).at
      ?? record(attempt.lastProgress).at,
  );
  return {
    attemptId: idFrom(attempt.id),
    status,
    leaseId,
    leaseAgeMs: leaseId ? ageMs(leaseStartedAt, now) : null,
    leaseExpiresAt: explicitLeaseExpiry ?? derivedLeaseExpiry,
    progressAt,
    progressAgeMs: ageMs(progressAt, now),
  };
}

function providerDiagnostics(run, input) {
  const root = record(input);
  const attempt = currentAttempt(run, input);
  const snapshot = record(root.snapshot);
  const diagnostic = record(root.providerDiagnostics ?? attempt?.providerDiagnostics ?? snapshot.providerDiagnostics);
  const providerSnapshot = record(root.provider ?? snapshot.provider);
  const source = { ...providerSnapshot, ...snapshot, ...diagnostic };
  const session = safeIdentifier(source.session ?? source.providerSessionId ?? source.sessionId);
  const effectiveModel = safeProviderText(source.effectiveModel ?? source.model ?? source.modelId);
  const transport = safeProviderText(source.transport);
  const connectionMode = safeProviderText(source.connectionMode);
  const requestId = safeIdentifier(source.requestId ?? source.request_id);
  const fallbackCandidate = source.fallbackCount ?? source.transportFallbackCount ?? source.fallback_count ?? source.transport_fallback_count;
  const fallbackCount = finiteInteger(fallbackCandidate);
  const observed = Boolean(session || effectiveModel || transport || connectionMode || requestId || fallbackCount !== null);
  return { session, effectiveModel, transport, connectionMode, requestId, fallbackCount: fallbackCount ?? 0, observed };
}

function contextDiagnostics(run, input) {
  const root = record(input);
  const attempt = currentAttempt(run, input);
  const currentTurn = Array.isArray(run.turns)
    ? run.turns.find((turn) => idFrom(turn?.id) === idFrom(run.currentTurnId))
    : null;
  const snapshot = record(root.snapshot);
  const usage = record(root.context ?? root.contextUsage ?? attempt?.context ?? currentTurn?.context ?? snapshot.contextUsage);
  const usedTokens = finiteInteger(usage.usedTokens ?? usage.used);
  const totalTokens = finiteInteger(usage.totalTokens ?? usage.total);
  const percentValue = Number(usage.percent);
  const percent = Number.isFinite(percentValue) && percentValue >= 0 && percentValue <= 100
    ? Math.round(percentValue * 100) / 100
    : usedTokens !== null && totalTokens !== null && totalTokens > 0
      ? Math.min(100, Math.max(0, Math.round((usedTokens / totalTokens) * 10_000) / 100))
      : null;
  const sourceValue = String(usage.source ?? usage.totalSource ?? "unknown");
  const source = ["runtime", "catalog", "table", "default", "unknown"].includes(sourceValue) ? sourceValue : "unknown";
  const modelId = safeProviderText(usage.modelId);
  const observedAt = finiteInteger(usage.observedAt);
  const observed = Boolean(usedTokens !== null || totalTokens !== null || percent !== null || modelId || observedAt !== null);
  return { usedTokens, totalTokens, percent, source, modelId, observedAt, observed };
}

function retryDiagnostics(run) {
  const budget = record(run.budget);
  const turns = Array.isArray(run.turns) ? run.turns : [];
  const primaryAttempts = Array.isArray(run.primaryAttempts) ? run.primaryAttempts : [];
  const workerAttempts = Array.isArray(run.workerAttempts) ? run.workerAttempts : [];
  let consecutiveFailures = 0;
  for (const attempt of [...primaryAttempts].reverse()) {
    if (!["failed", "blocked", "cancelled"].includes(String(attempt?.status))) break;
    consecutiveFailures += 1;
  }
  return {
    transportRetries: finiteInteger(budget.transportRetries, turns.filter((turn) => turn?.reason === "transport-retry").length) ?? 0,
    consecutiveFailures: finiteInteger(budget.consecutiveFailures, consecutiveFailures) ?? 0,
    primaryTurnsUsed: finiteInteger(budget.primaryTurnsUsed, turns.length) ?? 0,
    workerAttemptsUsed: finiteInteger(budget.workerAttemptsUsed, workerAttempts.length) ?? 0,
  };
}

function processDiagnostics(input) {
  const root = record(input);
  const aggregate = record(root.processAggregate ?? root.processSummary);
  if (Number.isSafeInteger(Number(aggregate.count)) && Number(aggregate.count) >= 0
    && isRecord(aggregate.states) && Array.isArray(aggregate.pids)) {
    const states = Object.fromEntries(Object.entries(aggregate.states)
      .map(([name, count]) => [String(name), finiteInteger(count, 0) ?? 0])
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_STATES));
    const pids = [...new Set(aggregate.pids.map((pid) => finiteInteger(pid)).filter((pid) => pid !== null && pid > 0 && pid <= 2_147_483_647))]
      .sort((left, right) => left - right).slice(0, MAX_PIDS);
    return {
      count: Number(aggregate.count),
      active: finiteInteger(aggregate.active, 0) ?? 0,
      states,
      pids,
    };
  }
  const rows = Array.isArray(root.processRows)
    ? root.processRows
    : Array.isArray(root.processes)
      ? root.processes
      : Array.isArray(record(root.snapshot).processes) ? record(root.snapshot).processes : [];
  const states = new Map();
  const pids = new Set();
  let active = 0;
  for (const row of rows.slice(0, 10_000)) {
    const rawStatus = String(record(row).status ?? "unknown").toLowerCase();
    const status = PROCESS_STATES.has(rawStatus) ? rawStatus : "unknown";
    states.set(status, (states.get(status) ?? 0) + 1);
    if (ACTIVE_PROCESS_STATES.has(status)) active += 1;
    const pid = finiteInteger(record(row).pid);
    if (pid !== null && pid > 0 && pid <= 2_147_483_647) pids.add(pid);
  }
  const stateEntries = [...states.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_STATES);
  return {
    count: rows.length,
    active,
    states: Object.fromEntries(stateEntries),
    pids: [...pids].sort((left, right) => left - right).slice(0, MAX_PIDS),
  };
}

function storageDiagnostics(input) {
  const root = record(input);
  const health = record(root.health ?? root.storeHealth ?? record(root.snapshot).health);
  const hasHealth = Object.keys(health).length > 0 && health.observed !== false;
  if (!hasHealth) return {
    observed: false,
    observedAt: null,
    stale: false,
    healthy: null,
    databaseBytes: null,
    reclaimableBytes: null,
    outboxCount: null,
    processCount: null,
    lastMaintenanceAt: null,
  };
  const storage = record(health.storage);
  const rows = record(health.rows);
  return {
    observed: true,
    observedAt: finiteInteger(health.observedAt),
    stale: health.stale === true,
    healthy: health.healthy === true || health.healthy === false ? health.healthy : null,
    databaseBytes: finiteInteger(storage.databaseBytes),
    reclaimableBytes: finiteInteger(storage.reclaimableBytes),
    outboxCount: finiteInteger(rows.outbox),
    processCount: finiteInteger(rows.processes),
    lastMaintenanceAt: finiteInteger(record(health.lastMaintenance).ranAt),
  };
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function boundedResult(value, maxBytes) {
  if (byteLength(value) <= maxBytes) return value;
  const minimal = {
    version: 1,
    generatedAt: value.generatedAt,
    terminalReason: value.terminalReason,
    attempt: {
      attemptId: value.attempt.attemptId,
      status: value.attempt.status,
      leaseId: value.attempt.leaseId,
      leaseAgeMs: value.attempt.leaseAgeMs,
      leaseExpiresAt: value.attempt.leaseExpiresAt,
      progressAt: value.attempt.progressAt,
      progressAgeMs: value.attempt.progressAgeMs,
    },
    context: { usedTokens: null, totalTokens: null, percent: null, source: "unknown", modelId: null, observedAt: null, observed: false },
    retries: value.retries,
    provider: {
      session: null,
      effectiveModel: null,
      transport: null,
      connectionMode: null,
      requestId: null,
      fallbackCount: 0,
      observed: false,
    },
    processes: { count: value.processes.count, active: value.processes.active, states: {}, pids: [] },
    storage: value.storage,
    truncated: true,
  };
  if (byteLength(minimal) <= maxBytes) return minimal;
  return { version: 1, generatedAt: value.generatedAt, truncated: true };
}

/**
 * Build a bounded operations diagnostic snapshot.
 *
 * @param {{run?: unknown, snapshot?: unknown, attempt?: unknown, attempts?: unknown[], processRows?: unknown[], processes?: unknown[], processAggregate?: unknown, processSummary?: unknown, health?: unknown, storeHealth?: unknown, now?: number | (() => number), maxBytes?: number}} [input]
 */
export function projectOperationsDiagnostics(input = {}) {
  const root = record(input);
  const run = runFromInput(root);
  const now = resolveNow(root.now);
  const requestedMax = Number(root.maxBytes ?? DEFAULT_MAX_BYTES);
  const maxBytes = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.min(MAX_OUTPUT_BYTES, Math.max(MIN_MAX_BYTES, Math.floor(requestedMax)))
    : DEFAULT_MAX_BYTES;
  const result = {
    version: 1,
    generatedAt: now,
    terminalReason: terminalReason(run),
    attempt: attemptDiagnostics(run, root, now),
    context: contextDiagnostics(run, root),
    retries: retryDiagnostics(run),
    provider: providerDiagnostics(run, root),
    processes: processDiagnostics(root),
    storage: storageDiagnostics(root),
    truncated: false,
  };
  return taskOrchestratorOperationsDiagnosticsSchema.parse(boundedResult(result, maxBytes));
}

export const buildOperationsDiagnostics = projectOperationsDiagnostics;

export const OPERATIONS_DIAGNOSTICS_MIN_BYTES = MIN_MAX_BYTES;
