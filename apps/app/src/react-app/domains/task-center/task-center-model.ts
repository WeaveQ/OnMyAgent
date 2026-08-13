import type {
  PersonalLocalAgent,
  PersonalLocalAgentModelOption,
} from "@/app/lib/desktop-types";
import {
  TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS,
} from "@onmyagent/types";
import type {
  TaskOrchestratorAgentSelection,
  TaskOrchestratorActorKind,
  TaskOrchestratorApprovalRisk,
  TaskOrchestratorAttempt,
  TaskOrchestratorCheckerProfile,
  TaskOrchestratorContract,
  TaskOrchestratorContinuationCapsule,
  TaskOrchestratorEndConditions,
  TaskOrchestratorEvent,
  TaskOrchestratorCheckpoint,
  TaskOrchestratorCheckpointTrigger,
  TaskOrchestratorEvidence,
  TaskOrchestratorHandoffArtifact,
  TaskOrchestratorHumanGate,
  TaskOrchestratorPauseReason,
  TaskOrchestratorPrimaryDecisionKind,
  TaskOrchestratorRun,
  TaskOrchestratorSnapshot,
  TaskOrchestratorTaskCreateInput,
  TaskOrchestratorTaskListResult,
  TaskOrchestratorContractFinalization,
  TaskOrchestratorPermissionMode,
  TaskOrchestratorTurn,
  TaskOrchestratorTurnReason,
} from "@onmyagent/types";

// Supervisor events/outbox are the realtime source. Polling is only a
// watchdog for missed events, renderer sleep/wake, and reconnect recovery.
export const TASK_CENTER_LIST_IDLE_POLL_MS = 30_000;
export const TASK_CENTER_ACTIVE_POLL_MS = 5_000;
export const TASK_CENTER_CODEX_MODEL = "gpt-5.6-sol";
export const TASK_CENTER_CLAUDE_WORKER_MODEL = "deepseek-v4-flash";

export type TaskCenterEndConditionPreset = "recommended-overnight" | "quick" | "custom";

const QUICK_END_CONDITIONS: TaskOrchestratorEndConditions = {
  ...TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS,
  maxElapsedMs: 3_600_000,
  maxPrimaryTurns: 8,
  maxWorkerAttempts: 20,
  maxWorkerConcurrency: 2,
  maxConsecutiveFailures: 2,
  contextRolloverPercent: 75,
  stallTimeoutMs: 300_000,
  maxTurnRuntimeMs: 1_800_000,
  maxTransportRetries: 2,
};

export const TASK_CENTER_END_CONDITION_PRESETS: Record<
  Exclude<TaskCenterEndConditionPreset, "custom">,
  TaskOrchestratorEndConditions
> = {
  "recommended-overnight": { ...TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS },
  quick: QUICK_END_CONDITIONS,
};

export function taskCenterEndConditionsForPreset(
  preset: TaskCenterEndConditionPreset,
): TaskOrchestratorEndConditions {
  if (preset === "custom") return { ...TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS };
  return { ...TASK_CENTER_END_CONDITION_PRESETS[preset] };
}

export function taskCenterEndConditionPresetFor(
  conditions: TaskOrchestratorEndConditions,
): TaskCenterEndConditionPreset {
  if (Object.entries(TASK_CENTER_END_CONDITION_PRESETS).some(([, preset]) =>
    Object.entries(preset).every(([key, value]) => conditions[key as keyof TaskOrchestratorEndConditions] === value)
  )) {
    return conditions.maxElapsedMs === TASK_CENTER_END_CONDITION_PRESETS.quick.maxElapsedMs
      ? "quick"
      : "recommended-overnight";
  }
  return "custom";
}

const TASK_CENTER_SELECTION_STORAGE_PREFIX = "onmyagent:task-center:selected:";
const TASK_CENTER_DRAFT_STORAGE_PREFIX = "onmyagent:task-center:draft:";
export const TASK_CENTER_DRAFT_SCHEMA_VERSION = 1 as const;
export const TASK_CENTER_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const TASK_CENTER_DRAFT_MAX_IDEA_LENGTH = 24_000;
export const TASK_CENTER_DRAFT_MAX_WORKERS = 20;
const TASK_CENTER_DRAFT_MAX_ID_LENGTH = 240;
const TASK_CENTER_DRAFT_MAX_SERIALIZED_BYTES = 64_000;

export function taskCenterSelectionStorageKey(workspaceRoot: string): string {
  return `${TASK_CENTER_SELECTION_STORAGE_PREFIX}${encodeURIComponent(workspaceRoot.trim())}`;
}

export function taskCenterDraftStorageKey(workspaceRoot: string): string {
  return `${TASK_CENTER_DRAFT_STORAGE_PREFIX}${encodeURIComponent(workspaceRoot.trim())}`;
}

type TaskCenterSelectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type TaskCenterDraftStorage = TaskCenterSelectionStorage;

function browserTaskCenterSelectionStorage(): TaskCenterSelectionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function browserTaskCenterDraftStorage(): TaskCenterDraftStorage | null {
  return browserTaskCenterSelectionStorage();
}

export function readTaskCenterSelection(
  workspaceRoot: string,
  storage: TaskCenterSelectionStorage | null = browserTaskCenterSelectionStorage(),
): string | null {
  if (!workspaceRoot.trim() || !storage) return null;
  const value = storage.getItem(taskCenterSelectionStorageKey(workspaceRoot));
  return value?.trim() || null;
}

