import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonalLocalAgent } from "@/app/lib/desktop-types";
import { TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS } from "@onmyagent/types";
import type { TaskOrchestratorArtifactMetadata, TaskOrchestratorHumanGate, TaskOrchestratorOperationsDiagnostics, TaskOrchestratorSnapshot, TaskOrchestratorTurnHistoryItem } from "@onmyagent/types";

import { TaskCenterPendingGates } from "./task-center-detail-gates";
import { TaskCenterActionErrors } from "./task-center-action-errors";
import { EndConditionCard, TaskCenterCreateForm } from "./task-center-create-form";
import { TaskCenterArtifactsPanel, TaskCenterEvidencePanel } from "./task-center-detail-artifacts";
import { TaskCenterAlignmentPanel, TaskCenterExecutionPanel } from "./task-center-detail-overview-flow";
import { TaskCenterDetail } from "./task-center-detail";
import { TaskCenterRunHistoryPanel } from "./task-center-history";
import {
  TASK_CENTER_ACTIVE_POLL_MS,
  TASK_CENTER_CODEX_MODEL,
  TASK_CENTER_CLAUDE_WORKER_MODEL,
  TASK_CENTER_DRAFT_MAX_AGE_MS,
  TASK_CENTER_DRAFT_MAX_IDEA_LENGTH,
  TASK_CENTER_DRAFT_MAX_WORKERS,
  TASK_CENTER_LIST_IDLE_POLL_MS,
  buildTaskCenterCreateInput,
  clearTaskCenterDraft,
  createTaskCenterDraft,
  persistTaskCenterDraft,
  readTaskCenterDraftRecord,
  taskCenterDraftFromStoredRecord,
  taskCenterDraftRecordFromDraft,
  taskCenterDraftStorageKey,
  hydrateTaskCenterDraftFromCatalog,
  isTaskCenterDraftValid,
  latestPrimaryRetryCandidate,
  taskCenterRecoveryCandidate,
  taskCenterListPollInterval,
  taskCenterModelsForAgent,
  taskCenterEndConditionsForPreset,
  taskCenterSelectionStorageKey,
  persistTaskCenterSelection,
  readTaskCenterSelection,
  taskCenterFilterTasks,
  taskCenterQueryWithTaskId,
  taskCenterQueryWithTaskSelection,
  taskCenterRunSelectionNeedsMore,
  taskCenterRunIdFromQuery,
  taskCenterStatusTone,
  taskCenterTaskIdFromQuery,
} from "./task-center-model";

function agent(input: Partial<PersonalLocalAgent>): PersonalLocalAgent {
  return {
    id: input.id ?? "codex",
    name: input.name ?? "Codex",
    provider: input.provider ?? "codex",
    executablePath: "/usr/bin/agent",
    model: input.model ?? null,
    customArgs: [],
    modelOptions: input.modelOptions ?? [{ id: TASK_CENTER_CODEX_MODEL, label: "gpt-5.6-sol" }],
    defaultModel: input.defaultModel ?? TASK_CENTER_CODEX_MODEL,
    status: "online",
    version: "catalog-1",
    error: null,
    lastCheckedAt: 100,
    ...input,
  };
}

function draftStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function gate(): TaskOrchestratorHumanGate {
  return {
    schemaVersion: 2,
    id: "gate-1",
    kind: "personal-runtime-approval",
    status: "pending",
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    attemptId: "primary-1",
    turnId: null,
    leaseId: null,
    personalRunId: null,
    personalApprovalId: "approval-1",
    expiresAt: null,
    title: "Review requested operation",
    summary: "The agent needs permission to continue.",
    risk: "careful",
    operation: {
      method: "fs/write_file",
      kind: "file_change",
      command: null,
      cwd: "/workspace/project",
      params: [{ name: "path", value: "src/fixture.ts" }],
      diff: null,
      readOnly: false,
    },
    requestedAt: 1,
    decisionRequestedAt: null,
    resolvedAt: null,
    decision: null,
  };
}

function operationsDiagnostics(truncated = false): TaskOrchestratorOperationsDiagnostics {
  if (truncated) {
    return {
      version: 1,
      generatedAt: 1_000,
      truncated: true,
      attempt: { status: "running" },
      context: { source: "runtime" },
      provider: { requestId: null, fallbackCount: 0 },
      processes: { states: {}, pids: [] },
    } as unknown as TaskOrchestratorOperationsDiagnostics;
  }
  return {
    version: 1,
    generatedAt: 1_000,
    terminalReason: { code: "RUN_SUCCEEDED", category: "completed", message: "Task run completed." },
    attempt: { attemptId: "primary-1", status: "succeeded", leaseId: null, leaseAgeMs: 250, leaseExpiresAt: 2_000, progressAt: 900, progressAgeMs: 100 },
    context: { usedTokens: 12, totalTokens: 100, percent: 12, source: "runtime", modelId: "gpt-5.6-sol", observedAt: 900, observed: true },
    retries: { transportRetries: 1, consecutiveFailures: 0, primaryTurnsUsed: 2, workerAttemptsUsed: 1 },
    provider: { session: "session-1", effectiveModel: "gpt-5.6-sol", transport: "https", requestId: "request-1", fallbackCount: 0, observed: true },
    processes: { count: 2, active: 1, states: { running: 1, exited: 1 }, pids: [1234, 5678] },
    storage: { healthy: true, databaseBytes: 1_024, reclaimableBytes: 128, outboxCount: 1, processCount: 2, lastMaintenanceAt: 800 },
    truncated: false,
  };
}

