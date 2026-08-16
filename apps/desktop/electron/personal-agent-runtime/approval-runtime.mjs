import { appendContractEvent } from "./contract.mjs";
import { getStoredApprovalDecision } from "./approval-store.mjs";
import { buildApprovalRecord, normalizeApprovalExpiry } from "./run-helpers.mjs";
import { evaluateTaskPermission } from "./task-permission-policy.mjs";

async function beforeTaskOperation(observer, operation) {
  const beforeOperation = observer?.beforeOperation;
  if (typeof beforeOperation !== "function") return { ok: false, reason: "task-intent-observer-missing" };
  try {
    const result = await beforeOperation(operation);
    if (result?.recorded === true) return { ok: true, result };
    if (result?.recorded === false && result?.idempotency === "read-only") return { ok: true, result };
    return { ok: false, reason: "task-intent-not-durable" };
  } catch {
    return { ok: false, reason: "task-intent-observer-failed" };
  }
}

/**
 * Request / pending approval + resolveApproval for createPersonalAgentRuntime.
 *
 * @param {{
 *   runs: Map<string, any>,
 *   flushPersistRun: (state: any, force?: boolean) => Promise<unknown>,
 *   beginTaskOperation: (name: string, input: unknown) => any,
 *   finishTaskOperation: (operation: any, result: unknown, failure?: unknown) => void,
 *   operationCancellationResult: (operation: any, extra?: object) => any,
 *   rememberApprovalDecision: Function,
 *   forgetRememberedApprovalDecision: Function,
 * }} deps
 */