export function persistTaskCenterSelection(
  workspaceRoot: string,
  taskId: string | null,
  storage: TaskCenterSelectionStorage | null = browserTaskCenterSelectionStorage(),
): void {
  if (!workspaceRoot.trim() || !storage) return;
  const key = taskCenterSelectionStorageKey(workspaceRoot);
  if (taskId?.trim()) storage.setItem(key, taskId.trim());
  else storage.removeItem(key);
}

export function taskCenterTaskIdFromQuery(search: string): string | null {
  try {
    const taskId = new URLSearchParams(search).get("taskId")?.trim();
    return taskId || null;
  } catch {
    return null;
  }
}

export function taskCenterRunIdFromQuery(search: string): string | null {
  try {
    const runId = new URLSearchParams(search).get("runId")?.trim();
    return runId || null;
  } catch {
    return null;
  }
}

export function taskCenterQueryWithTaskId(search: string, taskId: string | null): string {
  const params = new URLSearchParams(search);
  if (taskId?.trim()) params.set("taskId", taskId.trim());
  else params.delete("taskId");
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function taskCenterQueryWithTaskSelection(
  search: string,
  taskId: string | null,
  runId: string | null,
): string {
  const params = new URLSearchParams(search);
  if (taskId?.trim()) params.set("taskId", taskId.trim());
  else params.delete("taskId");
  if (runId?.trim()) params.set("runId", runId.trim());
  else params.delete("runId");
  const value = params.toString();
  return value ? `?${value}` : "";
}

/**
 * A deep-linked historical run may live beyond the first history page. Keep
 * fetching while the server advertises another page; only clear the selection
 * after every page has been exhausted without finding the requested run.
 */
export function taskCenterRunSelectionNeedsMore(input: {
  selectedRunId: string | null;
  runs: Array<{ id: string }>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}): boolean {
  return Boolean(
    input.selectedRunId &&
      !input.runs.some((run) => run.id === input.selectedRunId) &&
      input.hasNextPage &&
      !input.isFetchingNextPage,
  );
}

export type TaskCenterListFilters = {
  search: string;
  status: string;
  permissionMode: TaskOrchestratorPermissionMode | "all";
};

export const TASK_CENTER_DEFAULT_LIST_FILTERS: TaskCenterListFilters = {
  search: "",
  status: "all",
  permissionMode: "all",
};

export function taskCenterFilterTasks(
  tasks: TaskOrchestratorTaskListResult["tasks"],
  filters: TaskCenterListFilters,
): TaskOrchestratorTaskListResult["tasks"] {
  const search = filters.search.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    const status = task.latestRunStatus ?? task.definitionStatus;
    if (search && !`${task.idea} ${task.id}`.toLocaleLowerCase().includes(search)) return false;
    if (filters.status !== "all" && status !== filters.status) return false;
    if (filters.permissionMode !== "all" && task.permissionMode !== filters.permissionMode) return false;
    return true;
  });
}

export function taskCenterEventTypes(events: TaskOrchestratorEvent[]): TaskOrchestratorEvent["type"][] {
  return [...new Set(events.map((event) => event.type))].sort();
}

type TaskOrchestratorRunStatus = TaskOrchestratorRun["status"];

const activeRunStatuses = new Set<TaskOrchestratorRunStatus>([
  "queued",
  "running",
  "checkpointing",
  "pausing",
  "backoff",
  "waiting-approval",
]);

export type TaskCenterTab = "alignment" | "execution" | "artifacts" | "evidence";

export const taskCenterTabs: TaskCenterTab[] = [
  "alignment",
  "execution",
  "artifacts",
  "evidence",
];

const taskCenterTabLabelKeys: Record<TaskCenterTab, string> = {
  alignment: "task_center.alignment",
  execution: "task_center.execution",
  artifacts: "task_center.artifacts",
  evidence: "task_center.evidence",
};

export function taskCenterTabLabelKey(tab: TaskCenterTab): string {
  return taskCenterTabLabelKeys[tab];
}

const taskCenterActorLabelKeys: Record<TaskOrchestratorActorKind, string> = {
  primary: "task_center.current_actor_primary",
  worker: "task_center.current_actor_worker",
};

export function taskCenterActorLabelKey(actor: TaskOrchestratorActorKind): string {
  return taskCenterActorLabelKeys[actor];
}

const taskCenterAlignmentRoleLabelKeys = {
  human: "task_center.alignment_role_human",
  primary: "task_center.alignment_role_primary",
} as const;

export function taskCenterAlignmentRoleLabelKey(role: keyof typeof taskCenterAlignmentRoleLabelKeys): string {
  return taskCenterAlignmentRoleLabelKeys[role];
}

const taskCenterCheckerVerdictLabelKeys = {
  approve: "task_center.checker_verdict_approve",
  revise: "task_center.checker_verdict_revise",
  block: "task_center.checker_verdict_block",
} as const;

export function taskCenterCheckerVerdictLabelKey(verdict: keyof typeof taskCenterCheckerVerdictLabelKeys): string {
  return taskCenterCheckerVerdictLabelKeys[verdict];
}

const taskCenterCheckpointTriggerLabelKeys: Record<TaskOrchestratorCheckpointTrigger, string> = {
  "primary-decision": "task_center.checkpoint_trigger_primary_decision",
  "context-threshold": "task_center.checkpoint_trigger_context_threshold",
  "user-pause": "task_center.checkpoint_trigger_user_pause",
  "app-quit": "task_center.checkpoint_trigger_app_quit",
  "supervisor-restart": "task_center.checkpoint_trigger_supervisor_restart",
  retry: "task_center.checkpoint_trigger_retry",
};

