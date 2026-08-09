/**
 * Send / stop / plan-execute / goal pause-resume handlers for SessionSurface.
 * Mechanical extract — no product behavior changes.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import type { OnMyAgentSessionSnapshot } from "../../../../app/lib/onmyagent-server";
import { abortSessionSafe } from "../../../../app/lib/opencode-session";
import { createClient } from "../../../../app/lib/opencode";
import { t } from "../../../../i18n";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerAttachment,
  ComposerDraft,
  ComposerCollaborationMode,
  TodoItem,
} from "../../../../app/types";
import { useSessionActivityStore } from "../status/session-activity-store";
import {
  OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX,
  buildOutputLimitContinuationDraft,
} from "../sync/output-limit-recovery";
import {
  manualStopNoticeKind,
  resolveSessionCollaborationKind,
  hasRepeatedGoalAssistantOutput,
} from "./session-run-controller";
import {
  applySendDraftIntents,
  buildGoalPauseRuntime,
  buildGoalResumeRuntime,
  buildPlanExecutionRequest,
  goalResumeCollaborationMode,
  makeSessionRunKey,
  resolveAbortAction,
  shouldBlockCodeDraftSend,
} from "./session-surface-run-orchestration";
import {
  parseSessionError,
  revokeAttachmentPreview,
  type SessionError,
} from "./session-surface-support";
import { messageToReadableText } from "./session-surface-model";
import {
  buildGoalHiddenSystemPrompt,
  createSessionInterruptionNotice,
  goalElapsedMs,
  isGoalIntentRuntime,
  removeRecordKey,
  shouldRecordSessionInterruption,
  type SessionTranscriptNotice,
} from "./plan-goal/goal-runtime";
import { IDLE_STATUS, MAX_TRANSCRIPT_NOTICES_PER_SESSION } from "./session-surface-constants";
import { FOLDER_REQUIRED_BUBBLE_TIMEOUT_MS } from "./session-surface-helpers";
import type { AssistantCategoryId } from "./personal-assistant-config";
import type { UIMessage } from "ai";

type OpencodeClient = ReturnType<typeof createClient>;

export type SessionSurfaceRunHandlersInput = {
  sessionId: string;
  workspaceId: string;
  draftOnly?: boolean;
  draftWorkspaceDirectory?: string | null;
  assistantCodeFeaturesActive: boolean;
  assistantFeatureCategoryId: AssistantCategoryId;
  draft: string;
  attachments: ComposerAttachment[];
  effectiveCollaborationMode: ComposerCollaborationMode;
  goalRuntime: CollaborationGoalRuntime | null | undefined;
  planRuntime: CollaborationPlanRuntime | null | undefined;
  todos?: TodoItem[] | null;
  renderedMessages: UIMessage[];
  renderedMessageCountRef: MutableRefObject<number>;
  chatStreaming: boolean;
  sending: boolean;
  setSending: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<SessionError | null>>;
  setDismissedErrorMessage: Dispatch<SetStateAction<string | null>>;
  setAwaitingAssistantBaseline: Dispatch<SetStateAction<number | null>>;
  setNoVisibleAssistantOutputBaseline: Dispatch<SetStateAction<number | null>>;
  setShowFolderRequiredBubble: Dispatch<SetStateAction<boolean>>;
  setDismissedPlanBySessionId: Dispatch<SetStateAction<Record<string, boolean>>>;
  setDismissedGoalBySessionId: Dispatch<SetStateAction<Record<string, boolean>>>;
  setTranscriptNoticesBySessionId: Dispatch<
    SetStateAction<Record<string, SessionTranscriptNotice[]>>
  >;
  stallRecoveryBySessionId: Record<string, boolean>;
  setStallRecoveryBySessionId: Dispatch<SetStateAction<Record<string, boolean>>>;
  /**
   * Local optimistic user bubble while the cold path (create session / install /
   * prompt) is still running and the transcript query is empty.
   */
  setPendingOutgoingUserMessage: Dispatch<
    SetStateAction<{ id: string; text: string; createdAt: number } | null>
  >;
  buildDraft: (text: string, attachments: ComposerAttachment[]) => ComposerDraft;
  clearComposerSession: (sessionId: string) => void;
  updateCollaborationMode: (mode: ComposerCollaborationMode) => void;
  onSendDraft: (draft: ComposerDraft) => void | Promise<void>;
  onDraftChange: (draft: ComposerDraft) => void;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  outputLimitedAssistantMessage: UIMessage | null | undefined;
  opencodeClient: OpencodeClient;
  queryClient: QueryClient;
  snapshotQueryKey: readonly unknown[];
  statusQueryKey: readonly unknown[];
  snapshotQuery: Pick<UseQueryResult<OnMyAgentSessionSnapshot>, "refetch">;
  visibleError: SessionError | null;
  cancelledError: SessionError | null;
};

