/**
 * Pure send / plan / goal orchestration for SessionSurface.
 *
 * Keep side-effects (stores, network, React state) in the host; this module
 * only computes preconditions, draft augmentations, and runtime transitions
 * so they stay unit-testable without mounting the surface.
 */
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerCollaborationMode,
  ComposerDraft,
  TodoItem,
} from "../../../../app/types";
import type { AssistantCategoryId } from "./personal-assistant-config";
import {
  deriveGoalSummary,
  resolveSessionCollaborationKind,
  type SessionCollaborationKind,
} from "./session-run-controller";
import {
  buildGoalHiddenSystemPrompt,
  buildPlanExecutionHiddenSystemPrompt,
  isGoalIntentRuntime,
} from "./plan-goal/goal-runtime";

/** Stable run identity for activity store + interruption notices. */
export function makeSessionRunKey(sessionId: string, startedAt: number): string {
  return `${sessionId}:${startedAt}`;
}

/**
 * Code draft home requires a workspace folder before the first send.
 * Returns true when the host should show the folder-required bubble instead.
 */
export function shouldBlockCodeDraftSend(input: {
  assistantCodeFeaturesActive: boolean;
  draftOnly: boolean;
  assistantFeatureCategoryId: AssistantCategoryId | string;
  draftWorkspaceDirectory?: string | null;
}): boolean {
  return (
    input.assistantCodeFeaturesActive &&
    input.draftOnly &&
    input.assistantFeatureCategoryId === "code" &&
    !input.draftWorkspaceDirectory?.trim()
  );
}

export type SendDraftIntentResult = {
  draft: ComposerDraft;
  /** When goal mode continues an existing runtime, host should publish this. */
  nextGoalRuntime: CollaborationGoalRuntime | null;
};

/**
 * Apply plan/goal collaboration intents onto a composed draft before onSendDraft.
 */
