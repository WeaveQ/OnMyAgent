/**
 * Permission / question chrome helpers for SessionSurface.
 * Builds respondPermission wrapper + composer accessory props.
 */
import type { ReactNode } from "react";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerCollaborationMode,
  PendingPermission,
  PendingQuestion,
  TodoItem,
} from "../../../../app/types";
import {
  renderSessionComposerAccessories,
} from "./session-surface-goal";
import type { SessionTranscriptNotice } from "./plan-goal/goal-runtime";

export function respondPermissionWithTranscriptNotice(input: {
  requestID: string;
  reply: "reject" | "once" | "always";
  sessionId: string;
  renderedMessageCount: number;
  appendTranscriptNotice: (notice: SessionTranscriptNotice) => void;
  visibleGoalRuntime: CollaborationGoalRuntime | null;
  visiblePlanRuntime: CollaborationPlanRuntime | null;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  respondPermission?: (
    requestID: string,
    reply: "reject" | "once" | "always",
  ) => void;
}): void {
  const {
    requestID,
    reply,
    sessionId,
    renderedMessageCount,
    appendTranscriptNotice,
    visibleGoalRuntime,
    visiblePlanRuntime,
    onGoalRuntimeChange,
    onPlanRuntimeChange,
    respondPermission,
  } = input;

  if (reply === "reject") {
    const now = Date.now();
    appendTranscriptNotice({
      id: `${sessionId}:permission-rejected:${renderedMessageCount}:${now}`,
      kind: "permission-rejected",
      afterMessageCount: renderedMessageCount,
    });
    if (
      visibleGoalRuntime &&
      visibleGoalRuntime.status !== "paused" &&
      visibleGoalRuntime.status !== "completed"
    ) {
      onGoalRuntimeChange?.({
        ...visibleGoalRuntime,
        status: "paused",
        waitingReason: "permission",
        updatedAt: now,
        pauseStartedAt: now,
      });
    }
    if (
      visiblePlanRuntime &&
      (visiblePlanRuntime.status === "executing" ||
        visiblePlanRuntime.status === "drafting")
    ) {
      onPlanRuntimeChange?.({
        ...visiblePlanRuntime,
        status: "blocked",
        blockedReason: "permission_rejected",
      });
    }
  }
  respondPermission?.(requestID, reply);
}

export type BuildSessionComposerAccessoryInput = {
  sessionId: string;
  draftOnly?: boolean;
  visiblePlanRuntime: CollaborationPlanRuntime | null;
  goalRuntime: CollaborationGoalRuntime | null | undefined;
  visibleGoalRuntimeForUi: CollaborationGoalRuntime | null;
  visibleTodos: TodoItem[];
  hasVisibleTodos: boolean;
  busy: boolean;
  canPauseGoal: boolean;
  canResumeGoal: boolean;
  collaborationMode: ComposerCollaborationMode;
  goalDismissed: boolean;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  extraComposerAccessory?: ReactNode;
  activePermission?: PendingPermission | null;
  activePermissionNeedsApproval: boolean;
  permissionReplyBusy?: boolean;
  respondPermission?: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => void;
  safeStringify?: (value: unknown) => string;
  onExecutePlan: () => void;
  onPauseGoal: () => void;
  onResumeGoal: () => void;
  onClearGoalPreview: () => void;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  setDismissedPlanBySessionId: (
    update: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setDismissedGoalBySessionId: (
    update: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setLastTodosBySessionId: (
    update: (current: Record<string, TodoItem[]>) => Record<string, TodoItem[]>,
  ) => void;
  onClearSessionProgress?: () => void;
  stopActiveRun: () => void | Promise<void>;
};

/** Thin wrapper around renderSessionComposerAccessories for SessionSurface. */
export function buildSessionComposerAccessory(
  input: BuildSessionComposerAccessoryInput,
): ReactNode {
  return renderSessionComposerAccessories(input);
}
