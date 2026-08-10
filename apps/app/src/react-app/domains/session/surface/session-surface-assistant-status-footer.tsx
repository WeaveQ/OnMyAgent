/** @jsxImportSource react */
/**
 * Assistant status footer cards for SessionSurface transcript.
 * Mechanical extract from session-surface.tsx.
 */
import { useMemo, type ReactNode } from "react";
import type { UIMessage } from "ai";
import {
  assistantActivityAllowsLoadingTips,
  getAssistantActivityPhaseLabel,
  type AssistantActivity,
} from "./chrome/assistant-activity";
import {
  AssistantNoVisibleOutputCard,
  AssistantStatusSpacer,
  AssistantWaitingCard,
  OutputLimitContinueCard,
} from "./chrome/assistant-status";
import type { SessionError } from "./session-surface-support";

export type SessionSurfaceAssistantStatusFooterInput = {
  showInlineActivityIndicator: boolean;
  assistantActivity: AssistantActivity;
  showNoVisibleAssistantOutput: boolean;
  noVisibleAssistantOutputText: string;
  outputLimitedAssistantMessage: UIMessage | null | undefined;
  visibleTranscriptError: SessionError | null;
  sending: boolean;
  chatStreaming: boolean;
  reserveAssistantStatusSpace: boolean;
  onOutputLimitContinue: () => void;
};

/** Stable footer element for SessionTranscript (memo-friendly). */
export function useSessionSurfaceAssistantStatusFooter(
  input: SessionSurfaceAssistantStatusFooterInput,
): ReactNode {
  const {
    showInlineActivityIndicator,
    assistantActivity,
    showNoVisibleAssistantOutput,
    noVisibleAssistantOutputText,
    outputLimitedAssistantMessage,
    visibleTranscriptError,
    sending,
    chatStreaming,
    reserveAssistantStatusSpace,
    onOutputLimitContinue,
  } = input;

  // Keep footer identity stable across unrelated SessionSurface renders so
  // SessionTranscript's React.memo can skip (avoids full list re-render).
  return useMemo(() => {
    if (showInlineActivityIndicator) {
      return (
        <AssistantWaitingCard
          collapseLayout
          label={getAssistantActivityPhaseLabel(assistantActivity)}
          showTips={assistantActivityAllowsLoadingTips(assistantActivity)}
        />
      );
    }
    if (showNoVisibleAssistantOutput) {
      return (
        <AssistantNoVisibleOutputCard text={noVisibleAssistantOutputText} />
      );
    }
    if (outputLimitedAssistantMessage && !visibleTranscriptError) {
      return (
        <OutputLimitContinueCard
          key={outputLimitedAssistantMessage.id}
          busy={sending || chatStreaming}
          onContinue={onOutputLimitContinue}
        />
      );
    }
    if (reserveAssistantStatusSpace) {
      return <AssistantStatusSpacer />;
    }
    return null;
  }, [
    assistantActivity,
    chatStreaming,
    noVisibleAssistantOutputText,
    onOutputLimitContinue,
    outputLimitedAssistantMessage,
    reserveAssistantStatusSpace,
    sending,
    showInlineActivityIndicator,
    showNoVisibleAssistantOutput,
    visibleTranscriptError,
  ]);
}