describe("Task Center v2 creation model", () => {
  const codex = agent({ id: "codex", name: "Codex", provider: "codex" });
  const claude = agent({
    id: "claude",
    name: "Claude",
    provider: "claude",
    modelOptions: [{ id: TASK_CENTER_CLAUDE_WORKER_MODEL, label: "deepseek-v4-flash" }],
    defaultModel: TASK_CENTER_CLAUDE_WORKER_MODEL,
  });

  it("chooses live catalog defaults and model options depend on the selected agent", () => {
    const draft = createTaskCenterDraft({ agents: [codex, claude], catalogRevision: "r1" });
    assert.equal(draft.primary?.agent.id, "codex");
    assert.equal(draft.primary?.model?.id, TASK_CENTER_CODEX_MODEL);
    assert.equal(draft.workers[0]?.agent.id, "claude");
    assert.equal(draft.workers[0]?.model?.id, TASK_CENTER_CLAUDE_WORKER_MODEL);
    assert.deepEqual(taskCenterModelsForAgent(claude), [{ id: TASK_CENTER_CLAUDE_WORKER_MODEL, label: "deepseek-v4-flash" }]);
  });

  it("builds a v2 create payload with live catalog references and both modes", () => {
    const draft = createTaskCenterDraft({ agents: [codex, claude], catalogRevision: "r1" });
    draft.idea = "Deliver a local multi-agent task center";
    draft.permissionMode = "full-allow";
    draft.contractFinalization = "model-recommended-auto";
    assert.equal(isTaskCenterDraftValid(draft, "/workspace"), true);
    const input = buildTaskCenterCreateInput(draft, "/workspace", "r1");
    assert.equal(input.idea, draft.idea);
    assert.equal(input.primary.agentId, "codex");
    assert.equal(input.primary.model, TASK_CENTER_CODEX_MODEL);
    assert.equal(input.primary.catalogSource, "personal-registry");
    assert.equal(input.primary.catalogRevision, "r1");
    assert.equal(input.allowedWorkers[0]?.provider, "claude");
    assert.equal(input.permissionMode, "full-allow");
    assert.equal(input.contractFinalization, "model-recommended-auto");
    assert.deepEqual(input.endConditions, TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS);

    draft.independentCheckerMode = "independent";
    draft.checker = draft.primary;
    draft.checkerMaxRounds = 3;
    const checkedInput = buildTaskCenterCreateInput(draft, "/workspace", "r1");
    assert.equal(checkedInput.independentChecker?.mode, "independent");
    assert.equal(checkedInput.independentChecker?.maxRounds, 3);
    assert.equal(checkedInput.independentChecker?.profile?.agentId, "codex");
    assert.equal(checkedInput.independentChecker?.profile?.approvalMode, "read-only-auto");
    assert.equal(checkedInput.independentChecker?.profile?.sessionStrategy, "fresh");

    const html = renderToStaticMarkup(createElement(TaskCenterCreateForm, {
      workspaceRoot: "/workspace",
      catalog: { agents: [codex, claude], catalogRevision: "r1" },
      catalogLoading: false,
      catalogError: null,
      busy: false,
      onRefreshCatalog: () => undefined,
      onCancel: () => undefined,
      onCreate: async () => undefined,
    }));
    assert.doesNotMatch(html, /data-task-selection-card/);
    assert.doesNotMatch(html, /data-allowed-workers/);
    assert.match(html, /data-advanced-settings/);
    assert.match(html, /data-advanced-open="false"/);
    assert.match(html, /data-primary-summary/);
    assert.match(html, /Show advanced settings/);
    assert.match(html, /Start alignment/);
    assert.doesNotMatch(html, /planner|implementer|verifier/i);
  });

  it("renders the selected overnight preset as localized product copy", () => {
    const draft = createTaskCenterDraft({ agents: [codex, claude], catalogRevision: "r1" });
    const html = renderToStaticMarkup(createElement(EndConditionCard, {
      draft,
      onChange: () => undefined,
    }));
    assert.match(html, /Recommended Overnight/);
    assert.doesNotMatch(html, />recommended-overnight</);
  });

  it("renders a restored local draft status and discard action without opening advanced settings", () => {
    const storage = draftStorage();
    const draft = createTaskCenterDraft({ agents: [codex, claude], catalogRevision: "r1" });
    draft.idea = "Keep this thought after relaunch";
    assert.ok(persistTaskCenterDraft("/workspace", draft, storage));
    const html = renderToStaticMarkup(createElement(TaskCenterCreateForm, {
      workspaceRoot: "/workspace",
      catalog: { agents: [codex, claude], catalogRevision: "r1" },
      draftStorage: storage,
      catalogLoading: false,
      catalogError: null,
      busy: false,
      onRefreshCatalog: () => undefined,
      onCancel: () => undefined,
      onCreate: async () => undefined,
    }));
    assert.match(html, /data-task-center-draft-status/);
    assert.match(html, /Draft saved locally/);
    assert.match(html, /Discard draft/);
    assert.match(html, /Keep this thought after relaunch/);
    assert.match(html, /data-advanced-open="false"/);
  });

  it("preserves auto approval when the Personal catalog finishes loading", () => {
    const draft = createTaskCenterDraft(null);
    draft.idea = "Keep my choices while the catalog loads";
    draft.permissionMode = "full-allow";
    draft.contractFinalization = "model-recommended-auto";
    const hydrated = hydrateTaskCenterDraftFromCatalog(draft, {
      agents: [codex, claude],
      catalogRevision: "r2",
    });
    assert.equal(hydrated.idea, draft.idea);
    assert.equal(hydrated.permissionMode, "full-allow");
    assert.equal(hydrated.contractFinalization, "model-recommended-auto");
    assert.equal(hydrated.primary?.agent.id, "codex");
    assert.equal(hydrated.workers[0]?.agent.id, "claude");
  });

  it("does not enable create when the live catalog is empty", () => {
    const draft = createTaskCenterDraft({ agents: [], catalogRevision: null });
    draft.idea = "An idea";
    assert.equal(isTaskCenterDraftValid(draft, "/workspace"), false);
  });

  it("uses schema-aligned safe end-condition presets and supports bounded custom values", () => {
    assert.deepEqual(taskCenterEndConditionsForPreset("recommended-overnight"), TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS);
    const quick = taskCenterEndConditionsForPreset("quick");
    assert.equal(quick.maxElapsedMs, 3_600_000);
    assert.ok(quick.maxPrimaryTurns >= 1 && quick.maxPrimaryTurns <= 100);
    assert.ok(quick.contextRolloverPercent >= 50 && quick.contextRolloverPercent <= 95);
    assert.equal(taskCenterEndConditionsForPreset("custom").completionAuthority, "model-recommended");
  });

  it("persists a stable selection per workspace without requiring a shell route", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    persistTaskCenterSelection(" /workspace ", "task-1", storage);
    assert.equal(readTaskCenterSelection("/workspace", storage), "task-1");
    assert.equal(values.has(taskCenterSelectionStorageKey("/workspace")), true);
    persistTaskCenterSelection("/workspace", null, storage);
    assert.equal(readTaskCenterSelection("/workspace", storage), null);
  });

  it("autosaves a bounded, catalog-reference-only draft and rejects corrupt or stale records", () => {
    const storage = draftStorage();
    const draft = createTaskCenterDraft({ agents: [codex, claude], catalogRevision: "r1" });
    draft.idea = `  ${"x".repeat(TASK_CENTER_DRAFT_MAX_IDEA_LENGTH + 100)}  `;
    draft.workers = Array.from({ length: TASK_CENTER_DRAFT_MAX_WORKERS + 5 }, () => ({
      agent: claude,
      model: claude.modelOptions?.[0] ?? null,
    }));
    const savedAt = persistTaskCenterDraft(" /workspace ", draft, storage);
    assert.ok(savedAt);
    const serialized = storage.values.get(taskCenterDraftStorageKey("/workspace"));
    assert.ok(serialized);
    assert.doesNotMatch(serialized, /"name"|"label"|Codex|Claude/);
    const record = readTaskCenterDraftRecord("/workspace", storage);
    assert.equal(record?.idea.length, TASK_CENTER_DRAFT_MAX_IDEA_LENGTH);
    assert.equal(record?.workers.length, TASK_CENTER_DRAFT_MAX_WORKERS);

    storage.setItem(taskCenterDraftStorageKey("/workspace"), "not-json");
    assert.equal(readTaskCenterDraftRecord("/workspace", storage), null);
    assert.equal(storage.values.has(taskCenterDraftStorageKey("/workspace")), false);
    storage.setItem(taskCenterDraftStorageKey("/workspace"), JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now() - TASK_CENTER_DRAFT_MAX_AGE_MS - 1,
    }));
    assert.equal(readTaskCenterDraftRecord("/workspace", storage), null);
    assert.equal(storage.values.has(taskCenterDraftStorageKey("/workspace")), false);
  });

  it("rehydrates canonical catalog choices while preserving an explicit empty worker list", () => {
    const storage = draftStorage();
    const draft = createTaskCenterDraft({ agents: [codex, claude], catalogRevision: "r1" });
    draft.idea = "Restore this thought";
    draft.workers = [];
    const record = taskCenterDraftRecordFromDraft(draft, Date.now());
    record.primary = { agentId: "missing-agent", modelId: "untrusted-model" };
    record.workers = [{ agentId: "claude", modelId: "stale-model" }, { agentId: "offline", modelId: null }];
    storage.setItem(taskCenterDraftStorageKey("/workspace"), JSON.stringify(record));
    const restoredRecord = readTaskCenterDraftRecord("/workspace", storage);
    const restored = taskCenterDraftFromStoredRecord(restoredRecord, { agents: [codex, claude], catalogRevision: "r2" });
    assert.equal(restored.idea, "Restore this thought");
    assert.equal(restored.primary?.agent.id, "codex");
    assert.equal(restored.primary?.model?.id, TASK_CENTER_CODEX_MODEL);
    assert.deepEqual(restored.workers.map((choice) => choice.agent.id), ["claude"]);
    assert.equal(restored.workers[0]?.model?.id, TASK_CENTER_CLAUDE_WORKER_MODEL);

    clearTaskCenterDraft("/workspace", storage);
    assert.equal(storage.values.has(taskCenterDraftStorageKey("/workspace")), false);
  });

  it("filters tasks by idea/id, status, and permission without reordering", () => {
    const tasks = [
      { id: "task-alpha", idea: "Nightly docs", latestRunStatus: "running", definitionStatus: "ready", permissionMode: "restricted" },
      { id: "task-beta", idea: "Quick test", latestRunStatus: "succeeded", definitionStatus: "ready", permissionMode: "full-allow" },
    ] as unknown as Parameters<typeof taskCenterFilterTasks>[0];
    assert.deepEqual(taskCenterFilterTasks(tasks, { search: "ALPHA", status: "all", permissionMode: "all" }).map((task) => task.id), ["task-alpha"]);
    assert.deepEqual(taskCenterFilterTasks(tasks, { search: "", status: "succeeded", permissionMode: "full-allow" }).map((task) => task.id), ["task-beta"]);
    assert.deepEqual(taskCenterFilterTasks(tasks, { search: "", status: "all", permissionMode: "restricted" }).map((task) => task.id), ["task-alpha"]);
  });

  it("round-trips task and run query selection for durable history", () => {
    assert.equal(taskCenterTaskIdFromQuery("?workspace=%2Ftmp&taskId=task-2"), "task-2");
    assert.equal(taskCenterRunIdFromQuery("?taskId=task-2&runId=run-2"), "run-2");
    assert.equal(taskCenterQueryWithTaskId("?workspace=%2Ftmp&taskId=old", "task-3"), "?workspace=%2Ftmp&taskId=task-3");
    assert.equal(taskCenterQueryWithTaskId("?taskId=old", null), "");
    assert.equal(taskCenterQueryWithTaskSelection("?taskId=old&runId=old-run", "task-3", "run-3"), "?taskId=task-3&runId=run-3");
  });

  it("keeps a deep-linked historical run selected while more run pages remain", () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: `run-${index + 1}` }));
    assert.equal(taskCenterRunSelectionNeedsMore({
      selectedRunId: "run-51",
      runs: firstPage,
      hasNextPage: true,
      isFetchingNextPage: false,
    }), true);
    assert.equal(taskCenterRunSelectionNeedsMore({
      selectedRunId: "run-51",
      runs: firstPage,
      hasNextPage: true,
      isFetchingNextPage: true,
    }), false);
    assert.equal(taskCenterRunSelectionNeedsMore({
      selectedRunId: "run-51",
      runs: [...firstPage, { id: "run-51" }],
      hasNextPage: true,
      isFetchingNextPage: false,
    }), false);
    assert.equal(taskCenterRunSelectionNeedsMore({
      selectedRunId: "run-51",
      runs: firstPage,
      hasNextPage: false,
      isFetchingNextPage: false,
    }), false);
  });

  it("maps durable overnight statuses to distinct translated badge tones", () => {
    assert.equal(taskCenterStatusTone("checkpointing"), "accent");
    assert.equal(taskCenterStatusTone("pausing"), "warning");
    assert.equal(taskCenterStatusTone("backoff"), "warning");
    assert.equal(taskCenterStatusTone("paused"), "surface");
  });

  it("uses event-driven updates with a bounded polling watchdog", () => {
    assert.equal(TASK_CENTER_LIST_IDLE_POLL_MS, 30_000);
    assert.equal(TASK_CENTER_ACTIVE_POLL_MS, 5_000);
    assert.equal(taskCenterListPollInterval(undefined), TASK_CENTER_LIST_IDLE_POLL_MS);
    assert.equal(taskCenterListPollInterval({ issues: [], tasks: [{
      id: "task-1", revision: 1, idea: "Idea", workspaceRoot: "/workspace",
      definitionStatus: "ready", permissionMode: "restricted", contractFinalization: "manual-confirm",
      latestRunId: "run-1", latestRunStatus: "running", currentActor: "primary", updatedAt: 1,
      currentTurn: 1, pauseReason: null, resumeEligible: false,
    }] }), TASK_CENTER_ACTIVE_POLL_MS);
  });

  it("only exposes the latest failed primary attempt as a retry candidate", () => {
    const run = {
      status: "failed",
      primaryAttempts: [
        { id: "primary-1", kind: "primary", status: "failed" },
        { id: "primary-2", kind: "primary", status: "failed" },
      ],
    } as unknown as NonNullable<Parameters<typeof latestPrimaryRetryCandidate>[0]>;
    assert.equal(latestPrimaryRetryCandidate(run)?.id, "primary-2");
    assert.equal(latestPrimaryRetryCandidate({ ...run, primaryAttempts: [...run.primaryAttempts, run.primaryAttempts[0]!] }), null);
  });

  it("allows retry after a rejected manual completion review", () => {
    const run = {
      status: "blocked",
      error: "Completion review rejected: acceptance evidence needs another pass.",
      primaryAttempts: [{ id: "primary-1", kind: "primary", status: "succeeded" }],
    } as unknown as NonNullable<Parameters<typeof latestPrimaryRetryCandidate>[0]>;
    assert.equal(latestPrimaryRetryCandidate(run)?.id, "primary-1");
  });

  it("offers recovery only for a desktop-interrupted run with a blocked current worker", () => {
    const run = {
      status: "blocked",
      error: "Desktop restarted during an active primary/worker attempt; the run was blocked and was not replayed.",
      primaryAttempts: [{ id: "primary-1", kind: "primary", status: "succeeded" }],
      workerAttempts: [{ id: "worker-1", kind: "worker", status: "blocked", leaseId: null }],
      currentAttemptId: "worker-1",
    } as unknown as NonNullable<Parameters<typeof taskCenterRecoveryCandidate>[0]>;
    assert.equal(taskCenterRecoveryCandidate(run)?.id, "worker-1");
    assert.equal(taskCenterRecoveryCandidate({ ...run, error: "A provider blocked this run." }), null);
    assert.equal(taskCenterRecoveryCandidate({ ...run, primaryAttempts: [{ ...run.primaryAttempts[0]!, id: "primary-1" }, { ...run.primaryAttempts[0]!, id: "primary-2" }, { ...run.primaryAttempts[0]!, id: "primary-3" }] }), null);
  });
});

