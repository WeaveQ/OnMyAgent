import { randomUUID } from "node:crypto";

import {
  TASK_ORCHESTRATOR_SCHEMA_VERSION,
  TASK_ORCHESTRATOR_TEMPLATE,
  taskOrchestratorAgentProfileSchema,
  taskOrchestratorAgentSelectionSchema,
  taskOrchestratorContractSchema,
  taskOrchestratorRunDefinitionSnapshotSchema,
} from "@onmyagent/types/task-orchestrator";

export const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "checkpointing", "pausing", "backoff", "waiting-approval"]);
export const ACTIVE_ATTEMPT_STATUSES = new Set(["ready", "running", "waiting-approval"]);
export const PERSONAL_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "missing"]);
export const PRIMARY_PROFILE_ID = "primary";

const DEFAULT_TIMEOUT_PRIMARY = 7_200_000;
const DEFAULT_TIMEOUT_WORKER = 3_600_000;

export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export function defaultId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function clone(value) {
  return structuredClone(value);
}

export function sleepFor(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") timer.unref();
  });
}

export function profileFromSelection(kind, selection, index = 0) {
  const parsed = taskOrchestratorAgentSelectionSchema.parse(selection);
  const profile = {
    id: kind === "primary" ? PRIMARY_PROFILE_ID : `worker-${index + 1}`,
    label: parsed.label,
    kind,
    runtime: "personal-local-agent",
    agentId: parsed.agentId,
    provider: parsed.provider,
    model: parsed.model,
    modelLabel: parsed.modelLabel ?? null,
    catalogSource: "personal-registry",
    catalogRevision: parsed.catalogRevision ?? null,
    capabilitySnapshot: parsed.capabilitySnapshot ?? null,
    instructions: "",
    approvalMode: kind === "primary" ? "ask" : "ask",
    sessionStrategy: "fresh",
    timeoutMs: parsed.timeoutMs ?? (kind === "primary" ? DEFAULT_TIMEOUT_PRIMARY : DEFAULT_TIMEOUT_WORKER),
  };
  return taskOrchestratorAgentProfileSchema.parse(profile);
}

export function profilesFromInput(primary, workers) {
  return {
    primary: profileFromSelection("primary", primary),
    allowedWorkers: (Array.isArray(workers) ? workers : []).map((selection, index) => profileFromSelection("worker", selection, index)),
  };
}

export function definitionFromTask(task) {
  if (!task.contract) throw new Error("Task contract is not frozen");
  return taskOrchestratorRunDefinitionSnapshotSchema.parse({
    idea: task.idea,
    workspaceRoot: task.workspaceRoot,
    primary: clone(task.primary),
    allowedWorkers: clone(task.allowedWorkers),
    independentChecker: clone(task.independentChecker ?? { mode: "primary-only", profile: null, maxRounds: 1 }),
    permissionMode: task.permissionMode,
    contractFinalization: task.contractFinalization,
    endConditions: clone(task.endConditions),
    contract: clone(task.contract),
    template: TASK_ORCHESTRATOR_TEMPLATE,
    executionProtocol: "structured-decisions-v1",
  });
}

export function profileForAttempt(run, attempt) {
  if (!attempt) throw new Error("Attempt is required");
  if (attempt.kind === "primary") {
    if (attempt.profileId !== run.definition.primary.id) throw new Error("Primary attempt profile drifted");
    return run.definition.primary;
  }
  const profile = run.definition.allowedWorkers.find((candidate) => candidate.id === attempt.profileId);
  if (!profile) throw new Error(`Worker profile ${attempt.profileId} is not allowed by the frozen task`);
  return profile;
}

export function checkerProfileForRun(run) {
  const profile = run?.definition?.independentChecker?.profile;
  if (!profile || run?.definition?.independentChecker?.mode !== "independent") {
    throw new Error("Independent checker is not enabled for this run");
  }
  return profile;
}

export function allAttempts(run) {
  return [...run.primaryAttempts, ...run.workerAttempts, ...(run.checkerAttempts ?? [])];
}

export function findAttempt(run, attemptId) {
  return allAttempts(run).find((attempt) => attempt.id === attemptId) ?? null;
}

export function currentAttempt(run) {
  return run.currentAttemptId ? findAttempt(run, run.currentAttemptId) : null;
}

