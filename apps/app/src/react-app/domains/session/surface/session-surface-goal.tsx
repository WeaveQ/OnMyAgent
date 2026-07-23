/** @jsxImportSource react */
/**
 * Session surface goal/plan accessory stack.
 * Extracted from session-surface.tsx (mechanical UI move).
 */
import type { ReactNode } from "react";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  PendingPermission,
  PendingQuestion,
  TodoItem,
} from "../../../../app/types";
import { PermissionApprovalPanel } from "../components/permission-modal";
import { QuestionPanel } from "../modals/question-modal";
import {
  shouldShowGoalPreview,
  shouldShowGoalRuntime,
} from "./session-run-controller";
import { PlanApprovalPanel, TodoPanel } from "./plan-goal/panels";
import {
  GoalPreviewPanel,
  GoalRuntimePanel,
  isGoalIntentRuntime,
  removeRecordKey,
} from "./plan-goal/goal-runtime";
import type { ComposerCollaborationMode } from "../../../../app/types";
import type { AssistantCategoryId } from "./personal-assistant-config";

export function resolveVisibleGoalRuntime(input: {
  mode: ComposerCollaborationMode;
  categoryId: AssistantCategoryId;
  goalRuntime: CollaborationGoalRuntime | null | undefined;
  dismissed: boolean;
}): CollaborationGoalRuntime | null {
  return shouldShowGoalRuntime({
    mode: input.mode,
    categoryId: input.categoryId,
    goalRuntime: input.goalRuntime ?? null,
    dismissed: input.dismissed,
  }) && isGoalIntentRuntime(input.goalRuntime)
    ? input.goalRuntime
    : null;
}

export function applyGoalWaitingReason(
  visibleGoalRuntime: CollaborationGoalRuntime | null,
  waitingReason: CollaborationGoalRuntime["waitingReason"] | null,
): CollaborationGoalRuntime | null {
  if (
    visibleGoalRuntime &&
    waitingReason &&
    visibleGoalRuntime.status !== "paused" &&
    visibleGoalRuntime.status !== "completed"
  ) {
    return {
      ...visibleGoalRuntime,
      status: "waiting" as const,
      waitingReason,
    };
  }
  return visibleGoalRuntime;
}

export type SessionComposerAccessoriesProps = {
  sessionId: string;
  draftOnly?: boolean;
  visiblePlanRuntime: CollaborationPlanRuntime | null;
  /** Raw goal runtime from props (for preview gate). */
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

export function renderSessionComposerAccessories(
  props: SessionComposerAccessoriesProps,
): ReactNode {
  const planOrTodoAccessory = props.visiblePlanRuntime ? (
    <PlanApprovalPanel
      runtime={props.visiblePlanRuntime}
      todos={props.visibleTodos}
      busy={props.busy}
      onExecute={props.onExecutePlan}
      onCancel={() => {
        props.setDismissedPlanBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        props.onPlanRuntimeChange?.(null);
      }}
      onConfirm={() => {
        props.setDismissedPlanBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        props.onPlanRuntimeChange?.(null);
      }}
    />
  ) : props.hasVisibleTodos ? (
    <TodoPanel todos={props.visibleTodos} />
  ) : null;

  const goalAccessory = props.visibleGoalRuntimeForUi ? (
    <GoalRuntimePanel
      runtime={props.visibleGoalRuntimeForUi}
      busy={props.busy}
      canPause={props.canPauseGoal}
      canResume={props.canResumeGoal}
      onPause={() => {
        if (props.visibleGoalRuntimeForUi?.status === "paused") return;
        props.onPauseGoal();
      }}
      onResume={props.onResumeGoal}
      onClear={() => {
        props.setDismissedGoalBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        props.setDismissedPlanBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        props.setLastTodosBySessionId((current) =>
          removeRecordKey(current, props.sessionId),
        );
        props.onClearSessionProgress?.();
        props.onGoalRuntimeChange?.(null);
        props.onPlanRuntimeChange?.(null);
        void props.stopActiveRun();
      }}
    />
  ) : null;

  const goalPreviewAccessory = shouldShowGoalPreview({
    mode: props.collaborationMode,
    goalRuntime: props.goalRuntime ?? null,
    planRuntime: props.visiblePlanRuntime,
    dismissed: props.goalDismissed,
    hasCreatedSession: !props.draftOnly,
  }) ? (
    <GoalPreviewPanel onClear={props.onClearGoalPreview} />
  ) : null;

  const questionAccessory = props.activeQuestion ? (
    <QuestionPanel
      requestId={props.activeQuestion.id}
      questions={props.activeQuestion.questions}
      busy={props.questionReplyBusy ?? false}
      onReply={(answers) => {
        if (props.activeQuestion) {
          props.respondQuestion?.(props.activeQuestion.id, answers);
        }
      }}
    />
  ) : null;

  const permissionAccessory =
    props.activePermission && props.activePermissionNeedsApproval ? (
      <PermissionApprovalPanel
        permission={props.activePermission}
        busy={props.permissionReplyBusy}
        respondPermission={props.respondPermission}
        safeStringify={props.safeStringify}
      />
    ) : null;

  if (
    !(
      planOrTodoAccessory ||
      goalAccessory ||
      goalPreviewAccessory ||
      questionAccessory ||
      permissionAccessory ||
      props.extraComposerAccessory
    )
  ) {
    return null;
  }

  return (
    <div>
      {permissionAccessory}
      {questionAccessory}
      {props.extraComposerAccessory}
      {planOrTodoAccessory}
      {goalAccessory}
      {goalPreviewAccessory}
    </div>
  );
}
