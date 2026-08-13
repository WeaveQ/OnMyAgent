import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_ORCHESTRATOR_SCHEMA_VERSION,
  TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET,
  taskOrchestratorAgentSelectionSchema,
  taskOrchestratorArtifactContentGetInputSchema,
  taskOrchestratorArtifactContentResultSchema,
  taskOrchestratorArtifactsListInputSchema,
  taskOrchestratorAttemptSchema,
  taskOrchestratorContractSchema,
  taskOrchestratorDesktopEventSchema,
  taskOrchestratorEndConditionsSchema,
  taskOrchestratorLegacyTaskSchema,
  taskOrchestratorPrimaryDecisionSchema,
  taskOrchestratorPermissionGrantSchema,
  taskOrchestratorProviderCapabilitySnapshotSchema,
  taskOrchestratorProviderDiagnosticsSchema,
  taskOrchestratorOperationsDiagnosticsGetInputSchema,
  taskOrchestratorOperationsDiagnosticsSchema,
  taskOrchestratorRunDefinitionSnapshotSchema,
  taskOrchestratorEventsListInputSchema,
  taskOrchestratorRunsListInputSchema,
  taskOrchestratorTaskGetInputSchema,
  taskOrchestratorTaskArchiveInputSchema,
  taskOrchestratorTaskRestoreInputSchema,
  taskOrchestratorTaskExportManifestInputSchema,
  taskOrchestratorMaintenanceInputSchema,
  taskOrchestratorStoreHealthInputSchema,
  taskOrchestratorTaskSchema,
} from "../src/task-orchestrator.ts";

const contract = {
  outcome: "Ship the aligned change",
  deliverables: ["Implementation"],
  acceptance: ["Focused tests pass"],
  scope: { included: ["Task Center"], excluded: ["Scheduling"] },
  verification: ["pnpm test:runtime"],
};
const selection = (agentId, provider = "codex", model = "model-1") => ({
  agentId,
  provider,
  label: agentId,
  model,
  modelLabel: model,
  catalogSource: "personal-registry",
});
const profile = (kind, id, provider = "codex") => ({
  id,
  label: id,
  kind,
  runtime: "personal-local-agent",
  agentId: id,
  provider,
  model: "model-1",
  modelLabel: "Model 1",
  catalogSource: "personal-registry",
  catalogRevision: null,
  instructions: "",
  approvalMode: "ask",
  sessionStrategy: "fresh",
  timeoutMs: 60_000,
});

test("v2 selectors require a live Personal registry reference", () => {
  assert.equal(taskOrchestratorAgentSelectionSchema.safeParse(selection("primary")).success, true);
  assert.equal(taskOrchestratorAgentSelectionSchema.safeParse({ ...selection("primary"), catalogSource: "free-text" }).success, false);
  assert.equal(taskOrchestratorAgentSelectionSchema.safeParse({ ...selection("primary"), agentId: "../../escape" }).success, false);
});