export function taskCenterCheckpointTriggerLabelKey(trigger: TaskOrchestratorCheckpointTrigger): string {
  return taskCenterCheckpointTriggerLabelKeys[trigger];
}

const taskCenterTurnReasonLabelKeys: Record<TaskOrchestratorTurnReason, string> = {
  initial: "task_center.history_reason_initial",
  "primary-continue": "task_center.history_reason_primary_continue",
  "primary-checkpoint": "task_center.history_reason_primary_checkpoint",
  "context-rollover": "task_center.history_reason_context_rollover",
  "user-resume": "task_center.history_reason_user_resume",
  "app-quit-resume": "task_center.history_reason_app_quit_resume",
  "supervisor-recovery": "task_center.history_reason_supervisor_recovery",
  retry: "task_center.history_reason_retry",
  "transport-retry": "task_center.history_reason_transport_retry",
};

export function taskCenterTurnReasonLabelKey(reason: TaskOrchestratorTurnReason): string {
  return taskCenterTurnReasonLabelKeys[reason];
}

const taskCenterDecisionLabelKeys: Record<TaskOrchestratorPrimaryDecisionKind, string> = {
  checkpoint: "task_center.history_decision_checkpoint",
  continue: "task_center.history_decision_continue",
  complete: "task_center.history_decision_complete",
  block: "task_center.history_decision_block",
  realign: "task_center.history_decision_realign",
};

export function taskCenterDecisionLabelKey(decision: TaskOrchestratorPrimaryDecisionKind): string {
  return taskCenterDecisionLabelKeys[decision];
}

const taskCenterArtifactLabelKeys: Record<TaskOrchestratorHandoffArtifact["kind"], string> = {
  alignment: "task_center.artifact_alignment",
  primary: "task_center.artifact_primary",
  worker: "task_center.artifact_worker",
  evidence: "task_center.artifact_evidence",
};

export function taskCenterArtifactLabelKey(kind: TaskOrchestratorHandoffArtifact["kind"]): string {
  return taskCenterArtifactLabelKeys[kind];
}

const taskCenterEvidenceLabelKeys: Record<TaskOrchestratorEvidence["kind"], string> = {
  command: "task_center.evidence_command",
  file: "task_center.evidence_file",
  test: "task_center.evidence_test",
  review: "task_center.evidence_review",
  message: "task_center.evidence_message",
};

export function taskCenterEvidenceLabelKey(kind: TaskOrchestratorEvidence["kind"]): string {
  return taskCenterEvidenceLabelKeys[kind];
}

const taskCenterEvidenceProvenanceLabelKeys: Record<TaskOrchestratorEvidence["provenance"], string> = {
  "agent-reported": "task_center.provenance_agent_reported",
  "runtime-observed": "task_center.provenance_runtime_observed",
  user: "task_center.provenance_user",
};

export function taskCenterEvidenceProvenanceLabelKey(provenance: TaskOrchestratorEvidence["provenance"]): string {
  return taskCenterEvidenceProvenanceLabelKeys[provenance];
}

const taskCenterGateLabelKeys: Record<TaskOrchestratorHumanGate["kind"], string> = {
  "personal-runtime-approval": "task_center.gate_personal_runtime_approval",
  "high-risk-action": "task_center.gate_high_risk_action",
  "manual-review": "task_center.gate_manual_review",
};

export function taskCenterGateLabelKey(kind: TaskOrchestratorHumanGate["kind"]): string {
  return taskCenterGateLabelKeys[kind];
}

const taskCenterGateRiskLabelKeys: Record<TaskOrchestratorApprovalRisk, string> = {
  safe: "task_center.gate_risk_safe",
  careful: "task_center.gate_risk_careful",
  destructive: "task_center.gate_risk_destructive",
};

export function taskCenterGateRiskLabelKey(risk: TaskOrchestratorApprovalRisk): string {
  return taskCenterGateRiskLabelKeys[risk];
}

const taskCenterGateDecisionLabelKeys = {
  approve: "task_center.gate_decision_approve",
  reject: "task_center.gate_decision_reject",
} as const;

export function taskCenterGateDecisionLabelKey(decision: keyof typeof taskCenterGateDecisionLabelKeys): string {
  return taskCenterGateDecisionLabelKeys[decision];
}

const taskCenterGateStatusLabelKeys: Record<TaskOrchestratorHumanGate["status"], string> = {
  pending: "task_center.status_pending",
  resolving: "task_center.status_running",
  approved: "task_center.gate_status_approved",
  rejected: "task_center.gate_status_rejected",
  cancelled: "task_center.gate_status_cancelled",
};

export function taskCenterGateStatusLabelKey(status: TaskOrchestratorHumanGate["status"]): string {
  return taskCenterGateStatusLabelKeys[status];
}

const taskCenterPauseReasonLabelKeys: Record<TaskOrchestratorPauseReason, string> = {
  user: "task_center.pause_reason_user",
  "app-quit": "task_center.pause_reason_app_quit",
  "supervisor-restart": "task_center.pause_reason_supervisor_restart",
  budget: "task_center.pause_reason_budget",
  "manual-review": "task_center.pause_reason_manual_review",
};

export function taskCenterPauseReasonLabelKey(reason: TaskOrchestratorPauseReason): string {
  return taskCenterPauseReasonLabelKeys[reason];
}

export type TaskCenterCatalog = {
  agents: PersonalLocalAgent[];
  catalogRevision: string | null;
};

export type TaskCenterModelOption = PersonalLocalAgentModelOption;

export type TaskCenterAgentChoice = {
  agent: PersonalLocalAgent;
  model: TaskCenterModelOption | null;
};

