import { TASK_ORCHESTRATOR_SCHEMA_VERSION } from "@onmyagent/types/task-orchestrator";

import { ACTIVE_ATTEMPT_STATUSES, ACTIVE_RUN_STATUSES } from "./definitions.mjs";
import { approvalGateDetails } from "./approval-risk.mjs";

function timestamp(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function attemptsFor(run) {
  return [
    ...(Array.isArray(run?.primaryAttempts) ? run.primaryAttempts : []),
    ...(Array.isArray(run?.workerAttempts) ? run.workerAttempts : []),
    ...(Array.isArray(run?.checkerAttempts) ? run.checkerAttempts : []),
  ];
}

/**
 * Compact optimistic-concurrency cursor for an approval fence. The full run
 * payload is intentionally not used as a CAS key: sibling attempts may be
 * appended concurrently, so the store compares this identity/status/lease
 * set against the durable row before applying the terminal transition.
 */
export function approvalFenceRunExpectation(run) {
  return {
    id: run.id,
    taskId: run.taskId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    currentAttemptId: run.currentAttemptId ?? null,
    attempts: attemptsFor(run).map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      leaseId: attempt.leaseId ?? null,
      personalRunId: attempt.personalRunId ?? null,
      updatedAt: attempt.updatedAt,
    })),
  };
}

function attemptFor(run, attemptId) {
  return attemptsFor(run).find((attempt) => attempt.id === attemptId) ?? null;
}

