import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  TASK_ORCHESTRATOR_SCHEMA_VERSION,
  TASK_ORCHESTRATOR_TEMPLATE,
  taskOrchestratorArtifactContentGetInputSchema,
  taskOrchestratorArtifactGetInputSchema,
  taskOrchestratorArtifactsListInputSchema,
  taskOrchestratorCheckerProfileSchema,
  taskOrchestratorAlignmentMessageInputSchema,
  taskOrchestratorContractSchema,
  taskOrchestratorEventsListInputSchema,
  taskOrchestratorFinalizeContractInputSchema,
  taskOrchestratorPermissionModeSchema,
  taskOrchestratorMaintenanceInputSchema,
  taskOrchestratorRecoveryInputSchema,
  taskOrchestratorResolveGateInputSchema,
  taskOrchestratorRetryInputSchema,
  taskOrchestratorRunIdInputSchema,
  taskOrchestratorRunsListInputSchema,
  taskOrchestratorTurnHistoryListInputSchema,
  taskOrchestratorTaskCreateInputSchema,
  taskOrchestratorTaskArchiveInputSchema,
  taskOrchestratorTaskExportManifestInputSchema,
  taskOrchestratorTaskGetInputSchema,
  taskOrchestratorTaskIdInputSchema,
  taskOrchestratorTaskListInputSchema,
  taskOrchestratorTaskPurgeInputSchema,
  taskOrchestratorTaskRestoreInputSchema,
  taskOrchestratorTaskUpdateInputSchema,
  taskOrchestratorStoreHealthInputSchema,
  taskOrchestratorOperationsDiagnosticsGetInputSchema,
} from "@onmyagent/types/task-orchestrator";

import {
  ACTIVE_ATTEMPT_STATUSES,
  ACTIVE_RUN_STATUSES,
  PERSONAL_TERMINAL_STATUSES,
  allAttempts,
  clone,
  createAttempt,
  currentAttempt,
  defaultId,
  definitionFromTask,
  findAttempt,
  messageOf,
  profileFromSelection,
  profilesFromInput,
  runtimeApprovalMode,
  sleepFor,
} from "./definitions.mjs";
import {
  createApprovalDecisionReconciler,
  createApprovalGateExpirationReconciler,
  finalizedDecisionGate,
  reconcileApprovalGateStates,
  terminalGateForInterruptedRun,
} from "./approval-gates.mjs";
import { createTaskAlignmentRuntime } from "./alignment-runtime.mjs";
import { createTaskOrchestratorRunner } from "./runner.mjs";
import { unsafeUnknownSideEffects } from "./side-effects.mjs";
import {
  isTaskProviderNativeDelegationIsolated,
  preflightProviderSelection,
  providerCapabilitySnapshot,
} from "./provider-capabilities.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import { buildRecoveryManifest, isRecoveryAttempt } from "./recovery-manifest.mjs";
import {
  buildPauseContinuationRecords,
  continuationPrompt,
  createTurn,
  endConditionViolation,
  refreshRunBudget,
  turnForAttempt,
  assertContinuationCapsuleIdentity,
  hydrateContinuationCapsuleEvidence,
} from "./turns.mjs";
import { normalizeIndependentCheckerPolicy } from "./independent-checker.mjs";
import { withRuntimeDeadline } from "./runtime-deadline.mjs";
import { createTaskRuntimeOperationController } from "./runtime-operation.mjs";
import { projectOperationsDiagnostics } from "./operations-diagnostics.mjs";

function text(value) {
  return String(value ?? "").trim();
}

const RETAINED_APPROVAL_TERMINAL_STATUSES = new Set([
  ...PERSONAL_TERMINAL_STATUSES,
  "stopped",
  "terminated",
  "exited",
]);
const RETAINED_APPROVAL_PROCESS_TERMINAL_STATUSES = new Set([
  "exited",
  "failed",
  "cancelled",
  "stopped",
  "terminated",
  "tombstoned",
  "stale",
]);

/**
 * Match a retained provider process to the exact Task approval identity.
 * Terminal rows and rows belonging to another task/attempt are never
 * cancellation or tombstone candidates.
 */
export function retainedApprovalProcessMatches(row, request) {
  const personalRunId = String(request?.personalRunId ?? "").trim();
  if (!personalRunId || String(row?.personalRunId ?? "").trim() !== personalRunId) return false;
  const taskRunId = String(request?.taskRunId ?? request?.runId ?? "").trim();
  const rowTaskRunId = String(row?.runId ?? row?.taskRunId ?? "").trim();
  if (taskRunId && rowTaskRunId && rowTaskRunId !== taskRunId) return false;
  const attemptId = String(request?.attemptId ?? "").trim();
  const rowAttemptId = String(row?.attemptId ?? "").trim();
  if (attemptId && rowAttemptId && rowAttemptId !== attemptId) return false;
  return !RETAINED_APPROVAL_PROCESS_TERMINAL_STATUSES.has(String(row?.status ?? "").trim().toLowerCase());
}