test("provider capability snapshots are bounded and optional for legacy v2 rows", () => {
  const snapshot = {
    schemaVersion: 1,
    requestedModel: "provider-alias",
    effectiveModel: "provider/model-1",
    modelResolution: "catalog",
    catalogRevision: "catalog-3",
    catalogFreshness: "fresh",
    catalogObservedAt: 42,
    supports: {
      taskMcp: true,
      tools: true,
      modelOverride: true,
      approval: true,
      fullAllow: "unknown",
      context: true,
      nativeCompact: false,
      nativeResume: true,
      streaming: true,
      nativeDelegationIsolated: true,
    },
    nativeDelegationIsolated: true,
    warnings: ["Provider catalog is stale."],
  };
  assert.equal(taskOrchestratorProviderCapabilitySnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(taskOrchestratorProviderDiagnosticsSchema.safeParse({
    providerSessionId: "session-1",
    effectiveModel: "provider/model-1",
    transport: "stdio",
    connectionMode: "Custom ACP session",
  }).success, true);
  assert.equal(taskOrchestratorAgentSelectionSchema.parse(selection("primary")).capabilitySnapshot, null);
  assert.equal(taskOrchestratorAttemptSchema.parse({
    id: "primary-1",
    kind: "primary",
    profileId: "primary",
    parentAttemptId: null,
    depth: 0,
    status: "ready",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    prompt: "work",
    outputArtifactIds: [],
    timeoutMs: 60_000,
    startedAt: null,
    updatedAt: 1,
    finishedAt: null,
    error: null,
  }).providerDiagnostics, null);
  assert.equal(taskOrchestratorAttemptSchema.parse({
    id: "primary-legacy",
    kind: "primary",
    profileId: "primary",
    parentAttemptId: null,
    depth: 0,
    status: "ready",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    prompt: "work",
    outputArtifactIds: [],
    timeoutMs: 60_000,
    startedAt: null,
    updatedAt: 1,
    finishedAt: null,
    error: null,
  }).progressAt, null);
});

test("operations diagnostics accepts the exact input and full or minimal bounded results", () => {
  assert.deepEqual(taskOrchestratorOperationsDiagnosticsGetInputSchema.parse({ taskId: "task-1", taskRunId: "run-1" }), {
    taskId: "task-1",
    taskRunId: "run-1",
  });
  const full = {
    version: 1,
    generatedAt: 100,
    terminalReason: { code: "RUN_ACTIVE", category: "active", message: "Task run is active." },
    attempt: { attemptId: "attempt-1", status: "running", leaseId: "lease-1", leaseAgeMs: 1, leaseExpiresAt: 200, progressAt: 99, progressAgeMs: 1 },
    context: { usedTokens: 1, totalTokens: 10, percent: 10, source: "provider", modelId: "model-1", observedAt: 99, observed: true },
    retries: { transportRetries: 0, consecutiveFailures: 0, primaryTurnsUsed: 1, workerAttemptsUsed: 0 },
    provider: { session: "session-1", effectiveModel: "model-1", transport: "stdio", requestId: null, fallbackCount: 0, observed: true },
    processes: { count: 0, active: 0, states: {}, pids: [] },
    storage: { healthy: true, databaseBytes: 1, reclaimableBytes: 0, outboxCount: 0, processCount: 0, lastMaintenanceAt: null },
    truncated: false,
  };
  assert.equal(taskOrchestratorOperationsDiagnosticsSchema.safeParse(full).success, true);
  assert.equal(taskOrchestratorOperationsDiagnosticsSchema.safeParse({ version: 1, generatedAt: 100, truncated: true }).success, true);
  assert.equal(taskOrchestratorOperationsDiagnosticsSchema.safeParse({ ...full, truncated: true }).success, true);
});

test("history contracts keep task get distinct and every page bounded", () => {
  assert.deepEqual(taskOrchestratorTaskGetInputSchema.parse({ taskId: "task-1" }), { taskId: "task-1" });
  assert.deepEqual(taskOrchestratorTaskGetInputSchema.parse({ taskId: "task-1", taskRunId: "run-1" }), { taskId: "task-1", taskRunId: "run-1" });
  assert.equal(taskOrchestratorRunsListInputSchema.safeParse({ taskId: "task-1", limit: 200 }).success, true);
  assert.equal(taskOrchestratorRunsListInputSchema.safeParse({ taskId: "task-1", limit: 201 }).success, false);
  assert.equal(taskOrchestratorEventsListInputSchema.safeParse({ taskId: "task-1", cursor: 0, limit: 50 }).success, true);
  assert.equal(taskOrchestratorArtifactsListInputSchema.safeParse({ taskId: "task-1", taskRunId: "run-1", limit: 0 }).success, false);
  assert.equal(taskOrchestratorArtifactContentGetInputSchema.safeParse({ taskId: "task-1", taskRunId: "run-1", artifactId: "artifact-1", offset: 0, limitChars: 64_000, evidenceOffset: 0, evidenceLimit: 2 }).success, true);
  assert.equal(taskOrchestratorArtifactContentGetInputSchema.safeParse({ taskId: "task-1", taskRunId: "run-1", artifactId: "artifact-1", limitChars: 64_001 }).success, false);
  assert.equal(taskOrchestratorArtifactContentGetInputSchema.safeParse({ taskId: "task-1", taskRunId: "run-1", artifactId: "artifact-1", evidenceLimit: 3 }).success, false);
  assert.equal(taskOrchestratorArtifactContentResultSchema.safeParse({
    artifact: {
      schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
      id: "artifact-1",
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      attemptId: "attempt-1",
      turnId: null,
      kind: "primary",
      summary: "bounded",
      evidenceCount: 0,
      contentBytes: 12,
      contentSha256: "a".repeat(64),
      createdAt: 1,
    },
    offset: 0,
    contentChunk: "任务",
    nextOffset: null,
    complete: true,
    totalChars: 2,
    evidenceOffset: 0,
    evidence: [],
    nextEvidenceOffset: null,
    evidenceComplete: true,
    totalEvidence: 0,
  }).success, true);
  assert.deepEqual(taskOrchestratorTaskArchiveInputSchema.parse({ taskId: "task-1", expectedRevision: 2 }), { taskId: "task-1", expectedRevision: 2 });
  assert.deepEqual(taskOrchestratorTaskRestoreInputSchema.parse({ taskId: "task-1", expectedRevision: 3 }), { taskId: "task-1", expectedRevision: 3 });
  assert.equal(taskOrchestratorTaskExportManifestInputSchema.safeParse({ taskId: "task-1", cursor: 0, limit: 200 }).success, true);
  assert.equal(taskOrchestratorTaskExportManifestInputSchema.safeParse({ taskId: "task-1", limit: 201 }).success, false);
  assert.equal(taskOrchestratorMaintenanceInputSchema.safeParse({ retentionMs: 0, maxTerminalRowsPerTable: 1, incrementalVacuumPages: 1 }).success, true);
  assert.deepEqual(taskOrchestratorStoreHealthInputSchema.parse({}), {});
  assert.equal(TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET, 786_432);
});

test("v2 task contract is idea-first and has no fixed workflow nodes", () => {
  const task = {
    schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
    id: "task-1",
    revision: 1,
    idea: "Improve task execution",
    workspaceRoot: "/tmp/task-center",
    primary: profile("primary", "primary"),
    allowedWorkers: [profile("worker", "worker-1", "claude")],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: {
      conversationId: "conversation-1",
      personalRunId: "run-1",
      messages: [{ id: "message-1", role: "human", text: "refine", at: 1 }],
      proposals: [{ id: "proposal-1", revision: 1, contract, source: "primary", createdAt: 1 }],
      latestProposalId: "proposal-1",
      latestProposalRevision: 1,
    },
    latestRunId: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const parsed = taskOrchestratorTaskSchema.parse(task);
  assert.equal(parsed.primary.kind, "primary");
  assert.equal("nodes" in parsed, false);
  assert.equal("planner" in parsed, false);
});

test("manual and automatic finalization plus permission modes are represented", () => {
  const base = {
    schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION,
    id: "task-2",
    revision: 1,
    idea: "idea",
    workspaceRoot: "/tmp/task-center",
    primary: profile("primary", "primary"),
    allowedWorkers: [],
    permissionMode: "full-allow",
    contractFinalization: "model-recommended-auto",
    contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: { conversationId: null, personalRunId: null, messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
    latestRunId: null,
    createdAt: 1,
    updatedAt: 1,
  };
  assert.equal(taskOrchestratorTaskSchema.parse(base).permissionMode, "full-allow");
  assert.equal(taskOrchestratorTaskSchema.parse(base).contractFinalization, "model-recommended-auto");
  assert.equal(taskOrchestratorTaskSchema.safeParse({ ...base, definitionStatus: "ready", contract: null }).success, false);
  assert.equal(taskOrchestratorTaskSchema.safeParse({ ...base, definitionStatus: "archived" }).success, true);
});

test("depth one is enforced and legacy v1 is identified separately", () => {
  const attempt = {
    id: "worker-1",
    kind: "worker",
    profileId: "worker-1",
    parentAttemptId: "primary-1",
    depth: 1,
    status: "ready",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    prompt: "work",
    outputArtifactIds: [],
    timeoutMs: 60_000,
    startedAt: null,
    updatedAt: 1,
    finishedAt: null,
    error: null,
  };
  assert.equal(taskOrchestratorAttemptSchema.safeParse(attempt).success, true);
  assert.equal(taskOrchestratorAttemptSchema.safeParse({ ...attempt, depth: 2 }).success, false);
  assert.equal(taskOrchestratorLegacyTaskSchema.safeParse({ schemaVersion: 1, template: "software-delivery-v1" }).success, true);
});

test("new execution definitions opt into structured decisions while old v2 snapshots parse explicitly as legacy", () => {
  const definition = {
    idea: "A bounded task",
    workspaceRoot: "/tmp/task-center",
    primary: profile("primary", "primary"),
    allowedWorkers: [],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    contract,
    template: "task-center-v2",
  };
  assert.equal(
    taskOrchestratorRunDefinitionSnapshotSchema.parse(definition).executionProtocol,
    "provider-completion-v2",
  );
  assert.equal(
    taskOrchestratorRunDefinitionSnapshotSchema.parse({
      ...definition,
      executionProtocol: "structured-decisions-v1",
    }).executionProtocol,
    "structured-decisions-v1",
  );
});

test("primary decisions are bounded structured records rather than provider prose", () => {
  const decision = {
    id: "decision-1",
    attemptId: "primary-1",
    kind: "complete",
    summary: "All acceptance criteria passed.",
    nextAction: null,
    acceptanceResults: [{
      criterionIndex: 0,
      status: "passed",
      summary: "Focused tests passed.",
      evidenceArtifactIds: [],
    }],
    createdAt: 1,
  };
  assert.equal(taskOrchestratorPrimaryDecisionSchema.safeParse(decision).success, true);
  assert.equal(taskOrchestratorPrimaryDecisionSchema.safeParse({ ...decision, kind: "provider-finished" }).success, false);
  assert.equal(taskOrchestratorPrimaryDecisionSchema.safeParse({ ...decision, acceptanceResults: [{ ...decision.acceptanceResults[0], criterionIndex: 50 }] }).success, false);
});

test("overnight end conditions are bounded and receive durable defaults", () => {
  const defaults = taskOrchestratorEndConditionsSchema.parse({});
  assert.equal(defaults.maxPrimaryTurns, 24);
  assert.equal(defaults.maxWorkerConcurrency, 3);
  assert.equal(defaults.contextRolloverPercent, 80);
  assert.equal(defaults.maxElapsedMs, 86_400_000);
  assert.equal(defaults.completionAuthority, "model-recommended");
  assert.equal(taskOrchestratorEndConditionsSchema.safeParse({ maxPrimaryTurns: 101 }).success, false);
  assert.equal(taskOrchestratorEndConditionsSchema.safeParse({ contextRolloverPercent: 99 }).success, false);
});

test("full-allow is represented by a bounded expiring workspace capability", () => {
  const grant = {
    policyVersion: 1,
    id: "grant-1",
    mode: "full-allow",
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 2,
    workspaceRoot: "/tmp/task-center",
    realWorkspaceRoot: "/private/tmp/task-center",
    contractHash: "a".repeat(64),
    allowedProfileIds: ["primary", "worker-1"],
    allowedProviders: ["codex", "claude"],
    issuedAt: 10,
    expiresAt: 20,
  };
  assert.equal(taskOrchestratorPermissionGrantSchema.safeParse(grant).success, true);
  assert.equal(taskOrchestratorPermissionGrantSchema.safeParse({ ...grant, expiresAt: 10 }).success, false);
  assert.equal(taskOrchestratorPermissionGrantSchema.safeParse({ ...grant, allowedProfileIds: ["primary", "primary"] }).success, false);
});

test("desktop event contract separates Supervisor resync from task lifecycle events", () => {
  const resync = taskOrchestratorDesktopEventSchema.parse({
    type: "task-supervisor-resync",
    sequence: 4,
    supervisorEpoch: "epoch-2",
    coveredScopes: ["task-list"],
    snapshot: { tasks: [], issues: [] },
  });
  assert.equal(resync.type, "task-supervisor-resync");
  assert.equal("taskId" in resync, false);
  assert.equal(taskOrchestratorDesktopEventSchema.safeParse({ ...resync, coveredScopes: ["task-run"] }).success, false);
});