/** The immutable run deadline used by every approval created for the run. */
export function frozenRunHardDeadline(run) {
  const conditions = run?.definition?.endConditions;
  const candidates = [];
  const explicit = timestamp(conditions?.deadlineAt);
  if (explicit !== null) candidates.push(explicit);
  const createdAt = timestamp(run?.createdAt);
  const maxElapsedMs = timestamp(conditions?.maxElapsedMs);
  if (createdAt !== null && maxElapsedMs !== null && createdAt <= Number.MAX_SAFE_INTEGER - maxElapsedMs) {
    candidates.push(createdAt + maxElapsedMs);
  }
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Provider approvals may carry their own expiry. A Task Center gate is never
 * allowed to outlive the frozen run deadline, so the earlier bound wins.
 */
export function approvalGateExpiryAt(run, approval = null, kind = "personal-runtime-approval") {
  const hardDeadline = frozenRunHardDeadline(run);
  if (kind === "manual-review") return hardDeadline;
  const providerExpiry = timestamp(approval?.expiresAt ?? approval?.expires_at);
  const candidates = [providerExpiry, hardDeadline].filter((value) => value !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

function expired(gate, at) {
  return ["pending", "resolving"].includes(gate.status)
    && gate.expiresAt !== null
    && gate.expiresAt <= at;
}

function staleProviderGate(run, gate) {
  if (gate.kind === "manual-review" || !["pending", "resolving"].includes(gate.status)) return null;
  const attempt = attemptFor(run, gate.attemptId);
  if (!attempt) return "approval gate attempt no longer exists";
  if (run.currentAttemptId !== attempt.id) return "approval gate is not attached to the current attempt";
  if (!attempt.leaseId || !gate.leaseId || attempt.leaseId !== gate.leaseId) return "approval gate lease is stale";
  if (!attempt.personalRunId || !gate.personalRunId || attempt.personalRunId !== gate.personalRunId) return "approval gate Personal run is stale";
  if (!ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) return "approval gate attempt is no longer active";
  return null;
}

function terminalExpiredGate(gate, at) {
  return {
    ...gate,
    status: "cancelled",
    decision: null,
    decisionRequestedAt: null,
    resolvedAt: at,
  };
}

function fenceEvent({ run, type, message, attemptId, at, id }) {
  const attempt = attemptFor(run, attemptId);
  return {
    schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
    id,
    // commitApprovalFence allocates the stream sequence atomically. The
    // positive placeholder is required by the shared event schema and is
    // replaced by the persisted sequence in the transaction result.
    sequence: 1,
    taskId: run.taskId,
    taskRunId: run.id,
    attemptId: attemptId ?? null,
    turnId: attempt?.turnId ?? run.currentTurnId ?? null,
    type,
    message: String(message ?? "").slice(0, 4_000),
    at,
  };
}

function approvalFencePlan({ run, gates, now, createId }) {
  const at = now();
  const triggered = gates.filter((gate) => {
    if (!['pending', 'resolving'].includes(gate.status)) return false;
    return expired(gate, at) || Boolean(staleProviderGate(run, gate));
  });
  if (!triggered.length) return null;

  // Once one gate is expired/stale, fence the complete run. This closes the
  // sibling primary/worker/checker race and prevents another pending gate
  // from being approved after the run's lease has been invalidated.
  const changedGates = gates.filter((gate) => ['pending', 'resolving'].includes(gate.status));
  const expectedGates = changedGates.map((gate) => ({
    id: gate.id,
    status: gate.status,
    taskId: gate.taskId,
    taskRunId: gate.taskRunId,
    leaseId: gate.leaseId ?? null,
    personalRunId: gate.personalRunId ?? null,
  }));
  const expectedRun = approvalFenceRunExpectation(run);
  const nextGates = changedGates.map((gate) => terminalExpiredGate(gate, at));
  const reasons = triggered.map((gate) => {
    if (expired(gate, at)) return `Approval gate ${gate.id} expired at ${gate.expiresAt}.`;
    return `Approval gate ${gate.id} is stale: ${staleProviderGate(run, gate)}.`;
  });
  const reason = reasons[0] ?? "Approval gate expired or became stale.";
  const nextRun = structuredClone(run);
  const nextAttempts = attemptsFor(nextRun);
  const checkerAttemptIds = new Set((nextRun.checkerAttempts ?? []).map((attempt) => attempt.id));
  const terminalizedAttemptIds = new Set();
  let currentAttempt = nextAttempts.find((attempt) => attempt.id === nextRun.currentAttemptId) ?? null;
  for (const attempt of nextAttempts) {
    const shouldFence = ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId
      || (checkerAttemptIds.has(attempt.id) && ["ready", "running"].includes(attempt.status));
    if (shouldFence) {
      terminalizedAttemptIds.add(attempt.id);
      attempt.status = "blocked";
      attempt.leaseId = null;
      attempt.error = reason;
      attempt.updatedAt = at;
      attempt.finishedAt = at;
      currentAttempt ??= attempt;
    }
  }
  nextRun.status = "blocked";
  nextRun.error = reason;
  nextRun.currentAttemptId = currentAttempt?.id ?? nextRun.currentAttemptId;
  nextRun.updatedAt = at;
  nextRun.finishedAt = at;
  const personalIds = new Map();
  for (const gate of changedGates) {
    // Keep every unresolved gate identity in the fence plan.  The attempt may
    // already have been terminalized by startup/runner while its provider
    // process row (or Personal runtime) is still live; cancellation eligibility
    // is checked against those durable/provider identities immediately before
    // invoking cancelRun, outside this durable mutation boundary.
    const personalRunId = String(gate.personalRunId ?? "").trim();
    if (personalRunId) personalIds.set(personalRunId, {
      taskId: run.taskId,
      taskRunId: run.id,
      attemptId: gate.attemptId,
      personalRunId,
      reason: expired(gate, at) ? "task-approval-expired" : "task-approval-stale",
    });
  }
  // Only attempts actually terminalized by this fence are eligible for
  // provider cancellation. Historical succeeded/failed siblings remain
  // immutable and must never produce a spurious cancellation diagnostic.
  for (const attempt of nextAttempts) {
    if (!terminalizedAttemptIds.has(attempt.id)) continue;
    const previous = attemptFor(run, attempt.id);
    const personalRunId = String(previous?.personalRunId ?? attempt.personalRunId ?? "").trim();
    if (personalRunId && !personalIds.has(personalRunId)) personalIds.set(personalRunId, {
      taskId: run.taskId,
      taskRunId: run.id,
      attemptId: attempt.id,
      personalRunId,
      reason: "task-approval-expired",
    });
  }
  const idFor = (kind, suffix) => {
    const candidate = typeof createId === "function" ? createId(kind) : `${kind}-${run.id}-${suffix}-${at}`;
    return String(candidate).replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 160);
  };
  const events = [
    ...triggered.map((gate, index) => fenceEvent({
      run,
      type: "approval-expired",
      message: reasons[index] ?? reason,
      attemptId: gate.attemptId,
      at,
      id: idFor("event", `approval-${gate.id}`),
    })),
    fenceEvent({ run, type: "run-blocked", message: reason, attemptId: currentAttempt?.id ?? null, at, id: idFor("event", "run-blocked") }),
  ];
  return {
    taskId: run.taskId,
    taskRunId: run.id,
    expectedGates,
    expectedRun,
    gates: nextGates,
    run: nextRun,
    events,
    cancelRequests: [...personalIds.values()],
    changedRun: true,
    at,
    reason,
  };
}

async function persistApprovalFence({ store, plan, emit, notify }) {
  if (!plan) return { changedRun: false, gates: null, cancelRequests: [] };
  if (typeof store.commitApprovalFence === "function") {
    const committed = await store.commitApprovalFence(plan);
    Object.assign(plan.run, committed.run);
    if (typeof notify === "function") {
      for (const event of committed.events ?? []) await notify(event);
    }
    return {
      changedRun: true,
      run: committed.run,
      gates: committed.gates,
      cancelRequests: plan.cancelRequests,
      events: committed.events ?? [],
      committed: true,
      reason: plan.reason,
    };
  }
  // Legacy/fake stores used by unit tests do not expose the atomic fence yet.
  // Keep their observable behavior while production stores remain fail-closed
  // on the single CAS transaction above.
  for (const gate of plan.gates) await store.writeGate(gate);
  await store.writeRun(plan.run);
  for (const event of plan.events) await emit?.(plan.run, event.type, event.message, event.attemptId);
  return {
    changedRun: true,
    run: plan.run,
    gates: plan.gates,
    cancelRequests: plan.cancelRequests,
    events: plan.events,
    committed: false,
    reason: plan.reason,
  };
}

/**
 * Sweep pending/resolving gates before they can be acted on. The gate and the
 * associated active attempt/run are changed in one serialized mutation, and
 * an explicit event is emitted as the durable audit record. Provider gates
 * with missing or mismatched lease identity are treated as stale, including
 * legacy records that predate the identity fields.
 */
export async function reconcileApprovalGateStates({ store, run, now, emit, notify = null, createId = null }) {
  let candidate = run;
  for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
    const gates = await store.readGates(candidate.taskId, candidate.id);
    const plan = approvalFencePlan({ run: candidate, gates, now, createId });
    if (!plan) {
      if (candidate !== run) Object.assign(run, structuredClone(candidate));
      return { changedRun: false, gates, cancelRequests: [] };
    }
    try {
      const result = await persistApprovalFence({ store, plan, emit, notify });
      if (result.run) Object.assign(run, structuredClone(result.run));
      return result;
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!/stale|expected state|not found|terminal/i.test(message) || attemptNumber >= 2) throw error;
      const refreshed = typeof store.readRun === "function"
        ? await store.readRun(candidate.taskId, candidate.id)
        : (typeof store.findRun === "function" ? (await store.findRun(candidate.id))?.run : null);
      if (!refreshed) throw error;
      candidate = structuredClone(refreshed);
    }
  }
  return { changedRun: false, gates: await store.readGates(run.taskId, run.id), cancelRequests: [] };
}