export function createApprovalRuntime({
  runs,
  flushPersistRun,
  beginTaskOperation,
  finishTaskOperation,
  operationCancellationResult,
  rememberApprovalDecision: rememberApprovalDecisionFn,
  forgetRememberedApprovalDecision: forgetRememberedApprovalDecisionFn,
}) {
  async function requestRunApproval(state, request = {}) {
    const approval = buildApprovalRecord(state, request);
    const isExpired = () => approval.expiresAt !== null && approval.expiresAt <= Date.now();
    const declineExpired = () => {
      appendContractEvent(state.events, {
        type: "approval_decision",
        text: `${approval.kind}: decline (expired)`,
        approval,
        expired: true,
      });
      state.updatedAt = Date.now();
      state.lastApprovalPersist = flushPersistRun(state, true);
      void state.lastApprovalPersist;
      return { decision: "decline", approval, expired: true, policyReason: "approval-expired" };
    };
    // Provider TTLs are authoritative before any full-allow/remembered
    // decision path. An expired request must never become a durable pending
    // or remembered approval.
    if (isExpired()) return declineExpired();
    if (state.taskPermissionMode === "full-allow") {
      const policy = await evaluateTaskPermission({
        taskPermissionGrant: state.taskPermissionGrant,
        taskId: state.taskId,
        taskRunId: state.taskRunId ?? state.runId,
        taskRevision: state.taskRevision,
        contractHash: state.taskContractHash,
        taskProfileId: state.taskProfileId,
        provider: state.agentProvider,
        workspaceRoot: state.workspaceRoot,
        operation: request,
      });
      // A Task Center grant is fail-closed: invalid/mismatched/expired grants
      // decline without creating a user prompt or remembered approval.
      if (policy.decision !== "accept") return { decision: "decline", approval, policyReason: policy.reason };
      if (isExpired()) return declineExpired();
      const intent = await beforeTaskOperation(state.taskExecutionObserver, request);
      if (!intent.ok) return { decision: "decline", approval, policyReason: intent.reason };
      if (isExpired()) return declineExpired();
      return { decision: "accept", approval, policyReason: policy.reason };
    }
    const stored = state.useRememberedApprovals ? await getStoredApprovalDecision(state.workspaceRoot, { provider: state.agentProvider, agentId: state.agentId, approval }) : null;
    if (isExpired()) return declineExpired();
    if (stored) {
      appendContractEvent(state.events, {
        type: "approval_decision",
        text: `${approval.kind}: acceptForSession (stored)` ,
        approval,
        storedApprovalKey: stored.key,
      });
      state.updatedAt = Date.now();
      state.lastApprovalPersist = flushPersistRun(state, true);
      void state.lastApprovalPersist;
      return { decision: "acceptForSession", approval, stored: true };
    }
    if (isExpired()) return declineExpired();
    state.pendingApprovals = [...(state.pendingApprovals ?? []).filter((item) => item.id !== approval.id), approval];
    appendContractEvent(state.events, {
      type: "approval_request",
      text: approval.summary,
      approval,
    });
    state.updatedAt = Date.now();
    // Register the resolver synchronously so a decision arriving during the
    // durable write is never dropped. The persist is fire-and-forget for the
    // in-memory pending state (already observable), but the recoverable
    // confirmation write (ASP-3) is awaited via `state.persistedApproval` so
    // callers that need the durable record can synchronize on it.
    const decision = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener?.("abort", abort);
        resolve(value);
      };
      const abort = () => {
        state.approvalResolvers.delete(approval.id);
        state.pendingApprovals = (state.pendingApprovals ?? []).filter((item) => item.id !== approval.id);
        appendContractEvent(state.events, {
          type: "approval_decision",
          text: `${approval.kind}: decline (request cancelled)`,
          approval,
          cancelled: true,
        });
        state.updatedAt = Date.now();
        state.lastApprovalPersist = flushPersistRun(state, true);
        void state.lastApprovalPersist;
        finish({ decision: "decline", approval, cancelled: true });
      };
      state.approvalResolvers.set(approval.id, finish);
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener?.("abort", abort, { once: true });
    });
    state.lastApprovalPersist = flushPersistRun(state, true);
    void state.lastApprovalPersist;
    return decision;
  }

  async function resolveApproval(input = {}) {
    const runIdValue = String(input.runId ?? "").trim();
    const approvalId = String(input.approvalId ?? input.id ?? "").trim();
    const decision = String(input.decision ?? "").trim();
    const allowed = new Set(["accept", "acceptForSession", "decline", "cancel"]);
    if (!runIdValue || !approvalId) return { ok: false, error: "runId and approvalId are required" };
    if (!allowed.has(decision)) return { ok: false, error: "invalid approval decision" };
    const operation = beginTaskOperation("resolveApproval", input);
    let result = null;
    let failure = null;
    try {
      if (operation?.status === "cancelling" || operation?.signal.aborted) {
        result = operationCancellationResult(operation);
        return result;
      }
      const state = runs.get(runIdValue);
      if (!state || state.status !== "running") return { ok: false, error: "run is not active" };
      if (operation) {
        operation.state = state;
        operation.runId = runIdValue;
      }
      const approval = (state.pendingApprovals ?? []).find((item) => item.id === approvalId);
      if (!approval) return { ok: false, error: "approval request not found" };
      const requestedExpiry = normalizeApprovalExpiry(input);
      const approvalExpiry = normalizeApprovalExpiry(approval);
      const effectiveExpiry = requestedExpiry === null
        ? approvalExpiry
        : approvalExpiry === null ? requestedExpiry : Math.min(requestedExpiry, approvalExpiry);
      const expiredApproval = () => effectiveExpiry !== null && effectiveExpiry <= Date.now();
      const declineExpired = async () => {
        state.pendingApprovals = (state.pendingApprovals ?? []).filter((item) => item.id !== approvalId);
        appendContractEvent(state.events, {
          type: "approval_decision",
          text: `${approval.kind}: decline (expired)`,
          approval,
          expired: true,
        });
        state.updatedAt = Date.now();
        await flushPersistRun(state, true);
        const resolver = state.approvalResolvers?.get(approvalId);
        state.approvalResolvers?.delete(approvalId);
        resolver?.({ decision: "decline", approval, expired: true });
        return { ok: false, error: "approval expired", code: "APPROVAL_EXPIRED", expired: true };
      };
      if (expiredApproval()) return await declineExpired();
      if (operation?.status === "cancelling" || operation?.signal.aborted) return operationCancellationResult(operation);
      if ((decision === "accept" || decision === "acceptForSession") && state.taskExecutionObserver) {
        if (expiredApproval()) return await declineExpired();
        const intent = await beforeTaskOperation(state.taskExecutionObserver, {
          ...approval,
          id: approval.id,
          toolCallId: approval.toolCallId ?? approval.id,
        });
        if (!intent.ok) return { ok: false, error: `Task side-effect intent was not durably recorded: ${intent.reason}` };
      }
      // Re-check immediately before resolver dispatch. The provider may have
      // spent enough time in the observer for the gate to cross its TTL.
      if (operation?.status === "cancelling" || operation?.signal.aborted) return operationCancellationResult(operation);
      if (expiredApproval()) return await declineExpired();
      let rememberedDecision = null;
      if (input.alwaysAllow === true) {
        rememberedDecision = await rememberApprovalDecisionFn(state.workspaceRoot, {
          provider: state.agentProvider,
          agentId: state.agentId,
          approval,
          decision: "acceptForSession",
        });
      }
      if (operation?.status === "cancelling" || operation?.signal.aborted || expiredApproval()) {
        if (rememberedDecision?.key) {
          await forgetRememberedApprovalDecisionFn(state.workspaceRoot, {
            key: rememberedDecision.key,
            expected: rememberedDecision,
          }).catch(() => undefined);
        }
        return operation?.status === "cancelling" || operation?.signal.aborted
          ? operationCancellationResult(operation)
          : await declineExpired();
      }
      state.pendingApprovals = (state.pendingApprovals ?? []).filter((item) => item.id !== approvalId);
      appendContractEvent(state.events, {
        type: "approval_decision",
        text: `${approval.kind}: ${decision}`,
        approval,
      });
      state.updatedAt = Date.now();
      await flushPersistRun(state, true);
      if (operation?.status === "cancelling" || operation?.signal.aborted || expiredApproval()) {
        // The durable pending record has already been removed only after the
        // final expiry check; a concurrent deadline must not resolve it as ok.
        if (rememberedDecision?.key) {
          await forgetRememberedApprovalDecisionFn(state.workspaceRoot, {
            key: rememberedDecision.key,
            expected: rememberedDecision,
          }).catch(() => undefined);
        }
        return operation?.status === "cancelling" || operation?.signal.aborted
          ? operationCancellationResult(operation)
          : await declineExpired();
      }
      const resolver = state.approvalResolvers?.get(approvalId);
      state.approvalResolvers?.delete(approvalId);
      resolver?.({ decision, approval });
      result = { ok: true };
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      finishTaskOperation(operation, result, failure);
    }
  }

  return { requestRunApproval, resolveApproval };
}