describe("Task Center v2 rendering and gates", () => {
  it("renders nested worker attempts under a primary owner", () => {
    const snapshot = {
      task: { idea: "Implement nested delegation", permissionMode: "restricted" },
      run: {
        status: "succeeded",
        definition: {
          primary: { id: "primary", label: "Codex", modelLabel: "gpt-5.6-sol", model: "gpt-5.6-sol" },
          allowedWorkers: [{ id: "worker-1", label: "Claude", modelLabel: "deepseek-v4-flash", model: "deepseek-v4-flash" }],
        },
        primaryAttempts: [{ id: "primary-1", kind: "primary", status: "succeeded", profileId: "primary", prompt: "Plan", outputArtifactIds: [], error: null }],
        workerAttempts: [{ id: "worker-1", kind: "worker", status: "succeeded", profileId: "worker-1", prompt: "Inspect", outputArtifactIds: ["artifact-1"], error: null }],
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, { snapshot }));
    assert.match(html, /data-task-center-execution/);
    assert.match(html, /data-worker-timeline/);
    assert.match(html, /data-attempt-kind="worker"/);
    assert.match(html, /artifact-1/);
  });

  it("renders persisted operations diagnostics without exposing raw logs or paths", () => {
    const snapshot = {
      task: { idea: "Inspect diagnostics", permissionMode: "restricted" },
      run: {
        id: "run-1",
        status: "succeeded",
        definition: { primary: { id: "primary", label: "Codex", model: "gpt-5.6-sol" }, allowedWorkers: [] },
        primaryAttempts: [],
        workerAttempts: [],
        checkerAttempts: [],
        checkerVerdicts: [],
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, {
      snapshot,
      operationsDiagnostics: operationsDiagnostics(),
    }));
    assert.match(html, /data-task-center-operations-diagnostics/);
    assert.match(html, /data-task-center-operations-diagnostics-state="full"/);
    assert.match(html, /RUN_SUCCEEDED/);
    assert.match(html, /request-1/);
    assert.match(html, /session-1/);
    assert.match(html, /1234, 5678/);
    assert.match(html, /1,024/);
    assert.doesNotMatch(html, /raw logs|\/workspace\/project|src\/fixture/);
  });

  it("renders bounded minimal diagnostics and explicit unavailable values", () => {
    const snapshot = {
      task: { idea: "Inspect partial diagnostics", permissionMode: "restricted" },
      run: {
        id: "run-1",
        status: "running",
        definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] },
        primaryAttempts: [],
        workerAttempts: [],
        checkerAttempts: [],
        checkerVerdicts: [],
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, {
      snapshot,
      operationsDiagnostics: operationsDiagnostics(true),
    }));
    assert.match(html, /data-task-center-operations-diagnostics-state="truncated"/);
    assert.match(html, /data-task-center-operations-diagnostics-truncated/);
    assert.match(html, /Not available/);
  });

  it("keeps diagnostics errors independently retryable", () => {
    const snapshot = {
      task: { idea: "Retry diagnostics", permissionMode: "restricted" },
      run: {
        id: "run-1",
        status: "succeeded",
        definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] },
        primaryAttempts: [],
        workerAttempts: [],
        checkerAttempts: [],
        checkerVerdicts: [],
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, {
      snapshot,
      operationsDiagnosticsError: new Error("diagnostics unavailable"),
      onRetryOperationsDiagnostics: () => undefined,
    }));
    assert.match(html, /data-task-center-operations-diagnostics-error/);
    assert.match(html, /data-task-center-operations-diagnostics-retry/);
    assert.match(html, /diagnostics unavailable/);
  });

  it("renders the optional independent checker result without a fixed role pipeline", () => {
    const snapshot = {
      task: { idea: "Check acceptance", permissionMode: "restricted" },
      run: {
        status: "succeeded",
        definition: {
          primary: { id: "primary", label: "Codex", model: "model" },
          allowedWorkers: [],
          independentChecker: { mode: "independent", maxRounds: 2, profile: { id: "checker-codex", label: "Independent checker", agentId: "codex" } },
        },
        primaryAttempts: [],
        workerAttempts: [],
        checkerAttempts: [{ id: "checker-1", profileId: "checker-codex", status: "succeeded", error: null }],
        checkerVerdicts: [{ id: "verdict-1", verdict: "approve", summary: "All criteria verified", criterionResults: [] }],
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, { snapshot }));
    assert.match(html, /data-independent-checker-status/);
    assert.match(html, /Independent checker/);
    assert.match(html, /All criteria verified/);
    assert.doesNotMatch(html, /planner|implementer|verifier/i);
  });

  it("renders immutable history plus expandable, copyable artifact evidence", () => {
    const snapshot = {
      task: { idea: "Inspect artifacts", permissionMode: "restricted" },
      run: {
        id: "run-1",
        status: "succeeded",
        definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] },
        primaryAttempts: [{ id: "primary-1", kind: "primary", status: "succeeded", profileId: "primary", prompt: "Plan", outputArtifactIds: ["artifact-1"], error: null, updatedAt: 200 }],
        workerAttempts: [],
        turns: [{ id: "turn-1", sequence: 1, status: "succeeded", reason: "initial", workerAttemptIds: [], updatedAt: 200, startedAt: 100, finishedAt: 200 }],
      },
      events: [],
      artifacts: [{ id: "artifact-1", summary: "Result", kind: "primary", content: "complete artifact content", evidence: [{ kind: "test", provenance: "runtime-observed", label: "Focused test", value: "24 passed", status: "passed", path: null, exitCode: 0 }] }],
      gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const executionHtml = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, { snapshot }));
    assert.match(executionHtml, /data-task-center-history/);
    assert.match(executionHtml, /Attempt history/);
    assert.match(executionHtml, /Turn history/);
    const artifactHtml = renderToStaticMarkup(createElement(TaskCenterArtifactsPanel, { snapshot }));
    assert.match(artifactHtml, /Show full content/);
    assert.match(artifactHtml, /Copy content/);
    assert.match(artifactHtml, /complete artifact content/);
    const evidenceHtml = renderToStaticMarkup(createElement(TaskCenterEvidencePanel, { snapshot }));
    assert.match(evidenceHtml, /24 passed/);
    assert.match(evidenceHtml, /Copy content/);
  });

  it("renders server-backed immutable primary, worker, checker, decision, checkpoint, and capsule history", () => {
    const item = {
      historyVersion: 1,
      taskId: "task-1",
      taskRunId: "run-old",
      turn: {
        id: "turn-1",
        sequence: 1,
        status: "succeeded",
        reason: "initial",
        primaryAttemptId: "primary-1",
        workerAttemptIds: ["worker-1"],
        decisionId: "decision-1",
        checkpointId: "checkpoint-1",
        capsuleId: "capsule-1",
        context: { percent: 42, inputTokens: 10, outputTokens: 20, totalTokens: 30, windowTokens: 100, observedAt: 200 },
        startedAt: 100,
        updatedAt: 200,
        finishedAt: 200,
      },
      primaryAttempt: {
        id: "primary-1", kind: "primary", profileId: "codex", parentAttemptId: null, turnId: "turn-1", depth: 0,
        status: "succeeded", leaseId: null, personalRunId: "personal-1", conversationId: "conversation-1",
        providerDiagnostics: { providerSessionId: "session-1", effectiveModel: "gpt-5.6-sol", transport: "https", connectionMode: "websocket" },
        providerUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costMicros: 4, observedAt: 200 },
        outputArtifactIds: ["artifact-1"], timeoutMs: 60_000, startedAt: 100, updatedAt: 200, finishedAt: 200, error: null,
      },
      workerAttempts: [{
        id: "worker-1", kind: "worker", profileId: "claude", parentAttemptId: "primary-1", turnId: "turn-1", depth: 1,
        status: "succeeded", leaseId: null, personalRunId: null, conversationId: null, providerDiagnostics: null, providerUsage: null,
        outputArtifactIds: [], timeoutMs: 60_000, startedAt: 110, updatedAt: 190, finishedAt: 190, error: null,
      }],
      checkerAttempts: [{
        id: "checker-1", profileId: "codex", turnId: "turn-1", primaryDecisionId: "decision-1", round: 1, status: "succeeded", leaseId: null,
        personalRunId: "checker-run-1", conversationId: "checker-conversation-1", providerDiagnostics: null, providerUsage: null,
        outputArtifactIds: [], timeoutMs: 60_000, startedAt: 205, updatedAt: 220, finishedAt: 220, error: null,
      }],
      decision: { id: "decision-1", attemptId: "primary-1", turnId: "turn-1", kind: "complete", summary: "All criteria passed", nextAction: null, acceptanceResults: [{ criterionIndex: 0, status: "passed", summary: "Tests passed", evidenceArtifactIds: ["artifact-1"] }], createdAt: 200 },
      checkpoint: { id: "checkpoint-1", turnId: "turn-1", capsuleId: "capsule-1", trigger: "primary-decision", createdAt: 201 },
      capsule: {
        capsuleVersion: 1, id: "capsule-1", fromTurnId: "turn-1", taskId: "task-1", taskRunId: "run-old", taskRevision: 1,
        contractHash: null, workspaceRootHash: null, summary: "Continue from durable checkpoint", completed: ["Tests"], pending: ["Review"], risks: [], artifactIds: ["artifact-1"],
        workspaceEvidence: [], acceptanceResults: [], workerMail: [], remainingBudget: null, unresolvedSideEffects: [], nextAction: "Review", lastDecisionId: "decision-1", context: null, createdAt: 202,
        truncation: { truncated: true, textFieldsTruncated: 1, omitted: { completed: 0, pending: 1, risks: 0, artifactIds: 0, workspaceEvidence: 0, acceptanceResults: 0, workerMail: 0, unresolvedSideEffects: 0 } },
      },
    } as unknown as TaskOrchestratorTurnHistoryItem;
    const html = renderToStaticMarkup(createElement(TaskCenterRunHistoryPanel, {
      run: { id: "run-old", budget: { elapsedMs: 120_000 } } as never,
      items: [item],
      hasMore: true,
      loading: false,
      onLoadMore: () => undefined,
    }));
    assert.match(html, /data-task-center-immutable-history/);
    assert.match(html, /data-history-immutable-turn="turn-1"/);
    assert.match(html, /data-history-primary/);
    assert.match(html, /data-history-workers/);
    assert.match(html, /data-history-immutable-checker="checker-1"/);
    assert.match(html, /data-history-decision="decision-1"/);
    assert.match(html, /data-history-checkpoint="checkpoint-1"/);
    assert.match(html, /data-history-capsule="capsule-1"/);
    assert.match(html, /data-history-truncation/);
    assert.match(html, /Load more turns/);
    assert.match(html, /gpt-5.6-sol/);
  });

  it("renders server-page controls and on-demand loaders for metadata-only artifacts", () => {
    const snapshot = {
      task: { idea: "Load history pages", workspaceRoot: "/workspace", permissionMode: "restricted" },
      run: { id: "run-1", status: "succeeded", definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] }, primaryAttempts: [], workerAttempts: [] },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const metadata = [{
      schemaVersion: 2,
      id: "artifact-2",
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      attemptId: "primary-1",
      turnId: null,
      kind: "primary",
      summary: "Paged result",
      evidenceCount: 1,
      contentBytes: 12,
      contentSha256: "0".repeat(64),
      createdAt: 200,
    }] as unknown as TaskOrchestratorArtifactMetadata[];
    const artifactHtml = renderToStaticMarkup(createElement(TaskCenterArtifactsPanel, {
      snapshot,
      artifactMetadata: metadata,
      artifactsHasMore: true,
      onLoadMoreArtifacts: () => undefined,
      onLoadArtifact: async () => ({}) as never,
    }));
    assert.match(artifactHtml, /Load full content/);
    assert.match(artifactHtml, /Load more/);
    const evidenceHtml = renderToStaticMarkup(createElement(TaskCenterEvidencePanel, {
      snapshot,
      artifactMetadata: metadata,
      artifactsHasMore: true,
      onLoadMoreArtifacts: () => undefined,
      onLoadArtifact: async () => ({}) as never,
    }));
    assert.match(evidenceHtml, /Load evidence/);
    assert.match(evidenceHtml, /Load more/);
  });

  it("merges a newly pushed snapshot artifact with an older metadata page", () => {
    const snapshot = {
      task: { idea: "Live artifacts", workspaceRoot: "/workspace", permissionMode: "restricted" },
      run: { id: "run-1", status: "running", definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] }, primaryAttempts: [], workerAttempts: [] },
      events: [],
      artifacts: [{
        id: "artifact-new",
        summary: "Newest pushed result",
        kind: "primary",
        content: "new content",
        evidence: [],
        createdAt: 300,
      }],
      gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const metadata = [{
      schemaVersion: 2,
      id: "artifact-old",
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      attemptId: "primary-1",
      turnId: null,
      kind: "primary",
      summary: "Older paged result",
      evidenceCount: 0,
      contentBytes: 12,
      contentSha256: "0".repeat(64),
      createdAt: 200,
    }] as unknown as TaskOrchestratorArtifactMetadata[];
    const html = renderToStaticMarkup(createElement(TaskCenterArtifactsPanel, {
      snapshot,
      artifactMetadata: metadata,
      onLoadArtifact: async () => ({}) as never,
    }));
    assert.match(html, /Newest pushed result/);
    assert.match(html, /Older paged result/);
    assert.ok(html.indexOf("Newest pushed result") < html.indexOf("Older paged result"));
  });

  it("forces cursor evidence loading when the snapshot only contains a preview", () => {
    const snapshot = {
      task: { idea: "Preview evidence", workspaceRoot: "/workspace", permissionMode: "restricted" },
      run: null,
      events: [],
      artifacts: [{
        id: "artifact-preview",
        summary: "Preview result",
        kind: "primary",
        content: "artifact content",
        evidence: [{ kind: "test", provenance: "runtime-observed", label: "Preview check", value: "1 passed", status: "passed", path: null, exitCode: 0 }],
      }],
      gates: [],
      truncation: {
        truncated: true,
        omitted: { artifactEvidence: 2 },
        artifactContentTruncatedIds: [],
      },
    } as unknown as TaskOrchestratorSnapshot;
    const metadata = [{
      schemaVersion: 2,
      id: "artifact-preview",
      taskId: "task-1",
      taskRunId: null,
      taskRevision: 1,
      attemptId: null,
      turnId: null,
      kind: "primary",
      summary: "Preview result",
      evidenceCount: 3,
      contentBytes: 16,
      contentSha256: "0".repeat(64),
      createdAt: 1,
    }] as unknown as TaskOrchestratorArtifactMetadata[];
    const html = renderToStaticMarkup(createElement(TaskCenterEvidencePanel, {
      snapshot,
      artifactMetadata: metadata,
      onLoadArtifact: async () => ({}) as never,
    }));
    assert.match(html, /Preview check/);
    assert.match(html, /Load evidence/);
    assert.match(html, /3 evidence items/);
  });

  it("surfaces artifact metadata errors with an explicit retry control", () => {
    const snapshot = {
      task: { idea: "Unavailable history", workspaceRoot: "/workspace", permissionMode: "restricted" },
      run: null,
      events: [],
      artifacts: [],
      gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterArtifactsPanel, {
      snapshot,
      artifactsError: new Error("history unavailable"),
      onRetryArtifacts: () => undefined,
    }));
    assert.match(html, /data-task-center-artifacts-error/);
    assert.match(html, /data-task-center-artifacts-retry/);
    assert.match(html, /Artifact history could not be loaded/);
  });

  it("keeps archived task history read-only while retaining restore", () => {
    const snapshot = {
      task: {
        id: "task-archived",
        revision: 4,
        idea: "Archived task",
        workspaceRoot: "/workspace",
        definitionStatus: "archived",
        permissionMode: "restricted",
        contractFinalization: "manual-confirm",
        endConditions: TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS,
        alignment: { status: "completed", messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
      },
      run: {
        id: "run-archived",
        status: "failed",
        error: "provider failed",
        currentAttemptId: null,
        primaryAttemptId: "primary-1",
        primaryAttempts: [{ id: "primary-1", kind: "primary", status: "failed", profileId: "primary", prompt: "", outputArtifactIds: [], error: "provider failed" }],
        workerAttempts: [],
        definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] },
      },
      events: [],
      artifacts: [],
      gates: [gate()],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterDetail, {
      snapshot,
      busy: false,
      onAlignmentMessage: () => undefined,
      onAlignmentCancel: () => undefined,
      onFinalize: () => undefined,
      onStart: () => undefined,
      onStop: () => undefined,
      onPause: () => undefined,
      onResume: () => undefined,
      onUpdateEndConditions: () => undefined,
      onRetry: () => undefined,
      onRecovery: () => undefined,
      onResolveGate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
    }));
    assert.match(html, /data-task-center-restore-cta/);
    assert.match(html, /data-task-center-read-only/);
    assert.doesNotMatch(html, /data-task-center-archive-cta/);
    assert.doesNotMatch(html, /data-task-center-recovery-cta/);
    assert.doesNotMatch(html, /data-task-center-pending-gates/);
    assert.doesNotMatch(html, /data-edit-end-conditions/);
  });

  it("renders turn, budget, timeout, checkpoint, and fresh-session capsule observability", () => {
    const snapshot = {
      task: { idea: "Observe an overnight run", permissionMode: "restricted" },
      run: {
        status: "checkpointing",
        definition: {
          endConditions: {
            ...TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS,
            contextRolloverPercent: 80,
          },
          primary: { id: "primary", label: "Codex", modelLabel: "gpt-5.6-sol", model: "gpt-5.6-sol" },
          allowedWorkers: [],
        },
        turns: [{ id: "turn-2", sequence: 2, status: "checkpointing", reason: "context-rollover", context: { percent: 82 }, startedAt: 100, updatedAt: 200 }],
        currentTurnId: "turn-2",
        budget: { primaryTurnsUsed: 2, workerAttemptsUsed: 4, consecutiveFailures: 1, transportRetries: 2, tokensUsed: 12_000, costMicrosUsed: 30, elapsedMs: 90_000, updatedAt: 200 },
        checkpoints: [{ id: "checkpoint-1", turnId: "turn-2", capsuleId: "capsule-1", trigger: "context-threshold", createdAt: 200 }],
        continuationCapsules: [{ id: "capsule-1", fromTurnId: "turn-2", summary: "Continue from durable state", completed: ["checkpoint"], pending: ["verification"], risks: [], artifactIds: [], createdAt: 200 }],
        primaryAttempts: [{ id: "primary-1", kind: "primary", status: "running", profileId: "primary", prompt: "Plan", outputArtifactIds: [], error: null, updatedAt: 200, providerDiagnostics: { providerSessionId: "session-redacted-1", effectiveModel: "gpt-5.6-sol[medium]", transport: "stdio", connectionMode: "ACP" } }],
        workerAttempts: [],
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterExecutionPanel, { snapshot }));
    assert.match(html, /data-task-center-observability/);
    assert.match(html, /Turn 2/);
    assert.match(html, /Context threshold/);
    assert.match(html, /fresh agent session/);
    assert.match(html, /82%/);
    assert.match(html, /data-provider-diagnostics="primary-1"/);
    assert.match(html, /gpt-5.6-sol\[medium\]/);
    assert.match(html, /session-redacted-1/);
  });

  it("surfaces cancellable alignment progress and preserves provider errors", () => {
    const snapshot = {
      task: {
        idea: "Align a task",
        alignment: { status: "running", startedAt: 100, finishedAt: null, error: null, messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
      },
      run: null, events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterAlignmentPanel, {
      snapshot,
      busy: false,
      cancelBusy: false,
      onSend: () => undefined,
      onCancel: () => undefined,
      onFinalize: () => undefined,
    }));
    assert.match(html, /data-alignment-running/);
    assert.match(html, /Cancel alignment/);
  });

  it("keeps restricted approval operation details visible", () => {
    const html = renderToStaticMarkup(createElement(TaskCenterPendingGates, { gates: [gate()], busy: false, onResolve: () => undefined }));
    assert.match(html, /data-risk="careful"/);
    assert.match(html, /src\/fixture\.ts/);
    assert.match(html, />Approve once</);
    assert.match(html, />Reject</);
  });

  it("shows finite gate expiry and terminal gate audit rows while retaining no-expiry semantics", () => {
    const expiring = { ...gate(), id: "gate-expiring", expiresAt: Date.now() + 60_000 };
    const expired = { ...gate(), id: "gate-expired", expiresAt: Date.now() - 60_000 };
    const cancelled = { ...gate(), id: "gate-cancelled", status: "cancelled" as const, resolvedAt: Date.now() };
    const noExpiry = gate();
    const html = renderToStaticMarkup(createElement(TaskCenterPendingGates, {
      gates: [expiring, expired, cancelled, noExpiry],
      busy: false,
      onResolve: () => undefined,
    }));
    assert.match(html, /data-task-center-gate="gate-expiring"/);
    assert.match(html, /data-task-center-gate-expiry="gate-expiring"/);
    assert.match(html, /Approval expires in/);
    assert.match(html, /data-task-center-gate-expiry="gate-expired"/);
    assert.match(html, /Approval expired at/);
    assert.match(html, /data-task-center-gate-audit/);
    assert.match(html, /data-task-center-gate-status="cancelled"/);
    assert.match(html, /No approval expiry was provided/);
  });

  it("renders an actionable localized recovery CTA and notice", () => {
    const snapshot = {
      task: {
        idea: "Recover an interrupted task",
        workspaceRoot: "/workspace",
        definitionStatus: "ready",
        permissionMode: "restricted",
        alignment: { messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
      },
      run: {
        status: "blocked",
        error: "Desktop restarted during an active primary/worker attempt; the run was blocked and was not replayed.",
        currentAttemptId: "worker-1",
        primaryAttemptId: "primary-1",
        primaryAttempts: [{ id: "primary-1", kind: "primary", status: "succeeded", profileId: "primary", prompt: "", outputArtifactIds: [], error: null }],
        workerAttempts: [{ id: "worker-1", kind: "worker", status: "blocked", profileId: "worker-1", prompt: "worker", outputArtifactIds: [], error: null, leaseId: null }],
        definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [{ id: "worker-1", label: "Claude", model: "model" }] },
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterDetail, {
      snapshot,
      busy: false,
      onAlignmentMessage: () => undefined,
      onAlignmentCancel: () => undefined,
      onFinalize: () => undefined,
      onStart: () => undefined,
      onStop: () => undefined,
      onPause: () => undefined,
      onResume: () => undefined,
      onUpdateEndConditions: () => undefined,
      onRetry: () => undefined,
      onRecovery: () => undefined,
      onResolveGate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
    }));
    assert.match(html, /data-task-center-recovery-cta/);
    assert.match(html, /Continue safely/);
    assert.match(html, /Previous attempts and artifacts are preserved/);
    assert.doesNotMatch(html, /the run was blocked and was not replayed/i);
  });

  it("renders resume only for a durable paused run", () => {
    const snapshot = {
      task: {
        idea: "Resume an overnight task",
        workspaceRoot: "/workspace",
        definitionStatus: "ready",
        permissionMode: "restricted",
        contractFinalization: "manual-confirm",
        endConditions: TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS,
        alignment: { messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
      },
      run: {
        status: "paused",
        error: null,
        pause: { reason: "user", requestedAt: 100, pausedAt: 200, checkpointId: "checkpoint-1", resumeEligible: true },
        currentAttemptId: null,
        primaryAttemptId: "primary-1",
        primaryAttempts: [{ id: "primary-1", kind: "primary", status: "cancelled", profileId: "primary", prompt: "", outputArtifactIds: [], error: null }],
        workerAttempts: [],
        definition: { primary: { id: "primary", label: "Codex", model: "model" }, allowedWorkers: [] },
      },
      events: [], artifacts: [], gates: [],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterDetail, {
      snapshot,
      busy: false,
      onAlignmentMessage: () => undefined,
      onAlignmentCancel: () => undefined,
      onFinalize: () => undefined,
      onStart: () => undefined,
      onStop: () => undefined,
      onPause: () => undefined,
      onResume: () => undefined,
      onUpdateEndConditions: () => undefined,
      onRetry: () => undefined,
      onRecovery: () => undefined,
      onResolveGate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
    }));
    assert.match(html, />Resume</);
    assert.match(html, /requested by you/);
    assert.match(html, /can resume safely/);
  });

  it("keeps manual completion review gates visible in full-allow mode", () => {
    const manualReviewGate = { ...gate(), kind: "manual-review" } as TaskOrchestratorHumanGate;
    const snapshot = {
      task: {
        idea: "Review completion",
        workspaceRoot: "/workspace",
        definitionStatus: "ready",
        permissionMode: "full-allow",
        contractFinalization: "manual-confirm",
        endConditions: { ...TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS, completionAuthority: "user-confirm" },
        alignment: { messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
      },
      run: null,
      events: [], artifacts: [], gates: [manualReviewGate],
    } as unknown as TaskOrchestratorSnapshot;
    const html = renderToStaticMarkup(createElement(TaskCenterDetail, {
      snapshot,
      busy: false,
      onAlignmentMessage: () => undefined,
      onAlignmentCancel: () => undefined,
      onFinalize: () => undefined,
      onStart: () => undefined,
      onStop: () => undefined,
      onPause: () => undefined,
      onResume: () => undefined,
      onUpdateEndConditions: () => undefined,
      onRetry: () => undefined,
      onRecovery: () => undefined,
      onResolveGate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
    }));
    assert.match(html, /Review requested operation/);
  });

  it("renders independent retry and dismiss controls for an action error", () => {
    const html = renderToStaticMarkup(createElement(TaskCenterActionErrors, {
      errors: { start: new Error("The run is already active") },
      pending: { create: false, alignment: false, alignmentCancel: false, finalize: false, update: false, start: false, stop: false, pause: false, resume: false, retry: false, recovery: false, gate: false, archive: false, restore: false },
      onRetry: () => undefined,
      onDismiss: () => undefined,
    }));
    assert.match(html, /data-task-center-action-error="start"/);
    assert.match(html, /Retry/);
    assert.match(html, /Dismiss error/);
    assert.match(html, /already active/);
  });

  it("does not expose stale mutation retries for an archived task", () => {
    const html = renderToStaticMarkup(createElement(TaskCenterActionErrors, {
      errors: { archive: new Error("archive failed"), restore: new Error("restore failed") },
      pending: { create: false, alignment: false, alignmentCancel: false, finalize: false, update: false, start: false, stop: false, pause: false, resume: false, retry: false, recovery: false, gate: false, archive: false, restore: false },
      readOnly: true,
      onRetry: () => undefined,
      onDismiss: () => undefined,
    }));
    assert.doesNotMatch(html, /data-task-center-action-error="archive"/);
    assert.match(html, /data-task-center-action-error="restore"/);
  });
});