function errorCode(value) {
  if (!value || typeof value !== "object" || !("code" in value)) return null;
  const code = value.code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

async function requireWorkspaceRoot(value) {
  const workspaceRoot = text(value);
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) throw new Error("Task workspace root must be an absolute directory");
  const info = await stat(workspaceRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Task workspace root must be an existing directory");
  return workspaceRoot;
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertFiniteFullAllowDeadline(permissionMode, endConditions) {
  if (permissionMode !== "full-allow") return;
  if (endConditions.deadlineAt === null && endConditions.maxElapsedMs === null) {
    throw new Error("Task full-allow mode requires a finite deadline or maximum elapsed time");
  }
}

async function permissionGrantForRun(task, runId, definition, timestamp, createId, runCreatedAt = timestamp, existingGrant = null) {
  if (definition.permissionMode !== "full-allow") return null;
  const realWorkspaceRoot = await realpath(definition.workspaceRoot);
  const deadlines = [];
  if (definition.endConditions.deadlineAt !== null) {
    deadlines.push(definition.endConditions.deadlineAt);
  }
  if (definition.endConditions.maxElapsedMs !== null) {
    deadlines.push(runCreatedAt + definition.endConditions.maxElapsedMs);
  }
  if (!deadlines.length) {
    throw new Error("Task full-allow mode requires a finite deadline or maximum elapsed time");
  }
  const expiresAt = Math.min(...deadlines);
  if (expiresAt <= timestamp) throw new Error("Task full-allow grant cannot start after its frozen deadline");
  if (existingGrant && existingGrant.realWorkspaceRoot !== realWorkspaceRoot) {
    throw new Error("Task workspace canonical path changed while paused; full-allow resume is blocked");
  }
  const profiles = [definition.primary, ...definition.allowedWorkers, definition.independentChecker?.profile].filter(Boolean);
  return {
    policyVersion: 1,
    id: existingGrant?.id ?? createId("grant"),
    mode: "full-allow",
    taskId: task.id,
    taskRunId: runId,
    taskRevision: task.revision,
    workspaceRoot: definition.workspaceRoot,
    realWorkspaceRoot,
    contractHash: sha256Json(definition.contract),
    allowedProfileIds: profiles.map((profile) => profile.id),
    allowedProviders: [...new Set(profiles.map((profile) => profile.provider))],
    issuedAt: existingGrant?.issuedAt ?? timestamp,
    expiresAt,
  };
}

function catalogModels(entry) {
  const handshake = entry?.handshake ?? {};
  const models = [];
  const append = (value) => {
    if (Array.isArray(value)) {
      models.push(...value);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [id, model] of Object.entries(value)) {
      models.push(model && typeof model === "object" ? { ...model, id: model.id ?? id } : id);
    }
  };
  append(entry?.modelOptions);
  append(entry?.models);
  append(entry?.availableModels);
  append(handshake?.available_models);
  append(handshake?.availableModels);
  return models.map((model) => ({
    id: text(model?.id ?? model?.value ?? model),
    label: text(model?.label ?? model?.name ?? model?.id ?? model),
    aliases: Array.isArray(model?.aliases) ? model.aliases.map(text).filter(Boolean) : [],
  })).filter((model) => model.id);
}

export function createTaskOrchestrator(options = {}) {
  const personalAgentRuntime = options.personalAgentRuntime;
  for (const method of [
    "createConversation",
    "startMessage",
    "getRun",
    "cancelRun",
    "resolveApproval",
    "cancelTaskOperation",
    "getTaskOperation",
    "getTaskCapability",
  ]) {
    if (typeof personalAgentRuntime?.[method] !== "function") throw new Error(`personalAgentRuntime.${method} is required`);
  }
  const store = options.store ?? createTaskOrchestratorStore({ userDataDir: options.userDataDir, supervisorEpoch: options.supervisorEpoch });
  const now = typeof options.now === "function" ? options.now : Date.now;
  const createId = typeof options.idFactory === "function" ? options.idFactory : defaultId;
  const supervisorEpoch = String(options.supervisorEpoch ?? store.supervisorEpoch ?? "").trim() || null;
  const sleep = typeof options.sleep === "function" ? options.sleep : sleepFor;
  const pollMs = Math.max(1, Number(options.pollMs) || 500);
  const runtimeCallTimeoutMs = options.runtimeCallTimeoutMs ?? options.personalRuntimeCallTimeoutMs;
  const listeners = new Set();
  const activeGateResolutions = new Set();
  let closed = false;
  let closePromise = null;
  let mutationTail = Promise.resolve();
  const retainedCancellationFlights = new Map();
  let approvalSweepTimer = null;
  let approvalSweepInFlight = null;
  const configuredApprovalSweepMs = Number(options.approvalExpirySweepMs);
  const approvalSweepIntervalMs = Number.isFinite(configuredApprovalSweepMs)
    ? Math.max(1, Math.min(60_000, Math.round(configuredApprovalSweepMs)))
    : 5_000;

  /** @template T @param {() => Promise<T> | T} operation @returns {Promise<T>} */
  function serialized(operation) {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function runtimeCall(label, operation) {
    return withRuntimeDeadline(label, runtimeCallTimeoutMs, operation);
  }

  async function retainedApprovalCancellationEvidence(request) {
    const taskRunId = String(request?.taskRunId ?? request?.runId ?? "").trim();
    const personalRunId = String(request?.personalRunId ?? "").trim();
    if (!taskRunId || !personalRunId) return { eligible: false, skipped: true, reason: "missing-retained-approval-identity", processIds: [] };

    let liveRows = [];
    if (typeof store.listProcesses === "function") {
      try {
        const rows = await store.listProcesses({ runId: taskRunId, includeTerminal: false });
        liveRows = (Array.isArray(rows) ? rows : []).filter((row) => retainedApprovalProcessMatches(row, request));
      } catch (error) {
        return { eligible: false, error: messageOf(error), processIds: [] };
      }
    }
    if (liveRows.length) {
      return { eligible: true, processIds: liveRows.map((row) => row.id).filter(Boolean) };
    }

    // A process row may not have been persisted yet (or may already have
    // been tombstoned) while the Personal run is still live.  Query the
    // provider state as a second, identity-scoped liveness source.  An
    // explicitly terminal/missing state is safe to skip; an unavailable,
    // timed-out, or malformed state remains a diagnostic cancellation
    // failure and must not be treated as a tombstone.
    if (typeof personalAgentRuntime?.getRun !== "function") {
      return { eligible: false, error: "Personal getRun is unavailable while checking retained approval liveness", processIds: [] };
    }
    let snapshot;
    try {
      snapshot = await runtimeCall(`Personal getRun (${personalRunId})`, () => personalAgentRuntime.getRun({ runId: personalRunId }));
    } catch (error) {
      return { eligible: false, error: messageOf(error), processIds: [] };
    }
    const status = String(snapshot?.status ?? "").trim().toLowerCase();
    if (!status) {
      return { eligible: false, error: "Personal getRun returned no status while checking retained approval liveness", processIds: [] };
    }
    if (RETAINED_APPROVAL_TERMINAL_STATUSES.has(status)) {
      return { eligible: false, skipped: true, reason: "no-live-retained-provider", processIds: [] };
    }
    return { eligible: true, processIds: [] };
  }

  function cancelOneRetainedApprovalRun(request) {
    const personalRunId = String(request?.personalRunId ?? "").trim();
    if (!personalRunId) return Promise.resolve({ ok: true, skipped: true });
    const existing = retainedCancellationFlights.get(personalRunId);
    if (existing) return existing;
    const flight = (async () => {
      const evidence = await retainedApprovalCancellationEvidence(request);
      if (evidence.error) return { ok: false, error: evidence.error };
      if (!evidence.eligible) return { ok: true, skipped: true, reason: evidence.reason };
      try {
        const result = await runtimeCall(`Personal cancelRun (${request.reason || "task-approval-stale"})`, () => personalAgentRuntime.cancelRun(
          personalRunId,
          { reason: request.reason || "task-approval-stale" },
        ));
        return result?.ok === false
          ? { ok: false, error: text(result.error) || "provider cancellation was not confirmed" }
          : { ok: true, result, processIds: evidence.processIds };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    })();
    const tracked = flight.finally(() => {
      if (retainedCancellationFlights.get(personalRunId) === tracked) retainedCancellationFlights.delete(personalRunId);
    });
    retainedCancellationFlights.set(personalRunId, tracked);
    return tracked;
  }

  async function tombstoneRetainedApprovalProcess(request) {
    if (typeof store.listProcesses !== "function" || typeof store.tombstoneProcess !== "function") return { ok: true, skipped: true };
    const rows = await store.listProcesses({ runId: request.taskRunId, includeTerminal: false });
    const matching = rows.filter((row) => retainedApprovalProcessMatches(row, request));
    const results = await Promise.allSettled(matching.map((row) => store.tombstoneProcess({ id: row.id, status: "cancelled" })));
    const failed = results.find((entry) => entry.status === "rejected");
    if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
    return { ok: true, count: matching.length };
  }

  async function cancelRetainedApprovalRuns(requests) {
    const unique = [...new Map(
      (Array.isArray(requests) ? requests : [])
        .filter((request) => String(request?.personalRunId ?? "").trim())
        .map((request) => [request.personalRunId, request]),
    ).values()];
    const failures = [];
    const tombstoneTasks = [];
    const settled = await Promise.allSettled(unique.map((request) => cancelOneRetainedApprovalRun(request)));
    settled.forEach((entry, index) => {
      const request = unique[index];
      if (entry.status === "rejected") failures.push({ request, error: messageOf(entry.reason) });
      else if (entry.value?.ok === false) failures.push({ request, error: text(entry.value.error) || "provider cancellation was not confirmed" });
      else if (entry.value?.skipped !== true) tombstoneTasks.push({ request, promise: tombstoneRetainedApprovalProcess(request) });
    });
    const tombstoneResults = await Promise.allSettled(tombstoneTasks.map((task) => task.promise));
    tombstoneResults.forEach((entry, index) => {
      if (entry.status === "rejected") {
        const request = tombstoneTasks[index].request;
        failures.push({ request, error: `provider cancellation confirmed but process tombstone failed: ${messageOf(entry.reason)}` });
      }
    });
    if (failures.length) {
      await serialized(async () => {
        for (const failure of failures) {
          const located = await store.findRun?.(failure.request.taskRunId);
          if (!located) continue;
          const run = located.run;
          if (run.status !== "blocked") continue;
          run.error = `${run.error || "Approval gate expired or became stale."} Provider cancellation was not confirmed: ${failure.error}`.slice(0, 8_000);
          run.updatedAt = now();
          await store.writeRun(run);
          await emit(run, "run-blocked", run.error, failure.request.attemptId);
        }
      });
    }
    return failures;
  }

  async function emit(run, type, message, attemptId = null) {
    const attempt = attemptId ? findAttempt(run, attemptId) : null;
    const event = await store.appendEvent({
      schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
      id: createId("event"),
      sequence: await store.nextEventSequence(run.taskId, run.id),
      taskId: run.taskId,
      taskRunId: run.id,
      attemptId,
      turnId: attempt?.turnId ?? run.currentTurnId ?? null,
      type,
      message: String(message ?? "").slice(0, 4_000),
      at: now(),
    });
    await notifyEvent(event);
    return event;
  }

  async function emitTask(taskId, type, message, extra = {}) {
    const event = await store.appendEvent({
      schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
      id: createId("event"),
      sequence: await store.nextEventSequence(taskId, null),
      taskId,
      taskRunId: null,
      attemptId: null,
      turnId: null,
      type,
      message: String(message ?? "").slice(0, 4_000),
      proposalId: extra.proposalId ?? null,
      proposalRevision: extra.proposalRevision ?? null,
      at: now(),
    });
    await notifyEvent(event);
    return event;
  }

  async function notifyEvent(event, { claimed = false } = {}) {
    // Keep the durable intent pending until at least one local subscriber is
    // present. Startup/recovery can emit events before the Supervisor socket
    // subscribes; acknowledging that window would lose the notification.
    if (listeners.size === 0) return false;
    let entryClaimed = claimed;
    if (!entryClaimed && typeof store.claimOutbox === "function") {
      const claimedRows = await store.claimOutbox({ ids: [event.id], ownerEpoch: supervisorEpoch ?? undefined, limit: 1 });
      entryClaimed = claimedRows.some((row) => row.id === event.id);
      // A legacy/test store may not expose the outbox API. The event itself
      // remains the authoritative payload and is still delivered locally.
      if (!entryClaimed && claimedRows.length === 0 && typeof store.ackOutbox !== "function") entryClaimed = true;
    }
    if (!entryClaimed && typeof store.claimOutbox === "function") return false;
    const deliveries = [];
    for (const listener of [...listeners]) {
      try { deliveries.push(Promise.resolve(listener(event))); } catch (error) { deliveries.push(Promise.reject(error)); }
    }
    const results = await Promise.allSettled(deliveries);
    if (results.some((result) => result.status === "rejected")
      || results.some((result) => result.status === "fulfilled" && result.value === false)) {
      if (typeof store.releaseOutbox === "function") {
        await store.releaseOutbox({ id: event.id, ownerEpoch: supervisorEpoch ?? undefined }).catch(() => undefined);
      }
      return false;
    }
    if (typeof store.ackOutbox === "function") await store.ackOutbox({ id: event.id, ownerEpoch: supervisorEpoch ?? undefined });
    return true;
  }

  const runner = createTaskOrchestratorRunner({
    personalAgentRuntime,
    store,
    now,
    createId,
    sleep,
    pollMs,
    serialized,
    emit,
    notify: notifyEvent,
    onCancellationConfirmed: (request) => tombstoneRetainedApprovalProcess(request),
    isClosed: () => closed,
    supervisorEpoch,
    admissionScheduler: options.admissionScheduler,
    maxGlobalActiveAttempts: options.maxGlobalActiveAttempts,
    reservedWorkerSlots: options.reservedWorkerSlots,
    runtimeCallTimeoutMs: options.runtimeCallTimeoutMs ?? options.personalRuntimeCallTimeoutMs,
    preflightAttempt: preflightFrozenAttempt,
    evaluateAttemptLiveness: options.evaluateAttemptLiveness,
  });
  const alignmentRuntime = createTaskAlignmentRuntime({
    personalAgentRuntime,
    store,
    now,
    createId,
    sleep,
    pollMs,
    serialized,
    emitTask,
    proposeContract: applyProposal,
    isClosed: () => closed,
    runtimeCallTimeoutMs: options.runtimeCallTimeoutMs ?? options.personalRuntimeCallTimeoutMs,
  });
  const reconcileApprovalDecisionIntents = createApprovalDecisionReconciler({
    store,
    now,
    serialized,
    emit,
    notify: notifyEvent,
    createId,
    cancelAttempt: ({ personalRunId, reason, ...request }) => cancelOneRetainedApprovalRun({ ...request, personalRunId, reason }),
    onCancellationConfirmed: (request) => tombstoneRetainedApprovalProcess(request),
  });
  const reconcileApprovalGateExpirationsOnce = createApprovalGateExpirationReconciler({
    store,
    now,
    serialized,
    emit,
    notify: notifyEvent,
    createId,
    cancelAttempt: ({ personalRunId, reason, ...request }) => cancelOneRetainedApprovalRun({ ...request, personalRunId, reason }),
    onCancellationConfirmed: (request) => tombstoneRetainedApprovalProcess(request),
  });
  async function reconcileApprovalGateExpirations() {
    if (approvalSweepInFlight) return approvalSweepInFlight;
    approvalSweepInFlight = Promise.resolve()
      .then(() => reconcileApprovalGateExpirationsOnce())
      .finally(() => { approvalSweepInFlight = null; });
    return approvalSweepInFlight;
  }
  function startApprovalExpirySweep() {
    if (approvalSweepTimer || closed) return;
    approvalSweepTimer = setInterval(() => { void reconcileApprovalGateExpirations().catch(() => undefined); }, approvalSweepIntervalMs);
    approvalSweepTimer.unref?.();
  }
  async function stopApprovalExpirySweep() {
    if (approvalSweepTimer) {
      clearInterval(approvalSweepTimer);
      approvalSweepTimer = null;
    }
    if (approvalSweepInFlight) await approvalSweepInFlight.catch(() => undefined);
  }
  const ready = store.initialize()
    .then(() => store.reconcileLatestRunPointers())
    .then(() => reconcileInterruptedAlignments())
    .then(() => runner.reconcileCompletionReviews())
    // Expiry/stale-lease sweep must precede durable decision reconciliation;
    // otherwise a resolving gate could be approved after its TTL elapsed.
    .then(() => reconcileApprovalGateExpirations())
    .then(() => runner.reconcileActiveRuns({ trigger: "startup" }))
    // The restart reconciliation fences every persisted provider lease. Run
    // the gate sweep again before deciding any durable manual review intent so
    // a provider gate cannot be finalized from an interrupted old session.
    .then(() => reconcileApprovalGateExpirations())
    .then(() => reconcileApprovalDecisionIntents())
    .then(() => runner.reconcileReadyAttempts())
    .then(() => recoverSafeInterruptedRuns())
    .then(() => recoverAutoFinalizationRuns())
    .then(() => { startApprovalExpirySweep(); });

  function subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Task orchestrator listener must be a function");
    if (closed) throw new Error("Task orchestrator is closed");
    listeners.add(listener);
    let subscribed = true;
    return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
  }

  async function replayOutbox(input = {}) {
    await ready;
    if (typeof store.replayOutbox !== "function") return { claimed: 0, delivered: 0, pending: 0 };
    return store.replayOutbox({
      ...input,
      ownerEpoch: supervisorEpoch ?? input.ownerEpoch,
      notify: (event) => notifyEvent(event, { claimed: true }),
    });
  }

  async function requireLocatedRun(taskRunId) {
    const located = await store.findRun(taskRunId);
    if (!located) throw new Error(`Run not found: ${taskRunId}`);
    return located;
  }

  async function listCatalog(workspaceRoot) {
    const method = personalAgentRuntime.listAvailableAgentMetadata ?? personalAgentRuntime.listAgentMetadata ?? personalAgentRuntime.listAgents;
    if (typeof method !== "function") throw new Error("Personal agent/model catalog is unavailable");
    const result = await runtimeCall("Personal agent/model catalog", () => method.call(personalAgentRuntime, { workspaceRoot, includeModels: true, includeDiscoverable: true }));
    const entries = Array.isArray(result) ? result : Array.isArray(result?.agents) ? result.agents : [];
    if (!entries.length) throw new Error("Personal agent/model catalog is empty");
    return entries;
  }

  async function selectedCatalogEntry(workspaceRoot, selection) {
    if (typeof personalAgentRuntime.getTaskAgentMetadata === "function") {
      const result = await runtimeCall(`Personal agent/model catalog (${selection.agentId})`, () => personalAgentRuntime.getTaskAgentMetadata({
        workspaceRoot,
        agent: { id: selection.agentId, provider: selection.provider },
        includeModels: true,
      }));
      const entry = result?.agent ?? result?.metadata ?? result;
      if (!entry || typeof entry !== "object") throw new Error(`Personal agent/model catalog returned no metadata for ${selection.agentId}`);
      return entry;
    }
    const entries = await listCatalog(workspaceRoot);
    return entries.find((candidate) => String(candidate?.id ?? "").trim() === selection.agentId) ?? null;
  }

  async function validateSelection(workspaceRoot, selection, kind, permissionMode = "restricted", options = {}) {
    const parsed = selection;
    const entry = await selectedCatalogEntry(workspaceRoot, parsed);
    if (!entry) throw new Error(`${kind} agent ${parsed.agentId} is unavailable in the Personal registry`);
    const liveAgentId = text(entry.id);
    if (liveAgentId && liveAgentId !== parsed.agentId) throw new Error(`${kind} agent ${parsed.agentId} does not match the live Personal registry entry`);
    const provider = text(entry.provider ?? entry.backend);
    if (provider && provider !== parsed.provider) throw new Error(`${kind} agent ${parsed.agentId} provider does not match the live Personal registry`);
    const capability = preflightProviderSelection({
      metadata: entry,
      selection: {
        ...parsed,
        // Checker sessions intentionally do not request Task MCP. `false`
        // would be interpreted by provider preflight as an explicit
        // unsupported capability, so use unknown while disabling the
        // requirement.
        taskMcp: options.checker ? "unknown" : true,
        requireTaskMcp: options.checker ? false : true,
        requireModelOverride: parsed.model !== null,
        fullAllow: options.checker ? "unknown" : permissionMode === "full-allow",
        requireFullAllow: options.checker ? false : permissionMode === "full-allow",
      },
    });
    if (!capability.ok) {
      const reason = capability.reasons.join(" ") || "Provider capability preflight failed.";
      throw new Error(`${kind} agent ${parsed.agentId} cannot run this task: ${reason} [${capability.reasonCodes.join(", ")}]`);
    }
    if (permissionMode === "full-allow" && !options.checker) {
      const taskCapability = await runtimeCall(`Personal task capability (${kind})`, () => personalAgentRuntime.getTaskCapability({
        agent: { id: parsed.agentId, provider: parsed.provider },
        model: parsed.model,
      }));
      if (taskCapability?.supportsTaskIntentHook !== true || taskCapability?.supportsScopedFullAllow !== true) {
        const diagnostic = text(taskCapability?.diagnostic) || "blocking pre-execute intent hook is not proven";
        throw new Error(`${kind} agent ${parsed.agentId} cannot run full-allow tasks: ${diagnostic} [task_full_allow_unsupported]`);
      }
    }
    let selectedModel = null;
    if (parsed.model !== null) {
      // Use the same live preflight resolution path used for user-facing errors.
      // The catalog can drift between catalog cache entries, while preflight is
      // the source-of-truth for current provider availability.
      const effectiveModel = text(capability.effective?.model ?? capability.effectiveModel);
      if (!effectiveModel) throw new Error(`${kind} model ${parsed.model} is unavailable for Personal agent ${parsed.agentId}`);
      const requestedModel = text(parsed.model).toLowerCase();
      const liveModel = catalogModels(entry).find((model) => (
        [model.id, model.label, ...model.aliases]
          .some((value) => [requestedModel, effectiveModel.toLowerCase()].includes(text(value).toLowerCase()))
      ));
      selectedModel = liveModel ?? {
        id: effectiveModel,
        label: parsed.modelLabel ?? effectiveModel,
        aliases: [parsed.model, effectiveModel],
      };
    }
    const liveCatalogRevision = text(entry.catalog?.revision ?? entry.catalogRevision ?? entry.updatedAt ?? entry.version ?? "") || null;
    return {
      ...parsed,
      label: text(entry.name ?? entry.label ?? parsed.label) || parsed.label,
      catalogRevision: liveCatalogRevision ?? parsed.catalogRevision,
      // Freeze the live catalog's canonical id, not a stale label/alias from
      // the picker.  The capability snapshot retains the requested alias for
      // diagnostics, while every subsequent provider launch uses this id.
      model: parsed.model === null ? null : selectedModel?.id ?? parsed.model,
      modelLabel: parsed.model === null ? null : selectedModel?.label ?? parsed.modelLabel ?? null,
      capabilitySnapshot: providerCapabilitySnapshot(capability),
    };
  }

  async function validateCheckerPolicy(workspaceRoot, policy, permissionMode = "restricted") {
    const normalized = normalizeIndependentCheckerPolicy(policy);
    if (normalized.mode === "primary-only") return normalized;
    const selection = {
      agentId: normalized.profile.agentId,
      provider: normalized.profile.provider,
      label: normalized.profile.label,
      model: normalized.profile.model,
      modelLabel: normalized.profile.modelLabel,
      catalogSource: "personal-registry",
      catalogRevision: normalized.profile.catalogRevision,
      capabilitySnapshot: normalized.profile.capabilitySnapshot ?? null,
      timeoutMs: normalized.profile.timeoutMs,
    };
    const validated = await validateSelection(workspaceRoot, selection, "Checker", permissionMode, { checker: true });
    return {
      mode: "independent",
      maxRounds: normalized.maxRounds,
      profile: taskOrchestratorCheckerProfileSchema.parse({
        id: normalized.profile.id,
        label: validated.label,
        runtime: "personal-local-agent",
        agentId: validated.agentId,
        provider: validated.provider,
        model: validated.model,
        modelLabel: validated.modelLabel,
        catalogSource: "personal-registry",
        catalogRevision: validated.catalogRevision,
        capabilitySnapshot: validated.capabilitySnapshot ?? null,
        instructions: normalized.profile.instructions ?? "Read-only acceptance verification.",
        approvalMode: "read-only-auto",
        sessionStrategy: "fresh",
        timeoutMs: validated.timeoutMs ?? normalized.profile.timeoutMs,
      }),
    };
  }

  function assertTaskProviderIsolation(profile, kind) {
    if (isTaskProviderNativeDelegationIsolated(profile?.provider)) return;
    const provider = text(profile?.provider) || "unknown";
    throw new Error(`${kind} agent ${profile?.agentId ?? "unknown"} cannot run this task: provider ${provider} has no hard native delegation isolation contract; use Codex, Claude, or OpenCode. [native_delegation_isolation_unsupported]`);
  }

  function assertFrozenTaskProviderIsolation(task) {
    assertTaskProviderIsolation(task.primary, "Primary");
    for (const worker of task.allowedWorkers) assertTaskProviderIsolation(worker, "Worker");
    if (task.independentChecker?.profile) assertTaskProviderIsolation(task.independentChecker.profile, "Checker");
  }

  function selectionFromProfile(profile) {
    return {
      agentId: profile.agentId,
      provider: profile.provider,
      label: profile.label,
      model: profile.model,
      modelLabel: profile.modelLabel,
      catalogSource: "personal-registry",
      catalogRevision: profile.catalogRevision,
      capabilitySnapshot: profile.capabilitySnapshot ?? null,
      timeoutMs: profile.timeoutMs,
    };
  }

  async function preflightFrozenProfile(run, profile, kind, options = {}) {
    assertTaskProviderIsolation(profile, kind);
    await validateSelection(
      run.definition.workspaceRoot,
      selectionFromProfile(profile),
      kind,
      run.definition.permissionMode,
      options,
    );
  }

  async function preflightFrozenAttempt({ run, attempt, profile, checker = false }) {
    const kind = checker ? "Checker" : attempt.kind === "primary" ? "Primary" : "Worker";
    await preflightFrozenProfile(run, profile, kind, { checker });
  }

  async function listTasks(input = {}) {
    await ready;
    return serialized(async () => {
      const parsed = taskOrchestratorTaskListInputSchema.parse(input);
      return store.listTasks(parsed);
    });
  }

  async function allTaskSummaries(input = {}) {
    const tasks = [];
    const issues = [];
    let cursor = null;
    do {
      const page = await store.listTasks({ ...input, cursor, limit: 200 });
      tasks.push(...page.tasks);
      issues.push(...page.issues);
      cursor = page.hasMore ? page.nextCursor ?? null : null;
    } while (cursor !== null);
    return { tasks, issues };
  }

  async function getTask(input) {
    await ready;
    const { taskId, taskRunId } = taskOrchestratorTaskGetInputSchema.parse(input);
    return serialized(() => store.snapshot(taskId, taskRunId));
  }

  async function listRuns(input) {
    await ready;
    const parsed = taskOrchestratorRunsListInputSchema.parse(input);
    return serialized(() => store.listRuns(parsed));
  }

  async function listTurnHistory(input) {
    await ready;
    const parsed = taskOrchestratorTurnHistoryListInputSchema.parse(input);
    return serialized(() => store.listTurnHistory(parsed));
  }

  async function listEvents(input) {
    await ready;
    const parsed = taskOrchestratorEventsListInputSchema.parse(input);
    return serialized(() => store.listEvents(parsed));
  }

  async function listArtifacts(input) {
    await ready;
    const parsed = taskOrchestratorArtifactsListInputSchema.parse(input);
    return serialized(() => store.listArtifacts(parsed));
  }

  async function getArtifact(input) {
    await ready;
    const parsed = taskOrchestratorArtifactGetInputSchema.parse(input);
    return serialized(() => store.getArtifact(parsed));
  }

  async function getArtifactContent(input) {
    await ready;
    const parsed = taskOrchestratorArtifactContentGetInputSchema.parse(input);
    return serialized(() => store.getArtifactContent(parsed));
  }

  async function archiveTask(input) {
    await ready;
    const parsed = taskOrchestratorTaskArchiveInputSchema.parse(input);
    return serialized(async () => {
      const task = await store.archiveTask(parsed);
      return store.snapshot(task.id, task.latestRunId);
    });
  }

  async function restoreTask(input) {
    await ready;
    const parsed = taskOrchestratorTaskRestoreInputSchema.parse(input);
    return serialized(async () => {
      const task = await store.restoreTask(parsed);
      return store.snapshot(task.id, task.latestRunId);
    });
  }

  async function purgeTask(input) {
    await ready;
    const parsed = taskOrchestratorTaskPurgeInputSchema.parse(input);
    return serialized(() => store.purgeTask(parsed));
  }

  async function exportTaskManifest(input) {
    await ready;
    const parsed = taskOrchestratorTaskExportManifestInputSchema.parse(input);
    return serialized(() => store.exportTaskManifest(parsed));
  }

  async function runMaintenance(input = {}) {
    await ready;
    const parsed = taskOrchestratorMaintenanceInputSchema.parse(input);
    return serialized(() => store.runMaintenance(parsed));
  }

  async function getHealth(input = {}) {
    await ready;
    taskOrchestratorStoreHealthInputSchema.parse(input);
    return serialized(() => store.health());
  }

  async function getSupervisorRuntimeHealth() {
    await ready;
    const health = typeof store.diagnosticsHealth === "function"
      ? await store.diagnosticsHealth({ maxAgeMs: 0 })
      : await store.health();
    return {
      observedAt: now(),
      store: health,
      scheduler: runner.schedulerSnapshot(),
      readyWake: runner.readyWakeSnapshot(),
      processObservations: runner.processObservationSnapshot(),
      taskControlFs: runner.taskControlFsSnapshot(),
    };
  }

  function recordPowerEvent(input = {}) {
    return runner.recordPowerEvent(input);
  }

  async function getOperationsDiagnostics(input) {
    await ready;
    const parsed = taskOrchestratorOperationsDiagnosticsGetInputSchema.parse(input);
    // Diagnostics are polled while a run is active. Keep this read path out of
    // the orchestrator mutation queue and use the bounded/cached store APIs;
    // `store.health()` performs PRAGMA quick_check and is reserved for the
    // explicit maintenance health endpoint.
    const located = await requireLocatedRun(parsed.taskRunId);
    if (located.taskId !== parsed.taskId) throw new Error(`Run not found: ${parsed.taskRunId}`);
    // Re-read by the caller's task/run pair so a stale task id can never
    // accidentally project diagnostics from another task's run.
    const run = await store.requireRun(parsed.taskId, parsed.taskRunId);
    const processAggregate = typeof store.diagnosticsAggregate === "function"
      ? await store.diagnosticsAggregate({ runId: parsed.taskRunId })
      : null;
    const health = typeof store.diagnosticsHealth === "function"
      ? await store.diagnosticsHealth()
      : null;
    return projectOperationsDiagnostics({
      run,
      processAggregate: processAggregate?.processes ?? null,
      health,
      now,
    });
  }

  async function applyProposal(taskId, inputContract, source = "primary") {
    const parsed = taskOrchestratorContractSchema.safeParse(inputContract);
    if (!parsed.success) return null;
    const contract = parsed.data;
    const result = await serialized(async () => {
      const task = clone(await store.requireTask(taskId));
      const revision = (task.alignment.proposals.at(-1)?.revision ?? 0) + 1;
      const proposal = { id: createId("proposal"), revision, contract, source, createdAt: now() };
      task.alignment.proposals.push(proposal);
      task.alignment.latestProposalId = proposal.id;
      task.alignment.latestProposalRevision = proposal.revision;
      task.definitionStatus = task.contractFinalization === "model-recommended-auto" ? "ready" : "awaiting-confirmation";
      if (task.contractFinalization === "model-recommended-auto") task.contract = clone(contract);
      task.revision += 1;
      task.updatedAt = now();
      await store.writeTask(task);
      const proposalEvent = { proposalId: proposal.id, proposalRevision: proposal.revision };
      await emitTask(taskId, "contract-proposed", `Contract proposal ${proposal.revision} received.`, proposalEvent);
      if (task.contract) await emitTask(taskId, "contract-frozen", "Model-recommended contract frozen automatically.", proposalEvent);
      const execution = task.contract
        ? await queueFrozenTask(task, await store.runsForTask(task.id))
        : null;
      return { task, proposal, execution };
    });
    if (result.execution) runner.launch(result.execution.run.taskId, result.execution.run.id, result.execution.primary.id);
    return result;
  }

  async function reconcileInterruptedAlignments() {
    const listed = await allTaskSummaries();
    for (const summary of listed.tasks) {
      const task = clone(await store.requireTask(summary.id));
      if (task.alignment.status !== "running") continue;
      if (task.alignment.personalRunId) {
        await runtimeCall("Personal cancelRun (task-alignment-supervisor-restart)", () => personalAgentRuntime.cancelRun(task.alignment.personalRunId, { reason: "task-alignment-supervisor-restart" })).catch(() => undefined);
      }
      task.alignment.status = "failed";
      task.alignment.finishedAt = now();
      task.alignment.error = "Task Supervisor restarted during alignment. Continue the conversation to start a fresh read-only alignment turn.";
      task.updatedAt = now();
      await store.writeTask(task);
      await emitTask(task.id, "alignment-failed", task.alignment.error);
    }
  }

  async function createTask(input) {
    await ready;
    if (closed) throw new Error("Task orchestrator is closed");
    const parsed = taskOrchestratorTaskCreateInputSchema.parse(input);
    assertFiniteFullAllowDeadline(parsed.permissionMode, parsed.endConditions);
    await requireWorkspaceRoot(parsed.workspaceRoot);
    const primarySelection = await validateSelection(parsed.workspaceRoot, parsed.primary, "Primary", parsed.permissionMode);
    const workerSelections = await Promise.all(parsed.allowedWorkers.map((selection) => validateSelection(parsed.workspaceRoot, selection, "Worker", parsed.permissionMode)));
    const independentChecker = await validateCheckerPolicy(parsed.workspaceRoot, parsed.independentChecker, parsed.permissionMode);
    const profiles = profilesFromInput(primarySelection, workerSelections);
    const timestamp = now();
    const task = {
      schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
      id: createId("task"),
      revision: 1,
      idea: parsed.idea,
      workspaceRoot: parsed.workspaceRoot,
      primary: profiles.primary,
      allowedWorkers: profiles.allowedWorkers,
      independentChecker,
      permissionMode: taskOrchestratorPermissionModeSchema.parse(parsed.permissionMode),
      contractFinalization: parsed.contractFinalization,
      endConditions: clone(parsed.endConditions),
      contract: null,
      definitionStatus: "alignment",
      template: TASK_ORCHESTRATOR_TEMPLATE,
      alignment: {
        conversationId: null,
        personalRunId: null,
        status: "running",
        startedAt: timestamp,
        finishedAt: null,
        error: null,
        messages: [],
        proposals: [],
        latestProposalId: null,
        latestProposalRevision: null,
      },
      latestRunId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await serialized(async () => {
      await store.writeTask(task);
      await emitTask(task.id, "alignment-started", "Interactive task-contract alignment started.");
    });
    const execution = alignmentRuntime.launch(
      task.id,
      `Start an interactive alignment for this idea. This phase is read-only: inspect context only, do not modify files or run mutating commands. Ask clarifying questions and use the structured propose_contract tool when a candidate is ready.\n\nIdea:\n${task.idea}`,
    );
    if (options.awaitAlignment === true) await execution;
    const current = await store.requireTask(task.id);
    return store.snapshot(task.id, current.latestRunId);
  }

  async function sendAlignmentMessage(input) {
    await ready;
    const parsed = taskOrchestratorAlignmentMessageInputSchema.parse(input);
    const task = await serialized(() => store.requireTask(parsed.taskId));
    if (!["alignment", "awaiting-confirmation"].includes(task.definitionStatus)) throw new Error("Task alignment is already frozen");
    if (alignmentRuntime.isActive(task.id) || task.alignment.status === "running") throw new Error("Task alignment already has an active provider turn");
    await serialized(async () => {
      const current = clone(await store.requireTask(parsed.taskId));
      current.alignment.messages.push({ id: createId("message"), role: "human", text: parsed.text, at: now() });
      current.alignment.status = "running";
      current.alignment.startedAt = now();
      current.alignment.finishedAt = null;
      current.alignment.error = null;
      current.updatedAt = now();
      await store.writeTask(current);
      await emitTask(parsed.taskId, "alignment-message", parsed.text);
      await emitTask(parsed.taskId, "alignment-started", "Alignment follow-up started.");
    });
    const current = await store.requireTask(parsed.taskId);
    const execution = alignmentRuntime.launch(
      current.id,
      `Read-only alignment follow-up. Do not modify files or run mutating commands.\n\n${parsed.text}`,
      current.alignment.conversationId,
    );
    if (options.awaitAlignment === true) await execution;
    const latest = await store.requireTask(parsed.taskId);
    return store.snapshot(parsed.taskId, latest.latestRunId);
  }

  async function cancelAlignment(input) {
    await ready;
    const { taskId } = taskOrchestratorTaskIdInputSchema.parse(input);
    return alignmentRuntime.cancel(taskId, "user");
  }

  async function finalizeContract(input) {
    await ready;
    const parsed = taskOrchestratorFinalizeContractInputSchema.parse(input);
    return serialized(async () => {
      const task = clone(await store.requireTask(parsed.taskId));
      if (task.revision !== parsed.expectedRevision) throw new Error(`Task revision conflict: expected ${parsed.expectedRevision}, found ${task.revision}`);
      if (task.contractFinalization !== "manual-confirm") throw new Error("Model-recommended-auto tasks finalize through the primary alignment response");
      const proposal = task.alignment.proposals.find((candidate) => candidate.id === parsed.proposalId);
      if (!proposal || proposal.revision !== parsed.proposalRevision) throw new Error("Contract proposal is stale or missing");
      task.contract = clone(parsed.contract ?? proposal.contract);
      task.definitionStatus = "ready";
      task.revision += 1;
      task.updatedAt = now();
      await store.writeTask(task);
      await emitTask(task.id, "contract-frozen", `Contract proposal ${proposal.revision} confirmed.`);
      return store.snapshot(task.id);
    });
  }

  async function updateTask(input) {
    await ready;
    const parsed = taskOrchestratorTaskUpdateInputSchema.parse(input);
    return serialized(async () => {
      const task = clone(await store.requireTask(parsed.taskId));
      if (task.revision !== parsed.expectedRevision) throw new Error(`Task revision conflict: expected ${parsed.expectedRevision}, found ${task.revision}`);
      if (task.definitionStatus === "archived") throw new Error("Archived tasks are immutable; restore the task before updating it");
      if (task.definitionStatus === "ready") throw new Error("Frozen task definitions are immutable; start a new alignment to change the contract");
      if (parsed.idea !== undefined) task.idea = parsed.idea;
      if (parsed.permissionMode !== undefined) task.permissionMode = parsed.permissionMode;
      if (parsed.contractFinalization !== undefined) task.contractFinalization = parsed.contractFinalization;
      if (parsed.endConditions !== undefined) task.endConditions = clone(parsed.endConditions);
      assertFiniteFullAllowDeadline(task.permissionMode, task.endConditions);
      const desiredPermissionMode = parsed.permissionMode ?? task.permissionMode;
      if (parsed.independentChecker !== undefined) task.independentChecker = await validateCheckerPolicy(task.workspaceRoot, parsed.independentChecker, desiredPermissionMode);
      if (parsed.primary !== undefined) task.primary = profileFromSelection("primary", await validateSelection(task.workspaceRoot, parsed.primary, "Primary", desiredPermissionMode));
      else if (parsed.permissionMode !== undefined) task.primary = profileFromSelection("primary", await validateSelection(task.workspaceRoot, selectionFromProfile(task.primary), "Primary", desiredPermissionMode));
      if (parsed.allowedWorkers !== undefined) {
        const validated = await Promise.all(parsed.allowedWorkers.map((selection) => validateSelection(task.workspaceRoot, selection, "Worker", desiredPermissionMode)));
        task.allowedWorkers = validated.map((selection, index) => profileFromSelection("worker", selection, index));
      } else if (parsed.permissionMode !== undefined) {
        const validated = await Promise.all(task.allowedWorkers.map((profile) => validateSelection(task.workspaceRoot, selectionFromProfile(profile), "Worker", desiredPermissionMode)));
        task.allowedWorkers = validated.map((selection, index) => profileFromSelection("worker", selection, index));
      }
      if (parsed.permissionMode !== undefined && parsed.independentChecker?.mode !== "primary-only") {
        task.independentChecker = await validateCheckerPolicy(task.workspaceRoot, task.independentChecker, desiredPermissionMode);
      }
      task.revision += 1;
      task.updatedAt = now();
      await store.writeTask(task);
      return store.snapshot(task.id);
    });
  }

  async function queueFrozenTask(task, runs) {
    if (task.definitionStatus !== "ready" || !task.contract) throw new Error("Only a frozen task contract can start execution");
    // Re-check immutable profile providers immediately before allocating a
    // durable run. This protects imported/legacy frozen tasks and keeps
    // provider-native delegation outside the Task Center audit surface.
    assertFrozenTaskProviderIsolation(task);
    const preflightDefinition = { workspaceRoot: task.workspaceRoot, permissionMode: task.permissionMode };
    await preflightFrozenProfile({ definition: preflightDefinition }, task.primary, "Primary");
    for (const worker of task.allowedWorkers) {
      await preflightFrozenProfile({ definition: preflightDefinition }, worker, "Worker");
    }
    if (task.independentChecker?.profile) {
      await preflightFrozenProfile({ definition: preflightDefinition }, task.independentChecker.profile, "Checker", { checker: true });
    }
    const active = runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
    if (active) throw new Error(`Task already has a durable active run: ${active.id}`);
    const timestamp = now();
    const definition = definitionFromTask(task);
    const runId = createId("run");
    const run = {
      schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
      id: runId,
      taskId: task.id,
      taskRevision: task.revision,
      definition,
      status: "queued",
      primaryAttemptId: "pending",
      currentAttemptId: null,
      primaryAttempts: [],
      workerAttempts: [],
      checkerAttempts: [],
      checkerVerdicts: [],
      primaryDecisions: [],
      latestDecisionId: null,
      sideEffects: [],
      turns: [],
      currentTurnId: null,
      checkpoints: [],
      continuationCapsules: [],
      pause: null,
      budget: null,
      permissionGrant: await permissionGrantForRun(task, runId, definition, timestamp, createId),
      createdAt: timestamp,
      startedAt: null,
      updatedAt: timestamp,
      finishedAt: null,
      error: null,
    };
    const turnId = createId("turn");
    run.currentTurnId = turnId;
    const primary = createAttempt(createId, now, run, "primary", task.primary, "Execute the frozen task contract.", null, "ready", turnId);
    run.primaryAttemptId = primary.id;
    run.primaryAttempts.push(primary);
    run.turns.push(createTurn({ id: turnId, sequence: 1, primaryAttemptId: primary.id, reason: "initial", now }));
    run.currentAttemptId = primary.id;
    refreshRunBudget(run, now);
    await store.writeRun(run);
    await emit(run, "run-created", "Task execution queued.", primary.id);
    task.latestRunId = run.id;
    task.updatedAt = timestamp;
    await store.writeTask(task);
    return { snapshot: await store.snapshot(task.id, run.id), run, primary };
  }

  function appendPrimaryTurn(run, prompt, reason) {
    const exhausted = endConditionViolation(run, now, { nextTurn: true });
    if (exhausted) throw new Error(`Cannot continue task: ${exhausted}`);
    const priorTurn = run.currentTurnId ? run.turns.find((turn) => turn.id === run.currentTurnId) : null;
    if (priorTurn && !["succeeded", "failed", "blocked", "cancelled", "paused"].includes(priorTurn.status)) {
      const priorAttempt = findAttempt(run, priorTurn.primaryAttemptId);
      priorTurn.status = priorAttempt?.status === "cancelled" ? "cancelled"
        : priorAttempt?.status === "failed" ? "failed"
          : priorAttempt?.status === "succeeded" ? "succeeded"
            : "blocked";
      priorTurn.updatedAt = now();
      priorTurn.finishedAt = now();
    }
    const turnId = createId("turn");
    const primary = createAttempt(createId, now, run, "primary", run.definition.primary, prompt, null, "ready", turnId);
    const sequence = (run.turns.at(-1)?.sequence ?? 0) + 1;
    run.turns.push(createTurn({ id: turnId, sequence, primaryAttemptId: primary.id, reason, now }));
    run.currentTurnId = turnId;
    run.primaryAttempts.push(primary);
    run.primaryAttemptId = primary.id;
    run.currentAttemptId = primary.id;
    run.status = "queued";
    run.pause = null;
    run.error = null;
    run.updatedAt = now();
    run.finishedAt = null;
    refreshRunBudget(run, now);
    return primary;
  }

  function appendRecoveryTurn(run, interrupted, artifacts) {
    const priorTurn = turnForAttempt(run, interrupted);
    let capsule = null;
    if (priorTurn) {
      const existingCheckpoint = priorTurn.checkpointId
        ? run.checkpoints.find((candidate) => candidate.id === priorTurn.checkpointId)
        : null;
      capsule = existingCheckpoint
        ? run.continuationCapsules.find((candidate) => candidate.id === existingCheckpoint.capsuleId) ?? null
        : null;
      if (!capsule) {
        const records = buildPauseContinuationRecords({
          run,
          turn: priorTurn,
          artifacts,
          createId,
          now,
          trigger: "supervisor-restart",
          reason: "Task Supervisor restarted after an unexpected interruption",
        });
        capsule = records.capsule;
        run.continuationCapsules.push(records.capsule);
        run.checkpoints.push(records.checkpoint);
        priorTurn.checkpointId = records.checkpoint.id;
        priorTurn.capsuleId = records.capsule.id;
        priorTurn.status = "blocked";
        priorTurn.updatedAt = now();
        priorTurn.finishedAt ??= now();
      }
      if (capsule) assertContinuationCapsuleIdentity(run, capsule);
    }
    const manifest = buildRecoveryManifest({ run, currentAttempt: interrupted, artifacts });
    const prompt = capsule ? `${manifest}\n\n${continuationPrompt(capsule)}` : manifest;
    return appendPrimaryTurn(run, prompt, "supervisor-recovery");
  }

  async function recoverSafeInterruptedRuns() {
    if (closed) return;
    const queued = [];
    for (const persisted of await store.allRuns()) {
      if (
        persisted.status !== "blocked"
        || !/Desktop restarted during an active primary\/worker attempt/i.test(persisted.error ?? "")
        || unsafeUnknownSideEffects(persisted).length
      ) continue;
      try {
        const recovered = await serialized(async () => {
          const run = clone(await store.requireRun(persisted.taskId, persisted.id));
          if (run.status !== "blocked" || unsafeUnknownSideEffects(run).length) return null;
          const interrupted = currentAttempt(run);
          if (!interrupted || interrupted.status !== "blocked" || interrupted.leaseId) return null;
          if (endConditionViolation(run, now, { nextTurn: true })) return null;
          const artifacts = await store.readArtifacts(run.taskId, run.id);
          const primary = appendRecoveryTurn(run, interrupted, artifacts);
          await store.writeRun(run);
          await emit(run, "primary-recovery-queued", "Supervisor restart was recovered automatically in a fresh bounded primary turn; prior attempts remain immutable.", primary.id);
          return { taskId: run.taskId, runId: run.id, primary };
        });
        if (recovered) queued.push(recovered);
      } catch (error) {
        console.error(`[task-orchestrator] automatic recovery remained blocked for ${persisted.id}:`, messageOf(error));
      }
    }
    for (const recovered of queued) runner.launch(recovered.taskId, recovered.runId, recovered.primary.id);
  }

  /**
   * Recover the one crash window where auto alignment froze a task but the
   * durable run write failed before any Personal provider could start. The
   * startup reconciler has already blocked active persisted runs, so only a
   * ready auto task with zero runs is eligible. Existing runs are pointer-only
   * recovery and are never duplicated or replayed.
   */
  async function recoverAutoFinalizationRuns() {
    const listed = await allTaskSummaries();
    if (closed) return;
    for (const summary of listed.tasks) {
      if (summary.contractFinalization !== "model-recommended-auto" || summary.definitionStatus !== "ready") continue;
      const recovered = await serialized(async () => {
        const task = clone(await store.requireTask(summary.id));
        if (task.contractFinalization !== "model-recommended-auto" || task.definitionStatus !== "ready" || !task.contract) return null;
        const runs = await store.runsForTask(task.id);
        if (runs.length > 0) return null;
        return queueFrozenTask(task, runs);
      });
      if (recovered && !closed) runner.launch(recovered.run.taskId, recovered.run.id, recovered.primary.id);
    }
  }

  async function startTask(input) {
    await ready;
    if (closed) throw new Error("Task orchestrator is closed");
    const { taskId } = taskOrchestratorTaskIdInputSchema.parse(input);
    const result = await serialized(async () => {
      const reconciled = await store.reconcileLatestRunPointer(taskId);
      const task = clone(reconciled.task);
      return queueFrozenTask(task, reconciled.runs);
    });
    runner.launch(result.run.taskId, result.run.id, result.primary.id);
    return result.snapshot;
  }

  async function stopRun(input) {
    await ready;
    const { taskRunId } = taskOrchestratorRunIdInputSchema.parse(input);
    const personalRunIds = [];
    const result = await serialized(async () => {
      const located = await requireLocatedRun(taskRunId);
      const run = clone(located.run);
      if (!ACTIVE_RUN_STATUSES.has(run.status)) return store.snapshot(located.taskId, run.id);
      for (const attempt of allAttempts(run)) {
        if (attempt.personalRunId && ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) personalRunIds.push(attempt.personalRunId);
        if (ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) {
          attempt.status = "cancelled";
          attempt.leaseId = null;
          attempt.error = "Cancelled by user.";
          attempt.updatedAt = now();
          attempt.finishedAt = now();
        }
      }
      Object.assign(run, { status: "cancelled", error: "Cancelled by user.", updatedAt: now(), finishedAt: now() });
      await store.writeRun(run);
      for (const gate of await store.readGates(located.taskId, run.id)) {
        const terminal = terminalGateForInterruptedRun(gate, now());
        if (terminal !== gate) await store.writeGate(terminal);
      }
      await emit(run, "run-cancelled", "Task execution cancelled by user.", currentAttempt(run)?.id ?? null);
      return store.snapshot(located.taskId, run.id);
    });
    runner.cancelAdmissions(taskRunId, "Task run was cancelled before provider admission");
    await Promise.allSettled(personalRunIds.map((runId) => runtimeCall("Personal cancelRun (task-orchestrator-user)", () => personalAgentRuntime.cancelRun(runId, { reason: "task-orchestrator-user" }))));
    // Cancellation revokes every attempt lease above. The provider may keep a
    // Personal execution promise alive after acknowledging cancellation, so
    // do not make the renderer wait for that provider lifecycle. The durable
    // cancelled snapshot is authoritative immediately; close() remains the
    // strict drain boundary for all attempt executions.
    void runner.awaitActive(taskRunId).catch(() => undefined);
    return result;
  }

  function normalizedPause(reason) {
    const raw = text(reason).toLowerCase();
    if (raw.includes("quit") || raw.includes("relaunch")) return { reason: "app-quit", trigger: "app-quit", message: "Application quit requested" };
    if (raw.includes("supervisor") || raw.includes("sig") || raw.includes("disconnect")) {
      return { reason: "supervisor-restart", trigger: "supervisor-restart", message: "Task Supervisor shutdown requested" };
    }
    return { reason: "user", trigger: "user-pause", message: "User paused the task" };
  }

  async function pauseRuns({ taskRunId = null, reason = "user", strictDrain = false } = {}) {
    const pauseKind = normalizedPause(reason);
    const staged = await serialized(async () => {
      const locatedRuns = taskRunId
        ? [await requireLocatedRun(taskRunId)]
        : (await store.allRuns()).map((run) => ({ taskId: run.taskId, run }));
      const pending = [];
      for (const located of locatedRuns) {
        if (!ACTIVE_RUN_STATUSES.has(located.run.status)) continue;
        const run = clone(located.run);
        const timestamp = now();
        const activeAttempts = allAttempts(run).filter((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status));
        const personalRunIds = activeAttempts.map((attempt) => attempt.personalRunId).filter(Boolean);
        for (const attempt of activeAttempts) {
          // Revoke first. Late provider callbacks are fenced while cancellation
          // and durable checkpointing complete.
          attempt.leaseId = null;
          attempt.updatedAt = timestamp;
        }
        let checkpointId = run.pause?.checkpointId ?? null;
        const current = currentAttempt(run) ?? run.primaryAttempts.at(-1) ?? null;
        const turn = current ? turnForAttempt(run, current) : null;
        if (!checkpointId && turn) {
          const artifacts = await store.readArtifacts(located.taskId, run.id);
          const { capsule, checkpoint } = buildPauseContinuationRecords({
            run,
            turn,
            artifacts,
            createId,
            now,
            trigger: pauseKind.trigger,
            reason: pauseKind.message,
          });
          run.continuationCapsules.push(capsule);
          run.checkpoints.push(checkpoint);
          checkpointId = checkpoint.id;
          turn.status = "checkpointing";
          turn.checkpointId = checkpoint.id;
          turn.capsuleId = capsule.id;
          turn.updatedAt = timestamp;
        }
        run.status = "pausing";
        run.pause = {
          reason: pauseKind.reason,
          requestedAt: run.pause?.requestedAt ?? timestamp,
          pausedAt: null,
          checkpointId,
          resumeEligible: true,
        };
        run.error = null;
        run.updatedAt = timestamp;
        run.finishedAt = null;
        await store.writeRun(run);
        await emit(run, "run-pausing", `${pauseKind.message}; checkpointing and cancelling active provider sessions.`, current?.id ?? null);
        pending.push({ taskId: located.taskId, runId: run.id, personalRunIds });
      }
      return pending;
    });

    for (const item of staged) {
      runner.cancelAdmissions(item.runId, "Task run was paused before provider admission");
      const results = await Promise.allSettled(item.personalRunIds.map((runId) => runtimeCall(`Personal cancelRun (task-${pauseKind.trigger})`, () => personalAgentRuntime.cancelRun(runId, { reason: `task-${pauseKind.trigger}` }))));
      const failed = results.find((result) => result.status === "rejected" || result.value?.ok === false);
      if (failed) {
        const detail = failed.status === "rejected" ? messageOf(failed.reason) : messageOf(failed.value?.error ?? "provider cancellation was rejected");
        const code = failed.status === "rejected" ? errorCode(failed.reason) : null;
        const error = Object.assign(new Error(`Task pause could not safely cancel every provider session: ${detail}`), code ? { code } : {});
        throw error;
      }
      if (strictDrain) await runner.awaitActive(item.runId);
    }

    const snapshots = await serialized(async () => {
      const results = [];
      for (const item of staged) {
        const run = clone(await store.requireRun(item.taskId, item.runId));
        if (run.status !== "pausing") continue;
        const timestamp = now();
        for (const attempt of allAttempts(run)) {
          if (!ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) continue;
          attempt.status = "cancelled";
          attempt.leaseId = null;
          attempt.error = `Paused safely: ${pauseKind.message}.`;
          attempt.updatedAt = timestamp;
          attempt.finishedAt = timestamp;
        }
        const turn = run.currentTurnId ? run.turns.find((candidate) => candidate.id === run.currentTurnId) : null;
        if (turn && !["succeeded", "failed", "blocked", "cancelled"].includes(turn.status)) {
          turn.status = "paused";
          turn.updatedAt = timestamp;
          turn.finishedAt = timestamp;
        }
        run.status = "paused";
        run.pause = { ...run.pause, pausedAt: timestamp, resumeEligible: true };
        run.updatedAt = timestamp;
        run.finishedAt = null;
        refreshRunBudget(run, now);
        await store.writeRun(run);
        await emit(run, "run-paused", `${pauseKind.message}; a fresh provider session can resume from the durable checkpoint.`, currentAttempt(run)?.id ?? null);
        results.push(await store.snapshot(item.taskId, item.runId));
      }
      return results;
    });
    return taskRunId ? (snapshots[0] ?? (await store.snapshot((await requireLocatedRun(taskRunId)).taskId, taskRunId))) : snapshots;
  }

  async function pauseTask(input) {
    await ready;
    const { taskRunId } = taskOrchestratorRunIdInputSchema.parse(input);
    return pauseRuns({ taskRunId, reason: "user", strictDrain: false });
  }

  async function resumeTask(input) {
    await ready;
    if (closed) throw new Error("Task orchestrator is closed");
    const { taskRunId } = taskOrchestratorRunIdInputSchema.parse(input);
    const result = await serialized(async () => {
      const located = await requireLocatedRun(taskRunId);
      const run = clone(located.run);
      if (run.status !== "paused" || !run.pause?.resumeEligible) throw new Error("Only a safely paused task can resume");
      if (allAttempts(run).some((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId)) {
        throw new Error("Paused task still has an active attempt lease");
      }
      const exhausted = endConditionViolation(run, now, { nextTurn: true });
      if (exhausted) throw new Error(`Cannot resume task: ${exhausted}`);
      const checkpoint = run.pause.checkpointId ? run.checkpoints.find((candidate) => candidate.id === run.pause.checkpointId) : null;
      const capsule = checkpoint ? run.continuationCapsules.find((candidate) => candidate.id === checkpoint.capsuleId) : null;
      if (!capsule) throw new Error("Paused task is missing its durable continuation capsule");
      assertContinuationCapsuleIdentity(run, capsule);
      const task = await store.requireTask(located.taskId);
      run.permissionGrant = await permissionGrantForRun(task, run.id, run.definition, now(), createId, run.createdAt, run.permissionGrant);
      const reason = run.pause.reason === "app-quit" ? "app-quit-resume" : "user-resume";
      const primary = appendPrimaryTurn(run, continuationPrompt(capsule), reason);
      await store.writeRun(run);
      await emit(run, "run-resumed", "Task resumed in a fresh provider session from the durable checkpoint.", primary.id);
      return { snapshot: await store.snapshot(located.taskId, run.id), taskId: located.taskId, runId: run.id, primary };
    });
    runner.launch(result.taskId, result.runId, result.primary.id);
    return result.snapshot;
  }

  async function retryPrimary(input) {
    await ready;
    const parsed = taskOrchestratorRetryInputSchema.parse(input);
    const result = await serialized(async () => {
      const located = await requireLocatedRun(parsed.taskRunId);
      const run = clone(located.run);
      if (!["failed", "blocked", "cancelled"].includes(run.status)) throw new Error("Only failed, blocked, or cancelled task runs can be retried");
      const latest = run.primaryAttempts.at(-1);
      const completionReviewRejected = run.status === "blocked"
        && latest?.status === "succeeded"
        && /Completion review rejected/i.test(run.error ?? "");
      if (!latest || (parsed.attemptId && parsed.attemptId !== latest.id) || (!completionReviewRejected && !["failed", "blocked", "cancelled"].includes(latest.status))) {
        throw new Error("Retry target is stale or not a failed/rejected primary attempt");
      }
      const unsafeEffects = unsafeUnknownSideEffects(run);
      if (unsafeEffects.length) {
        throw new Error(`Retry blocked: ${unsafeEffects.length} non-idempotent provider side effect(s) have an unknown outcome and require reconciliation`);
      }
      const personalRunIds = [];
      const fencedAttempts = [];
      for (const attempt of allAttempts(run)) {
        if (!ACTIVE_ATTEMPT_STATUSES.has(attempt.status) && !attempt.leaseId) continue;
        if (attempt.personalRunId) personalRunIds.push(attempt.personalRunId);
        attempt.status = "cancelled";
        attempt.leaseId = null;
        attempt.error = "Superseded by a fresh primary retry.";
        attempt.updatedAt = now();
        attempt.finishedAt = now();
        fencedAttempts.push(attempt);
      }
      const artifacts = await store.readArtifacts(located.taskId, run.id);
      const priorCapsule = run.continuationCapsules.at(-1) ?? null;
      const retryPrompt = priorCapsule
        ? `Retry the frozen task contract after this failure: ${text(latest.error ?? run.error ?? "unknown failure")}\n\n${continuationPrompt(hydrateContinuationCapsuleEvidence(priorCapsule, artifacts))}`
        : "Retry the frozen task contract and address the prior failure.";
      const retry = appendPrimaryTurn(run, retryPrompt, "retry");
      await store.writeRun(run);
      for (const attempt of fencedAttempts) {
        await emit(run, attempt.kind === "worker" ? "worker-closed" : attempt.kind === "checker" || attempt.kind === undefined ? "checker-failed" : "primary-failed", attempt.error, attempt.id);
      }
      await emit(run, "primary-progress", `Primary retry ${run.primaryAttempts.length} queued.`, retry.id);
      return { snapshot: await store.snapshot(located.taskId, run.id), taskId: located.taskId, runId: run.id, retry, personalRunIds };
    });
    const cancellationResults = await Promise.allSettled(result.personalRunIds.map((runId) => runtimeCall("Personal cancelRun (task-primary-retry)", () => personalAgentRuntime.cancelRun(runId, { reason: "task-primary-retry" }))));
    const failedCancellation = cancellationResults.find((candidate) => candidate.status === "rejected" || candidate.value?.ok === false);
    if (failedCancellation) {
      const detail = failedCancellation.status === "rejected"
        ? messageOf(failedCancellation.reason)
        : messageOf(failedCancellation.value?.error ?? "provider cancellation was rejected");
      const blockedMessage = `Retry blocked: provider cancellation was not confirmed before the fresh attempt could start: ${detail}`;
      await serialized(async () => {
        const run = clone(await store.requireRun(result.taskId, result.runId));
        const retry = findAttempt(run, result.retry.id);
        if (retry && retry.status === "ready" && !retry.leaseId) {
          retry.status = "blocked";
          retry.error = blockedMessage;
          retry.updatedAt = now();
          retry.finishedAt = now();
        }
        run.status = "blocked";
        run.error = blockedMessage;
        run.updatedAt = now();
        run.finishedAt = now();
        await store.writeRun(run);
        await emit(run, "primary-retry-blocked", blockedMessage, retry?.id ?? null);
      });
      const code = failedCancellation.status === "rejected" ? errorCode(failedCancellation.reason) : null;
      const error = Object.assign(new Error(blockedMessage), code ? { code } : {});
      throw error;
    }
    runner.launch(result.taskId, result.runId, result.retry.id);
    return result.snapshot;
  }

  /**
   * Continue a run that the desktop reconciler blocked after shutdown/restart.
   * This never resumes a provider process: it appends a fresh primary attempt
   * to the same immutable run definition and gives it a bounded recovery
   * manifest. Duplicate clicks while that fresh attempt is queued/running (or
   * after it reaches a terminal state) return the existing snapshot.
   */
  async function continueRecovery(input) {
    await ready;
    const parsed = taskOrchestratorRecoveryInputSchema.parse(input);
    const result = await serialized(async () => {
      const located = await requireLocatedRun(parsed.taskRunId);
      const run = clone(located.run);
      const latestPrimary = run.primaryAttempts.at(-1) ?? null;
      // The marker makes a repeated IPC request idempotent once the new
      // continuation has been accepted. A blocked continuation is eligible
      // for another fresh attempt because that means a second restart happened.
      if (latestPrimary && isRecoveryAttempt(latestPrimary) && run.status !== "blocked") {
        return { snapshot: await store.snapshot(located.taskId, run.id), primary: null };
      }
      if (run.status !== "blocked") throw new Error("Only a desktop-interrupted blocked run can be continued");
      if (!/Desktop (?:shut down|restarted) during an active primary\/worker attempt/i.test(run.error ?? "")) {
        throw new Error("Recovery requires a desktop shutdown/restart interruption");
      }
      const interrupted = currentAttempt(run);
      if (!interrupted || interrupted.status !== "blocked") throw new Error("Recovery requires the current attempt to be blocked");
      if (parsed.attemptId && parsed.attemptId !== interrupted.id) throw new Error("Recovery target is stale or not the current blocked attempt");
      if (interrupted.leaseId || allAttempts(run).some((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId)) {
        throw new Error("Recovery requires no active attempt lease");
      }
      const unsafeEffects = unsafeUnknownSideEffects(run);
      if (unsafeEffects.length) {
        throw new Error(`Recovery blocked: ${unsafeEffects.length} non-idempotent provider side effect(s) have an unknown outcome and require reconciliation`);
      }
      const artifacts = await store.readArtifacts(located.taskId, run.id);
      const interruptedTurn = turnForAttempt(run, interrupted);
      const checkpoint = interruptedTurn?.checkpointId
        ? run.checkpoints.find((candidate) => candidate.id === interruptedTurn.checkpointId)
        : (interruptedTurn?.capsuleId ? run.checkpoints.find((candidate) => candidate.capsuleId === interruptedTurn.capsuleId) : null);
      const capsule = checkpoint ? run.continuationCapsules.find((candidate) => candidate.id === checkpoint.capsuleId) : null;
      if (capsule) assertContinuationCapsuleIdentity(run, capsule);
      const continuation = appendRecoveryTurn(run, interrupted, artifacts);
      await store.writeRun(run);
      await emit(run, "primary-recovery-queued", "A fresh primary continuation was queued after the desktop interruption; prior attempts remain immutable.", continuation.id);
      return { snapshot: await store.snapshot(located.taskId, run.id), taskId: located.taskId, runId: run.id, primary: continuation };
    });
    if (result.primary) runner.launch(result.taskId, result.runId, result.primary.id);
    return result.snapshot;
  }

  async function retryLegacyNode() {
    throw new Error("Task Center v1 node retry is read-only/rejected; use taskOrchestratorPrimaryRetry for a v2 primary attempt");
  }

  // Approval resolution is caller-owned just like startMessage/worker turns:
  // a timeout must cancel the Personal operation before its Task lease can be
  // fenced, and a late provider response must never revive a terminal gate.
  const approvalRuntimeOperations = createTaskRuntimeOperationController({
    personalAgentRuntime,
    createId,
    timeoutMs: runtimeCallTimeoutMs,
  });

  async function resolveGateOperation(input) {
    await ready;
    if (closed) throw new Error("Task orchestrator is closing and cannot resolve a new approval");
    const parsed = taskOrchestratorResolveGateInputSchema.parse(input);
    // Sweep outside the validation mutation so an expired/stale gate is
    // durably terminal before we re-read it for this decision request.
    await reconcileApprovalGateExpirations();
    const preValidationCancellationRequests = [];
    const context = await serialized(async () => {
      const located = await requireLocatedRun(parsed.taskRunId);
      const run = clone(located.run);
      const preValidationReconciliation = await reconcileApprovalGateStates({ store, run, now, emit, notify: notifyEvent, createId });
      preValidationCancellationRequests.push(...(preValidationReconciliation.cancelRequests ?? []));
      const gate = (await store.readGates(located.taskId, run.id)).find((candidate) => candidate.id === parsed.gateId);
      if (!gate) throw new Error(`Gate not found: ${parsed.gateId}`);
      if (gate.status !== "pending") return {
        taskId: located.taskId,
        run,
        gate,
        attempt: findAttempt(run, gate.attemptId),
        fenced: true,
        error: "Approval gate expired or became stale before validation",
      };
      const decisionNow = now();
      const fenceValidationFailure = async (error) => {
        const reconciliation = await reconcileApprovalGateStates({ store, run, now, emit, notify: notifyEvent, createId });
        preValidationCancellationRequests.push(...(reconciliation.cancelRequests ?? []));
        const terminalGate = (await store.readGates(located.taskId, run.id)).find((candidate) => candidate.id === parsed.gateId) ?? gate;
        return {
          taskId: located.taskId,
          run,
          gate: terminalGate,
          attempt: findAttempt(run, terminalGate.attemptId),
          fenced: true,
          error,
        };
      };
      if (gate.expiresAt !== null && gate.expiresAt <= decisionNow) {
        return fenceValidationFailure("Approval gate expired before validation");
      }
      if (gate.taskRevision !== run.taskRevision) return fenceValidationFailure("Approval gate belongs to a stale task revision");
      const attempt = findAttempt(run, gate.attemptId);
      if (!attempt) return fenceValidationFailure("Gate attempt no longer exists");
      if (gate.kind === "manual-review") {
        if (run.status !== "waiting-approval" || attempt.status !== "succeeded") {
          throw new Error("Completion review gate is no longer attached to the current waiting run");
        }
      } else {
        if (!ACTIVE_RUN_STATUSES.has(run.status) || run.currentAttemptId !== attempt.id || !ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) {
          return fenceValidationFailure("Approval gate is no longer attached to the current active attempt");
        }
        if (!attempt.personalRunId || !gate.personalApprovalId || !gate.personalRunId || gate.personalRunId !== attempt.personalRunId) {
          return fenceValidationFailure("Gate is not connected to the current Personal runtime approval");
        }
        if (!attempt.leaseId || !gate.leaseId || gate.leaseId !== attempt.leaseId) {
          return fenceValidationFailure("Approval gate lease is stale; the old provider run cannot be resumed");
        }
      }
      const resolving = { ...gate, status: "resolving", decision: parsed.decision, decisionRequestedAt: decisionNow, resolvedAt: null };
      await store.writeGate(resolving);
      return { taskId: located.taskId, run, gate: resolving, attempt, decisionNow };
    });
    const preValidationFailures = await cancelRetainedApprovalRuns(preValidationCancellationRequests);
    if ("fenced" in context && context.fenced) {
      const suffix = preValidationFailures.length ? `; provider cancellation was not confirmed: ${preValidationFailures.map((failure) => failure.error).join("; ")}` : "";
      throw new Error(`${context.error}${suffix}`);
    }
    if (context.gate.kind === "manual-review") {
      // A manual decision captures one validation timestamp, then performs a
      // second expiry sweep immediately before durable reconciliation. This
      // closes the boundary where the user clicked before TTL but the sweep
      // crossed it while the decision intent was being persisted.
      await reconcileApprovalGateExpirations();
      const latestManualGate = (await store.readGates(context.taskId, context.run.id)).find((candidate) => candidate.id === parsed.gateId);
      if (!latestManualGate || latestManualGate.status !== "resolving") {
        throw new Error("Completion review gate expired while the decision was in flight");
      }
      if (latestManualGate.expiresAt !== null && latestManualGate.expiresAt <= now()) {
        // The second check can itself cross the frozen TTL.  Reconcile inside
        // the durable decision boundary so the gate/run are terminalized
        // before rejecting; throwing here would leave a resolving intent that
        // could be replayed by a later startup reconciler.
        const reconciliation = await reconcileApprovalDecisionIntents();
        const cancellationFailures = await cancelRetainedApprovalRuns(reconciliation?.cancelRequests ?? []);
        const suffix = cancellationFailures.length
          ? `; provider cancellation was not confirmed: ${cancellationFailures.map((failure) => failure.error).join("; ")}`
          : "";
        throw new Error(`Completion review gate expired while the decision was in flight${suffix}`);
      }
      const reconciliation = await reconcileApprovalDecisionIntents();
      const snapshot = await store.snapshot(context.taskId, context.run.id);
      const reconciledGate = snapshot.gates.find((candidate) => candidate.id === parsed.gateId);
      if (!reconciledGate || reconciledGate.status !== "approved" && reconciledGate.status !== "rejected") {
        const cancellationFailures = await cancelRetainedApprovalRuns(reconciliation?.cancelRequests ?? []);
        const suffix = cancellationFailures.length
          ? `; provider cancellation was not confirmed: ${cancellationFailures.map((failure) => failure.error).join("; ")}`
          : "";
        throw new Error(`Completion review gate expired or became stale while the decision was in flight${suffix}`);
      }
      return snapshot;
    }
    const fenceResolvingGate = async (reason) => {
      const cancellationRequests = await serialized(async () => {
        const run = await store.requireRun(context.taskId, context.run.id);
        const gate = (await store.readGates(context.taskId, run.id)).find((candidate) => candidate.id === parsed.gateId);
        if (!gate || !["pending", "resolving"].includes(gate.status)) return [];
        // Mark the unresolved decision as expired, then let the atomic fence
        // transition terminalize every sibling attempt/gate and clear leases.
        const at = now();
        await store.writeGate({ ...gate, expiresAt: at });
        const reconciliation = await reconcileApprovalGateStates({
          store,
          run,
          now,
          emit,
          notify: notifyEvent,
          createId,
        });
        return reconciliation.cancelRequests ?? [];
      });
      return cancellationRequests;
    };
    if (context.gate.expiresAt !== null && context.gate.expiresAt <= now()) {
      const cancellationRequests = await fenceResolvingGate("Approval gate expired before provider resolution");
      const cancellationFailures = await cancelRetainedApprovalRuns(cancellationRequests);
      const suffix = cancellationFailures.length ? `; provider cancellation was not confirmed: ${cancellationFailures.map((failure) => failure.error).join("; ")}` : "";
      throw new Error(`Approval gate expired before provider resolution${suffix}`);
    }
    let resolved;
    try {
      const remainingMs = context.gate.expiresAt === null
        ? runtimeCallTimeoutMs
        : Math.max(1, Math.min(runtimeCallTimeoutMs, context.gate.expiresAt - now()));
      const operationController = createTaskRuntimeOperationController({
        personalAgentRuntime,
        createId,
        timeoutMs: remainingMs,
      });
      const operationResult = await operationController.call("Personal resolveApproval", "resolveApproval", ({ operationId, signal }) => personalAgentRuntime.resolveApproval({
        runId: context.attempt.personalRunId,
        approvalId: context.gate.personalApprovalId,
        decision: parsed.decision === "approve" ? "accept" : "decline",
        operationId,
        signal,
        expiresAt: context.gate.expiresAt,
      }));
      resolved = operationResult.value;
    } catch (error) {
      const cancellationRequests = await fenceResolvingGate(`resolveApproval failed: ${messageOf(error)}`);
      const cancellationFailures = await cancelRetainedApprovalRuns(cancellationRequests);
      if (cancellationFailures.length) error.message = `${error.message}; provider cancellation was not confirmed: ${cancellationFailures.map((failure) => failure.error).join("; ")}`;
      throw error;
    }
    if (!resolved?.ok) {
      const cancellationRequests = await fenceResolvingGate(`Personal runtime rejected approval: ${resolved?.error || "unknown error"}`);
      const cancellationFailures = await cancelRetainedApprovalRuns(cancellationRequests);
      const suffix = cancellationFailures.length ? `; provider cancellation was not confirmed: ${cancellationFailures.map((failure) => failure.error).join("; ")}` : "";
      throw new Error(`${resolved?.error || "Personal runtime rejected the approval decision"}${suffix}`);
    }
    /** @type {Error | null} */
    let postResolutionFailure = null;
    const postResolutionCancellationRequests = [];
    const finalSnapshot = await serialized(async () => {
      const run = await store.requireRun(context.taskId, context.run.id);
      const gate = (await store.readGates(context.taskId, run.id)).find((candidate) => candidate.id === parsed.gateId);
      if (!gate) throw new Error(`Gate not found: ${parsed.gateId}`);
      if (gate.status !== "resolving" || gate.decision !== parsed.decision) {
        postResolutionFailure = new Error("Approval gate was terminalized while the provider decision was in flight");
        if (gate.personalRunId) postResolutionCancellationRequests.push({
          taskId: context.taskId,
          taskRunId: run.id,
          attemptId: gate.attemptId,
          personalRunId: gate.personalRunId,
          reason: "task-approval-stale",
        });
        return store.snapshot(context.taskId, run.id);
      }
      if (gate.expiresAt !== null && gate.expiresAt <= now()) {
        const reconciliation = await reconcileApprovalGateStates({ store, run, now, emit, notify: notifyEvent, createId });
        postResolutionCancellationRequests.push(...reconciliation.cancelRequests);
        postResolutionFailure = new Error("Approval gate expired while the provider decision was in flight");
        return store.snapshot(context.taskId, run.id);
      }
      const attempt = findAttempt(run, gate.attemptId);
      if (gate.kind !== "manual-review" && (!attempt || run.currentAttemptId !== attempt.id || !attempt.leaseId || gate.leaseId !== attempt.leaseId || gate.personalRunId !== attempt.personalRunId)) {
        const reconciliation = await reconcileApprovalGateStates({ store, run, now, emit, notify: notifyEvent, createId });
        postResolutionCancellationRequests.push(...reconciliation.cancelRequests);
        postResolutionFailure = new Error("Approval gate became stale while the provider decision was in flight");
        return store.snapshot(context.taskId, run.id);
      }
      await store.writeGate(finalizedDecisionGate(gate, now()));
      await emit(run, "approval-resolved", `${gate.title}: ${parsed.decision}`, gate.attemptId);
      return store.snapshot(context.taskId, run.id);
    });
    const cancellationFailures = await cancelRetainedApprovalRuns(postResolutionCancellationRequests);
    if (postResolutionFailure) {
      if (cancellationFailures.length) {
        postResolutionFailure.message = `${postResolutionFailure.message}; provider cancellation was not confirmed: ${cancellationFailures.map((failure) => failure.error).join("; ")}`;
      }
      throw postResolutionFailure;
    }
    return finalSnapshot;
  }

  function resolveGate(input) {
    const tracked = resolveGateOperation(input).finally(() => {
      activeGateResolutions.delete(tracked);
    });
    activeGateResolutions.add(tracked);
    return tracked;
  }

  async function pauseAllAndDrain(reason = "explicit_quit") {
    if (closePromise) return closePromise;
    closed = true;
    const operation = (async () => {
      await ready;
      await stopApprovalExpirySweep();
      await alignmentRuntime.cancelAll(reason);
      await Promise.allSettled([...activeGateResolutions]);
      await reconcileApprovalDecisionIntents();
      const snapshots = await pauseRuns({ reason, strictDrain: true });
      runner.closeAdmissions(`Task orchestrator ${reason}`);
      await runner.awaitActive();
      listeners.clear();
      await store.close?.();
      return { ok: true, reason, pausedRunIds: snapshots.map((snapshot) => snapshot.run?.id).filter(Boolean) };
    })();
    closePromise = operation.catch((error) => {
      // Safe Quit is intentionally retryable. A failed cancellation or
      // checkpoint must leave the owner/store alive so the next explicit Quit
      // can resume the durable drain instead of replaying a cached rejection.
      closed = false;
      closePromise = null;
      throw error;
    });
    return closePromise;
  }

  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      try {
        await ready;
        await stopApprovalExpirySweep();
        await alignmentRuntime.cancelAll("shutdown");
        await Promise.allSettled([...activeGateResolutions]);
        await reconcileApprovalDecisionIntents();
        await runner.reconcileActiveRuns({ trigger: "shutdown" });
        runner.closeAdmissions("Task orchestrator shutdown");
        await runner.awaitActive();
      } finally {
        listeners.clear();
        await store.close?.();
      }
    })();
    return closePromise;
  }

  async function claimSupervisorRequest(input) {
    await ready;
    if (typeof store.claimRpcRequest !== "function") return { state: "claimed" };
    return store.claimRpcRequest(input);
  }

  async function completeSupervisorRequest(input) {
    if (typeof store.completeRpcRequest !== "function") return { ok: true };
    return store.completeRpcRequest(input);
  }

  async function failSupervisorRequest(input) {
    if (typeof store.failRpcRequest !== "function") return { ok: true };
    return store.failRpcRequest(input);
  }

  return {
    rootDirectory: store.rootDirectory,
    subscribe,
    listTasks,
    getTask,
    listRuns,
    listTurnHistory,
    listEvents,
    listArtifacts,
    getArtifact,
    getArtifactContent,
    archiveTask,
    restoreTask,
    purgeTask,
    exportTaskManifest,
    runMaintenance,
    getHealth,
    getSupervisorRuntimeHealth,
    recordPowerEvent,
    getOperationsDiagnostics,
    createTask,
    sendAlignmentMessage,
    cancelAlignment,
    finalizeContract,
    updateTask,
    startTask,
    stopRun,
    stopTask: stopRun,
    pauseTask,
    resumeTask,
    retryPrimary,
    continueRecovery,
    // Explicit legacy alias: node-shaped v1 retries never mutate a v2 run.
    retryNode: retryLegacyNode,
    resolveGate,
    claimSupervisorRequest,
    completeSupervisorRequest,
    failSupervisorRequest,
    replayOutbox,
    pauseAllAndDrain,
    close,
  };
}
