/**
 * Plan drafting / goal settle / plan execution completion effects for SessionSurface.
 */
import { useEffect } from "react";
import type { UIMessage } from "ai";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  TodoItem,
} from "../../../../app/types";
import { planTextFromMessages } from "./plan-goal/plan-parse";
import {
  isGoalIntentRuntime,
  normalizedTodoItems,
} from "./plan-goal/goal-runtime";
import { settleGoalRuntimeAfterRun } from "./session-run-controller";

export type UseSessionSurfacePlanGoalEffectsInput = {
  chatStreaming: boolean;
  renderedMessages: UIMessage[];
  planRuntime?: CollaborationPlanRuntime | null;
  goalRuntime?: CollaborationGoalRuntime | null;
  todos?: TodoItem[] | null;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
};

export function useSessionSurfacePlanGoalEffects(
  input: UseSessionSurfacePlanGoalEffectsInput,
) {
  useEffect(() => {
    const runtime = input.planRuntime;
    if (!runtime || runtime.status !== "drafting" || input.chatStreaming) return;
    const planText = planTextFromMessages(
      input.renderedMessages.slice(runtime.messageBaseline),
    );
    if (!planText) return;
    input.onPlanRuntimeChange?.({
      ...runtime,
      status: "awaiting_approval",
      planText,
    });
  }, [
    input.chatStreaming,
    input.onPlanRuntimeChange,
    input.planRuntime,
    input.renderedMessages,
  ]);

  useEffect(() => {
    const runtime = input.goalRuntime;
    if (
      !isGoalIntentRuntime(runtime) ||
      runtime.status !== "running" ||
      input.chatStreaming
    ) {
      return;
    }
    const baseline = runtime.lastRunMessageBaseline ?? runtime.messageBaseline;
    const runText = planTextFromMessages(input.renderedMessages.slice(baseline));
    input.onGoalRuntimeChange?.(
      settleGoalRuntimeAfterRun({
        runtime,
        todos: normalizedTodoItems(input.todos ?? undefined),
        runText,
        now: Date.now(),
      }),
    );
  }, [
    input.chatStreaming,
    input.goalRuntime,
    input.onGoalRuntimeChange,
    input.todos,
    input.renderedMessages,
  ]);

  useEffect(() => {
    const runtime = input.planRuntime;
    if (!runtime || runtime.status !== "executing" || input.chatStreaming) return;
    const executionBaseline = runtime.executionBaseline ?? runtime.messageBaseline;
    const executionText = planTextFromMessages(
      input.renderedMessages.slice(executionBaseline),
    );
    if (!executionText) return;
    input.onPlanRuntimeChange?.({
      ...runtime,
      status: "completed",
    });
  }, [
    input.chatStreaming,
    input.onPlanRuntimeChange,
    input.planRuntime,
    input.renderedMessages,
  ]);
}
