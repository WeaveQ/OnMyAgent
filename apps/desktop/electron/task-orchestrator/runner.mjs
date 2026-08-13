import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASK_ORCHESTRATOR_SCHEMA_VERSION } from "@onmyagent/types/task-orchestrator";

import { completionReviewGate, createApprovalGateSynchronizer, terminalGateForInterruptedRun } from "./approval-gates.mjs";
import { taskControlMcpCallForApproval } from "./alignment-approvals.mjs";
import { runtimeEvidence } from "./runtime-evidence.mjs";
import {
  createPrimaryDecisionController,
  decisionForAttempt,
  decisionKindForTool,
} from "./primary-decisions.mjs";
import { createSideEffectController, unsafeUnknownSideEffects, untrustedObservedSideEffects } from "./side-effects.mjs";
import { isTransientProviderFailure, retryBackoffMs } from "./retry-policy.mjs";
import { createGlobalAdmissionScheduler } from "./global-scheduler.mjs";
import { classifyLiveness } from "./liveness-oracle.mjs";
import { withRuntimeDeadline } from "./runtime-deadline.mjs";
import { createTaskRuntimeOperationController } from "./runtime-operation.mjs";
import { classifyProcessTruth } from "./process-truth.mjs";
import {
  createContextUsagePersistenceState,
  observeContextUsageForPersistence,
} from "./context-usage-persistence.mjs";
import {
  attachWorkerToTurn,
  buildContinuationRecords,
  contextUsageFromSnapshot,
  continuationPrompt,
  createTurn,
  endConditionViolation,
  refreshRunBudget,
  turnForAttempt,
} from "./turns.mjs";
import {
  buildCheckerInput,
  checkerEligibility,
  checkerFeedbackCapsule,
  checkerPrompt,
  checkerVerdictForRound,
  createCheckerAttempt,
  parseCheckerVerdict,
} from "./independent-checker.mjs";
import { providerDiagnosticsFromResult, providerUsageFromResult } from "../personal-agent-runtime/run-helpers.mjs";
import {
  ACTIVE_ATTEMPT_STATUSES,
  ACTIVE_RUN_STATUSES,
  PERSONAL_TERMINAL_STATUSES,
  allAttempts,
  clone,
  createAttempt,
  currentAttempt,
  checkerProfileForRun,
  findAttempt,
  messageOf,
  normalizeOutput,
  profileForAttempt,
  runtimeApprovalMode,
  taskPrompt,
} from "./definitions.mjs";

const EXECUTION_TASK_TOOLS = [
  "get_task_state",
  "list_agents",
  "spawn_agent",
  "send_message",
  "wait_agent",
  "close_agent",
  "checkpoint_task",
  "continue_task",
  "complete_task",
  "block_task",
  "realign_task",
];
const UNKNOWN_CONTEXT_FALLBACK_MS = 90 * 60_000;
const TERMINAL_PROGRESS_STATUSES = new Set(["completed", "failed", "cancelled"]);
// Cleanup/reconciliation treats `pausing` and `waiting-approval` as active,
// but neither state may acquire a fresh attempt lease. In particular, this
// fences an admission granted immediately before a durable pause request.
const ATTEMPT_START_RUN_STATUSES = new Set(["queued", "running", "checkpointing", "backoff"]);
const TASK_MCP_POLL_MIN_MS = 30;
const TASK_MCP_POLL_MAX_MS = 500;

/** @typedef {Error & { runtimeCleanupAttempted?: boolean, runtimeCleanupOk?: boolean }} RuntimeCleanupError */

async function requireTaskWorkdir(value) {
  const workdir = String(value ?? "").trim();
  if (!workdir) throw new Error("Task workspace root is required");
  if (!path.isAbsolute(workdir)) throw new Error("Task workspace root must be absolute");
  const info = await stat(workdir).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Task workspace root must be an existing directory");
  return workdir;
}