export function createAttempt(createId, now, run, kind, profile, prompt, parentAttemptId = null, status = "ready", turnId = run.currentTurnId ?? null) {
  const depth = kind === "primary" ? 0 : 1;
  return {
    id: createId(kind === "primary" ? "primary" : "worker"),
    kind,
    profileId: profile.id,
    parentAttemptId,
    turnId,
    depth,
    status,
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    providerDiagnostics: null,
    providerUsage: null,
    prompt: String(prompt ?? "").slice(0, 24_000),
    outputArtifactIds: [],
    timeoutMs: profile.timeoutMs,
    startedAt: null,
    progressAt: null,
    notBefore: null,
    updatedAt: now(),
    finishedAt: null,
    error: null,
  };
}

export function normalizeOutput(output) {
  return String(output ?? "").slice(0, 500_000);
}

export function runtimeApprovalMode(permissionMode, kind = "primary") {
  // `full-allow` is an explicit user choice. It suppresses all task-center
  // approval gates while still using each provider's supported safe mode.
  if (permissionMode === "full-allow") return "auto";
  return kind === "worker" ? "ask" : "ask";
}

export function alignmentApprovalMode(_permissionMode) {
  // A full-allow capability does not exist until the contract is frozen and a
  // durable run id has been allocated. Alignment is always read-only.
  return "read-only-auto";
}

export function taskPrompt(run, attempt, extra = "") {
  const profile = attempt.kind === "checker" ? checkerProfileForRun(run) : profileForAttempt(run, attempt);
  const contract = JSON.stringify(run.definition.contract);
  const control = attempt.kind === "checker"
    ? "Independent checker boundary: read-only verification only. No delegation tools and no task completion tools are available. Return exactly one <task-checker-verdict> JSON object with verdict approve, revise, or block, every frozen criterion result, and durable evidence artifact ids."
    : attempt.kind === "primary"
    ? [
        "Delegation capability boundary: use only tools from the MCP server `onmyagent-task-control`.",
        "For Codex, invoke the fully qualified tools `mcp.onmyagent-task-control.get_task_state`, `mcp.onmyagent-task-control.list_agents`, `mcp.onmyagent-task-control.spawn_agent`, `mcp.onmyagent-task-control.send_message`, `mcp.onmyagent-task-control.wait_agent`, `mcp.onmyagent-task-control.close_agent`, and one matching structured decision tool.",
        "Never use provider-native collaboration or subagent tools (including an unqualified `spawn_agent`, `send_message`, `wait`, or `close_agent`) even when they have similar names.",
        "Delegate only to worker profiles returned by the task MCP server; delegation depth is one.",
        run.definition.executionProtocol === "structured-decisions-v1"
          ? "Before ending this primary turn, call exactly one of `complete_task`, `continue_task`, `checkpoint_task`, `block_task`, or `realign_task`. Provider completion without a durable structured decision blocks the run. `complete_task` requires one passed acceptance result for every frozen acceptance criterion."
          : "This imported run uses legacy provider-completion semantics.",
      ].join(" ")
    : "This is a depth-one worker attempt. No delegation tools are available and you must not attempt recursive delegation.";
  const phase = attempt.kind === "checker"
    ? "CURRENT PHASE: INDEPENDENT COMPLETION CHECK. The contract is already frozen. Do not propose or realign a contract and do not perform execution work."
    : attempt.kind === "primary"
    ? "CURRENT PHASE: TASK EXECUTION. Alignment is complete and the contract below is already frozen. Do not submit another contract proposal. Treat phase-transition wording in the original idea as historical background. Start by calling the Task Center MCP get_task_state tool, then execute the frozen contract through the available Task Center tools."
    : "CURRENT PHASE: DELEGATED WORKER EXECUTION. Alignment is complete and the contract below is already frozen. Do not submit a contract proposal or act as the Primary.";
  return [
    phase,
    `Frozen contract:\n${contract}`,
    `Original task idea (background only; the frozen contract is authoritative):\n${run.definition.idea}`,
    `Workspace: ${run.definition.workspaceRoot}`,
    `Permission mode: ${run.definition.permissionMode}`,
    `Frozen end conditions: ${JSON.stringify(run.definition.endConditions)}`,
    attempt.turnId ? `Durable turn: ${attempt.turnId}` : "",
    `You are the ${attempt.kind} local agent (${profile.label}).`,
    control,
    extra || attempt.prompt,
  ].filter(Boolean).join("\n\n").slice(0, 24_000);
}

export function parseContractProposal(output) {
  const source = String(output ?? "");
  const match = source.match(/<task-contract-proposal>\s*([\s\S]*?)\s*<\/task-contract-proposal>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    const contract = taskOrchestratorContractSchema.safeParse(parsed?.contract ?? parsed);
    return contract.success ? contract.data : null;
  } catch {
    return null;
  }
}