export type TaskCenterDraft = {
  idea: string;
  primary: TaskCenterAgentChoice | null;
  workers: TaskCenterAgentChoice[];
  permissionMode: TaskOrchestratorPermissionMode;
  contractFinalization: TaskOrchestratorContractFinalization;
  independentCheckerMode: "primary-only" | "independent";
  checker: TaskCenterAgentChoice | null;
  checkerMaxRounds: number;
  endConditionPreset: TaskCenterEndConditionPreset;
  endConditions: TaskOrchestratorEndConditions;
};

/**
 * The local draft deliberately stores only stable catalog references. Agent
 * labels, executable paths, and other live capability data must be re-read
 * from the current Personal catalog before a task can be created.
 */
export type TaskCenterDraftSelectionRef = {
  agentId: string;
  modelId: string | null;
};

export type TaskCenterDraftRecord = {
  schemaVersion: typeof TASK_CENTER_DRAFT_SCHEMA_VERSION;
  savedAt: number;
  idea: string;
  primary: TaskCenterDraftSelectionRef | null;
  workers: TaskCenterDraftSelectionRef[];
  permissionMode: TaskOrchestratorPermissionMode;
  contractFinalization: TaskOrchestratorContractFinalization;
  independentCheckerMode: "primary-only" | "independent";
  checker: TaskCenterDraftSelectionRef | null;
  checkerMaxRounds: number;
  endConditionPreset: TaskCenterEndConditionPreset;
  endConditions: TaskOrchestratorEndConditions;
};

type UnknownRecord = Record<string, unknown>;

function asUnknownRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function nullableBoundedInteger(
  value: unknown,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function sanitizeEndConditions(value: unknown): TaskOrchestratorEndConditions {
  const raw = asUnknownRecord(value);
  const defaults = TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS;
  const deadlineAt = raw?.deadlineAt;
  return {
    deadlineAt: deadlineAt === null || deadlineAt === undefined
      ? null
      : boundedInteger(deadlineAt, defaults.deadlineAt ?? 0, 0, Number.MAX_SAFE_INTEGER),
    maxElapsedMs: nullableBoundedInteger(raw?.maxElapsedMs, defaults.maxElapsedMs, 60_000, 604_800_000),
    maxPrimaryTurns: boundedInteger(raw?.maxPrimaryTurns, defaults.maxPrimaryTurns, 1, 100),
    maxWorkerAttempts: boundedInteger(raw?.maxWorkerAttempts, defaults.maxWorkerAttempts, 0, 500),
    maxWorkerConcurrency: boundedInteger(raw?.maxWorkerConcurrency, defaults.maxWorkerConcurrency, 1, 20),
    maxConsecutiveFailures: boundedInteger(raw?.maxConsecutiveFailures, defaults.maxConsecutiveFailures, 1, 20),
    contextRolloverPercent: boundedInteger(raw?.contextRolloverPercent, defaults.contextRolloverPercent, 50, 95),
    stallTimeoutMs: boundedInteger(raw?.stallTimeoutMs, defaults.stallTimeoutMs, 60_000, 14_400_000),
    maxTurnRuntimeMs: boundedInteger(raw?.maxTurnRuntimeMs, defaults.maxTurnRuntimeMs, 60_000, 14_400_000),
    maxTransportRetries: boundedInteger(raw?.maxTransportRetries, defaults.maxTransportRetries, 0, 10),
    maxTokens: nullableBoundedInteger(raw?.maxTokens, defaults.maxTokens, 1_000, 2_000_000_000),
    maxCostMicros: nullableBoundedInteger(raw?.maxCostMicros, defaults.maxCostMicros, 1, Number.MAX_SAFE_INTEGER),
    completionAuthority: raw?.completionAuthority === "user-confirm" ? "user-confirm" : "model-recommended",
  };
}

function taskCenterDraftSelectionRef(
  choice: TaskCenterAgentChoice | null,
): TaskCenterDraftSelectionRef | null {
  if (!choice?.agent.id?.trim()) return null;
  const modelId = choice.model?.id?.trim() || null;
  return {
    agentId: choice.agent.id.trim().slice(0, TASK_CENTER_DRAFT_MAX_ID_LENGTH),
    modelId: modelId?.slice(0, TASK_CENTER_DRAFT_MAX_ID_LENGTH) ?? null,
  };
}

function sanitizeDraftSelectionRef(value: unknown): TaskCenterDraftSelectionRef | null {
  const raw = asUnknownRecord(value);
  const agentId = boundedText(raw?.agentId, TASK_CENTER_DRAFT_MAX_ID_LENGTH);
  if (!agentId) return null;
  const modelId = boundedText(raw?.modelId, TASK_CENTER_DRAFT_MAX_ID_LENGTH);
  return { agentId, modelId: modelId || null };
}

function sanitizeDraftRecord(value: unknown, now = Date.now()): TaskCenterDraftRecord | null {
  const raw = asUnknownRecord(value);
  if (
    raw?.schemaVersion !== TASK_CENTER_DRAFT_SCHEMA_VERSION ||
    typeof raw.idea !== "string" ||
    !Array.isArray(raw.workers) ||
    !asUnknownRecord(raw.endConditions)
  ) return null;
  const savedAt = raw.savedAt;
  if (
    typeof savedAt !== "number" ||
    !Number.isSafeInteger(savedAt) ||
    savedAt <= 0 ||
    savedAt > now + 5 * 60 * 1_000 ||
    now - savedAt > TASK_CENTER_DRAFT_MAX_AGE_MS
  ) return null;
  const rawWorkers = raw.workers;
  const workers = rawWorkers
    .slice(0, TASK_CENTER_DRAFT_MAX_WORKERS)
    .map(sanitizeDraftSelectionRef)
    .filter((selection): selection is TaskCenterDraftSelectionRef => Boolean(selection));
  const permissionMode = raw.permissionMode === "full-allow" ? "full-allow" : "restricted";
  const contractFinalization = raw.contractFinalization === "model-recommended-auto"
    ? "model-recommended-auto"
    : "manual-confirm";
  const independentCheckerMode = raw.independentCheckerMode === "independent"
    ? "independent"
    : "primary-only";
  const endConditionPreset: TaskCenterEndConditionPreset =
    raw.endConditionPreset === "quick" || raw.endConditionPreset === "custom"
      ? raw.endConditionPreset
      : "recommended-overnight";
  return {
    schemaVersion: TASK_CENTER_DRAFT_SCHEMA_VERSION,
    savedAt,
    idea: boundedText(raw.idea, TASK_CENTER_DRAFT_MAX_IDEA_LENGTH),
    primary: sanitizeDraftSelectionRef(raw.primary),
    workers,
    permissionMode,
    contractFinalization,
    independentCheckerMode,
    checker: sanitizeDraftSelectionRef(raw.checker),
    checkerMaxRounds: boundedInteger(raw.checkerMaxRounds, 2, 1, 3),
    endConditionPreset,
    endConditions: sanitizeEndConditions(raw.endConditions),
  };
}

function serializedByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
  return value.length;
}

