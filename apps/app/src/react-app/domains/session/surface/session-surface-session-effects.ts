/**
 * Cross-cutting SessionSurface effects: session reset, notices, inspector,
 * delayed loading, no-visible-output timer, draft sync.
 */
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerMentionKind,
} from "../../../../app/types";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "../../../shell";
import type { ReactComposerNotice } from "./composer/notice";
import type { SessionError } from "./session-surface-support";
import {
  COMPOSER_NOTICE_TIMEOUT_MS,
  DELAYED_SESSION_LOADING_MS,
  NO_VISIBLE_ASSISTANT_OUTPUT_DELAY_MS,
} from "./session-surface-helpers";
import { useSessionActivityStore } from "../status/session-activity-store";

export function useSessionSurfaceSessionEffects(input: {
  workspaceId: string;
  sessionId: string;
  draft: string;
  attachments: ComposerAttachment[];
  mentions: Record<string, ComposerMentionKind>;
  pasteParts: Array<{ id: string; label: string; lines: number }>;
  sending: boolean;
  error: SessionError | null;
  notice: ReactComposerNotice | null;
  setNotice: Dispatch<SetStateAction<ReactComposerNotice | null>>;
  setError: Dispatch<SetStateAction<SessionError | null>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setShowDelayedLoading: Dispatch<SetStateAction<boolean>>;
  setAwaitingAssistantBaseline: Dispatch<SetStateAction<number | null>>;
  setNoVisibleAssistantOutputBaseline: Dispatch<SetStateAction<number | null>>;
  setDismissedErrorMessage: Dispatch<SetStateAction<string | null>>;
  /** Clear local optimistic bubble when leaving the session that owned it. */
  setPendingOutgoingUserMessage?: Dispatch<
    SetStateAction<{ id: string; text: string; createdAt: number } | null>
  >;
  resetHydrationKey: () => void;
  resetActiveRunRefs: () => void;
  pendingSessionLoad: boolean;
  snapshotSessionError: SessionError | null;
  awaitingAssistantBaseline: number | null;
  assistantOutputAfterAwaitStart: boolean;
  liveStatusType: string;
  renderedMessageCount: number;
  buildDraft: (text: string, attachments: ComposerAttachment[]) => ComposerDraft;
  onDraftChange: (draft: ComposerDraft) => void;
}): void {
  const {
    workspaceId,
    sessionId,
    draft,
    attachments,
    mentions,
    pasteParts,
    sending,
    error,
    notice,
    setNotice,
    setError,
    setSending,
    setShowDelayedLoading,
    setAwaitingAssistantBaseline,
    setNoVisibleAssistantOutputBaseline,
    setDismissedErrorMessage,
    setPendingOutgoingUserMessage,
    resetHydrationKey,
    resetActiveRunRefs,
    pendingSessionLoad,
    snapshotSessionError,
    awaitingAssistantBaseline,
    assistantOutputAfterAwaitStart,
    liveStatusType,
    renderedMessageCount,
    buildDraft,
    onDraftChange,
  } = input;

  useEffect(() => {
    resetHydrationKey();
    setError(null);
    setSending(false);
    setShowDelayedLoading(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    resetActiveRunRefs();
    // Optimistic bubble is per-session local state; drop it on tab switch so it
    // cannot stick to the next empty draft/session (seeded cache still holds
    // the real send session when the user returns).
    setPendingOutgoingUserMessage?.(null);
    // Composer draft state lives in the shared store keyed by session id, so
    // switching sessions preserves each session's own in-progress composer.
    setNotice(null);
    // Include workspaceId: surface no longer remounts on every session change,
    // so workspace hops must reset the same ephemeral chrome.
  }, [sessionId, workspaceId]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), COMPOSER_NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [notice, setNotice]);

  // Publish a composer inspector slice so external drivers can read draft
  // state, attachments, mentions, and sending status from the running app.
  useEffect(() => {
    const dispose = publishInspectorSlice("composer", () => ({
      workspaceId,
      sessionId,
      draft,
      draftLength: draft.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
      })),
      mentions,
      pasteParts: pasteParts.map((part) => ({
        id: part.id,
        label: part.label,
        lines: part.lines,
      })),
      sending,
      error,
      hasNotice: Boolean(notice),
    }));
    return dispose;
  }, [
    attachments,
    draft,
    error,
    mentions,
    notice,
    pasteParts,
    sessionId,
    workspaceId,
    sending,
  ]);

  useEffect(() => {
    recordInspectorEvent("session.mounted", {
      workspaceId,
      sessionId,
    });
  }, [sessionId, workspaceId]);

  useEffect(() => {
    if (!pendingSessionLoad) {
      setShowDelayedLoading(false);
      return;
    }
    const id = window.setTimeout(
      () => setShowDelayedLoading(true),
      DELAYED_SESSION_LOADING_MS,
    );
    return () => window.clearTimeout(id);
  }, [pendingSessionLoad, setShowDelayedLoading]);

  useEffect(() => {
    if (!snapshotSessionError) return;
    setSending(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    // End activity run even when the failure only appears on the snapshot
    // (async stream after promptAsync 200) so「准备中」does not stick.
    useSessionActivityStore
      .getState()
      .setError(workspaceId, sessionId, snapshotSessionError.message);
  }, [
    snapshotSessionError,
    sessionId,
    setAwaitingAssistantBaseline,
    setNoVisibleAssistantOutputBaseline,
    setSending,
    workspaceId,
  ]);

  useEffect(() => {
    setDismissedErrorMessage(null);
  }, [sessionId, setDismissedErrorMessage]);

  useEffect(() => {
    if (awaitingAssistantBaseline === null) return;
    if (assistantOutputAfterAwaitStart) {
      return;
    }
    if (
      sending ||
      liveStatusType !== "idle" ||
      renderedMessageCount <= awaitingAssistantBaseline
    )
      return;
    const id = window.setTimeout(() => {
      setNoVisibleAssistantOutputBaseline(awaitingAssistantBaseline);
      setAwaitingAssistantBaseline(null);
    }, NO_VISIBLE_ASSISTANT_OUTPUT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [
    assistantOutputAfterAwaitStart,
    awaitingAssistantBaseline,
    liveStatusType,
    renderedMessageCount,
    sending,
    setAwaitingAssistantBaseline,
    setNoVisibleAssistantOutputBaseline,
  ]);

  useEffect(() => {
    if (liveStatusType === "idle") {
      setSending(false);
    }
  }, [liveStatusType, setSending]);

  useEffect(() => {
    onDraftChange(buildDraft(draft, attachments));
  }, [attachments, buildDraft, draft, onDraftChange]);
}