export function createApprovalGateExpirationReconciler(options) {
  const { store, now, serialized, emit, notify, createId, cancelAttempt, onCancellationConfirmed } = options;
  return async function reconcileApprovalGateExpirations() {
    // Only snapshot run identities in the orchestrator serializer. Atomic
    // approval fences and event publication happen outside it so a provider
    // cancellation can never hold the durable mutation queue.
    const runs = await serialized(() => store.allRuns());
    const results = [];
    for (const run of runs) {
      try {
        results.push(await reconcileApprovalGateStates({ store, run, now, emit, notify, createId }));
      } catch (error) {
        // A concurrent resolve/restart may win the fence CAS. Re-read on the
        // next sweep rather than reopening or mutating a newer lease.
        if (/stale|not found|terminal/i.test(String(error?.message ?? error))) continue;
        throw error;
      }
    }
    const requests = [...new Map(
      results.flatMap((result) => result.cancelRequests ?? [])
        .map((request) => [request.personalRunId, request]),
    ).values()];
    const failures = [];
    if (typeof cancelAttempt === "function") {
      const settled = await Promise.allSettled(requests.map((request) => cancelAttempt(request)));
      for (const [index, entry] of settled.entries()) {
        const request = requests[index];
        if (entry.status === "rejected") failures.push({ request, error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) });
        else if (entry.value?.ok === false) failures.push({ request, error: String(entry.value.error || "provider cancellation was not confirmed") });
        else if (entry.value?.skipped !== true && typeof onCancellationConfirmed === "function") {
          try { await onCancellationConfirmed(request, entry.value); } catch (error) {
            failures.push({ request, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    }
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
    return { results, cancelRequests: requests, cancellationFailures: failures };
  };
}

export function completionReviewGate(run, attempt, createId, at) {
  const decision = run.primaryDecisions.find((candidate) => candidate.attemptId === attempt.id && candidate.kind === "complete");
  return {
    schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
    id: createId("gate"),
    kind: "manual-review",
    status: "pending",
    taskId: run.taskId,
    taskRunId: run.id,
    taskRevision: run.taskRevision,
    attemptId: attempt.id,
    turnId: attempt.turnId ?? null,
    personalApprovalId: null,
    title: "Confirm task completion",
    summary: decision?.summary ?? "The primary agent reports that every frozen acceptance criterion passed.",
    risk: "careful",
    operation: {
      method: "complete_task",
      kind: "manual-review",
      command: null,
      cwd: run.definition.workspaceRoot,
      params: [{ name: "acceptanceCriteria", value: String(run.definition.contract.acceptance.length) }],
      diff: null,
      readOnly: true,
    },
    requestedAt: at,
    leaseId: null,
    personalRunId: null,
    expiresAt: approvalGateExpiryAt(run, null, "manual-review"),
    decisionRequestedAt: null,
    resolvedAt: null,
    decision: null,
  };
}

export function finalizedDecisionGate(gate, at) {
  if (gate.status !== "resolving" || !gate.decision) return gate;
  return {
    ...gate,
    status: gate.decision === "approve" ? "approved" : "rejected",
    resolvedAt: Math.max(at, gate.decisionRequestedAt ?? at),
  };
}

export function terminalGateForInterruptedRun(gate, at) {
  // A durable provider decision intent cannot be replayed after the provider
  // lease/session was interrupted. Manual completion review has no provider
  // side effect and may still be finalized, but provider gates are cancelled
  // and must be requested again on a fresh attempt.
  if (gate.status === "resolving") {
    if (gate.kind === "manual-review") return finalizedDecisionGate(gate, at);
    return terminalExpiredGate(gate, at);
  }
  if (gate.status !== "pending") return gate;
  return {
    ...gate,
    status: "cancelled",
    decision: null,
    decisionRequestedAt: null,
    resolvedAt: at,
  };
}

export function createApprovalDecisionReconciler(options) {
  const { store, now, serialized, emit, notify = null, createId = null, cancelAttempt, onCancellationConfirmed } = options;
  return async function reconcileApprovalDecisionIntents() {
    const cancelRequests = [];
    await serialized(async () => {
      for (const run of await store.allRuns()) {
        for (const gate of await store.readGates(run.taskId, run.id)) {
          if (gate.status !== "resolving") continue;
          // A provider decision intent is caller-owned and cannot be replayed
          // after a supervisor restart.  Fence it through the same durable
          // expiry/CAS path used by the periodic sweep, then cancel the
          // retained Personal run outside this serializer.
          if (gate.kind !== "manual-review") {
            const at = now();
            await store.writeGate({ ...gate, expiresAt: at });
            const reconciliation = await reconcileApprovalGateStates({ store, run, now, emit, notify, createId });
            cancelRequests.push(...(reconciliation.cancelRequests ?? []));
            continue;
          }
          // The final manual-review check and this durable reconciliation share
          // one mutation boundary. If the injected clock crosses the TTL in
          // between, fence the run instead of finalizing an expired approval.
          if (gate.expiresAt !== null && gate.expiresAt <= now()) {
            const reconciliation = await reconcileApprovalGateStates({ store, run, now, emit, notify, createId });
            cancelRequests.push(...(reconciliation.cancelRequests ?? []));
            continue;
          }
          const resolved = finalizedDecisionGate(gate, now());
          if (gate.kind === "manual-review") {
            run.status = gate.decision === "approve" ? "succeeded" : "blocked";
            run.error = gate.decision === "approve" ? null : "Completion review rejected; retry the primary agent to continue the frozen task.";
            run.updatedAt = now();
            run.finishedAt = now();
            await store.writeRun(run);
          }
          await store.writeGate(resolved);
          await emit(
            run,
            "approval-resolved",
            `${gate.title}: ${gate.decision} (reconciled from durable decision intent)`,
            gate.attemptId,
          );
          if (gate.kind === "manual-review") {
            await emit(
              run,
              gate.decision === "approve" ? "run-succeeded" : "run-blocked",
              gate.decision === "approve"
                ? "Task completion was confirmed by the user."
                : "Task completion was rejected by the user; retry the primary agent to continue.",
              gate.attemptId,
            );
          }
        }
      }
    });
    const requests = [...new Map(cancelRequests.map((request) => [request.personalRunId, request])).values()];
    const failures = [];
    if (typeof cancelAttempt === "function") {
      const settled = await Promise.allSettled(requests.map((request) => cancelAttempt(request)));
      for (const [index, entry] of settled.entries()) {
        const request = requests[index];
        if (entry.status === "rejected") failures.push({ request, error: errorText(entry.reason) });
        else if (entry.value?.ok === false) failures.push({ request, error: String(entry.value.error || "provider cancellation was not confirmed") });
        else if (entry.value?.skipped !== true && typeof onCancellationConfirmed === "function") {
          try { await onCancellationConfirmed(request, entry.value); } catch (error) {
            failures.push({ request, error: errorText(error) });
          }
        }
      }
    }
    if (failures.length) {
      await serialized(async () => {
        for (const failure of failures) {
          const located = await store.findRun?.(failure.request.taskRunId);
          if (!located || located.run.status !== "blocked") continue;
          const run = located.run;
          run.error = `${run.error || "Approval gate expired or became stale."} Provider cancellation was not confirmed: ${failure.error}`.slice(0, 8_000);
          run.updatedAt = now();
          await store.writeRun(run);
          await emit(run, "run-blocked", run.error, failure.request.attemptId);
        }
      });
    }
    return { cancelRequests: requests, cancellationFailures: failures };
  };
}

export function createApprovalGateSynchronizer(options) {
  const { store, now, createId, serialized, emit, cancelAttempt, onCancellationConfirmed } = options;

  return async function synchronizeApprovalGates(
    taskId,
    taskRunId,
    attemptId,
    leaseId,
    snapshot,
  ) {
    const pending = Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals : [];
    const cancelRequests = [];
    await serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const attempt = [...run.primaryAttempts, ...run.workerAttempts].find((candidate) => candidate.id === attemptId);
      if (!attempt || attempt.leaseId !== leaseId || !ACTIVE_RUN_STATUSES.has(run.status)) return;
      const initialReconcile = await reconcileApprovalGateStates({ store, run, now, emit });
      cancelRequests.push(...initialReconcile.cancelRequests);
      if (!ACTIVE_RUN_STATUSES.has(run.status) || attempt.leaseId !== leaseId) return;
      if (run.definition.permissionMode === "full-allow" && pending.length > 0) {
        throw new Error("full-allow runtime returned an approval request; Task Center approval gates are disabled");
      }
      const gates = await store.readGates(taskId, taskRunId);
      for (const approval of pending) {
        const personalApprovalId = String(approval?.id ?? "").trim();
        if (!personalApprovalId) continue;
        if (gates.some((gate) => (
          gate.attemptId === attemptId && gate.personalApprovalId === personalApprovalId
        ))) continue;
        const details = approvalGateDetails(approval);
        const gate = {
          schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
          id: createId("gate"),
          kind: details.kind,
          status: "pending",
          taskId,
          taskRunId,
          taskRevision: run.taskRevision,
          attemptId,
          turnId: attempt.turnId ?? null,
          leaseId: attempt.leaseId,
          personalRunId: attempt.personalRunId,
          personalApprovalId,
          expiresAt: approvalGateExpiryAt(run, approval, details.kind),
          title: details.title,
          summary: details.summary,
          risk: details.risk,
          operation: details.operation,
          requestedAt: now(),
          decisionRequestedAt: null,
          resolvedAt: null,
          decision: null,
        };
        await store.writeGate(gate);
        await emit(run, "approval-required", gate.summary, attemptId);
      }
      const finalReconcile = await reconcileApprovalGateStates({ store, run, now, emit });
      cancelRequests.push(...finalReconcile.cancelRequests);
      if (!ACTIVE_RUN_STATUSES.has(run.status)) return;
      const unresolved = (await store.readGates(taskId, taskRunId))
        .some((gate) => (
          gate.attemptId === attemptId
          && (gate.status === "pending" || gate.status === "resolving")
        ));
      if (unresolved) {
        attempt.status = "waiting-approval";
        run.status = "waiting-approval";
      } else if (attempt.status === "waiting-approval") {
        attempt.status = "running";
        run.status = "running";
      }
      attempt.updatedAt = now();
      run.updatedAt = now();
      await store.writeRun(run);
    });
    const requests = [...new Map(cancelRequests.map((request) => [`${request.taskRunId}:${request.attemptId}:${request.personalRunId}`, request])).values()];
    if (typeof cancelAttempt === "function") {
      for (const request of requests) {
        const result = await cancelAttempt(request);
        if (result?.ok === false) {
          await serialized(async () => {
            const located = await store.findRun?.(request.taskRunId);
            if (!located || located.run.status !== "blocked") return;
            const run = located.run;
            run.error = `${run.error || "Approval gate expired or became stale."} Provider cancellation was not confirmed: ${String(result.error || "unknown cancellation failure")}`.slice(0, 8_000);
            run.updatedAt = now();
            await store.writeRun(run);
            await emit(run, "run-blocked", run.error, request.attemptId);
          });
        } else if (result?.skipped !== true && typeof onCancellationConfirmed === "function") {
          try { await onCancellationConfirmed(request, result); } catch (error) {
            await serialized(async () => {
              const located = await store.findRun?.(request.taskRunId);
              if (!located || located.run.status !== "blocked") return;
              const run = located.run;
              run.error = `${run.error || "Approval gate expired or became stale."} Provider cancellation tombstone was not confirmed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 8_000);
              run.updatedAt = now();
              await store.writeRun(run);
              await emit(run, "run-blocked", run.error, request.attemptId);
            });
          }
        }
      }
    }
  };
}