export function taskCenterDraftRecordFromDraft(
  draft: TaskCenterDraft,
  savedAt = Date.now(),
): TaskCenterDraftRecord {
  return {
    schemaVersion: TASK_CENTER_DRAFT_SCHEMA_VERSION,
    savedAt,
    idea: draft.idea.trim().slice(0, TASK_CENTER_DRAFT_MAX_IDEA_LENGTH),
    primary: taskCenterDraftSelectionRef(draft.primary),
    workers: draft.workers
      .slice(0, TASK_CENTER_DRAFT_MAX_WORKERS)
      .map(taskCenterDraftSelectionRef)
      .filter((selection): selection is TaskCenterDraftSelectionRef => Boolean(selection)),
    permissionMode: draft.permissionMode === "full-allow" ? "full-allow" : "restricted",
    contractFinalization: draft.contractFinalization === "model-recommended-auto"
      ? "model-recommended-auto"
      : "manual-confirm",
    independentCheckerMode: draft.independentCheckerMode === "independent" ? "independent" : "primary-only",
    checker: taskCenterDraftSelectionRef(draft.checker),
    checkerMaxRounds: boundedInteger(draft.checkerMaxRounds, 2, 1, 3),
    endConditionPreset: draft.endConditionPreset,
    endConditions: sanitizeEndConditions(draft.endConditions),
  };
}

export function persistTaskCenterDraft(
  workspaceRoot: string,
  draft: TaskCenterDraft,
  storage: TaskCenterDraftStorage | null = browserTaskCenterDraftStorage(),
): number | null {
  if (!workspaceRoot.trim() || !storage) return null;
  const record = taskCenterDraftRecordFromDraft(draft);
  const serialized = JSON.stringify(record);
  if (serializedByteLength(serialized) > TASK_CENTER_DRAFT_MAX_SERIALIZED_BYTES) return null;
  try {
    storage.setItem(taskCenterDraftStorageKey(workspaceRoot), serialized);
    return record.savedAt;
  } catch {
    return null;
  }
}

export function readTaskCenterDraftRecord(
  workspaceRoot: string,
  storage: TaskCenterDraftStorage | null = browserTaskCenterDraftStorage(),
  now = Date.now(),
): TaskCenterDraftRecord | null {
  if (!workspaceRoot.trim() || !storage) return null;
  const key = taskCenterDraftStorageKey(workspaceRoot);
  let serialized: string | null = null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return null;
  }
  if (!serialized) return null;
  if (serializedByteLength(serialized) > TASK_CENTER_DRAFT_MAX_SERIALIZED_BYTES) {
    try { storage.removeItem(key); } catch { /* ignore storage failures */ }
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    try { storage.removeItem(key); } catch { /* ignore storage failures */ }
    return null;
  }
  const record = sanitizeDraftRecord(parsed, now);
  if (!record) {
    try { storage.removeItem(key); } catch { /* ignore storage failures */ }
  }
  return record;
}

export function clearTaskCenterDraft(
  workspaceRoot: string,
  storage: TaskCenterDraftStorage | null = browserTaskCenterDraftStorage(),
): void {
  if (!workspaceRoot.trim() || !storage) return;
  try { storage.removeItem(taskCenterDraftStorageKey(workspaceRoot)); } catch { /* ignore storage failures */ }
}

export function usableTaskCenterAgents(agents: PersonalLocalAgent[]): PersonalLocalAgent[] {
  return agents.filter((agent) => {
    if (agent.enabled === false) return false;
    if (agent.status !== "online") return false;
    if (agent.capability?.installed === false) return false;
    if (agent.capability?.authenticated === false) return false;
    return true;
  });
}

export function taskCenterModelsForAgent(
  agent: PersonalLocalAgent | null | undefined,
): TaskCenterModelOption[] {
  if (!agent) return [];
  const models = [...(agent.modelOptions ?? [])];
  const knownIds = new Set(models.map((model) => model.id));
  const fallback = agent.defaultModel ?? agent.model;
  if (fallback && !knownIds.has(fallback)) {
    models.unshift({ id: fallback, label: fallback });
  }
  return models;
}