/** Run lifecycle handlers (send, abort, plan execute, goal pause/resume, interruptions). */
export function useSessionSurfaceRunHandlers(input: SessionSurfaceRunHandlersInput) {
  const activeRunStartedAtRef = useRef<number | null>(null);
  const activeRunKeyRef = useRef<string | null>(null);
  // React state updates are asynchronous, so two submit events from the same
  // click/shortcut turn can both see `sending === false`. Keep this lock local
  // to the submit promise; it deliberately does not block a later follow-up
  // once OpenCode has accepted the current turn.
  const sendInFlightRef = useRef(false);

  const {
    sessionId,
    workspaceId,
    draftOnly,
    draftWorkspaceDirectory,
    assistantCodeFeaturesActive,
    assistantFeatureCategoryId,
    draft,
    attachments,
    effectiveCollaborationMode,
    goalRuntime,
    planRuntime,
    todos,
    renderedMessages,
    renderedMessageCountRef,
    chatStreaming,
    sending,
    setSending,
    setError,
    setDismissedErrorMessage,
    setAwaitingAssistantBaseline,
    setNoVisibleAssistantOutputBaseline,
    setShowFolderRequiredBubble,
    setDismissedPlanBySessionId,
    setDismissedGoalBySessionId,
    setTranscriptNoticesBySessionId,
    stallRecoveryBySessionId,
    setStallRecoveryBySessionId,
    setPendingOutgoingUserMessage,
    buildDraft,
    clearComposerSession,
    updateCollaborationMode,
    onSendDraft,
    onDraftChange,
    onGoalRuntimeChange,
    onPlanRuntimeChange,
    outputLimitedAssistantMessage,
    opencodeClient,
    queryClient,
    snapshotQueryKey,
    statusQueryKey,
    snapshotQuery,
    visibleError,
    cancelledError,
  } = input;

  /** Clear active-run refs when the session changes (pair with other session-reset effects). */
  const resetActiveRunRefs = useCallback(() => {
    activeRunStartedAtRef.current = null;
    activeRunKeyRef.current = null;
  }, []);

  const recordSessionInterruption = useCallback(
    (
      kind: "cancelled" | "stopped",
      goalRuntimeArg?: CollaborationGoalRuntime,
    ) => {
      const now = Date.now();
      const afterMessageCount = renderedMessageCountRef.current;
      const elapsedMs =
        kind === "stopped" && goalRuntimeArg
          ? goalElapsedMs(goalRuntimeArg, now)
          : undefined;
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[sessionId] ?? [];
        const latestTerminal = [...existing]
          .reverse()
          .find((notice) => notice.kind === "cancelled" || notice.kind === "stopped");
        const storedRunIdentity = useSessionActivityStore
          .getState()
          .getRunIdentity(workspaceId, sessionId);
        const runStartedAt =
          activeRunStartedAtRef.current ??
          storedRunIdentity?.runStartedAt ??
          goalRuntimeArg?.lastRunStartedAt ??
          latestTerminal?.runStartedAt ??
          now;
        const runKey =
          activeRunKeyRef.current ??
          storedRunIdentity?.runKey ??
          latestTerminal?.runKey ??
          `${sessionId}:remote:${runStartedAt}`;
        const notice = createSessionInterruptionNotice({
          sessionId,
          kind,
          runKey,
          afterMessageCount,
          runStartedAt,
          now,
          ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        });
        if (!shouldRecordSessionInterruption({ existing, candidate: notice })) {
          return current;
        }
        return {
          ...current,
          [sessionId]: [...existing, notice].slice(
            -MAX_TRANSCRIPT_NOTICES_PER_SESSION,
          ),
        };
      });
    },
    [renderedMessageCountRef, sessionId, setTranscriptNoticesBySessionId, workspaceId],
  );

  useEffect(() => {
    if (!cancelledError) return;
    recordSessionInterruption("cancelled");
  }, [cancelledError?.message, recordSessionInterruption]);

  const handleOutputLimitContinue = useCallback(async () => {
    if (!outputLimitedAssistantMessage || sending || chatStreaming) return;
    setError(null);
    setDismissedErrorMessage(null);
    const startedAt = Date.now();
    const runKey = `${sessionId}:${startedAt}`;
    activeRunStartedAtRef.current = startedAt;
    activeRunKeyRef.current = runKey;
    if (!draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(workspaceId, sessionId, {
          runKey,
          runStartedAt: startedAt,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    try {
      const continuationDraft = buildOutputLimitContinuationDraft({
        messageID: `${OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX}${crypto.randomUUID()}`,
        prompt: t("session.output_limit_continue_content"),
        hiddenSystemPrompt: t("session.output_limit_continue_hidden"),
      });
      await onSendDraft(continuationDraft);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(workspaceId, sessionId, parsed.message);
      }
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
    } finally {
      setSending(false);
    }
  }, [
    chatStreaming,
    draftOnly,
    onSendDraft,
    outputLimitedAssistantMessage,
    renderedMessages.length,
    sending,
    sessionId,
    setAwaitingAssistantBaseline,
    setDismissedErrorMessage,
    setError,
    setNoVisibleAssistantOutputBaseline,
    setSending,
    workspaceId,
  ]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (sendInFlightRef.current) return;
    if (
      shouldBlockCodeDraftSend({
        assistantCodeFeaturesActive,
        draftOnly: draftOnly,
        assistantFeatureCategoryId,
        draftWorkspaceDirectory: draftWorkspaceDirectory,
      })
    ) {
      setShowFolderRequiredBubble(true);
      window.setTimeout(
        () => setShowFolderRequiredBubble(false),
        FOLDER_REQUIRED_BUBBLE_TIMEOUT_MS,
      );
      return;
    }
    // Intentionally allow sending while the assistant is still streaming.
    // OpenCode accepts follow-up user turns mid-run and queues them; if the
    // backend can't accept the follow-up it'll surface an error via the
    // catch below. This restores the "append a prompt while it's still
    // talking" behavior that the Solid composer had.
    sendInFlightRef.current = true;
    setDismissedPlanBySessionId((current) =>
      removeRecordKey(current, sessionId),
    );
    setDismissedGoalBySessionId((current) =>
      removeRecordKey(current, sessionId),
    );
    setError(null);
    setDismissedErrorMessage(null);
    const startedAt = Date.now();
    const runKey = makeSessionRunKey(sessionId, startedAt);
    activeRunStartedAtRef.current = startedAt;
    activeRunKeyRef.current = runKey;
    if (!draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(workspaceId, sessionId, {
          runKey,
          runStartedAt: startedAt,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    // Paint a local user bubble immediately so draft / empty-session cold paths
    // never sit on a blank "准备中" page while create+prompt is still running.
    if (text) {
      setPendingOutgoingUserMessage({
        id: `msg_local_${crypto.randomUUID()}`,
        text,
        createdAt: startedAt,
      });
    }
    try {
      const stallKey = sessionId;
      const hadStallRecovery = Boolean(stallRecoveryBySessionId[stallKey]);
      const { draft: nextDraft, nextGoalRuntime } = applySendDraftIntents({
        draft: buildDraft(text, attachments),
        text,
        messageBaseline: renderedMessages.length,
        startedAt,
        effectiveCollaborationMode,
        assistantFeatureCategoryId,
        goalRuntime,
        stallRecoveryHiddenPrompt: hadStallRecovery
          ? t("session.stall_recovery_hidden")
          : null,
      });
      if (hadStallRecovery) {
        setStallRecoveryBySessionId((current) =>
          removeRecordKey(current, sessionId),
        );
      }
      if (nextGoalRuntime) {
        onGoalRuntimeChange?.(nextGoalRuntime);
      }
      await onSendDraft(nextDraft);
      attachments.forEach(revokeAttachmentPreview);
      clearComposerSession(sessionId);
      onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(workspaceId, sessionId, parsed.message);
      }
      // Drop the local bubble on failure; keep the composer draft so the user
      // can edit and retry (composer is only cleared after acceptance above).
      setPendingOutgoingUserMessage(null);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [
    attachments,
    assistantCodeFeaturesActive,
    assistantFeatureCategoryId,
    buildDraft,
    clearComposerSession,
    draft,
    draftOnly,
    draftWorkspaceDirectory,
    effectiveCollaborationMode,
    goalRuntime,
    onDraftChange,
    onGoalRuntimeChange,
    onSendDraft,
    renderedMessages.length,
    sessionId,
    setAwaitingAssistantBaseline,
    setDismissedErrorMessage,
    setDismissedGoalBySessionId,
    setDismissedPlanBySessionId,
    setError,
    setNoVisibleAssistantOutputBaseline,
    setPendingOutgoingUserMessage,
    setSending,
    setShowFolderRequiredBubble,
    setStallRecoveryBySessionId,
    stallRecoveryBySessionId,
    workspaceId,
  ]);

  const executeApprovedPlan = useCallback(async () => {
    const runtime = planRuntime;
    if (!runtime) return;
    const request = buildPlanExecutionRequest({
      planRuntime: runtime,
      pursueGoal: effectiveCollaborationMode.pursueGoal,
      messageBaseline: renderedMessages.length,
    });
    if (!request) return;
    const executionPrompt = t("session.plan_runtime_execute");

    setError(null);
    setDismissedErrorMessage(null);
    const startedAt = Date.now();
    const runKey = makeSessionRunKey(sessionId, startedAt);
    activeRunStartedAtRef.current = startedAt;
    activeRunKeyRef.current = runKey;
    if (!draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(workspaceId, sessionId, {
          runKey,
          runStartedAt: startedAt,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    updateCollaborationMode(request.executionMode);
    onPlanRuntimeChange?.(request.nextPlanRuntime);
    try {
      await onSendDraft({
        ...buildDraft(executionPrompt, []),
        messageID: `msg_onmyagent-internal-plan-execute-${crypto.randomUUID()}`,
        collaborationMode: request.executionMode,
        hiddenSystemPrompt: request.executionSystemPrompt,
      });
      onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(workspaceId, sessionId, parsed.message);
      }
      onPlanRuntimeChange?.(runtime);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    buildDraft,
    draftOnly,
    effectiveCollaborationMode.pursueGoal,
    onDraftChange,
    onPlanRuntimeChange,
    onSendDraft,
    planRuntime,
    renderedMessages.length,
    sessionId,
    setAwaitingAssistantBaseline,
    setDismissedErrorMessage,
    setError,
    setNoVisibleAssistantOutputBaseline,
    setSending,
    updateCollaborationMode,
    workspaceId,
  ]);

  const resumeGoalRuntime = useCallback(async () => {
    const runtime = isGoalIntentRuntime(goalRuntime) ? goalRuntime : null;
    if (!runtime) return;
    const now = Date.now();
    const nextRuntime = buildGoalResumeRuntime({
      runtime,
      messageBaseline: renderedMessages.length,
      now,
      todos,
    });
    if (!nextRuntime) return;
    const goalMode = goalResumeCollaborationMode();

    setError(null);
    setDismissedErrorMessage(null);
    const runKey = makeSessionRunKey(sessionId, now);
    activeRunStartedAtRef.current = now;
    activeRunKeyRef.current = runKey;
    if (!draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(workspaceId, sessionId, {
          runKey,
          runStartedAt: now,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    updateCollaborationMode(goalMode);
    onGoalRuntimeChange?.(nextRuntime);
    try {
      await onSendDraft({
        ...buildDraft(t("session.goal_runtime_continue_prompt"), []),
        messageID: `msg_onmyagent-internal-goal-resume-${crypto.randomUUID()}`,
        collaborationMode: goalMode,
        hiddenSystemPrompt: buildGoalHiddenSystemPrompt(nextRuntime),
      });
      onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(workspaceId, sessionId, parsed.message);
      }
      onGoalRuntimeChange?.(runtime);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    buildDraft,
    draftOnly,
    goalRuntime,
    onDraftChange,
    onGoalRuntimeChange,
    onSendDraft,
    renderedMessages.length,
    sessionId,
    setAwaitingAssistantBaseline,
    setDismissedErrorMessage,
    setError,
    setNoVisibleAssistantOutputBaseline,
    setSending,
    todos,
    updateCollaborationMode,
    workspaceId,
  ]);

  const stopActiveRun = useCallback(async () => {
    setError(null);
    setDismissedErrorMessage(null);
    setSending(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    if (!draftOnly) {
      useSessionActivityStore
        .getState()
        .markRunStopped(workspaceId, sessionId);
      // Optimistic idle so the send button restores even if the worker lags
      // on session.status after abort (common on stuck skill retries).
      queryClient.setQueryData(statusQueryKey, IDLE_STATUS);
      queryClient.setQueryData(
        snapshotQueryKey,
        (current: OnMyAgentSessionSnapshot | undefined) =>
          current && current.session.id === sessionId
            ? { ...current, status: IDLE_STATUS }
            : current,
      );
    }
    await abortSessionSafe(opencodeClient, sessionId);
    await snapshotQuery.refetch();
  }, [
    draftOnly,
    opencodeClient,
    queryClient,
    sessionId,
    setAwaitingAssistantBaseline,
    setDismissedErrorMessage,
    setError,
    setNoVisibleAssistantOutputBaseline,
    setSending,
    snapshotQuery,
    snapshotQueryKey,
    statusQueryKey,
    workspaceId,
  ]);

  useEffect(() => {
    const runtime = goalRuntime;
    if (!isGoalIntentRuntime(runtime) || runtime.status !== "running") return;
    const baseline = runtime.lastRunMessageBaseline ?? runtime.messageBaseline;
    const assistantTexts = renderedMessages
      .slice(baseline)
      .filter((message) => message.role === "assistant")
      .map(messageToReadableText);
    if (!hasRepeatedGoalAssistantOutput(assistantTexts)) return;

    onGoalRuntimeChange?.({
      ...runtime,
      status: "waiting",
      waitingReason: "idle",
      updatedAt: Date.now(),
    });
    void stopActiveRun();
  }, [goalRuntime, onGoalRuntimeChange, renderedMessages, stopActiveRun]);

  const pauseGoalRuntime = useCallback(async () => {
    const now = Date.now();
    const pausedRuntime = buildGoalPauseRuntime({
      runtime: goalRuntime,
      now,
    });
    if (pausedRuntime) {
      recordSessionInterruption("stopped", pausedRuntime);
      onGoalRuntimeChange?.(pausedRuntime);
    }
    await stopActiveRun();
  }, [goalRuntime, onGoalRuntimeChange, recordSessionInterruption, stopActiveRun]);

  const handleAbort = useCallback(async () => {
    const collaborationKind = resolveSessionCollaborationKind(
      effectiveCollaborationMode,
      assistantFeatureCategoryId,
    );
    const decision = resolveAbortAction({
      chatStreaming,
      collaborationKind,
      goalRuntime,
      planRuntime,
    });
    if (decision.action === "noop") return;
    if (decision.action === "pause-goal") {
      await pauseGoalRuntime();
      return;
    }
    if (decision.nextPlanRuntime) {
      onPlanRuntimeChange?.(decision.nextPlanRuntime);
    }
    recordSessionInterruption(manualStopNoticeKind(collaborationKind));
    await stopActiveRun();
  }, [
    assistantFeatureCategoryId,
    chatStreaming,
    effectiveCollaborationMode,
    goalRuntime,
    onPlanRuntimeChange,
    pauseGoalRuntime,
    planRuntime,
    recordSessionInterruption,
    stopActiveRun,
  ]);

  const handleDismissError = useCallback(() => {
    if (visibleError?.message) {
      setDismissedErrorMessage(visibleError.message);
    }
    setError(null);
    if (!draftOnly) {
      useSessionActivityStore
        .getState()
        .clearError(workspaceId, sessionId);
    }
  }, [
    draftOnly,
    sessionId,
    setDismissedErrorMessage,
    setError,
    visibleError,
    workspaceId,
  ]);

  return {
    activeRunStartedAtRef,
    activeRunKeyRef,
    resetActiveRunRefs,
    recordSessionInterruption,
    handleOutputLimitContinue,
    handleSend,
    executeApprovedPlan,
    resumeGoalRuntime,
    stopActiveRun,
    pauseGoalRuntime,
    handleAbort,
    handleDismissError,
  };
}