export function applySendDraftIntents(input: {
  draft: ComposerDraft;
  text: string;
  messageBaseline: number;
  startedAt: number;
  effectiveCollaborationMode: ComposerCollaborationMode;
  assistantFeatureCategoryId: AssistantCategoryId | string;
  goalRuntime: CollaborationGoalRuntime | null | undefined;
  stallRecoveryHiddenPrompt?: string | null;
}): SendDraftIntentResult {
  const nextDraft: ComposerDraft = { ...input.draft };
  if (input.stallRecoveryHiddenPrompt) {
    nextDraft.hiddenSystemPrompt = [
      nextDraft.hiddenSystemPrompt,
      input.stallRecoveryHiddenPrompt,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const goalMode =
    resolveSessionCollaborationKind(
      input.effectiveCollaborationMode,
      input.assistantFeatureCategoryId as AssistantCategoryId,
    ) === "goal";

  if (
    input.effectiveCollaborationMode.kind === "plan" ||
    input.effectiveCollaborationMode.planning
  ) {
    nextDraft.planningIntent = {
      originalPrompt: input.text,
      messageBaseline: input.messageBaseline,
    };
  }

  const currentGoalRuntime = isGoalIntentRuntime(input.goalRuntime)
    ? input.goalRuntime
    : null;

  if (goalMode && !currentGoalRuntime) {
    nextDraft.goalIntent = {
      objective: nextDraft.resolvedText ?? input.text,
      messageBaseline: input.messageBaseline,
    };
    return { draft: nextDraft, nextGoalRuntime: null };
  }

  if (goalMode && currentGoalRuntime) {
    const runtimeWithSummary = currentGoalRuntime.summary
      ? currentGoalRuntime
      : {
          ...currentGoalRuntime,
          summary: deriveGoalSummary(currentGoalRuntime.objective),
        };
    nextDraft.hiddenSystemPrompt = buildGoalHiddenSystemPrompt(runtimeWithSummary);
    return {
      draft: nextDraft,
      nextGoalRuntime: {
        ...runtimeWithSummary,
        status: "running",
        waitingReason: undefined,
        updatedAt: input.startedAt,
        lastRunStartedAt: input.startedAt,
        lastRunMessageBaseline: input.messageBaseline,
        completedAt: undefined,
      },
    };
  }

  return { draft: nextDraft, nextGoalRuntime: null };
}

export type PlanExecutionRequest = {
  executionMode: ComposerCollaborationMode;
  executionSystemPrompt: string;
  nextPlanRuntime: CollaborationPlanRuntime;
};

/** Build payload for approving and executing a plan runtime. */
export function buildPlanExecutionRequest(input: {
  planRuntime: CollaborationPlanRuntime;
  pursueGoal: boolean;
  messageBaseline: number;
  approvedAt?: number;
}): PlanExecutionRequest | null {
  if (input.planRuntime.status !== "awaiting_approval") return null;
  const executionMode: ComposerCollaborationMode = {
    kind: "craft",
    planning: false,
    pursueGoal: input.pursueGoal,
  };
  const approvedAt = input.approvedAt ?? Date.now();
  return {
    executionMode,
    executionSystemPrompt: buildPlanExecutionHiddenSystemPrompt(input.planRuntime),
    nextPlanRuntime: {
      ...input.planRuntime,
      status: "executing",
      approvedAt,
      executionBaseline: input.messageBaseline,
    },
  };
}

/** Build running goal runtime when the user resumes a paused/waiting goal. */
export function buildGoalResumeRuntime(input: {
  runtime: CollaborationGoalRuntime;
  messageBaseline: number;
  now?: number;
  todos?: TodoItem[] | null;
}): CollaborationGoalRuntime | null {
  const runtime = isGoalIntentRuntime(input.runtime) ? input.runtime : null;
  if (!runtime) return null;
  if (runtime.status === "running" || runtime.status === "completed") return null;
  const now = input.now ?? Date.now();
  const totalPausedMs =
    runtime.status === "paused" && runtime.pauseStartedAt
      ? runtime.totalPausedMs + Math.max(0, now - runtime.pauseStartedAt)
      : runtime.totalPausedMs;
  return {
    ...runtime,
    summary: runtime.summary || deriveGoalSummary(runtime.objective),
    status: "running",
    waitingReason: undefined,
    updatedAt: now,
    totalPausedMs,
    pauseStartedAt: undefined,
    lastRunStartedAt: now,
    lastRunMessageBaseline: input.messageBaseline,
    completedAt: undefined,
    lastKnownTodos: (input.todos ?? []).filter((todo) => todo.content.trim()),
  };
}

export function goalResumeCollaborationMode(): ComposerCollaborationMode {
  return {
    planning: false,
    pursueGoal: true,
  };
}

/** Pause a running/waiting goal; null when there is nothing to pause. */
export function buildGoalPauseRuntime(input: {
  runtime: CollaborationGoalRuntime | null | undefined;
  now?: number;
}): CollaborationGoalRuntime | null {
  const runtime = isGoalIntentRuntime(input.runtime) ? input.runtime : null;
  if (!runtime) return null;
  if (runtime.status !== "running" && runtime.status !== "waiting") return null;
  const now = input.now ?? Date.now();
  return {
    ...runtime,
    status: "paused",
    waitingReason: "user",
    updatedAt: now,
    pauseStartedAt: now,
  };
}

/**
 * When aborting a non-goal run, mark active plan drafting/executing as cancelled.
 */
export function buildAbortPlanRuntime(
  planRuntime: CollaborationPlanRuntime | null | undefined,
): CollaborationPlanRuntime | null {
  if (!planRuntime) return null;
  if (
    planRuntime.status !== "executing" &&
    planRuntime.status !== "drafting"
  ) {
    return null;
  }
  return {
    ...planRuntime,
    status: "blocked",
    blockedReason: "cancelled",
  };
}

/**
 * Abort routing: goal pauses via pause path; otherwise cancel plan + stop.
 */
export function resolveAbortAction(input: {
  chatStreaming: boolean;
  collaborationKind: SessionCollaborationKind;
  goalRuntime: CollaborationGoalRuntime | null | undefined;
  planRuntime: CollaborationPlanRuntime | null | undefined;
}): {
  action: "noop" | "pause-goal" | "stop";
  nextPlanRuntime: CollaborationPlanRuntime | null;
} {
  if (!input.chatStreaming) {
    return { action: "noop", nextPlanRuntime: null };
  }
  if (
    input.collaborationKind === "goal" &&
    isGoalIntentRuntime(input.goalRuntime)
  ) {
    return { action: "pause-goal", nextPlanRuntime: null };
  }
  return {
    action: "stop",
    nextPlanRuntime: buildAbortPlanRuntime(input.planRuntime),
  };
}