function preferredModel(
  agent: PersonalLocalAgent,
  preferredId: string,
): TaskCenterModelOption | null {
  return (
    taskCenterModelsForAgent(agent).find((model) => model.id === preferredId) ??
    taskCenterModelsForAgent(agent)[0] ??
    null
  );
}

export function defaultTaskCenterChoice(
  agents: PersonalLocalAgent[],
  preferredAgentId: string,
  preferredModelId: string,
): TaskCenterAgentChoice | null {
  const agent = agents.find((candidate) => candidate.id === preferredAgentId) ?? agents[0];
  return agent ? { agent, model: preferredModel(agent, preferredModelId) } : null;
}

export function createTaskCenterDraft(
  catalog?: TaskCenterCatalog | null,
): TaskCenterDraft {
  const agents = usableTaskCenterAgents(catalog?.agents ?? []);
  return {
    idea: "",
    primary: defaultTaskCenterChoice(agents, "codex", TASK_CENTER_CODEX_MODEL),
    workers: (() => {
      const worker = defaultTaskCenterChoice(
        agents,
        "claude",
        TASK_CENTER_CLAUDE_WORKER_MODEL,
      );
      return worker ? [worker] : [];
    })(),
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    independentCheckerMode: "primary-only",
    checker: null,
    checkerMaxRounds: 2,
    endConditionPreset: "recommended-overnight",
    endConditions: taskCenterEndConditionsForPreset("recommended-overnight"),
  };
}

function taskCenterChoiceFromDraftSelection(
  selection: TaskCenterDraftSelectionRef | null,
  catalog: TaskCenterCatalog,
): TaskCenterAgentChoice | null {
  if (!selection) return null;
  const agent = usableTaskCenterAgents(catalog.agents).find((candidate) => candidate.id === selection.agentId);
  if (!agent) return null;
  const models = taskCenterModelsForAgent(agent);
  return {
    agent,
    model: models.find((model) => model.id === selection.modelId) ?? models[0] ?? null,
  };
}

/** Rehydrates only catalog selections; user-entered values remain untouched. */
export function hydrateTaskCenterDraftSelectionsFromCatalog(
  draft: TaskCenterDraft,
  stored: TaskCenterDraftRecord,
  catalog: TaskCenterCatalog,
): TaskCenterDraft {
  const defaults = createTaskCenterDraft(catalog);
  return {
    ...draft,
    primary: taskCenterChoiceFromDraftSelection(stored.primary, catalog) ?? defaults.primary,
    workers: stored.workers
      .map((selection) => taskCenterChoiceFromDraftSelection(selection, catalog))
      .filter((choice): choice is TaskCenterAgentChoice => Boolean(choice)),
    independentCheckerMode: stored.independentCheckerMode,
    checker: taskCenterChoiceFromDraftSelection(stored.checker, catalog) ?? defaults.checker,
    checkerMaxRounds: stored.checkerMaxRounds,
  };
}

/**
 * Restores a bounded record. Unknown catalog entries are discarded and the
 * current canonical catalog supplies safe defaults for the primary choice.
 */
export function taskCenterDraftFromStoredRecord(
  stored: TaskCenterDraftRecord | null,
  catalog?: TaskCenterCatalog | null,
): TaskCenterDraft {
  if (!stored) return createTaskCenterDraft(catalog);
  const base = createTaskCenterDraft(catalog);
  return {
    ...base,
    idea: stored.idea,
    permissionMode: stored.permissionMode,
    contractFinalization: stored.contractFinalization,
    independentCheckerMode: stored.independentCheckerMode,
    checker: catalog
      ? taskCenterChoiceFromDraftSelection(stored.checker, catalog) ?? base.checker
      : null,
    checkerMaxRounds: stored.checkerMaxRounds,
    endConditionPreset: stored.endConditionPreset,
    endConditions: { ...stored.endConditions },
    primary: catalog
      ? taskCenterChoiceFromDraftSelection(stored.primary, catalog) ?? base.primary
      : null,
    workers: catalog
      ? stored.workers
        .map((selection) => taskCenterChoiceFromDraftSelection(selection, catalog))
        .filter((choice): choice is TaskCenterAgentChoice => Boolean(choice))
      : [],
  };
}

export function hydrateTaskCenterDraftFromCatalog(
  draft: TaskCenterDraft,
  catalog: TaskCenterCatalog,
): TaskCenterDraft {
  const defaults = createTaskCenterDraft(catalog);
  return {
    ...draft,
    primary: draft.primary ?? defaults.primary,
    workers: draft.workers.length ? draft.workers : defaults.workers,
    checker: draft.checker ?? defaults.checker,
  };
}

export function catalogRevisionForAgent(
  agent: PersonalLocalAgent,
  catalogRevision: string | null,
): string | null {
  if (catalogRevision?.trim()) return catalogRevision.trim();
  if (agent.version?.trim()) return agent.version.trim();
  if (typeof agent.lastCheckedAt === "number") return String(agent.lastCheckedAt);
  return null;
}