function contractHash(contract) {
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

/** Start an app-userData-backed MCP queue owned by the Electron supervisor. */
export async function createTaskControlMcpBridge({
  queueRoot,
  token,
  invoke,
  alignment = false,
  requestTimeoutMs = 900_000,
  /** Tests may force the Electron launch contract without running Electron. */
  electronRuntime = Boolean(process.versions?.electron),
  execPath = process.execPath,
  persistResponse = async (temporary, target, response) => {
    await writeFile(temporary, JSON.stringify(response), "utf8");
    await rename(temporary, target);
  },
  readRequest = (requestPath) => readFile(requestPath, "utf8"),
  onFatal = (_error) => undefined,
  watchRequests = (directory, listener) => watch(directory, listener),
  pollMinMs = TASK_MCP_POLL_MIN_MS,
  pollMaxMs = TASK_MCP_POLL_MAX_MS,
}) {
  const root = path.resolve(queueRoot);
  const requests = path.join(root, "requests");
  const processing = path.join(root, "processing");
  const responses = path.join(root, "responses");
  await mkdir(requests, { recursive: true });
  await mkdir(processing, { recursive: true });
  await mkdir(responses, { recursive: true });
  let stopped = false;
  let polling = false;
  let fatalError = null;
  let pollTimer = null;
  let watcher = null;
  let wakeRequested = false;
  let pollCount = 0;
  let watchWakeups = 0;
  let poisonRequests = 0;
  let unknownOutcomeRecoveries = 0;
  const minimumDelay = Math.max(5, Math.min(1_000, Number(pollMinMs) || TASK_MCP_POLL_MIN_MS));
  const maximumDelay = Math.max(minimumDelay, Math.min(5_000, Number(pollMaxMs) || TASK_MCP_POLL_MAX_MS));
  let idleDelay = minimumDelay;
  // A request is atomically claimed by moving it out of the provider-owned
  // inbox. If the Supervisor dies after invoke begins but before response
  // commit, the next owner must fail closed instead of replaying a possibly
  // completed spawn/mutation. A committed response wins and only needs claim
  // cleanup.
  for (const entry of await readdir(processing, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const processingPath = path.join(processing, entry.name);
    let request = null;
    try { request = JSON.parse(await readFile(processingPath, "utf8")); } catch { /* recovered poison */ }
    const requestId = String(request?.id ?? entry.name.replace(/\.json$/, ""));
    const target = path.join(responses, `${requestId}.json`);
    const responseExists = await stat(target).then(() => true, () => false);
    if (!responseExists) {
      const temporary = `${target}.${process.pid}.tmp`;
      await persistResponse(temporary, target, {
        id: request?.id ?? requestId,
        error: "Task control request outcome is unknown after Supervisor recovery; it was not replayed",
        code: "TASK_CONTROL_OUTCOME_UNKNOWN",
      });
      unknownOutcomeRecoveries += 1;
    }
    await rm(processingPath, { force: true });
  }
  const clearScheduledPoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };
  const schedulePoll = (delay = idleDelay) => {
    if (stopped || pollTimer) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, Math.max(0, delay));
    pollTimer.unref?.();
  };
  const wake = () => {
    if (stopped) return;
    watchWakeups += 1;
    idleDelay = minimumDelay;
    if (polling) {
      wakeRequested = true;
      return;
    }
    clearScheduledPoll();
    schedulePoll(0);
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    pollCount += 1;
    let processed = 0;
    try {
      for (const entry of await readdir(requests, { withFileTypes: true }).catch(() => [])) {
        if (stopped || !entry.isFile() || !entry.name.endsWith(".json")) continue;
        const requestPath = path.join(requests, entry.name);
        const processingPath = path.join(processing, entry.name);
        try { await rename(requestPath, processingPath); } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
        let request;
        try { request = JSON.parse(await readRequest(processingPath)); } catch {
          poisonRequests += 1;
          await rm(processingPath, { force: true }).catch(() => undefined);
          continue;
        }
        if (stopped) break;
        let response;
        try {
          if (String(request?.token ?? "") !== String(token)) throw new Error("Task control bridge token is invalid");
          response = { id: request.id, result: await invoke(String(request.tool ?? ""), request.arguments ?? {}) };
        } catch (error) {
          response = { id: request?.id ?? null, error: messageOf(error) };
        }
        // close() owns the queue lifetime. A host callback may be waiting on a
        // provider indefinitely, so never let a late callback recreate or
        // write into a queue after that lifetime has been fenced.
        if (stopped) break;
        const target = path.join(responses, `${String(request?.id ?? entry.name.replace(/\.json$/, ""))}.json`);
        const temporary = `${target}.${process.pid}.tmp`;
        try {
          await persistResponse(temporary, target, response);
          await rm(processingPath, { force: true }).catch(() => undefined);
          processed += 1;
        } catch (error) {
          if (stopped) break;
          fatalError = error instanceof Error ? error : new Error(String(error));
          stopped = true;
          clearScheduledPoll();
          watcher?.close?.();
          watcher = null;
          await Promise.resolve(onFatal(fatalError)).catch(() => undefined);
          break;
        }
      }
    } finally {
      polling = false;
      const shouldWake = wakeRequested;
      wakeRequested = false;
      if (!stopped) {
        idleDelay = processed > 0 || shouldWake
          ? minimumDelay
          : Math.min(maximumDelay, Math.max(minimumDelay, idleDelay * 2));
        schedulePoll(shouldWake ? 0 : idleDelay);
      }
    }
  };
  try {
    watcher = watchRequests(requests, wake);
    watcher?.on?.("error", () => {
      watcher?.close?.();
      watcher = null;
      schedulePoll(minimumDelay);
    });
    watcher?.unref?.();
  } catch {
    watcher = null;
  }
  schedulePoll(0);
  const bridgePath = fileURLToPath(new URL("./task-control-mcp.mjs", import.meta.url));
  const boundedRequestTimeoutMs = Math.max(1_000, Math.min(14_400_000, Number(requestTimeoutMs) || 900_000));
  return {
    mcpServers: [{
      name: "onmyagent-task-control",
      command: execPath,
      args: [bridgePath, root, String(token), `--timeout-ms=${Math.trunc(boundedRequestTimeoutMs)}`, ...(alignment ? ["--alignment"] : [])],
      // ACP stdio MCP descriptors require an array of name/value entries.
      // Invalid objects are silently dropped by real codex-acp schema parsing.
      // Electron's executable is not Node unless this flag is present.  Keep
      // the Node test/default descriptor empty so direct ACP processes retain
      // their inherited environment, while real Electron launches reliably
      // enter Node mode instead of opening another GUI process.
      env: electronRuntime ? [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }] : [],
    }],
    taskTools: alignment ? ["propose_contract"] : EXECUTION_TASK_TOOLS,
    getError: () => fatalError,
    pollingStats: () => ({ pollCount, watchWakeups, idleDelay, watching: watcher !== null, poisonRequests, unknownOutcomeRecoveries }),
    close: async () => {
      stopped = true;
      clearScheduledPoll();
      watcher?.close?.();
      watcher = null;
      // Do not await an untrusted host callback here. `stopped` is the durable
      // lifetime fence above; unresolved Promises do not keep Node alive, and
      // a late result is forbidden from persisting a response.
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * Electron-owned execution kernel. The Personal runtime owns provider
 * conversations; this runner owns leases, attempts, delegation policy and all
 * durable state transitions. A task-scoped control surface is passed as data to
 * the primary runtime. Renderer IPC never receives these closures.
 */
export function createTaskOrchestratorRunner(options) {
  const {
    personalAgentRuntime,
    store,
    now,
    createId,
    sleep,
    pollMs,
    serialized,
    emit,
    notify,
    onCancellationConfirmed,
    isClosed,
    runtimeCallTimeoutMs,
    preflightAttempt,
  } = options;
  const supervisorEpoch = String(options.supervisorEpoch ?? store.supervisorEpoch ?? "").trim() || null;
  const suspendIntervals = [];
  let suspendedAt = null;

  function recordPowerEvent(input = {}) {
    const type = String(input.type ?? "");
    const at = Number(input.at ?? now());
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("power event timestamp is invalid");
    if (type === "suspend") {
      if (suspendedAt === null) suspendedAt = at;
    } else if (type === "resume") {
      if (suspendedAt !== null && at >= suspendedAt) suspendIntervals.push({ from: suspendedAt, to: at });
      suspendedAt = null;
      while (suspendIntervals.length > 100) suspendIntervals.shift();
    } else throw new Error("power event type must be suspend or resume");
    return { suspended: suspendedAt !== null, suspendedAt, intervals: suspendIntervals.length };
  }

  function suspendedDurationBetween(from, to) {
    let duration = 0;
    for (const interval of suspendIntervals) {
      duration += Math.max(0, Math.min(to, interval.to) - Math.max(from, interval.from));
    }
    if (suspendedAt !== null) duration += Math.max(0, to - Math.max(from, suspendedAt));
    return Math.min(Math.max(0, to - from), duration);
  }
  // Executions are independent attempts. A primary may spawn a worker while
  // its own Personal run is still active, so serializing by taskRunId would
  // deadlock the primary's wait_agent call. Keep one promise per attempt and
  // deduplicate repeated launch requests for that same attempt.
  const activeExecutions = new Map();
  const admissionTickets = new Map();
  const processRecords = new Map();
  const processSnapshots = new Map();
  const activeTaskControlBridges = new Set();
  const taskControlTotals = { bridges: 0, pollCount: 0, watchWakeups: 0, poisonRequests: 0, unknownOutcomeRecoveries: 0 };
  const scheduleReadyTimer = options.readyWakeSetTimeout ?? setTimeout;
  const clearReadyTimer = options.readyWakeClearTimeout ?? clearTimeout;
  let readyWakeTimer = null;
  let readyWakeAt = null;
  let readyReconcileFlight = null;
  const admissionScheduler = options.admissionScheduler ?? createGlobalAdmissionScheduler({
    maxActiveAttempts: options.maxGlobalActiveAttempts ?? 4,
    reservedWorkerSlots: options.reservedWorkerSlots,
    now,
  });
  const synchronizeApprovalGates = createApprovalGateSynchronizer({
    store,
    now,
    createId,
    serialized,
    emit,
    notify,
    cancelAttempt: ({ personalRunId, reason }) => cancelRuntimeAttempt(personalRunId, null, reason),
    onCancellationConfirmed,
  });
  const primaryDecisions = createPrimaryDecisionController({ store, serialized, now, createId, emit });
  const sideEffects = createSideEffectController({ store, serialized, now, createId });
  const evaluateAttemptLiveness = typeof options.evaluateAttemptLiveness === "function"
    ? options.evaluateAttemptLiveness
    : classifyLiveness;
  const runtimeOperations = createTaskRuntimeOperationController({
    personalAgentRuntime,
    createId,
    timeoutMs: runtimeCallTimeoutMs,
  });

  async function runtimeCall(label, operation) {
    return withRuntimeDeadline(label, runtimeCallTimeoutMs, operation);
  }

  function providerUsage(result) {
    const usage = providerUsageFromResult(result);
    return usage ? { ...usage, observedAt: now() } : null;
  }

  /**
   * Fence a Personal provider call before changing durable attempt state. The
   * Personal runtime normally performs its own process-tree escalation; the
   * second bounded call is only for a wedged runtime boundary and prevents a
   * Task attempt from retaining a lease forever.
   */
  async function cancelRuntimeRun(personalRunId, reason) {
    if (!String(personalRunId ?? "").trim()) return { ok: true, skipped: true };
    let result;
    try {
      result = await runtimeCall(`Personal cancelRun (${reason})`, () => personalAgentRuntime.cancelRun(personalRunId, { reason }));
    } catch (error) {
      if (error?.code !== "TASK_RUNTIME_CALL_TIMEOUT") {
        return { ok: false, error: messageOf(error), cause: error };
      }
      try {
        result = await runtimeCall(`Personal cancelRun escalation (${reason})`, () => personalAgentRuntime.cancelRun(personalRunId, {
          reason: `${reason}-escalation`,
          escalation: true,
          force: true,
        }));
      } catch (escalationError) {
        return { ok: false, error: messageOf(escalationError), cause: escalationError, escalated: true };
      }
    }
    return result?.ok === false
      ? { ok: false, error: messageOf(result.error) || "Personal runtime rejected cancellation", result }
      : { ok: true, result };
  }

  async function cancelRuntimeAttempt(personalRunId, operationId, reason) {
    let operationCancellation = null;
    if (operationId) operationCancellation = await runtimeOperations.cancel(operationId, reason);
    if (operationCancellation?.ok === true) return operationCancellation;
    const runCancellation = await cancelRuntimeRun(personalRunId, reason);
    if (runCancellation?.ok === true) return runCancellation;
    return {
      ok: false,
      error: [operationCancellation?.error, runCancellation?.error].filter(Boolean).join("; ") || "Provider cancellation was not confirmed",
      operationCancellation,
      runCancellation,
    };
  }

  function runtimeCleanupError(error, cancellation) {
    const next = /** @type {RuntimeCleanupError} */ (error instanceof Error ? error : new Error(messageOf(error)));
    next.runtimeCleanupAttempted = true;
    next.runtimeCleanupOk = cancellation?.ok === true;
    if (cancellation?.ok !== true) {
      next.message = `${next.message}; provider cancellation was not confirmed: ${cancellation?.error || "unknown cancellation failure"}`;
    }
    return next;
  }

  function processRecordId(taskRunId, attemptId, personalRunId, snapshot) {
    const explicit = String(snapshot?.processId ?? snapshot?.process?.id ?? "").trim();
    if (explicit) return explicit.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120);
    const run = String(personalRunId ?? "").trim();
    if (!run) return null;
    return `process-${taskRunId}-${attemptId}-${run}`.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120);
  }

  function processTruthForSnapshot(snapshot, statusOverride = null) {
    const process = snapshot?.process && typeof snapshot.process === "object" ? snapshot.process : {};
    const status = statusOverride ?? snapshot?.status;
    // A provider run status alone is not proof that its child process exited;
    // cancellation/missing/unknown and terminal provider statuses all remain
    // unconfirmed until the process/child reports an explicit termination.
    return classifyProcessTruth({
      ...snapshot,
      status,
      processState: process.state ?? process.status,
      childState: process.childState ?? snapshot?.childState,
      exitCode: process.exitCode ?? snapshot?.exitCode,
      terminationConfirmed: snapshot?.terminationConfirmed === true || process.terminationConfirmed === true,
      exitConfirmed: snapshot?.exitConfirmed === true || process.exitConfirmed === true,
      childExitConfirmed: snapshot?.childExitConfirmed === true || process.childExitConfirmed === true,
    });
  }

  async function syncProcessRecord(taskId, taskRunId, attempt, personalRunId, snapshot, statusOverride = null) {
    if (typeof store.upsertProcess !== "function") return null;
    const process = snapshot?.process && typeof snapshot.process === "object" ? snapshot.process : snapshot;
    const pidValue = process?.pid ?? snapshot?.pid;
    const pid = pidValue == null ? null : Number(pidValue);
    // The Personal run id is a recoverable lifecycle identity even before the
    // ACP adapter reports its PID. Persist a `starting` row first, then enrich
    // it with PID/start-token data as provider events arrive.
    const hasIdentity = Number.isInteger(pid) && pid > 0 || process?.processStartToken || process?.pgid || personalRunId;
    const id = processRecordId(taskRunId, attempt.id, personalRunId, snapshot);
    if (!id || !hasIdentity) return null;
    const truth = processTruthForSnapshot(snapshot, statusOverride);
    const status = statusOverride
      ?? (truth.tombstone ? "exited" : truth.status === "unknown" ? (snapshot?.pid || process?.pid ? "running" : "starting") : truth.status);
    const record = {
      id,
      runId: taskRunId,
      attemptId: attempt.id,
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      status,
      processStartToken: process?.processStartToken ?? snapshot?.processStartToken ?? null,
      ownerEpoch: supervisorEpoch,
      provider: attempt.profileId,
      personalRunId,
      conversationId: attempt.conversationId,
      process: {
        pid: Number.isInteger(pid) && pid > 0 ? pid : null,
        pgid: process?.pgid ?? snapshot?.pgid ?? null,
        processStartToken: process?.processStartToken ?? snapshot?.processStartToken ?? null,
        state: process?.state ?? process?.status ?? snapshot?.state ?? null,
        childState: process?.childState ?? snapshot?.childState ?? null,
      },
      updatedAt: now(),
    };
    processRecords.set(`${taskRunId}:${attempt.id}`, id);
    processSnapshots.set(`${taskRunId}:${attempt.id}`, snapshot ?? null);
    await store.upsertProcess(record);
    return id;
  }

  async function tombstoneProcessFor(taskRunId, attemptId, snapshot = null) {
    const id = processRecords.get(`${taskRunId}:${attemptId}`);
    if (!id || typeof store.tombstoneProcess !== "function") return false;
    const observed = snapshot ?? processSnapshots.get(`${taskRunId}:${attemptId}`) ?? null;
    const truth = processTruthForSnapshot(observed);
    if (!truth.tombstone) return false;
    try { return await store.tombstoneProcess({ id, status: "exited" }); } catch { return false; }
  }

  function releaseProcessObservation(taskRunId, attemptId) {
    const key = `${taskRunId}:${attemptId}`;
    processRecords.delete(key);
    processSnapshots.delete(key);
  }

  function attemptFor(run, id) {
    return findAttempt(run, id);
  }

  async function leaseIsActive(taskId, taskRunId, attemptId, leaseId) {
    const run = await store.requireRun(taskId, taskRunId);
    const attempt = attemptFor(run, attemptId);
    if (!(ACTIVE_RUN_STATUSES.has(run.status) && attempt && ACTIVE_ATTEMPT_STATUSES.has(attempt.status) && attempt.leaseId === leaseId)) return false;
    if (typeof store.isLeaseCurrent === "function") {
      return store.isLeaseCurrent({ taskRunId, attemptId, leaseId, supervisorEpoch: supervisorEpoch ?? undefined });
    }
    return true;
  }

  async function reconcileActiveRuns(input = {}) {
    const shutdown = input.trigger === "shutdown";
    const cancelReason = shutdown ? "task-orchestrator-shutdown" : "task-orchestrator-reconcile";
    const plans = await serialized(async () => {
      const plans = [];
      for (const persisted of await store.allRuns()) {
        const attempts = allAttempts(persisted);
        const durableManualReview = persisted.status === "waiting-approval"
          && allAttempts(persisted).every((attempt) => !attempt.leaseId && !ACTIVE_ATTEMPT_STATUSES.has(attempt.status))
          && (await store.readGates(persisted.taskId, persisted.id)).some((gate) => (
            gate.kind === "manual-review" && (gate.status === "pending" || gate.status === "resolving")
          ));
        if (durableManualReview) continue;
        if (!ACTIVE_RUN_STATUSES.has(persisted.status)) {
          // Terminal runs are not replayed. Only a still-live attempt/process
          // row merits one bounded cancellation; tombstones prevent startup
          // from issuing the same cancellation on every restart.
          const liveAttempts = attempts.filter((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId);
          const processRows = typeof store.listProcesses === "function"
            ? await store.listProcesses({ runId: persisted.id, includeTerminal: false })
            : [];
          const personalRunIds = new Map();
          for (const attempt of liveAttempts) {
            const id = String(attempt.personalRunId ?? "").trim();
            if (id) personalRunIds.set(id, { runId: id, taskRunId: persisted.id, attemptId: attempt.id, processIds: [] });
          }
          for (const process of processRows) {
            const id = String(process.personalRunId ?? "").trim();
            if (!id) continue;
            if (!personalRunIds.has(id)) personalRunIds.set(id, { runId: id, taskRunId: persisted.id, attemptId: process.attemptId ?? null, processIds: [] });
            personalRunIds.get(id).processIds.push(process.id);
          }
          if (personalRunIds.size) plans.push({ run: persisted, cancelRequests: [...personalRunIds.values()], processIds: processRows.map((row) => row.id) });
          continue;
        }
        const readyAttempts = allAttempts(persisted).filter((attempt) => attempt.status === "ready" && !attempt.leaseId);
        // A queued/backoff run has no provider to reconcile. Its ready
        // attempts are the durable admission queue and must survive a
        // Supervisor restart; the startup sweep below reconstructs them.
        const legacyQueuedRecovery = persisted.status === "queued"
          && (persisted.definition.executionProtocol === "provider-completion-v2"
            || persisted.turns.length === 0
            || allAttempts(persisted).every((attempt) => !attempt.turnId));
        if (!shutdown && !legacyQueuedRecovery && readyAttempts.length > 0 && ["queued", "backoff", "running", "checkpointing"].includes(persisted.status)
          && allAttempts(persisted).every((attempt) => !ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.status === "ready")) {
          continue;
        }
        const run = clone(persisted);
        const current = currentAttempt(run);
        const active = current && (ACTIVE_ATTEMPT_STATUSES.has(current.status) || current.leaseId)
          ? current
          : allAttempts(run).find((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId) ?? null;
        const reason = `Desktop ${shutdown ? "shut down" : "restarted"} during an active primary/worker attempt; the run was blocked and was not replayed.`;
        const personalIds = new Map();
        for (const attempt of attempts) {
          const personalRunId = String(attempt.personalRunId ?? "").trim();
          if (personalRunId && (ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId)) {
            personalIds.set(personalRunId, { runId: personalRunId, taskRunId: persisted.id, attemptId: attempt.id, processIds: [] });
          }
        }
        for (const attempt of allAttempts(run)) {
          if (ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) {
            attempt.status = "blocked";
            attempt.leaseId = null;
            attempt.error = reason;
            attempt.updatedAt = now();
            attempt.finishedAt = now();
          }
        }
        const interruptedTurn = active ? turnForAttempt(run, active) : null;
        if (interruptedTurn && !["succeeded", "failed", "blocked", "cancelled", "paused"].includes(interruptedTurn.status)) {
          interruptedTurn.status = "blocked";
          interruptedTurn.updatedAt = now();
          interruptedTurn.finishedAt = now();
        }
        run.status = "blocked";
        run.error = reason;
        run.updatedAt = now();
        run.finishedAt = now();
        await store.writeRun(run);
        for (const gate of await store.readGates(run.taskId, run.id)) {
          const terminal = terminalGateForInterruptedRun(gate, now());
          if (terminal !== gate) await store.writeGate(terminal);
        }
        await emit(run, "run-reconciled", reason, active?.id ?? null);
        await emit(run, "run-blocked", reason, active?.id ?? null);
        const processRows = typeof store.listProcesses === "function"
          ? await store.listProcesses({ runId: persisted.id, includeTerminal: false })
          : [];
        for (const process of processRows) {
          const personalRunId = String(process.personalRunId ?? "").trim();
          if (!personalRunId) continue;
          if (!personalIds.has(personalRunId)) personalIds.set(personalRunId, { runId: personalRunId, taskRunId: persisted.id, attemptId: process.attemptId ?? null, processIds: [] });
          personalIds.get(personalRunId).processIds.push(process.id);
        }
        plans.push({ run, cancelRequests: [...personalIds.values()], processIds: processRows.map((row) => row.id) });
      }
      return plans;
    });
    const requests = [...new Map(plans.flatMap((plan) => plan.cancelRequests ?? []).map((request) => [request.runId, request])).values()];
    const settled = await Promise.allSettled(requests.map((request) => cancelRuntimeRun(request.runId, cancelReason)));
    const failures = [];
    for (let index = 0; index < settled.length; index += 1) {
      const entry = settled[index];
      const request = requests[index];
      if (entry.status === "rejected") failures.push({ request, error: messageOf(entry.reason) });
      else if (entry.value?.ok === false) failures.push({ request, error: String(entry.value.error || "provider cancellation was not confirmed") });
      else if (typeof store.tombstoneProcess === "function") {
        const processIds = plans.flatMap((plan) => plan.cancelRequests?.filter((candidate) => candidate.runId === request.runId).flatMap((candidate) => candidate.processIds ?? []) ?? []);
        await Promise.allSettled([...new Set(processIds)].map((id) => store.tombstoneProcess({ id, status: "cancelled" })));
      }
    }
    if (failures.length) {
      await serialized(async () => {
        for (const failure of failures) {
          const located = await store.findRun?.(failure.request.taskRunId);
          if (!located || located.run.status !== "blocked") continue;
          const run = located.run;
          run.error = `${run.error || "Task runtime was interrupted during reconciliation."} Provider cancellation was not confirmed: ${failure.error}`.slice(0, 8_000);
          run.updatedAt = now();
          await store.writeRun(run);
          await emit(run, "run-blocked", run.error, failure.request.attemptId);
        }
      });
    }
    return { plans, cancellationFailures: failures };
  }

  function clearReadyWake() {
    if (readyWakeTimer) clearReadyTimer(readyWakeTimer);
    readyWakeTimer = null;
    readyWakeAt = null;
  }

  function scheduleReadyWake(timestamp) {
    const target = Number(timestamp);
    if (isClosed() || !Number.isSafeInteger(target) || target < 0) return;
    if (readyWakeTimer && readyWakeAt !== null && readyWakeAt <= target) return;
    clearReadyWake();
    readyWakeAt = target;
    readyWakeTimer = scheduleReadyTimer(() => {
      readyWakeTimer = null;
      readyWakeAt = null;
      void reconcileReadyAttempts().catch(() => undefined);
    }, Math.min(2_147_483_647, Math.max(0, target - now())));
    readyWakeTimer.unref?.();
  }

  async function reconcileReadyAttemptsOnce() {
    if (typeof store.listReadyAttempts !== "function") return [];
    const ready = [];
    let cursor = null;
    let nextNotBefore = null;
    const readyAt = now();
    do {
      const page = await store.listReadyAttempts({ limit: 200, cursor, readyAt });
      const items = Array.isArray(page) ? page : page?.items ?? [];
      ready.push(...items);
      const pageNotBefore = Array.isArray(page) ? null : page?.nextNotBefore;
      if (Number.isSafeInteger(pageNotBefore)) {
        nextNotBefore = nextNotBefore === null ? pageNotBefore : Math.min(nextNotBefore, pageNotBefore);
      }
      cursor = !Array.isArray(page) && page?.hasMore ? page.nextCursor : null;
    } while (cursor);
    if (nextNotBefore !== null) scheduleReadyWake(nextNotBefore);
    const restorable = [];
    for (const item of ready) {
      if (!item?.taskId || !item.taskRunId || !item.attempt?.id) continue;
      const executionKey = `${item.taskRunId}:${item.attempt.id}`;
      if (activeExecutions.has(executionKey)) continue;
      restorable.push(item);
    }
    const tickets = admissionScheduler.restore(restorable.map((item) => ({
      runId: item.taskRunId,
      attemptId: item.attempt.id,
      kind: item.kind ?? (item.attempt.kind === "worker" ? "worker" : "primary"),
      priority: item.priority,
      sequence: item.sequence,
      enqueuedAt: item.enqueuedAt,
    })));
    const ticketsByKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
    for (const item of restorable) {
      const key = `${item.taskRunId}\u0000${item.attempt.id}`;
      launch(item.taskId, item.taskRunId, item.attempt.id, {
        ...item,
        ticket: ticketsByKey.get(key) ?? null,
      });
    }
    return restorable;
  }

  function reconcileReadyAttempts() {
    if (readyReconcileFlight) return readyReconcileFlight;
    const flight = reconcileReadyAttemptsOnce().finally(() => {
      if (readyReconcileFlight === flight) readyReconcileFlight = null;
    });
    readyReconcileFlight = flight;
    return flight;
  }

  async function persistAttempt(taskId, taskRunId, attemptId, leaseId, values) {
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = attemptFor(run, attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return false;
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return false;
      const { context: turnContext, ...attemptValues } = values ?? {};
      Object.assign(attempt, attemptValues, { updatedAt: now() });
      if (turnContext !== undefined) {
        const turn = turnForAttempt(run, attempt);
        if (turn) turn.context = turnContext;
      }
      run.updatedAt = now();
      if (Object.prototype.hasOwnProperty.call(attemptValues, "providerUsage")) refreshRunBudget(run, now);
      await store.writeRun(run);
      return true;
    });
  }

  async function persistTerminalContext(taskId, taskRunId, attemptId, leaseId, snapshot, modelId = null) {
    const context = contextUsageFromSnapshot(snapshot, now, modelId);
    if (!context) return true;
    const status = typeof snapshot?.status === "string" && snapshot.status.trim() ? snapshot.status.trim() : null;
    const leaseCurrent = await leaseIsActive(taskId, taskRunId, attemptId, leaseId);
    const decision = observeContextUsageForPersistence({
      state: createContextUsagePersistenceState(),
      usage: context,
      status,
      leaseCurrent,
    });
    if (!leaseCurrent) return false;
    if (!decision.persist) return true;
    return persistAttempt(taskId, taskRunId, attemptId, leaseId, {
      context: decision.usage,
      progressAt: now(),
    });
  }

  async function beginAttempt(taskId, taskRunId, attemptId) {
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = attemptFor(run, attemptId);
      if (!attempt || attempt.status !== "ready" || !ATTEMPT_START_RUN_STATUSES.has(run.status)) return null;
      const violation = endConditionViolation(run, now);
      if (violation) {
        const kind = attempt.kind ?? "checker";
        attempt.status = "blocked";
        attempt.leaseId = null;
        attempt.error = violation;
        attempt.updatedAt = now();
        attempt.finishedAt = now();
        run.currentAttemptId = kind === "checker" ? run.primaryAttemptId : attempt.id;
        run.status = "blocked";
        run.error = violation;
        run.updatedAt = now();
        run.finishedAt = now();
        await store.writeRun(run);
        await emit(run, "budget-warning", violation, attempt.id);
        if (kind === "checker") await emit(run, "checker-failed", violation, attempt.id);
        await emit(run, "run-blocked", violation, attempt.id);
        return null;
      }
      const leaseId = createId("lease");
      const firstStart = run.startedAt === null;
      const startedAt = now();
      const kind = attempt.kind ?? "checker";
      Object.assign(attempt, { status: "running", leaseId, startedAt, progressAt: startedAt, notBefore: null, updatedAt: startedAt, error: null });
      const turn = turnForAttempt(run, attempt);
      if (turn && kind === "primary") {
        turn.status = "running";
        turn.startedAt ??= now();
        turn.updatedAt = now();
      }
      run.status = "running";
      run.currentAttemptId = kind === "checker" ? run.primaryAttemptId : attempt.id;
      run.startedAt ??= now();
      run.updatedAt = now();
      run.finishedAt = null;
      run.error = null;
      refreshRunBudget(run, now);
      await store.writeRun(run);
      if (firstStart) await emit(run, "run-started", "Task execution started.", attempt.id);
      if (kind === "primary" && turn) await emit(run, "turn-started", `Turn ${turn.sequence} started.`, attempt.id);
      await emit(run, kind === "checker" ? "checker-running" : kind === "primary" ? "primary-started" : "worker-started", `${kind} attempt started.`, attempt.id);
      return { run, attempt, leaseId };
    });
  }

  async function assertProviderStartAllowed(taskId, taskRunId, attemptId, leaseId) {
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = attemptFor(run, attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ATTEMPT_START_RUN_STATUSES.has(run.status)) return false;
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return false;
      const violation = endConditionViolation(run, now);
      if (!violation) return true;
      const kind = attempt.kind ?? "checker";
      attempt.status = "blocked";
      attempt.leaseId = null;
      attempt.error = violation;
      attempt.updatedAt = now();
      attempt.finishedAt = now();
      run.currentAttemptId = kind === "checker" ? run.primaryAttemptId : attempt.id;
      run.status = "blocked";
      run.error = violation;
      run.updatedAt = now();
      run.finishedAt = now();
      const turn = kind === "primary" ? turnForAttempt(run, attempt) : null;
      if (turn) {
        turn.status = "blocked";
        turn.updatedAt = now();
        turn.finishedAt = now();
      }
      await store.writeRun(run);
      await emit(run, "budget-warning", violation, attempt.id);
      if (kind === "checker") await emit(run, "checker-failed", violation, attempt.id);
      await emit(run, "run-blocked", violation, attempt.id);
      return false;
    });
  }

  async function cancelOrphanPersonalRun(personalRunId, reason) {
    if (!personalRunId) return;
    await cancelRuntimeRun(personalRunId, reason);
  }

  async function failAttempt(taskId, taskRunId, attemptId, leaseId, error, status = "failed") {
    const cancellationRunIds = await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = attemptFor(run, attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return [];
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return [];
      const message = String(error || "Personal local agent failed").slice(0, 8_000);
      const terminalStatus = ["cancelled", "blocked"].includes(status) ? status : "failed";
      attempt.status = terminalStatus;
      attempt.leaseId = null;
      attempt.error = message;
      attempt.updatedAt = now();
      attempt.finishedAt = now();
      run.currentAttemptId = attempt.id;
      run.updatedAt = now();
      const personalRunIds = [];
      const cancelledWorkers = [];
      if (attempt.kind === "primary") {
        for (const worker of run.workerAttempts) {
          if (!ACTIVE_ATTEMPT_STATUSES.has(worker.status) && !worker.leaseId) continue;
          if (worker.personalRunId) personalRunIds.push(worker.personalRunId);
          worker.status = "cancelled";
          worker.leaseId = null;
          worker.error = `Primary attempt ended ${terminalStatus}; the worker lease was revoked.`;
          worker.updatedAt = now();
          worker.finishedAt = now();
          cancelledWorkers.push(worker);
        }
        run.status = terminalStatus;
        run.error = message;
        run.finishedAt = now();
        const turn = turnForAttempt(run, attempt);
        if (turn) {
          turn.status = terminalStatus;
          turn.updatedAt = now();
          turn.finishedAt = now();
        }
      } else {
        // A worker result belongs to the primary's control flow. Keep the run
        // active so wait_agent can return the terminal worker and the primary
        // may choose a bounded follow-up or finish with its own conclusion.
        run.status = "running";
        run.error = null;
        run.finishedAt = null;
      }
      refreshRunBudget(run, now);
      await store.writeRun(run);
      const eventType = attempt.kind === "primary"
        ? terminalStatus === "cancelled" ? "run-cancelled" : "primary-failed"
        : "worker-failed";
      await emit(run, eventType, message, attempt.id);
      if (attempt.kind === "primary" && terminalStatus === "failed") await emit(run, "run-failed", message, attempt.id);
      if (attempt.kind === "primary" && terminalStatus === "blocked") await emit(run, "run-blocked", message, attempt.id);
      for (const worker of cancelledWorkers) {
        await emit(run, "worker-closed", worker.error, worker.id);
      }
      return personalRunIds;
    });
    await Promise.allSettled(cancellationRunIds.map((personalRunId) => cancelRuntimeRun(personalRunId, "task-primary-terminal")));
    await maybeFinishRun(taskId, taskRunId);
  }

  function workersAreTerminal(run) {
    return run.workerAttempts.every((attempt) => !ACTIVE_ATTEMPT_STATUSES.has(attempt.status) && attempt.status !== "pending");
  }

  async function blockRunForEndCondition(run, attempt, violation) {
    const message = String(violation || "Task end condition prevented completion").slice(0, 8_000);
    run.status = "blocked";
    run.currentAttemptId = attempt?.id ?? run.currentAttemptId;
    run.error = message;
    run.updatedAt = now();
    run.finishedAt = now();
    const turn = attempt ? turnForAttempt(run, attempt) : null;
    if (turn) {
      turn.status = "blocked";
      turn.updatedAt = now();
      turn.finishedAt = now();
    }
    await store.writeRun(run);
    await emit(run, "budget-warning", message, attempt?.id ?? null);
    await emit(run, "run-blocked", message, attempt?.id ?? null);
  }

  function progressSignature(snapshot) {
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    const last = events.at(-1);
    const context = snapshot?.contextUsage ?? snapshot?.context ?? snapshot?.usage ?? {};
    return [
      snapshot?.status ?? "",
      String(snapshot?.output ?? "").length,
      events.length,
      last?.at ?? "",
      last?.type ?? "",
      Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals.length : 0,
      Number.isFinite(Number(context?.usedTokens ?? context?.used ?? context?.inputTokens))
        ? Number(context.usedTokens ?? context.used ?? context.inputTokens)
        : "",
      Number.isFinite(Number(context?.totalTokens ?? context?.total))
        ? Number(context.totalTokens ?? context.total)
        : "",
      Number.isFinite(Number(context?.percent ?? context?.percentage))
        ? Number(context.percent ?? context.percentage)
        : "",
    ].join(":");
  }

  function snapshotHasWorkingTool(snapshot) {
    const latest = new Map();
    for (const event of Array.isArray(snapshot?.events) ? snapshot.events : []) {
      if (event?.type !== "tool" && event?.type !== "acp_tool_call") continue;
      const call = event.toolCall ?? event.update ?? {};
      const id = String(call.id ?? call.toolCallId ?? call.tool_call_id ?? "").trim();
      if (!id) continue;
      latest.set(id, String(call.status ?? call.state ?? "").toLowerCase().replaceAll("_", "-"));
    }
    return [...latest.values()].some((status) => ["pending", "running", "in-progress", "started"].includes(status));
  }

  function livenessObservation(snapshot, activeObservedAt, activeProgressAt) {
    const process = snapshot?.process && typeof snapshot.process === "object" ? snapshot.process : {};
    const pid = Number(process.pid ?? snapshot?.pid);
    const validPid = Number.isInteger(pid) && pid > 0;
    const childState = ["running", "exited", "none", "unknown"].includes(String(process.childState ?? snapshot?.childState ?? ""))
      ? String(process.childState ?? snapshot?.childState)
      : null;
    const processState = ["running", "exited", "missing", "unknown"].includes(String(process.state ?? snapshot?.processState ?? ""))
      ? String(process.state ?? snapshot?.processState)
      : snapshot?.status === "missing" ? "missing" : "running";
    const pendingApproval = snapshot?.status === "waiting-approval" || Boolean(snapshot?.pendingApprovals?.length);
    const stdinWaiting = snapshot?.waitingForInput === true || snapshot?.stdinWaiting === true || snapshot?.status === "waiting-input";
    const cpuDeltaMs = Number(process.cpuDeltaMs ?? snapshot?.cpuDeltaMs);
    const ioDeltaBytes = Number(process.ioDeltaBytes ?? snapshot?.ioDeltaBytes);
    const hasSocket = typeof (process.socketEstablished ?? snapshot?.socketEstablished) === "boolean";
    const observation = {
      process: validPid ? { pid, state: processState } : {},
      child: childState ? {
        state: childState,
        ...(Number.isFinite(Number(process.childExitedAt ?? snapshot?.childExitedAt))
          ? { exitedAt: Number(process.childExitedAt ?? snapshot?.childExitedAt) }
          : {}),
      } : {},
      declaredWait: pendingApproval ? { active: true, kind: "approval" } : { active: false },
      stdin: { waiting: stdinWaiting },
      socket: hasSocket ? {
        established: Boolean(process.socketEstablished ?? snapshot?.socketEstablished),
        moving: Boolean(process.socketMoving ?? snapshot?.socketMoving),
      } : {},
      activity: {
        lastProgressAt: activeProgressAt,
        ...(Number.isFinite(cpuDeltaMs) && cpuDeltaMs >= 0 ? { cpuDeltaMs } : {}),
        ...(Number.isFinite(ioDeltaBytes) && ioDeltaBytes >= 0 ? { ioDeltaBytes } : {}),
      },
      exclusions: { sleepMs: 0, approvalMs: 0 },
    };
    return { observation, now: activeObservedAt };
  }

  async function contextCheckpointRequested(input, snapshot, elapsedMs, hardTurnMs) {
    if (input.kind !== "primary") return false;
    const run = await store.requireRun(input.taskId, input.taskRunId);
    if (decisionForAttempt(run, input.attemptId)) return false;
    const context = contextUsageFromSnapshot(snapshot, now, run.definition.primary.model);
    const fallbackAt = Math.max(60_000, Math.min(UNKNOWN_CONTEXT_FALLBACK_MS, Math.floor(hardTurnMs * 0.75)));
    const contextThresholdReached = context?.percent != null
      && context.percent >= run.definition.endConditions.contextRolloverPercent;
    const fallbackThresholdReached = context?.percent == null
      && elapsedMs >= fallbackAt
      && snapshot?.status !== "waiting-approval"
      && !(snapshot?.pendingApprovals?.length)
      && !snapshotHasWorkingTool(snapshot);
    if (!contextThresholdReached && !fallbackThresholdReached) return false;
    if (unsafeUnknownSideEffects(run, [input.attemptId]).length) return false;
    await primaryDecisions.record(input.taskId, input.taskRunId, input.attemptId, "checkpoint", {
      summary: contextThresholdReached
        ? `Automatic context rollover at ${Math.round(context.percent)}% of the provider context window.`
        : `Automatic time-based context rollover after ${elapsedMs}ms because the provider did not report usable context telemetry.`,
      nextAction: "Reuse the durable evidence excerpts and artifact ids from this checkpoint. Do not repeat already covered scans; inspect only missing criteria, synthesize the deliverable, then record exactly one structured task decision.",
      acceptanceResults: [],
    });
    const cancellation = await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-context-rollover");
    if (cancellation?.ok !== true) {
      throw runtimeCleanupError(new Error(`Task context rollover could not fence the old provider run: ${messageOf(cancellation?.error || "cancellation was not confirmed")}`), cancellation);
    }
    return true;
  }

  async function assertSideEffectIntent(taskId, taskRunId, attemptId) {
    const run = await store.requireRun(taskId, taskRunId);
    const untrusted = untrustedObservedSideEffects(run, [attemptId]);
    if (untrusted.length) {
      throw new Error(`Provider executed ${untrusted.length} side effect(s) without a durable pre-execute intent`);
    }
  }

  async function queueIndependentChecker(taskId, taskRunId) {
    const queued = await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const artifacts = await store.readArtifacts(taskId, taskRunId);
      const eligibility = checkerEligibility(run, artifacts);
      if (!eligibility.eligible) return null;
      const budgetViolation = endConditionViolation(run, now, { requireKnownUsage: true });
      if (budgetViolation) {
        const primary = run.primaryAttempts.find((candidate) => candidate.id === run.primaryAttemptId) ?? null;
        await blockRunForEndCondition(run, primary, budgetViolation);
        return null;
      }
      const profile = checkerProfileForRun(run);
      const attempt = createCheckerAttempt({
        id: createId("checker"),
        now,
        run,
        primaryDecision: eligibility.decision,
        profile,
        round: eligibility.round,
        prompt: "Independent acceptance verification.",
      });
      const input = buildCheckerInput(run, eligibility.decision, artifacts, attempt);
      attempt.prompt = checkerPrompt(input);
      const primary = run.primaryAttempts.find((candidate) => candidate.id === eligibility.decision.attemptId) ?? null;
      const turn = primary ? turnForAttempt(run, primary) : null;
      if (!turn || eligibility.decision.turnId !== turn.id) {
        throw new Error("Independent checker decision must reference the current primary turn");
      }
      if (turn.decisionId && turn.decisionId !== eligibility.decision.id) {
        throw new Error("Independent checker turn already references a different primary decision");
      }
      turn.decisionId = eligibility.decision.id;
      turn.updatedAt = now();
      run.checkerAttempts ??= [];
      run.checkerAttempts.push(attempt);
      run.currentAttemptId = run.primaryAttemptId;
      run.status = "queued";
      run.error = null;
      run.updatedAt = now();
      run.finishedAt = null;
      await store.writeRun(run);
      await emit(run, "checker-started", `Independent checker round ${attempt.round} queued.`, attempt.id);
      return attempt;
    });
    if (queued) launch(taskId, taskRunId, queued.id);
    return queued;
  }

  async function blockChecker(taskId, taskRunId, attemptId, leaseId, error) {
    await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = (run.checkerAttempts ?? []).find((candidate) => candidate.id === attemptId);
      if (!attempt || (leaseId !== null && attempt.leaseId !== leaseId) || !ACTIVE_RUN_STATUSES.has(run.status)) return;
      attempt.status = "blocked";
      attempt.leaseId = null;
      attempt.error = String(error || "Independent checker failed closed").slice(0, 8_000);
      attempt.updatedAt = now();
      attempt.finishedAt = now();
      run.currentAttemptId = run.primaryAttemptId;
      run.status = "blocked";
      run.error = attempt.error;
      run.updatedAt = now();
      run.finishedAt = now();
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, "checker-failed", attempt.error, attempt.id);
      await emit(run, "run-blocked", attempt.error, attempt.id);
    });
  }

  async function finalizeCheckerVerdict(taskId, taskRunId, attemptId, leaseId, snapshot) {
    const artifacts = await store.readArtifacts(taskId, taskRunId);
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = (run.checkerAttempts ?? []).find((candidate) => candidate.id === attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return null;
      const primaryDecision = (run.primaryDecisions ?? []).find((decision) => decision.id === attempt.primaryDecisionId);
      if (!primaryDecision) throw new Error("Independent checker primary decision is missing");
      const input = buildCheckerInput(run, primaryDecision, artifacts, attempt);
      const raw = parseCheckerVerdict(snapshot?.output, { ...input, checkerAttemptId: attempt.id, createdAt: now() }, artifacts.map((artifact) => artifact.id));
      const verdict = { ...raw, id: createId("checker-verdict"), checkerAttemptId: attempt.id, createdAt: now() };
      attempt.status = "succeeded";
      attempt.leaseId = null;
      attempt.progressAt = now();
      attempt.error = null;
      attempt.updatedAt = now();
      attempt.finishedAt = now();
      run.checkerVerdicts ??= [];
      if (!run.checkerVerdicts.some((existing) => existing.round === verdict.round && existing.primaryDecisionId === verdict.primaryDecisionId)) {
        run.checkerVerdicts.push(verdict);
      }
      run.currentAttemptId = run.primaryAttemptId;
      run.updatedAt = now();
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, "checker-verdict", `Independent checker round ${verdict.round}: ${verdict.verdict}.`, attempt.id);
      return { run, attempt, verdict };
    });
  }

  async function reviseAfterChecker(taskId, taskRunId, verdict) {
    const next = await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const primary = run.primaryAttempts.find((attempt) => attempt.id === run.primaryAttemptId);
      const turn = primary ? turnForAttempt(run, primary) : null;
      if (!primary || !turn) throw new Error("Independent checker revision requires the current primary turn");
      const artifacts = await store.readArtifacts(taskId, taskRunId);
      const capsuleId = createId("capsule");
      const checkpointId = createId("checkpoint");
      const capsule = {
        capsuleVersion: 1,
        id: capsuleId,
        fromTurnId: turn.id,
        taskId: run.taskId,
        taskRunId: run.id,
        taskRevision: run.taskRevision,
        contractHash: run.permissionGrant?.contractHash ?? contractHash(run.definition.contract),
        workspaceRootHash: createHash("sha256").update(run.definition.workspaceRoot).digest("hex"),
        summary: checkerFeedbackCapsule(verdict),
        completed: [],
        pending: run.definition.contract.acceptance.map((criterion, index) => `Re-check criterion ${index + 1}: ${criterion}`),
        risks: verdict.feedback ? [verdict.feedback] : [],
        artifactIds: artifacts.map((artifact) => artifact.id).slice(-100),
        workspaceEvidence: [],
        acceptanceResults: verdict.criterionResults,
        workerMail: [],
        remainingBudget: run.budget ? { primaryTurns: Math.max(0, run.definition.endConditions.maxPrimaryTurns - run.budget.primaryTurnsUsed), workerAttempts: Math.max(0, run.definition.endConditions.maxWorkerAttempts - run.budget.workerAttemptsUsed), elapsedMs: null, tokens: run.budget.tokensUsed, costMicros: run.budget.costMicrosUsed, deadlineAt: run.definition.endConditions.deadlineAt } : null,
        unresolvedSideEffects: [],
        nextAction: "Address independent checker feedback, then record one fresh complete_task decision.",
        lastDecisionId: verdict.primaryDecisionId,
        context: turn.context,
        createdAt: now(),
      };
      const checkpoint = { id: checkpointId, turnId: turn.id, capsuleId, trigger: "primary-decision", createdAt: now() };
      turn.status = "succeeded";
      turn.checkpointId = checkpointId;
      turn.capsuleId = capsuleId;
      turn.updatedAt = now();
      turn.finishedAt = now();
      run.checkpoints.push(checkpoint);
      run.continuationCapsules.push(capsule);
      primary.status = "succeeded";
      primary.updatedAt = now();
      primary.finishedAt = now();
      const turnId = createId("turn");
      const nextPrimary = createAttempt(createId, now, run, "primary", run.definition.primary, continuationPrompt(capsule), null, "ready", turnId);
      run.turns.push(createTurn({ id: turnId, sequence: turn.sequence + 1, primaryAttemptId: nextPrimary.id, reason: "primary-continue", now }));
      run.primaryAttempts.push(nextPrimary);
      run.primaryAttemptId = nextPrimary.id;
      run.currentAttemptId = nextPrimary.id;
      run.currentTurnId = turnId;
      run.status = "queued";
      run.error = null;
      run.finishedAt = null;
      run.updatedAt = now();
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, "turn-checkpointed", `Checker revision checkpointed turn ${turn.sequence}.`, primary.id);
      await emit(run, "turn-continued", "A fresh Primary turn was queued from checker feedback.", nextPrimary.id);
      return nextPrimary;
    });
    if (next) launch(taskId, taskRunId, next.id);
    return next;
  }

  async function finalizeApprovedRun(taskId, taskRunId, verdict) {
    await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const primary = run.primaryAttempts.find((attempt) => attempt.id === run.primaryAttemptId);
      if (!primary) return;
      const budgetViolation = endConditionViolation(run, now, { requireKnownUsage: true });
      if (budgetViolation) {
        await blockRunForEndCondition(run, primary, budgetViolation);
        return;
      }
      if (run.definition.endConditions.completionAuthority === "user-confirm") {
        const gates = await store.readGates(taskId, taskRunId);
        let review = gates.find((gate) => gate.kind === "manual-review" && gate.attemptId === primary.id) ?? null;
        if (!review) {
          review = completionReviewGate(run, primary, createId, now());
          await store.writeGate(review);
          await emit(run, "approval-required", "Independent checker approved; waiting for user confirmation.", primary.id);
        }
        if (review.status !== "approved") {
          run.status = "waiting-approval";
          run.error = null;
          run.finishedAt = null;
          run.updatedAt = now();
          await store.writeRun(run);
          return;
        }
      }
      run.status = "succeeded";
      run.currentAttemptId = primary.id;
      run.error = null;
      run.finishedAt = now();
      run.updatedAt = now();
      const turn = turnForAttempt(run, primary);
      if (turn) {
        turn.status = "succeeded";
        turn.decisionId = verdict.primaryDecisionId;
        turn.updatedAt = now();
        turn.finishedAt = now();
      }
      await store.writeRun(run);
      await emit(run, "run-succeeded", `Primary execution and independent checker approved round ${verdict.round}.`, primary.id);
    });
  }

  async function executeCheckerAttempt(taskId, taskRunId, attemptId) {
    const begun = await beginAttempt(taskId, taskRunId, attemptId);
    if (!begun) return { stale: true };
    const { run, attempt, leaseId } = begun;
    const profile = checkerProfileForRun(run);
    let personalRunId = null;
    let messageOperationId = null;
    const staleAfterProviderStart = async (reason) => {
      const cancellation = await cancelRuntimeAttempt(personalRunId, messageOperationId, reason);
      if (cancellation?.ok !== true) {
        throw runtimeCleanupError(new Error("Checker lease became stale and provider cancellation was not confirmed"), cancellation);
      }
      return { stale: true };
    };
    try {
      if (typeof preflightAttempt === "function") await preflightAttempt({ run, attempt, profile, checker: true });
      if (!(await assertProviderStartAllowed(taskId, taskRunId, attemptId, leaseId))) return { stale: true };
      const ownedCreate = await runtimeOperations.call("Personal createConversation (checker)", "checker-create", ({ operationId, signal }) => personalAgentRuntime.createConversation({
        workspaceRoot: run.definition.workspaceRoot,
        workdir: run.definition.workspaceRoot,
        agent: { id: profile.agentId, provider: profile.provider },
        model: profile.model,
        title: `${profile.label} · checker · ${run.id}`,
        source: "task-orchestrator-v2-checker",
        metadata: { taskId, taskRunId, attemptId, turnId: attempt.turnId, kind: "checker", round: attempt.round },
        operationId,
        signal,
      }));
      const created = ownedCreate.value;
      const conversationId = String(created?.conversation?.id ?? created?.id ?? "").trim();
      if (!conversationId) throw new Error("Checker provider did not return a conversation id");
      if (!(await persistAttempt(taskId, taskRunId, attemptId, leaseId, { conversationId }))) return { stale: true };
      if (!(await assertProviderStartAllowed(taskId, taskRunId, attemptId, leaseId))) return { stale: true };
      const ownedStart = await runtimeOperations.call("Personal startMessage (checker)", "checker-message", ({ operationId, signal }) => personalAgentRuntime.startMessage({
        workspaceRoot: run.definition.workspaceRoot,
        workdir: run.definition.workspaceRoot,
        prompt: attempt.prompt,
        approvalMode: "read-only-auto",
        timeoutMs: profile.timeoutMs,
        conversationId,
        sessionStrategy: "new",
        useRememberedApprovals: false,
        model: profile.model,
        agent: { id: profile.agentId, provider: profile.provider },
        taskControlPlane: null,
        taskTools: [],
        mcpServers: [],
        taskDepth: 0,
        taskPermissionMode: "restricted",
        taskId,
        taskRunId,
        taskRevision: run.taskRevision,
        taskContractHash: run.permissionGrant?.contractHash ?? contractHash(run.definition.contract),
        taskProfileId: profile.id,
        taskPermissionGrant: run.permissionGrant,
        operationId,
        signal,
      }));
      const started = ownedStart.value;
      messageOperationId = ownedStart.operationId;
      personalRunId = String(started?.runId ?? "").trim();
      if (!personalRunId && !PERSONAL_TERMINAL_STATUSES.has(started?.status)) throw new Error("Checker provider did not return a run id");
      const startedDiagnostics = providerDiagnosticsFromResult(started);
      const startedUsage = providerUsage(started);
      if (startedDiagnostics || startedUsage) {
        if (!(await persistAttempt(taskId, taskRunId, attemptId, leaseId, {
          ...(startedDiagnostics ? { providerDiagnostics: startedDiagnostics } : {}),
          ...(startedUsage ? { providerUsage: startedUsage } : {}),
          progressAt: now(),
        }))) return staleAfterProviderStart("checker-stale-lease");
      }
      if (personalRunId && !(await persistAttempt(taskId, taskRunId, attemptId, leaseId, { personalRunId }))) {
        return staleAfterProviderStart("checker-stale-lease");
      }
      const terminal = PERSONAL_TERMINAL_STATUSES.has(started?.status)
        ? { stale: false, snapshot: started }
        : await waitForPersonalRun({ taskId, taskRunId, attemptId, leaseId, personalRunId, operationId: messageOperationId, workspaceRoot: run.definition.workspaceRoot, provider: profile.provider, kind: "checker", timeoutMs: profile.timeoutMs, taskTools: [], started });
      if (terminal.stale) return staleAfterProviderStart("checker-stale-lease");
      if (PERSONAL_TERMINAL_STATUSES.has(started?.status)
        && !(await persistTerminalContext(taskId, taskRunId, attemptId, leaseId, terminal.snapshot, profile.model))) {
        return staleAfterProviderStart("checker-stale-terminal-context");
      }
      await tombstoneProcessFor(taskRunId, attemptId, terminal.snapshot);
      const terminalDiagnostics = providerDiagnosticsFromResult(terminal.snapshot);
      const terminalUsage = providerUsage(terminal.snapshot);
      if (terminalDiagnostics || terminalUsage || PERSONAL_TERMINAL_STATUSES.has(terminal.snapshot?.status)) {
        if (!(await persistAttempt(taskId, taskRunId, attemptId, leaseId, {
          ...(terminalDiagnostics ? { providerDiagnostics: terminalDiagnostics } : {}),
          ...(terminalUsage ? { providerUsage: terminalUsage } : {}),
          ...(TERMINAL_PROGRESS_STATUSES.has(String(terminal.snapshot?.status ?? "").toLowerCase()) ? { progressAt: now() } : {}),
        }))) return staleAfterProviderStart("checker-stale-terminal-result");
      }
      if (terminal.snapshot?.status !== "completed") throw new Error(terminal.snapshot?.error || `Checker provider ended with ${terminal.snapshot?.status ?? "unknown"}`);
      const output = normalizeOutput(terminal.snapshot?.output);
      const artifact = { schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION, id: createId("artifact"), taskId, taskRunId, taskRevision: run.taskRevision, attemptId, kind: "evidence", turnId: attempt.turnId, summary: `Independent checker round ${attempt.round} output.`, content: output, evidence: runtimeEvidence(terminal.snapshot), createdAt: now() };
      await serialized(async () => {
        const current = await store.requireRun(taskId, taskRunId);
        const checker = (current.checkerAttempts ?? []).find((candidate) => candidate.id === attemptId);
        if (!checker || checker.leaseId !== leaseId) return;
        await store.writeArtifact(artifact);
        checker.outputArtifactIds = [artifact.id];
        checker.updatedAt = now();
        await store.writeRun(current);
      });
      const finalized = await finalizeCheckerVerdict(taskId, taskRunId, attemptId, leaseId, terminal.snapshot);
      if (!finalized) return { stale: true };
      if (finalized.verdict.verdict === "approve") await finalizeApprovedRun(taskId, taskRunId, finalized.verdict);
      else if (finalized.verdict.verdict === "revise") await reviseAfterChecker(taskId, taskRunId, finalized.verdict);
      else await blockChecker(taskId, taskRunId, attemptId, null, finalized.verdict.summary);
      return { stale: false, verdict: finalized.verdict };
    } catch (error) {
      if (!error?.runtimeCleanupAttempted && (messageOperationId || personalRunId)) {
        const cancellation = await cancelRuntimeAttempt(personalRunId, messageOperationId, "checker-error");
        if (cancellation?.ok !== true) error = runtimeCleanupError(error, cancellation);
      }
      await blockChecker(taskId, taskRunId, attemptId, leaseId, messageOf(error));
      return { stale: false, blocked: true };
    } finally {
      await tombstoneProcessFor(taskRunId, attemptId);
      releaseProcessObservation(taskRunId, attemptId);
    }
  }

  async function maybeFinishRun(taskId, taskRunId) {
    const observed = await store.requireRun(taskId, taskRunId);
    if (observed.definition.independentChecker?.mode === "independent") {
      const artifacts = await store.readArtifacts(taskId, taskRunId);
      const eligibility = checkerEligibility(observed, artifacts);
      if (eligibility.eligible) {
        await queueIndependentChecker(taskId, taskRunId);
        return;
      }
      const latestVerdict = observed.checkerVerdicts?.at(-1) ?? null;
      if (!latestVerdict || latestVerdict.verdict !== "approve") return;
    }
    await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const primary = run.primaryAttempts.find((attempt) => attempt.id === run.primaryAttemptId);
      if (!primary || primary.status !== "succeeded" || !workersAreTerminal(run) || !ACTIVE_RUN_STATUSES.has(run.status)) return;
      if (run.definition.executionProtocol === "structured-decisions-v1" && decisionForAttempt(run, primary.id)?.kind !== "complete") return;
      const budgetViolation = endConditionViolation(run, now, { requireKnownUsage: true });
      if (budgetViolation) {
        await blockRunForEndCondition(run, primary, budgetViolation);
        return;
      }
      if (run.definition.endConditions.completionAuthority === "user-confirm") {
        const gates = await store.readGates(taskId, taskRunId);
        let review = gates.find((gate) => gate.kind === "manual-review" && gate.attemptId === primary.id) ?? null;
        if (review?.status === "rejected") return;
        if (!review) {
          review = completionReviewGate(run, primary, createId, now());
          await store.writeGate(review);
          await emit(run, "approval-required", review.summary, primary.id);
        }
        if (review.status !== "approved") {
          const turn = turnForAttempt(run, primary);
          if (turn) {
            turn.status = "succeeded";
            turn.decisionId = decisionForAttempt(run, primary.id)?.id ?? null;
            turn.updatedAt = now();
            turn.finishedAt = now();
          }
          run.status = "waiting-approval";
          run.error = null;
          run.updatedAt = now();
          run.finishedAt = null;
          await store.writeRun(run);
          return;
        }
      }
      run.status = "succeeded";
      run.error = null;
      run.updatedAt = now();
      run.finishedAt = now();
      const turn = turnForAttempt(run, primary);
      if (turn) {
        turn.status = "succeeded";
        turn.decisionId = decisionForAttempt(run, primary.id)?.id ?? null;
        turn.updatedAt = now();
        turn.finishedAt = now();
      }
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, "run-succeeded", "Primary execution and selected workers completed.", primary.id);
    });
  }

  async function reconcileCompletionReviews() {
    await serialized(async () => {
      for (const persisted of await store.allRuns()) {
        if (persisted.definition.endConditions.completionAuthority !== "user-confirm") continue;
        const run = clone(persisted);
        const primary = run.primaryAttempts.find((attempt) => attempt.id === run.primaryAttemptId);
        if (!primary || primary.status !== "succeeded" || !workersAreTerminal(run)) continue;
        if (decisionForAttempt(run, primary.id)?.kind !== "complete") continue;
        const gates = await store.readGates(run.taskId, run.id);
        let review = gates.find((gate) => gate.kind === "manual-review" && gate.attemptId === primary.id) ?? null;
        if (!review && ACTIVE_RUN_STATUSES.has(run.status)) {
          review = completionReviewGate(run, primary, createId, now());
          await store.writeGate(review);
          await emit(run, "approval-required", review.summary, primary.id);
        }
        if (!review || !["pending", "resolving"].includes(review.status)) continue;
        run.status = "waiting-approval";
        run.error = null;
        run.updatedAt = now();
        run.finishedAt = null;
        await store.writeRun(run);
      }
    });
  }

  async function waitForPersonalRun(input) {
    let snapshot = input.started;
    const resolvedTaskToolApprovals = new Set();
    const run = await store.requireRun(input.taskId, input.taskRunId);
    const hardTurnMs = Math.min(input.timeoutMs, run.definition.endConditions.maxTurnRuntimeMs);
    const startedAt = now();
    let lastObservedAt = startedAt;
    let activeElapsedMs = 0;
    let activeProgressAt = 0;
    let signature = progressSignature(snapshot);
    // Seed both observers with the usage/context captured by startMessage so
    // the first identical poll cannot emit duplicate progress. Every later
    // write is lease-fenced by both the explicit check and persistAttempt's
    // durable fence.
    let contextPersistenceState = createContextUsagePersistenceState(
      contextUsageFromSnapshot(snapshot, now, run.definition.primary.model),
    );
    const startedProviderUsage = providerUsage(snapshot);
    let lastProviderUsageSignature = startedProviderUsage
      ? [startedProviderUsage.inputTokens, startedProviderUsage.outputTokens, startedProviderUsage.totalTokens, startedProviderUsage.costMicros].join(":")
      : null;
    const observeUsage = async (candidate) => {
      const usage = providerUsage(candidate);
      const context = contextUsageFromSnapshot(candidate, now, run.definition.primary.model);
      const status = typeof candidate?.status === "string" && candidate.status.trim() ? candidate.status.trim() : null;
      // Do not add an extra lease poll for snapshots without usage telemetry;
      // the normal wait loop below already fences those observations. Usage
      // writes, including the terminal write, require this explicit fence.
      const leaseCurrent = usage === null && context === null
        ? true
        : await leaseIsActive(input.taskId, input.taskRunId, input.attemptId, input.leaseId);
      const contextDecision = observeContextUsageForPersistence({
        state: contextPersistenceState,
        usage: context,
        status,
        leaseCurrent,
      });
      if (!leaseCurrent) return false;
      const providerSignature = usage
        ? [usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.costMicros].join(":")
        : null;
      const providerChanged = status !== null && usage !== null && providerSignature !== lastProviderUsageSignature;
      const providerTerminal = status !== null && TERMINAL_PROGRESS_STATUSES.has(status.toLowerCase()) && usage !== null;
      const persistProvider = providerChanged || providerTerminal;
      if (!contextDecision.persist && !persistProvider) return true;
      const persisted = await persistAttempt(input.taskId, input.taskRunId, input.attemptId, input.leaseId, {
        ...(persistProvider ? { providerUsage: usage } : {}),
        ...(contextDecision.persist ? { context: contextDecision.usage } : {}),
        progressAt: now(),
      });
      if (persisted) {
        if (contextDecision.persist) contextPersistenceState = contextDecision.state;
        if (persistProvider) {
          lastProviderUsageSignature = providerSignature;
          const localAttempt = attemptFor(run, input.attemptId);
          if (localAttempt) localAttempt.providerUsage = usage;
        }
      }
      return persisted;
    };
    while (!PERSONAL_TERMINAL_STATUSES.has(snapshot?.status)) {
      if (!(await observeUsage(snapshot))) return { stale: true, snapshot };
      await syncProcessRecord(input.taskId, input.taskRunId, { id: input.attemptId, profileId: input.provider, conversationId: null }, input.personalRunId, snapshot);
      await sideEffects.synchronize(input.taskId, input.taskRunId, input.attemptId, input.leaseId, snapshot);
      await assertSideEffectIntent(input.taskId, input.taskRunId, input.attemptId);
      const bridgeError = input.bridgeError?.();
      if (bridgeError) throw new Error(`Task control bridge failed: ${messageOf(bridgeError)}`);
      if (isClosed() || !(await leaseIsActive(input.taskId, input.taskRunId, input.attemptId, input.leaseId))) return { stale: true, snapshot };
      const observedAt = now();
      const wallGap = Math.max(0, observedAt - lastObservedAt);
      // Only main-owned OS power events count as suspension. A long provider,
      // SQLite, filesystem, or event-loop stall must still consume the turn
      // and liveness budgets.
      const suspended = suspendedDurationBetween(lastObservedAt, observedAt);
      activeElapsedMs += Math.max(0, wallGap - suspended);
      lastObservedAt = observedAt;
      const elapsed = activeElapsedMs;
      const taskDeadline = endConditionViolation(run, () => observedAt);
      if (taskDeadline) {
        const cancellation = await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-deadline");
        if (cancellation?.ok !== true) {
          throw runtimeCleanupError(new Error(`Task deadline reached and provider cancellation was not confirmed: ${messageOf(cancellation?.error || "unknown cancellation failure")}`), cancellation);
        }
        throw new Error(taskDeadline);
      }
      if (await contextCheckpointRequested(input, snapshot, elapsed, hardTurnMs)) return { stale: false, snapshot, contextRollover: true };
      if (elapsed >= hardTurnMs) {
        const cancellation = await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-turn-timeout");
        if (cancellation?.ok !== true) {
          throw runtimeCleanupError(new Error(`Task turn exceeded its ${hardTurnMs}ms deadline and provider cancellation was not confirmed: ${messageOf(cancellation?.error || "unknown cancellation failure")}`), cancellation);
        }
        throw new Error(`Task turn exceeded its ${hardTurnMs}ms deadline`);
      }
      const nextSignature = progressSignature(snapshot);
      if (nextSignature !== signature) {
        signature = nextSignature;
        activeProgressAt = activeElapsedMs;
        if (!(await persistAttempt(input.taskId, input.taskRunId, input.attemptId, input.leaseId, { progressAt: observedAt }))) {
          return { stale: true, snapshot };
        }
      } else if (
        snapshot?.status !== "waiting-approval"
        && !(snapshot?.pendingApprovals?.length)
        && !snapshotHasWorkingTool(snapshot)
        && activeElapsedMs - activeProgressAt >= run.definition.endConditions.stallTimeoutMs
      ) {
        const evidence = livenessObservation(snapshot, activeElapsedMs, activeProgressAt);
        const liveness = await evaluateAttemptLiveness(evidence.observation, {
          now: evidence.now,
          stallAfterMs: run.definition.endConditions.stallTimeoutMs,
        });
        if (liveness?.terminationRecommended === true) {
          const cancellation = await cancelRuntimeAttempt(input.personalRunId, input.operationId, `task-liveness-${String(liveness.verdict ?? "unknown").toLowerCase()}`);
          if (cancellation?.ok !== true) {
            throw runtimeCleanupError(new Error(`Task turn liveness was ${liveness.verdict ?? "unknown"} and provider cancellation was not confirmed: ${messageOf(cancellation?.error || "unknown cancellation failure")}`), cancellation);
          }
          throw new Error(`Task turn liveness was ${liveness.verdict}: ${liveness.reason}`);
        }
        if (liveness?.verdict === "WORKING") activeProgressAt = activeElapsedMs;
      }
      let taskToolApprovalResolved = false;
      for (const approval of Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals : []) {
        const call = taskControlMcpCallForApproval({ provider: input.provider, workspaceRoot: input.workspaceRoot }, snapshot, approval);
        const approvalId = String(approval?.id ?? "").trim();
        if (!call || !approvalId || !input.taskTools.includes(call.tool) || resolvedTaskToolApprovals.has(approvalId)) continue;
        let result;
        try {
          result = await runtimeCall(`Personal resolveApproval (${approvalId})`, () => personalAgentRuntime.resolveApproval({ runId: input.personalRunId, approvalId, decision: "accept" }));
        } catch (error) {
          throw runtimeCleanupError(error, await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-approval-timeout"));
        }
        if (result?.ok !== true) {
          throw runtimeCleanupError(
            new Error(`Task control approval failed: ${messageOf(result?.error || "unknown error")}`),
            await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-approval-rejected"),
          );
        }
        resolvedTaskToolApprovals.add(approvalId);
        taskToolApprovalResolved = true;
      }
      if (taskToolApprovalResolved) {
        await sleep(pollMs);
        try {
          snapshot = await runtimeCall(`Personal getRun (${input.personalRunId})`, () => personalAgentRuntime.getRun({ runId: input.personalRunId, workspaceRoot: input.workspaceRoot }));
        } catch (error) {
          throw runtimeCleanupError(error, await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-approval-poll-timeout"));
        }
        if (!snapshot) snapshot = { status: "missing", error: "Personal runtime run is missing" };
        continue;
      }
      await synchronizeApprovalGates(input.taskId, input.taskRunId, input.attemptId, input.leaseId, snapshot);
      await sleep(pollMs);
      try {
        snapshot = await runtimeCall(`Personal getRun (${input.personalRunId})`, () => personalAgentRuntime.getRun({ runId: input.personalRunId, workspaceRoot: input.workspaceRoot }));
      } catch (error) {
        throw runtimeCleanupError(error, await cancelRuntimeAttempt(input.personalRunId, input.operationId, "task-runtime-poll-timeout"));
      }
      if (!snapshot) snapshot = { status: "missing", error: "Personal runtime run is missing" };
    }
    // Persist the final usage/context observation as well, even when the
    // provider became terminal between polls. The helper deliberately refuses
    // to advance progress when the status field is absent.
    if (!(await observeUsage(snapshot))) return { stale: true, snapshot };
    await syncProcessRecord(input.taskId, input.taskRunId, { id: input.attemptId, profileId: input.provider, conversationId: null }, input.personalRunId, snapshot);
    await sideEffects.synchronize(input.taskId, input.taskRunId, input.attemptId, input.leaseId, snapshot);
    await assertSideEffectIntent(input.taskId, input.taskRunId, input.attemptId);
    const bridgeError = input.bridgeError?.();
    if (bridgeError) throw new Error(`Task control bridge failed: ${messageOf(bridgeError)}`);
    // A provider may become terminal in the same poll that observes a wake
    // gap. Re-check the raw task deadline before accepting that terminal
    // snapshot so suspend compensation never bypasses the task's wall-clock
    // deadline.
    const terminalTaskDeadline = endConditionViolation(run, now);
    if (terminalTaskDeadline) throw new Error(terminalTaskDeadline);
    return { stale: false, snapshot };
  }

  async function writeAttemptArtifact(taskId, taskRunId, attempt, leaseId, snapshot) {
    const output = normalizeOutput(snapshot?.output);
    const artifact = {
      schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
      id: createId("artifact"),
      taskId,
      taskRunId,
      taskRevision: (await store.requireRun(taskId, taskRunId)).taskRevision,
      attemptId: attempt.id,
      kind: attempt.kind,
      turnId: attempt.turnId ?? null,
      summary: `${attempt.kind} attempt completed.`,
      content: output,
      evidence: runtimeEvidence(snapshot),
      createdAt: Math.max(
        now(),
        ((typeof store.latestArtifactCreatedAt === "function"
          ? await store.latestArtifactCreatedAt(taskId, taskRunId)
          : (await store.readArtifacts(taskId, taskRunId)).at(-1)?.createdAt) ?? -1) + 1,
      ),
    };
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const current = attemptFor(run, attempt.id);
      if (!current || current.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return null;
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId: attempt.id, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return null;
      await store.writeArtifact(artifact);
      current.outputArtifactIds = [artifact.id];
      current.updatedAt = now();
      run.updatedAt = now();
      await store.writeRun(run);
      return { artifact, run, attempt: current, output };
    });
  }

  async function succeedAttempt(taskId, taskRunId, attemptId, leaseId) {
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = attemptFor(run, attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return null;
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return null;
      attempt.status = "succeeded";
      attempt.leaseId = null;
      attempt.progressAt = now();
      attempt.updatedAt = now();
      attempt.finishedAt = now();
      attempt.error = null;
      if (attempt.kind === "worker") {
        const turn = turnForAttempt(run, attempt);
        if (turn) turn.updatedAt = now();
      }
      run.updatedAt = now();
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, attempt.kind === "primary" ? "primary-succeeded" : "worker-succeeded", `${attempt.kind} attempt succeeded.`, attempt.id);
      return { run, attempt };
    });
  }

  async function rolloverPrimary(taskId, taskRunId, attempt, leaseId, decision, snapshot, options = {}) {
    const context = contextUsageFromSnapshot(snapshot, now, (await store.requireRun(taskId, taskRunId)).definition.primary.model);
    const artifacts = await store.readArtifacts(taskId, taskRunId);
    const current = await store.requireRun(taskId, taskRunId);
    const unsafe = unsafeUnknownSideEffects(current, [attempt.id]);
    if (unsafe.length) {
      await failAttempt(taskId, taskRunId, attempt.id, leaseId, `Checkpoint blocked: ${unsafe.length} non-idempotent provider side effect(s) have an unknown outcome`, "blocked");
      return null;
    }
    const exhausted = endConditionViolation(current, now, { nextTurn: true });
    if (exhausted) {
      await failAttempt(taskId, taskRunId, attempt.id, leaseId, exhausted, "blocked");
      return null;
    }
    const next = await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const primary = attemptFor(run, attempt.id);
      if (!primary || primary.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return null;
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId: attempt.id, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return null;
      const turn = turnForAttempt(run, primary);
      if (!turn) throw new Error("Structured primary continuation requires a durable turn");
      const { capsule, checkpoint } = buildContinuationRecords({
        run,
        turn,
        decision,
        artifacts,
        context,
        createId,
        now,
        trigger: options.checkpointTrigger ?? "primary-decision",
      });
      primary.status = "succeeded";
      primary.leaseId = null;
      primary.updatedAt = now();
      primary.finishedAt = now();
      primary.error = null;
      turn.status = "succeeded";
      turn.decisionId = decision.id;
      turn.checkpointId = checkpoint.id;
      turn.capsuleId = capsule.id;
      turn.context = context;
      turn.updatedAt = now();
      turn.finishedAt = now();
      run.continuationCapsules.push(capsule);
      run.checkpoints.push(checkpoint);
      const turnId = createId("turn");
      const nextPrimary = createAttempt(
        createId,
        now,
        run,
        "primary",
        run.definition.primary,
        continuationPrompt(capsule),
        null,
        "ready",
        turnId,
      );
      const reason = options.continuationReason ?? (decision.kind === "checkpoint" ? "primary-checkpoint" : "primary-continue");
      run.turns.push(createTurn({ id: turnId, sequence: turn.sequence + 1, primaryAttemptId: nextPrimary.id, reason, now }));
      run.primaryAttempts.push(nextPrimary);
      run.primaryAttemptId = nextPrimary.id;
      run.currentAttemptId = nextPrimary.id;
      run.currentTurnId = turnId;
      run.status = "queued";
      run.error = null;
      run.updatedAt = now();
      run.finishedAt = null;
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, "primary-succeeded", "Primary turn checkpointed successfully.", primary.id);
      await emit(run, "turn-checkpointed", `Turn ${turn.sequence} checkpointed.`, primary.id);
      await emit(run, "turn-continued", `Turn ${turn.sequence + 1} queued in a fresh provider session.`, nextPrimary.id);
      return nextPrimary;
    });
    if (next) launch(taskId, taskRunId, next.id);
    return next;
  }

  async function scheduleTransportRetry(taskId, taskRunId, attempt, leaseId, error) {
    if (attempt.kind !== "primary" || !isTransientProviderFailure(error)) return false;
    const artifacts = await store.readArtifacts(taskId, taskRunId);
    const scheduled = await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const primary = attemptFor(run, attempt.id);
      if (!primary || primary.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return null;
      if (typeof store.isLeaseCurrent === "function" && !(await store.isLeaseCurrent({ taskRunId, attemptId: attempt.id, leaseId, supervisorEpoch: supervisorEpoch ?? undefined }))) return null;
      refreshRunBudget(run, now);
      const retryNumber = (run.budget?.transportRetries ?? 0) + 1;
      if (retryNumber > run.definition.endConditions.maxTransportRetries) return null;
      if (unsafeUnknownSideEffects(run, [primary.id]).length) return null;
      if (endConditionViolation(run, now, { nextTurn: true })) return null;
      const turn = turnForAttempt(run, primary);
      if (!turn) return null;
      const message = String(error || "Transient provider failure").slice(0, 4_000);
      const decision = {
        id: createId("decision"),
        attemptId: primary.id,
        turnId: primary.turnId ?? null,
        kind: "continue",
        summary: `Supervisor classified a transient provider failure: ${message}`.slice(0, 4_000),
        nextAction: "Retry this bounded turn in a fresh provider session after backoff.",
        acceptanceResults: [],
        createdAt: now(),
      };
      run.primaryDecisions.push(decision);
      run.latestDecisionId = decision.id;
      const { capsule, checkpoint } = buildContinuationRecords({
        run,
        turn,
        decision,
        artifacts,
        context: turn.context,
        createId,
        now,
        trigger: "retry",
      });
      primary.status = "failed";
      primary.leaseId = null;
      primary.error = message;
      primary.updatedAt = now();
      primary.finishedAt = now();
      turn.status = "failed";
      turn.decisionId = decision.id;
      turn.checkpointId = checkpoint.id;
      turn.capsuleId = capsule.id;
      turn.updatedAt = now();
      turn.finishedAt = now();
      run.continuationCapsules.push(capsule);
      run.checkpoints.push(checkpoint);
      const turnId = createId("turn");
      const nextPrimary = createAttempt(
        createId,
        now,
        run,
        "primary",
        run.definition.primary,
        continuationPrompt(capsule),
        null,
        "ready",
        turnId,
      );
      const delayMs = retryBackoffMs(retryNumber);
      nextPrimary.notBefore = now() + delayMs;
      run.turns.push(createTurn({ id: turnId, sequence: turn.sequence + 1, primaryAttemptId: nextPrimary.id, reason: "transport-retry", now }));
      run.primaryAttempts.push(nextPrimary);
      run.primaryAttemptId = nextPrimary.id;
      run.currentAttemptId = nextPrimary.id;
      run.currentTurnId = turnId;
      run.status = "backoff";
      run.error = `Transient provider failure; retry ${retryNumber} scheduled.`;
      run.updatedAt = now();
      run.finishedAt = null;
      refreshRunBudget(run, now);
      await store.writeRun(run);
      await emit(run, "primary-failed", message, primary.id);
      await emit(run, "turn-checkpointed", `Transient failure checkpointed before retry ${retryNumber}.`, primary.id);
      await emit(run, "budget-warning", `Provider retry ${retryNumber}/${run.definition.endConditions.maxTransportRetries} scheduled.`, nextPrimary.id);
      return { nextPrimary, retryNumber, delayMs, notBefore: nextPrimary.notBefore };
    });
    if (!scheduled) return false;
    scheduleReadyWake(scheduled.notBefore);
    return true;
  }

  async function finishCompletedAttempt(taskId, taskRunId, attempt, leaseId, snapshot, options = {}) {
    const run = await store.requireRun(taskId, taskRunId);
    if (attempt.kind === "worker" || run.definition.executionProtocol === "provider-completion-v2") {
      return succeedAttempt(taskId, taskRunId, attempt.id, leaseId);
    }
    const decision = decisionForAttempt(run, attempt.id);
    if (!decision) {
      await failAttempt(
        taskId,
        taskRunId,
        attempt.id,
        leaseId,
        "Primary provider completed without a durable task decision. Use complete_task, continue_task, checkpoint_task, block_task, or realign_task.",
        "blocked",
      );
      return null;
    }
    if (decision.kind === "checkpoint" || decision.kind === "continue") {
      return rolloverPrimary(taskId, taskRunId, attempt, leaseId, decision, snapshot, options);
    }
    if (decision.kind !== "complete") {
      const detail = decision.nextAction ? ` Next action: ${decision.nextAction}` : "";
      await failAttempt(taskId, taskRunId, attempt.id, leaseId, `Primary requested ${decision.kind}: ${decision.summary}.${detail}`, "blocked");
      return null;
    }
    return succeedAttempt(taskId, taskRunId, attempt.id, leaseId);
  }

  async function invokeTool(run, primaryAttempt, tool, args) {
    const name = String(tool ?? "").trim();
    if (primaryAttempt.kind !== "primary" || primaryAttempt.depth !== 0) throw new Error("Only the primary attempt may use task control tools");
    if (name === "get_task_state") {
      return primaryDecisions.getTaskState(run.taskId, run.id, primaryAttempt.id);
    }
    const decisionKind = decisionKindForTool(name);
    if (decisionKind) {
      return primaryDecisions.record(run.taskId, run.id, primaryAttempt.id, decisionKind, args);
    }
    const workers = run.definition.allowedWorkers;
    if (name === "list_agents") return workers.map((profile) => {
      const attempt = run.workerAttempts.filter((candidate) => candidate.profileId === profile.id).at(-1);
      const description = profile.instructions || `${profile.label} worker for the frozen task.`;
      const scheduler = admissionScheduler.snapshot();
      return {
        id: profile.id,
        label: profile.label,
        description,
        instructions: description,
        provider: profile.provider,
        model: profile.model,
        attemptId: attempt?.id ?? null,
        status: attempt?.status ?? "available",
        depth: 1,
        remainingBudget: {
          workerAttempts: Math.max(0, run.definition.endConditions.maxWorkerAttempts - run.workerAttempts.length),
          workerConcurrency: Math.max(0, run.definition.endConditions.maxWorkerConcurrency - run.workerAttempts.filter((candidate) => ACTIVE_ATTEMPT_STATUSES.has(candidate.status) || candidate.leaseId).length),
          globalAttempts: Math.max(0, scheduler.maxActiveAttempts - scheduler.active),
          globalQueued: scheduler.queued,
        },
      };
    });
    if (name === "spawn_agent") {
      const profileId = String(args?.workerProfileId ?? args?.profileId ?? "").trim();
      const profile = workers.find((candidate) => candidate.id === profileId);
      if (!profile) throw new Error(`Worker profile ${profileId || "<missing>"} is not allowed`);
      const prompt = String(args?.prompt ?? "").trim();
      if (!prompt) throw new Error("spawn_agent requires a prompt");
      const created = await serialized(async () => {
        const latest = await store.requireRun(run.taskId, run.id);
        const primary = latest.primaryAttempts.find((attempt) => attempt.id === latest.primaryAttemptId);
        if (!primary || primary.status !== "running") throw new Error("Primary attempt is not active");
        const exhausted = endConditionViolation(latest, now, { nextWorker: true });
        if (exhausted) throw new Error(`Worker delegation rejected: ${exhausted}`);
        const activeWorkerCount = latest.workerAttempts.filter((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId).length;
        if (activeWorkerCount >= latest.definition.endConditions.maxWorkerConcurrency) {
          throw new Error(`Worker concurrency limit reached (${latest.definition.endConditions.maxWorkerConcurrency})`);
        }
        const duplicateActive = latest.workerAttempts.some((attempt) => attempt.profileId === profile.id && ACTIVE_ATTEMPT_STATUSES.has(attempt.status));
        if (duplicateActive) throw new Error(`Worker ${profile.id} already has an active attempt`);
        const attempt = createAttempt(createId, now, latest, "worker", profile, prompt, primary.id, "ready");
        latest.workerAttempts.push(attempt);
        attachWorkerToTurn(latest, attempt);
        refreshRunBudget(latest, now);
        latest.currentAttemptId = attempt.id;
        latest.updatedAt = now();
        await store.writeRun(latest);
        await emit(latest, "worker-spawned", `${profile.label} worker spawned.`, attempt.id);
        return attempt;
      });
      launch(run.taskId, run.id, created.id);
      return { attemptId: created.id, profileId: created.profileId, depth: created.depth, status: created.status };
    }
    const attemptId = String(args?.attemptId ?? args?.workerAttemptId ?? "").trim();
    const target = findAttempt(run, attemptId);
    if (!target || target.kind !== "worker" || target.parentAttemptId !== primaryAttempt.id) throw new Error("Worker attempt is not owned by this primary run");
    if (name === "wait_agent") {
      // A newly spawned attempt is initially `ready` while its promise is
      // being scheduled. Await that attempt's execution directly so the
      // primary cannot observe the transient ready state and continue before
      // the worker has actually entered (and left) Personal runtime.
      const executionKey = `${run.id}:${target.id}`;
      const execution = activeExecutions.get(executionKey);
      if (execution) await execution.catch(() => undefined);
      while (true) {
        const latest = await store.requireRun(run.taskId, run.id);
        const current = findAttempt(latest, target.id);
        if (!current || (!ACTIVE_ATTEMPT_STATUSES.has(current.status) && current.status !== "ready" && current.status !== "pending")) {
          return current ?? { attemptId: target.id, status: "missing" };
        }
        // A launch can be rejected before beginAttempt (for example after a
        // stop/close race). Once its promise settles, re-fetch the durable
        // run and check both the map and lease rather than trusting the local
        // promise reference. Otherwise a ready attempt can spin forever.
        const pendingExecution = activeExecutions.get(executionKey);
        if ((current.status === "ready" || current.status === "pending") && !pendingExecution && !current.leaseId) {
          return serialized(async () => {
            const recovered = await store.requireRun(run.taskId, run.id);
            const candidate = findAttempt(recovered, target.id);
            if (!candidate) return { attemptId: target.id, status: "missing" };
            if (candidate.status !== "ready" && candidate.status !== "pending") return candidate;

            const cancelled = recovered.status === "cancelled";
            const runWasActive = ACTIVE_RUN_STATUSES.has(recovered.status);
            const terminalStatus = cancelled ? "cancelled" : "blocked";
            const reason = cancelled
              ? "Worker launch was cancelled before it began."
              : "Worker launch was rejected before it began.";
            candidate.status = terminalStatus;
            candidate.leaseId = null;
            candidate.error = reason;
            candidate.updatedAt = now();
            candidate.finishedAt = now();
            recovered.currentAttemptId = candidate.id;
            if (runWasActive) {
              recovered.status = terminalStatus;
              recovered.error = reason;
              recovered.finishedAt = now();
            }
            recovered.updatedAt = now();
            await store.writeRun(recovered);
            const eventType = cancelled
              ? "run-cancelled"
              : runWasActive ? "run-blocked" : "worker-failed";
            await emit(recovered, eventType, reason, candidate.id);
            return candidate;
          });
        }
        await sleep(pollMs);
      }
    }
    if (name === "send_message") {
      const text = String(args?.text ?? args?.message ?? "").trim();
      if (!text) throw new Error("send_message requires text");
      if (ACTIVE_ATTEMPT_STATUSES.has(target.status) || target.leaseId) {
        throw new Error("Worker attempt is active; wait_agent or close_agent before send_message");
      }
      if (!["succeeded", "failed", "blocked", "cancelled"].includes(target.status)) {
        throw new Error("Worker attempt is not terminal");
      }
      const created = await serialized(async () => {
        const latest = await store.requireRun(run.taskId, run.id);
        const primary = latest.primaryAttempts.find((attempt) => attempt.id === latest.primaryAttemptId);
        const previous = findAttempt(latest, target.id);
        if (!primary || !ACTIVE_ATTEMPT_STATUSES.has(primary.status)) throw new Error("Primary attempt is not active");
        if (!previous || previous.kind !== "worker" || previous.parentAttemptId !== primary.id) throw new Error("Worker attempt is not owned by this primary run");
        if (ACTIVE_ATTEMPT_STATUSES.has(previous.status) || previous.leaseId) {
          throw new Error("Worker attempt is active; wait_agent or close_agent before send_message");
        }
        if (!["succeeded", "failed", "blocked", "cancelled"].includes(previous.status)) throw new Error("Worker attempt is not terminal");
        const profile = profileForAttempt(latest, previous);
        const exhausted = endConditionViolation(latest, now, { nextWorker: true });
        if (exhausted) throw new Error(`Worker follow-up rejected: ${exhausted}`);
        const artifactReference = previous.outputArtifactIds.length ? previous.outputArtifactIds.join(", ") : "none";
        const followUpPrompt = [
          "Follow-up worker assignment from the primary agent.",
          `Primary request: ${text}`,
          `Prior worker attempt: ${previous.id} (${previous.status}).`,
          `Prior durable artifact ids: ${artifactReference}.`,
          previous.error ? `Prior error: ${previous.error}` : "",
        ].filter(Boolean).join("\n");
        const attempt = createAttempt(createId, now, latest, "worker", profile, followUpPrompt, primary.id, "ready");
        latest.workerAttempts.push(attempt);
        attachWorkerToTurn(latest, attempt);
        refreshRunBudget(latest, now);
        latest.currentAttemptId = attempt.id;
        latest.updatedAt = now();
        await store.writeRun(latest);
        await emit(latest, "worker-spawned", `${profile.label} worker follow-up spawned from ${previous.id}.`, attempt.id);
        return attempt;
      });
      const execution = launch(run.taskId, run.id, created.id);
      const result = await execution.catch(() => undefined);
      const latest = await store.requireRun(run.taskId, run.id);
      const completed = findAttempt(latest, created.id);
      const artifacts = await store.readArtifacts(run.taskId, run.id);
      const artifact = artifacts.find((candidate) => candidate.attemptId === created.id);
      return {
        attemptId: created.id,
        profileId: created.profileId,
        depth: created.depth,
        status: completed?.status ?? (result?.failed ? "failed" : "unknown"),
        output: normalizeOutput(artifact?.content ?? result?.completed?.output),
      };
    }
    if (name === "close_agent") {
      if (target.personalRunId) {
        const cancellation = await cancelRuntimeRun(target.personalRunId, "task-primary-close-agent");
        if (cancellation?.ok !== true) throw new Error(`Worker cancellation was not confirmed: ${messageOf(cancellation?.error || "unknown cancellation failure")}`);
      }
      await serialized(async () => {
        const latest = await store.requireRun(run.taskId, run.id);
        const current = findAttempt(latest, target.id);
        if (!current || !ACTIVE_ATTEMPT_STATUSES.has(current.status)) return;
        current.status = "cancelled";
        current.leaseId = null;
        current.error = "Closed by primary agent.";
        current.updatedAt = now();
        current.finishedAt = now();
        await store.writeRun(latest);
        await emit(latest, "worker-closed", current.error, current.id);
      });
      return { attemptId: target.id, status: "cancelled" };
    }
    throw new Error(`Unsupported task control tool: ${name}`);
  }

  function createControlPlane(taskId, taskRunId, attemptId) {
    const invoke = async (tool, args = {}) => {
      const located = await store.findRun(taskRunId);
      if (!located || located.taskId !== taskId) throw new Error("Task run not found");
      const run = await store.requireRun(taskId, taskRunId);
      const primary = findAttempt(run, attemptId);
      if (!primary || primary.kind !== "primary") throw new Error("Task control plane is primary-only");
      return invokeTool(run, primary, tool, args);
    };
    return Object.freeze({
      get_task_state: (args) => invoke("get_task_state", args),
      list_agents: (args) => invoke("list_agents", args),
      spawn_agent: (args) => invoke("spawn_agent", args),
      send_message: (args) => invoke("send_message", args),
      wait_agent: (args) => invoke("wait_agent", args),
      close_agent: (args) => invoke("close_agent", args),
      checkpoint_task: (args) => invoke("checkpoint_task", args),
      continue_task: (args) => invoke("continue_task", args),
      complete_task: (args) => invoke("complete_task", args),
      block_task: (args) => invoke("block_task", args),
      realign_task: (args) => invoke("realign_task", args),
      describe: () => ({ depth: 0, tools: EXECUTION_TASK_TOOLS }),
    });
  }

  async function executeAttempt(taskId, taskRunId, attemptId) {
    const located = await store.findRun(taskRunId);
    const checker = located?.run?.checkerAttempts?.find((candidate) => candidate.id === attemptId) ?? null;
    if (checker) return executeCheckerAttempt(taskId, taskRunId, attemptId);
    const begun = await beginAttempt(taskId, taskRunId, attemptId);
    if (!begun) return { stale: true };
    const { run, attempt, leaseId } = begun;
    const profile = profileForAttempt(run, attempt);
    let startedPersonalRunId = null;
    let messageOperationId = null;
    let mcpBridge = null;
    try {
      const taskWorkdir = await requireTaskWorkdir(run.definition.workspaceRoot);
      if (isClosed()) return { stale: true };
      if (typeof preflightAttempt === "function") await preflightAttempt({ run, attempt, profile, checker: false });
      if (!(await assertProviderStartAllowed(taskId, taskRunId, attempt.id, leaseId))) return { stale: true };
      const ownedCreate = await runtimeOperations.call(`Personal createConversation (${attempt.kind})`, `${attempt.kind}-create`, ({ operationId, signal }) => personalAgentRuntime.createConversation({
        workspaceRoot: run.definition.workspaceRoot,
        workdir: taskWorkdir,
        agent: { id: profile.agentId, provider: profile.provider },
        model: profile.model,
        title: `${profile.label} · ${run.id}`,
        source: "task-orchestrator-v2",
        metadata: { taskId, taskRunId, attemptId, turnId: attempt.turnId ?? null, kind: attempt.kind, depth: attempt.depth },
        operationId,
        signal,
      }));
      const created = ownedCreate.value;
      const conversationId = String(created?.conversation?.id ?? created?.id ?? "").trim();
      if (!conversationId) throw new Error("Personal runtime did not return a conversation id");
      if (!(await persistAttempt(taskId, taskRunId, attempt.id, leaseId, { conversationId }))) return { stale: true };
      if (isClosed() || !(await leaseIsActive(taskId, taskRunId, attempt.id, leaseId))) return { stale: true };
      const controlPlane = attempt.kind === "primary" ? createControlPlane(taskId, taskRunId, attempt.id) : null;
      const taskExecutionObserver = {
        beforeOperation: (operation) => sideEffects.recordIntent(taskId, taskRunId, attempt.id, leaseId, operation),
      };
      if (controlPlane) {
        mcpBridge = await createTaskControlMcpBridge({
          queueRoot: path.join(store.rootDirectory, "mcp", taskRunId, attempt.id),
          token: createId("mcp"),
          requestTimeoutMs: Math.min(attempt.timeoutMs, run.definition.endConditions.maxTurnRuntimeMs),
          invoke: (tool, args) => controlPlane[tool]?.(args) ?? Promise.reject(new Error(`Unknown task control tool: ${tool}`)),
        });
        activeTaskControlBridges.add(mcpBridge);
      }
      if (!(await assertProviderStartAllowed(taskId, taskRunId, attempt.id, leaseId))) return { stale: true };
      const ownedStart = await runtimeOperations.call(`Personal startMessage (${attempt.kind})`, `${attempt.kind}-message`, ({ operationId, signal }) => personalAgentRuntime.startMessage({
        workspaceRoot: run.definition.workspaceRoot,
        workdir: taskWorkdir,
        prompt: taskPrompt(run, attempt),
        approvalMode: runtimeApprovalMode(run.definition.permissionMode, attempt.kind),
        timeoutMs: profile.timeoutMs,
        conversationId,
        sessionStrategy: "new",
        useRememberedApprovals: false,
        model: profile.model,
        agent: { id: profile.agentId, provider: profile.provider },
        taskControlPlane: controlPlane,
        taskTools: mcpBridge?.taskTools ?? null,
        mcpServers: mcpBridge?.mcpServers ?? [],
        taskDepth: attempt.depth,
        taskPermissionMode: run.definition.permissionMode,
        taskId,
        taskRunId,
        taskRevision: run.taskRevision,
        taskContractHash: run.permissionGrant?.contractHash ?? contractHash(run.definition.contract),
        taskProfileId: profile.id,
        taskPermissionGrant: run.permissionGrant,
        taskExecutionObserver,
        requireTaskIntentHook: run.definition.permissionMode === "full-allow",
        operationId,
        signal,
      }));
      const started = ownedStart.value;
      messageOperationId = ownedStart.operationId;
      const startedDiagnostics = providerDiagnosticsFromResult(started);
      const startedUsage = providerUsage(started);
      if (startedDiagnostics || startedUsage) {
        await persistAttempt(taskId, taskRunId, attempt.id, leaseId, {
          ...(startedDiagnostics ? { providerDiagnostics: startedDiagnostics } : {}),
          ...(startedUsage ? { providerUsage: startedUsage } : {}),
          progressAt: now(),
        });
      }
      startedPersonalRunId = String(started?.runId ?? "").trim();
      if (!startedPersonalRunId && !PERSONAL_TERMINAL_STATUSES.has(started?.status)) throw new Error("Personal runtime did not return a run id");
      if (startedPersonalRunId && !(await persistAttempt(taskId, taskRunId, attempt.id, leaseId, { personalRunId: startedPersonalRunId }))) {
        await cancelRuntimeAttempt(startedPersonalRunId, messageOperationId, "orchestrator-stale-lease");
        return { stale: true };
      }
      await syncProcessRecord(taskId, taskRunId, attempt, startedPersonalRunId, started);
      const terminal = PERSONAL_TERMINAL_STATUSES.has(started?.status)
        ? { stale: false, snapshot: started }
        : await waitForPersonalRun({
            taskId,
            taskRunId,
            attemptId: attempt.id,
            leaseId,
            personalRunId: startedPersonalRunId,
            operationId: messageOperationId,
            workspaceRoot: run.definition.workspaceRoot,
            provider: profile.provider,
            kind: attempt.kind,
            timeoutMs: attempt.timeoutMs,
            taskTools: mcpBridge?.taskTools ?? [],
            bridgeError: mcpBridge?.getError,
            started,
          });
      if (PERSONAL_TERMINAL_STATUSES.has(started?.status)
        && !(await persistTerminalContext(taskId, taskRunId, attempt.id, leaseId, terminal.snapshot, profile.model))) return { stale: true };
      const terminalDiagnostics = providerDiagnosticsFromResult(terminal.snapshot);
      const terminalUsage = providerUsage(terminal.snapshot);
      await syncProcessRecord(taskId, taskRunId, attempt, startedPersonalRunId, terminal.snapshot, terminal.snapshot?.status === "cancelled" ? "cancelled" : null);
      if (terminalDiagnostics || terminalUsage || PERSONAL_TERMINAL_STATUSES.has(terminal.snapshot?.status)) {
        await persistAttempt(taskId, taskRunId, attempt.id, leaseId, {
          ...(terminalDiagnostics ? { providerDiagnostics: terminalDiagnostics } : {}),
          ...(terminalUsage ? { providerUsage: terminalUsage } : {}),
          ...(TERMINAL_PROGRESS_STATUSES.has(String(terminal.snapshot?.status ?? "").toLowerCase()) ? { progressAt: now() } : {}),
        });
      }
      await sideEffects.synchronize(taskId, taskRunId, attempt.id, leaseId, terminal.snapshot);
      await assertSideEffectIntent(taskId, taskRunId, attempt.id);
      if (terminal.stale) {
        await cancelRuntimeAttempt(startedPersonalRunId, messageOperationId, "orchestrator-stale-lease");
        return { stale: true };
      }
      if (!terminal.contextRollover && terminal.snapshot?.status !== "completed") {
        const terminalError = terminal.snapshot?.error || `Personal runtime ended with ${terminal.snapshot?.status ?? "unknown"}`;
        if (await scheduleTransportRetry(taskId, taskRunId, attempt, leaseId, terminalError)) return { stale: false, retrying: true };
        await failAttempt(taskId, taskRunId, attempt.id, leaseId, terminalError, terminal.snapshot?.status === "cancelled" ? "cancelled" : "failed");
        return { stale: false, failed: true };
      }
      const completed = await writeAttemptArtifact(taskId, taskRunId, attempt, leaseId, terminal.snapshot);
      if (!completed) return { stale: true };
      const finished = await finishCompletedAttempt(taskId, taskRunId, attempt, leaseId, terminal.snapshot, {
        checkpointTrigger: terminal.contextRollover ? "context-threshold" : "primary-decision",
        continuationReason: terminal.contextRollover ? "context-rollover" : undefined,
      });
      await maybeFinishRun(taskId, taskRunId);
      return { stale: false, completed, finished };
    } catch (error) {
      if (!error?.runtimeCleanupAttempted && (messageOperationId || startedPersonalRunId)) {
        const cancellation = await cancelRuntimeAttempt(startedPersonalRunId, messageOperationId, "orchestrator-attempt-error");
        if (cancellation?.ok !== true) error = runtimeCleanupError(error, cancellation);
      }
      // Cleanup failures are terminal attempt failures, not resumable
      // interruptions. Marking them failed fences the attempt while avoiding
      // automatic replay; blocked remains reserved for explicit safety/restart
      // conditions handled by failAttempt callers.
      const terminalStatus = "failed";
      if (error?.code !== "TASK_RUNTIME_CALL_TIMEOUT" && !error?.runtimeCleanupAttempted && await scheduleTransportRetry(taskId, taskRunId, attempt, leaseId, messageOf(error))) return { stale: false, retrying: true };
      await failAttempt(taskId, taskRunId, attempt.id, leaseId, messageOf(error), terminalStatus);
      return { stale: false, failed: true };
    } finally {
      await tombstoneProcessFor(taskRunId, attemptId);
      releaseProcessObservation(taskRunId, attemptId);
      if (mcpBridge) {
        const stats = mcpBridge.pollingStats();
        taskControlTotals.bridges += 1;
        for (const key of ["pollCount", "watchWakeups", "poisonRequests", "unknownOutcomeRecoveries"]) taskControlTotals[key] += Number(stats[key] ?? 0);
        activeTaskControlBridges.delete(mcpBridge);
      }
      await Promise.resolve(mcpBridge?.close?.()).catch(() => undefined);
    }
  }

  function launch(taskId, taskRunId, attemptId, durableAdmission = null) {
    if (isClosed()) return Promise.resolve();
    const executionKey = `${taskRunId}:${attemptId}`;
    const existing = activeExecutions.get(executionKey);
    if (existing) return existing;
    const execution = Promise.resolve()
      .then(async () => {
        if (isClosed()) return undefined;
        const located = await store.findRun(taskRunId);
        const attempt = located ? attemptFor(located.run, attemptId) : null;
        if (!attempt || attempt.status !== "ready") return undefined;
        if (attempt.notBefore !== null && attempt.notBefore > now()) {
          scheduleReadyWake(attempt.notBefore);
          return undefined;
        }
        const turn = turnForAttempt(located.run, attempt);
        const resumeReasons = new Set(["primary-continue", "primary-checkpoint", "context-rollover", "user-resume", "app-quit-resume", "supervisor-recovery", "retry", "transport-retry"]);
        const kind = attempt.profileId === located.run.definition.independentChecker?.profile?.id
          ? "checker"
          : attempt.kind === "worker" ? "worker" : resumeReasons.has(turn?.reason) ? "resume" : "primary";
        const storedAdmission = durableAdmission ?? await store.readAdmission?.({ taskRunId, attemptId });
        const ticket = storedAdmission?.ticket ?? admissionScheduler.enqueue({
          runId: taskRunId,
          attemptId,
          kind: storedAdmission?.kind ?? kind,
          priority: storedAdmission?.priority ?? (kind === "checker" ? 90 : attempt.kind === "primary" ? 100 : 0),
          sequence: storedAdmission?.sequence ?? attempt.updatedAt,
          enqueuedAt: storedAdmission?.enqueuedAt ?? attempt.updatedAt,
        });
        admissionTickets.set(executionKey, ticket);
        let admission = null;
        try {
          admission = await ticket;
          const durableAdmission = await store.markAdmission?.({ taskRunId, attemptId, status: "admitted" });
          if (durableAdmission === false) throw new Error("Durable admission row disappeared before lease acquisition");
          if (isClosed()) return undefined;
          return await executeAttempt(taskId, taskRunId, attemptId);
        } finally {
          if (admissionTickets.get(executionKey) === ticket) admissionTickets.delete(executionKey);
          try { await store.markAdmission?.({ taskRunId, attemptId, status: "released" }); } catch { /* durable attempt status remains authoritative */ }
          admission?.release();
        }
      })
      .catch(async (error) => {
        const located = await store.findRun(taskRunId).catch(() => null);
        const current = located ? attemptFor(located.run, attemptId) : null;
        if (located && current?.leaseId) await failAttempt(located.taskId, taskRunId, current.id, current.leaseId, messageOf(error));
      })
      .finally(() => {
        if (activeExecutions.get(executionKey) === execution) activeExecutions.delete(executionKey);
      });
    activeExecutions.set(executionKey, execution);
    return execution;
  }

  async function awaitActive(taskRunId = null) {
    const prefix = taskRunId ? `${taskRunId}:` : null;
    while (true) {
      const pending = [...activeExecutions.entries()]
        .filter(([key]) => !prefix || key.startsWith(prefix))
        .map(([, execution]) => execution);
      if (!pending.length) return;
      await Promise.allSettled([...new Set(pending)]);
    }
  }

  function cancelAdmissions(taskRunId, reason = "Task run no longer accepts queued attempts") {
    const prefix = `${taskRunId}:`;
    let cancelled = 0;
    for (const [key, ticket] of admissionTickets) {
      if (key.startsWith(prefix) && ticket.cancel(reason)) cancelled += 1;
    }
    return cancelled;
  }

  function closeAdmissions(reason = "Task orchestrator is closing") {
    clearReadyWake();
    return admissionScheduler.close({ reason });
  }

  return {
    reconcileCompletionReviews,
    reconcileActiveRuns,
    reconcileReadyAttempts,
    launch,
    awaitActive,
    invokeTool,
    cancelAdmissions,
    closeAdmissions,
    schedulerSnapshot: () => admissionScheduler.snapshot(),
    readyWakeSnapshot: () => ({ scheduledAt: readyWakeAt, reconciling: readyReconcileFlight !== null }),
    processObservationSnapshot: () => ({ records: processRecords.size, snapshots: processSnapshots.size }),
    taskControlFsSnapshot: () => {
      const snapshot = { ...taskControlTotals, activeBridges: activeTaskControlBridges.size };
      for (const bridge of activeTaskControlBridges) {
        const stats = bridge.pollingStats();
        for (const key of ["pollCount", "watchWakeups", "poisonRequests", "unknownOutcomeRecoveries"]) snapshot[key] += Number(stats[key] ?? 0);
      }
      return snapshot;
    },
    recordPowerEvent,
  };
}
