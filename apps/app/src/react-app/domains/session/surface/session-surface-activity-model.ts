/**
 * Assistant wait / activity phase model for SessionSurface (pure + light hook).
 */
import { useMemo } from "react";
import type { UIMessage } from "ai";

import {
  deriveAssistantActivity,
  getAssistantActivityPhaseLabel,
} from "./chrome/assistant-activity";
import {
  assistantFallbackText,
  messageHasVisibleAssistantOutput,
} from "./session-surface-model";
import type { SessionActivityStatus } from "../status/session-activity-store";
import { shouldShowSessionActivity } from "./session-run-controller";
import type { CollaborationGoalRuntime } from "../../../../app/types";
import type { SessionTranscriptNotice } from "./plan-goal/goal-runtime";
import { messageActivityFingerprint } from "./transcript/message-compaction";

export function useSessionSurfaceActivityModel(input: {
  renderedMessages: UIMessage[];
  awaitingAssistantBaseline: number | null;
  noVisibleAssistantOutputBaseline: number | null;
  sessionActivityStatus: SessionActivityStatus;
  chatStreaming: boolean;
  sending: boolean;
  activePermissionNeedsApproval: boolean;
  hasActiveQuestion: boolean;
  goalRuntime: CollaborationGoalRuntime | null | undefined;
  draftOnly?: boolean;
  stopRequested: boolean;
  storedSessionRunKey: string | null;
  transcriptNotices: SessionTranscriptNotice[];
}) {
  const assistantOutputAfterAwaitStart = useMemo(() => {
    if (input.awaitingAssistantBaseline === null) return false;
    return input.renderedMessages
      .slice(input.awaitingAssistantBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [input.awaitingAssistantBaseline, input.renderedMessages]);

  const noVisibleAssistantOutputText = useMemo(() => {
    if (input.noVisibleAssistantOutputBaseline === null) return "";
    return assistantFallbackText(
      input.renderedMessages,
      input.noVisibleAssistantOutputBaseline,
    );
  }, [input.noVisibleAssistantOutputBaseline, input.renderedMessages]);

  const assistantOutputAfterNoVisibleFallback = useMemo(() => {
    if (input.noVisibleAssistantOutputBaseline === null) return false;
    return input.renderedMessages
      .slice(input.noVisibleAssistantOutputBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [input.noVisibleAssistantOutputBaseline, input.renderedMessages]);

  const showAssistantWaitState =
    input.awaitingAssistantBaseline !== null && !assistantOutputAfterAwaitStart;
  const showAssistantRespondingState =
    input.awaitingAssistantBaseline !== null &&
    assistantOutputAfterAwaitStart &&
    input.chatStreaming;

  const effectiveActivityStatus: SessionActivityStatus =
    input.sessionActivityStatus !== "idle"
      ? input.sessionActivityStatus
      : showAssistantWaitState
        ? "thinking"
        : showAssistantRespondingState
          ? "responding"
          : "idle";

  const assistantActivity = deriveAssistantActivity({
    status: effectiveActivityStatus,
    sending: input.sending,
    hasActivePermission: input.activePermissionNeedsApproval,
    hasActiveQuestion: input.hasActiveQuestion,
    messages: input.renderedMessages,
  });

  const activityFingerprint = useMemo(
    () => messageActivityFingerprint(input.renderedMessages),
    [input.renderedMessages],
  );

  const activityVisible = shouldShowSessionActivity({
    chatStreaming: input.chatStreaming,
    activityStatus: effectiveActivityStatus,
    goalRuntime: input.goalRuntime ?? null,
    stopRequested: input.draftOnly ? false : input.stopRequested,
    runInterrupted:
      !input.draftOnly &&
      input.storedSessionRunKey !== null &&
      input.transcriptNotices.some(
        (notice) =>
          (notice.kind === "cancelled" || notice.kind === "stopped") &&
          notice.runKey === input.storedSessionRunKey,
      ),
  });

  const showNoVisibleAssistantOutput =
    input.noVisibleAssistantOutputBaseline !== null &&
    !assistantOutputAfterNoVisibleFallback;

  return {
    assistantOutputAfterAwaitStart,
    noVisibleAssistantOutputText,
    assistantOutputAfterNoVisibleFallback,
    showAssistantWaitState,
    showAssistantRespondingState,
    effectiveActivityStatus,
    assistantActivity,
    activityPhaseLabel: getAssistantActivityPhaseLabel(assistantActivity),
    activityFingerprint,
    activityVisible,
    showNoVisibleAssistantOutput,
  };
}