export function taskCenterSelectionFromChoice(
  choice: TaskCenterAgentChoice,
  kind: "primary" | "worker" | "checker",
  catalogRevision: string | null,
): TaskOrchestratorAgentSelection {
  return {
    agentId: choice.agent.id,
    provider: choice.agent.provider,
    label: choice.agent.name,
    model: choice.model?.id ?? null,
    modelLabel: choice.model?.label ?? null,
    catalogSource: "personal-registry",
    catalogRevision: catalogRevisionForAgent(choice.agent, catalogRevision),
    capabilitySnapshot: {
      schemaVersion: 1,
      requestedModel: choice.model?.id ?? null,
      effectiveModel: choice.model?.id ?? choice.agent.defaultModel ?? choice.agent.model ?? null,
      modelResolution: choice.model?.id ? "catalog" : "none",
      catalogRevision: catalogRevisionForAgent(choice.agent, catalogRevision),
      catalogFreshness: catalogRevisionForAgent(choice.agent, catalogRevision) ? "fresh" : "unknown",
      catalogObservedAt: choice.agent.lastCheckedAt ?? null,
      supports: {
        taskMcp: choice.agent.capability?.supportsAcp ?? "unknown",
        tools: choice.agent.capability?.supportsAcp ?? "unknown",
        modelOverride: choice.agent.capability?.supportsModelOverride ?? "unknown",
        approval: choice.agent.capability?.supportsApproval ?? "unknown",
        fullAllow: choice.agent.capability?.supportsPermissionAutoApprove ?? "unknown",
        context: "unknown",
        nativeCompact: "unknown",
        nativeResume: choice.agent.capability?.supportsResume ?? "unknown",
        streaming: choice.agent.capability?.supportsStreaming ?? "unknown",
      },
      warnings: choice.agent.capability?.warning ? [choice.agent.capability.warning] : [],
    },
    timeoutMs: kind === "primary" ? 7_200_000 : 3_600_000,
  };
}

export function taskCenterCheckerProfileFromChoice(
  choice: TaskCenterAgentChoice,
  catalogRevision: string | null,
  maxRounds: number,
): { mode: "independent"; maxRounds: number; profile: TaskOrchestratorCheckerProfile } {
  const selection = taskCenterSelectionFromChoice(choice, "checker", catalogRevision);
  const safeAgentId = choice.agent.id.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 160);
  return {
    mode: "independent",
    maxRounds: Math.min(3, Math.max(1, Math.round(maxRounds))),
    profile: {
      id: `checker-${safeAgentId}`.slice(0, 240),
      label: `${choice.agent.name} · Independent checker`,
      runtime: "personal-local-agent",
      agentId: selection.agentId,
      provider: selection.provider,
      model: selection.model,
      modelLabel: selection.modelLabel ?? null,
      catalogSource: "personal-registry",
      catalogRevision: selection.catalogRevision ?? null,
      capabilitySnapshot: selection.capabilitySnapshot ?? null,
      instructions: "Read-only acceptance verification.",
      approvalMode: "read-only-auto",
      sessionStrategy: "fresh",
      timeoutMs: selection.timeoutMs ?? 3_600_000,
    },
  };
}

export function isTaskCenterDraftValid(
  draft: TaskCenterDraft,
  workspaceRoot: string,
): boolean {
  return Boolean(
    workspaceRoot.trim() &&
      draft.idea.trim() &&
      draft.primary &&
      draft.primary.agent.id &&
      draft.workers.every((worker) => Boolean(worker.agent.id)) &&
      (draft.independentCheckerMode === "primary-only" || Boolean(draft.checker?.agent.id)),
  );
}

export function buildTaskCenterCreateInput(
  draft: TaskCenterDraft,
  workspaceRoot: string,
  catalogRevision: string | null = null,
): TaskOrchestratorTaskCreateInput {
  if (!draft.primary) throw new Error("A primary agent selection is required");
  return {
    idea: draft.idea.trim(),
    workspaceRoot: workspaceRoot.trim(),
    primary: taskCenterSelectionFromChoice(draft.primary, "primary", catalogRevision),
    allowedWorkers: draft.workers.map((worker) =>
      taskCenterSelectionFromChoice(worker, "worker", catalogRevision),
    ),
    permissionMode: draft.permissionMode,
    contractFinalization: draft.contractFinalization,
    independentChecker: draft.independentCheckerMode === "independent" && draft.checker
      ? taskCenterCheckerProfileFromChoice(draft.checker, catalogRevision, draft.checkerMaxRounds)
      : { mode: "primary-only", profile: null, maxRounds: 1 },
    endConditions: { ...draft.endConditions },
  };
}

export function isTaskCenterRunActive(
  status: TaskOrchestratorRunStatus | null | undefined,
): boolean {
  return status ? activeRunStatuses.has(status) : false;
}

export function taskCenterListPollInterval(
  result: TaskOrchestratorTaskListResult | undefined,
): number {
  return result?.tasks.some((task) => isTaskCenterRunActive(task.latestRunStatus))
    ? TASK_CENTER_ACTIVE_POLL_MS
    : TASK_CENTER_LIST_IDLE_POLL_MS;
}

export function taskCenterSnapshotPollInterval(
  snapshot: TaskOrchestratorSnapshot | undefined,
): number | false {
  return isTaskCenterRunActive(snapshot?.run?.status)
    ? TASK_CENTER_ACTIVE_POLL_MS
    : false;
}

export function taskCenterStatusLabelKey(status: string): string {
  return `task_center.status_${status.replaceAll("-", "_")}`;
}

export type TaskCenterStatusTone =
  | "neutral"
  | "surface"
  | "accent"
  | "success"
  | "warning"
  | "danger";

export function taskCenterStatusTone(status: string): TaskCenterStatusTone {
  if (status === "succeeded" || status === "approved" || status === "ready") return "success";
  if (status === "failed" || status === "rejected") return "danger";
  if (status === "blocked" || status === "waiting-approval" || status === "pausing" || status === "backoff") return "warning";
  if (status === "running" || status === "queued" || status === "checkpointing") return "accent";
  if (status === "paused") return "surface";
  return "surface";
}

export type TaskCenterDotTone = "active" | "success" | "muted" | "warning" | "danger";

export function taskCenterStatusDotTone(status: string): TaskCenterDotTone {
  const tone = taskCenterStatusTone(status);
  if (tone === "accent") return "active";
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  return "muted";
}

export function parseContractProposal(
  proposal: TaskCenterContractProposalLike | null | undefined,
): TaskOrchestratorContract | null {
  return proposal?.contract ?? null;
}

type TaskCenterContractProposalLike = {
  contract: TaskOrchestratorContract;
};

export function latestTaskCenterProposal(
  snapshot: TaskOrchestratorSnapshot,
) {
  const { latestProposalId } = snapshot.task.alignment;
  return (
    snapshot.task.alignment.proposals.find((proposal) => proposal.id === latestProposalId) ??
    snapshot.task.alignment.proposals.at(-1) ??
    null
  );
}

export function profileForAttempt(
  run: TaskOrchestratorRun,
  attempt: TaskOrchestratorAttempt,
) {
  if (attempt.kind === "primary") return run.definition.primary;
  return run.definition.allowedWorkers.find((profile) => profile.id === attempt.profileId) ?? null;
}

export function latestPrimaryAttempt(run: TaskOrchestratorRun | null): TaskOrchestratorAttempt | null {
  return run?.primaryAttempts.at(-1) ?? null;
}

export function latestPrimaryRetryCandidate(
  run: TaskOrchestratorRun | null,
): TaskOrchestratorAttempt | null {
  const latest = latestPrimaryAttempt(run);
  const completionReviewRejected = Boolean(
    run?.status === "blocked" &&
      latest?.status === "succeeded" &&
      /Completion review rejected/i.test(run.error ?? ""),
  );
  if (
    !run ||
    !latest ||
    (!["failed", "blocked", "cancelled"].includes(latest.status) && !completionReviewRejected) ||
    !["failed", "blocked", "cancelled"].includes(run.status) ||
    run.primaryAttempts.length >= 3
  ) {
    return null;
  }
  return latest;
}

function currentAttemptForRun(run: TaskOrchestratorRun | null): TaskOrchestratorAttempt | null {
  if (!run?.currentAttemptId) return null;
  return [...run.primaryAttempts, ...run.workerAttempts].find((attempt) => attempt.id === run.currentAttemptId) ?? null;
}

/** A desktop restart/shutdown is the only state eligible for safe recovery. */
export function taskCenterIsDesktopInterruption(run: TaskOrchestratorRun | null): boolean {
  return Boolean(run?.status === "blocked" && /Desktop (?:shut down|restarted) during an active primary\/worker attempt/i.test(run.error ?? ""));
}

export function taskCenterRecoveryCandidate(
  run: TaskOrchestratorRun | null,
): TaskOrchestratorAttempt | null {
  if (
    !run ||
    run.status !== "blocked" ||
    !taskCenterIsDesktopInterruption(run) ||
    run.primaryAttempts.length >= 3
  ) return null;
  const current = currentAttemptForRun(run);
  if (!current || current.status !== "blocked" || current.leaseId) return null;
  if ([...run.primaryAttempts, ...run.workerAttempts].some((attempt) => (
    ["ready", "running", "waiting-approval"].includes(attempt.status) || Boolean(attempt.leaseId)
  ))) return null;
  return current;
}

/** Alias kept descriptive for callers that render the recovery CTA. */
export const latestPrimaryRecoveryCandidate = taskCenterRecoveryCandidate;

export function allTaskCenterAttempts(run: TaskOrchestratorRun | null): TaskOrchestratorAttempt[] {
  return run ? [...run.primaryAttempts, ...run.workerAttempts] : [];
}

export function taskCenterCurrentTurn(run: TaskOrchestratorRun | null): TaskOrchestratorTurn | null {
  if (!run) return null;
  const turns = run.turns ?? [];
  return turns.find((turn) => turn.id === run.currentTurnId) ?? turns.at(-1) ?? null;
}

export function taskCenterElapsedMs(run: TaskOrchestratorRun | null, now = Date.now()): number {
  if (!run) return 0;
  if (run.budget) return run.budget.elapsedMs;
  if (run.startedAt === null) return 0;
  return Math.max(0, (run.finishedAt ?? now) - run.startedAt);
}

export function taskCenterContextPercent(run: TaskOrchestratorRun | null): number | null {
  const turn = taskCenterCurrentTurn(run);
  return turn?.context?.percent ?? null;
}

export function taskCenterActiveWorkerCount(run: TaskOrchestratorRun | null): number {
  if (!run) return 0;
  return (run.workerAttempts ?? []).filter((attempt) => attempt.status === "running" || attempt.status === "waiting-approval").length;
}

export function taskCenterFormatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function taskCenterFormatBudgetValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat().format(value);
}

export type TaskCenterCheckpointLike = Pick<TaskOrchestratorCheckpoint, "id" | "turnId" | "capsuleId" | "trigger" | "createdAt">;
export type TaskCenterCapsuleLike = Pick<TaskOrchestratorContinuationCapsule, "id" | "fromTurnId" | "summary" | "completed" | "pending" | "risks" | "artifactIds" | "createdAt">;

export function taskCenterEventLabelKey(event: TaskOrchestratorEvent): string {
  return taskCenterEventTypeLabelKey(event.type);
}

export function taskCenterEventTypeLabelKey(type: TaskOrchestratorEvent["type"]): string {
  return `task_center.event_${type.replaceAll("-", "_")}`;
}
