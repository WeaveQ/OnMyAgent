/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient, unwrap } from "../../../../app/lib/opencode";
import { resolveAccessModePermissionReply } from "../../../../app/lib/access-mode";
import {
  readSessionTranscriptNotices,
  writeSessionTranscriptNotices,
} from "../../../../app/lib/session-transcript-notices";
import { abortSessionSafe } from "../../../../app/lib/opencode-session";
import { currentLocale, t } from "../../../../i18n";
import {
  readWorkspaceCloudImports,
  type CloudImportedPlugin,
} from "../../../../app/cloud/import-state";
import type {
  OnMyAgentSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";
import type {
  ComposerAttachment,
  ComposerCollaborationMode,
  ComposerDraft,
  ComposerPart,
  CollaborationGoalRuntime,
  McpServerEntry,
  McpStatusMap,
  SkillCard,
  TodoItem,
} from "../../../../app/types";
import { publishInspectorSlice, recordInspectorEvent, useReactRenderWatchdog } from "../../../shell";
import {
  deriveAssistantActivity,
  getAssistantActivityPhaseLabel,
} from "./chrome/assistant-activity";
import { CodeSceneToolbar } from "./code-scene-toolbar";
import {
  decodeComposerMentionValue,
  encodeComposerMentionValue,
} from "./composer/mention-encoding";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";

import type { ReactComposerNotice } from "./composer/notice";
import {
  deriveRenderedSessionMessages,
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import {
  type SessionTranscriptDivider,
} from "./message-list";
import { useLocal } from "../../../kernel/local-provider";
import { deriveSessionRenderModel } from "../sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import {
  useSessionActivityStore,
  type SessionActivityStatus,
} from "../status/session-activity-store";
import {
  deriveOpenTargets,
} from "../artifacts/open-target";
import {
  seedSessionState,
  statusKey as reactStatusKey,
  transcriptKey as reactTranscriptKey,
} from "../sync/session-sync";
import {
  OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX,
  buildOutputLimitContinuationDraft,
  latestOutputLimitedAssistantMessage,
} from "../sync/output-limit-recovery";
import {
  deriveGoalSummary,
  manualStopNoticeKind,
  resolveSessionCollaborationKind,
  resolveSessionRunPolicy,
  shouldShowSessionActivity,
  summarizeGoalObjective,
  hasRepeatedGoalAssistantOutput,
} from "./session-run-controller";
import {
  getComposerAttachments,
  getComposerDraft,
  getComposerMentions,
  getComposerPasteParts,
  useComposerStateStore,
} from "./composer-state-store";
import {
  PERSONAL_ASSISTANT_CATEGORIES,
  ONMYAGENT_ASSISTANT_AVATAR,
  onmyagentAssistantName,
  type AssistantCategoryId,
} from "./personal-assistant-config";
import { personalizeAssistantScenariosForMenu } from "./personalize-assistant-scenarios";
import {
  assistantFallbackText,
  messageToReadableText,
  messageHasVisibleAssistantOutput,
  findTranscriptSearchMatchIds,
  transcriptToText,
} from "./session-surface-model";
import {
  parseSessionError,
  readSnapshotSessionError,
  revokeAttachmentPreview,
  type SessionError,
} from "./session-surface-support";
import {
  filterCompactionMessages,
  messageActivityFingerprint,
} from "./transcript/message-compaction";
import { useSharedQueryState, waitForControl } from "./session-surface-hooks";
import { useSessionSurfaceControlActions } from "./session-surface-control-actions";
import { useSessionSurfaceComposerHandlers } from "./session-surface-composer-handlers";
import { useSessionSurfaceCollaboration } from "./session-surface-collaboration";
import { useSessionSurfacePendingAgent } from "./session-surface-pending-agent";
import { useSessionSurfaceOpenTargets } from "./session-surface-open-targets";
import { useSessionSurfaceActivityStall } from "./session-surface-activity-stall";
import { useSessionSurfacePlanGoalEffects } from "./session-surface-plan-goal-effects";
import { SessionSurfaceView } from "./session-surface-view";
import {
  AssistantNoVisibleOutputCard,
  AssistantStatusSpacer,
  AssistantWaitingCard,
  OutputLimitContinueCard,
} from "./chrome/assistant-status";
import { deriveSessionSurfaceLayoutMode } from "./session-surface-layout-mode";
import {
  buildGoalHiddenSystemPrompt,
  buildLocaleRuntimeInstruction,
  buildPlanExecutionHiddenSystemPrompt,
  createSessionInterruptionNotice,
  goalElapsedMs,
  isGoalIntentRuntime,
  removeRecordKey,
  shouldRecordSessionInterruption,
  transcriptNoticeLabel,
  type SessionTranscriptNotice,
} from "./plan-goal/goal-runtime";
import {
  assistantScenarioDraftToken,
  isUserCancelledError,
} from "./chrome/personal-assistant";

import {
  EMPTY_TRANSCRIPT,
  IDLE_STATUS,
  MAX_TRANSCRIPT_NOTICES_PER_SESSION,
} from "./session-surface-constants";
import {
  renderSessionComposerAccessories,
  applyGoalWaitingReason,
  resolveVisibleGoalRuntime,
} from "./session-surface-goal";


export type { SessionSurfaceProps } from "./session-surface-types";
import type { SessionSurfaceProps } from "./session-surface-types";
import { flattenSessionSurfaceProps } from "./session-surface-types";
import { useSessionSurfaceSearch } from "./session-surface-search";

export function SessionSurface(bagProps: SessionSurfaceProps) {
  const props = flattenSessionSurfaceProps(bagProps);
  const local = useLocal();
  const queryClient = useQueryClient();
  const showThinking = local.prefs.showThinking;
  const storedSessionActivityStatus = useSessionActivityStore(
    (state) =>
      state.statusesByWorkspaceId[props.workspaceId]?.[props.sessionId] ??
      "idle",
  );
  const storedSessionActivityError = useSessionActivityStore((state) =>
    state.getErrorMessage(props.workspaceId, props.sessionId),
  );
  const storedSessionStopRequested = useSessionActivityStore((state) =>
    state.getStopRequested(props.workspaceId, props.sessionId),
  );
  const storedSessionRunKey = useSessionActivityStore((state) =>
    state.recordsByWorkspaceId[props.workspaceId]?.[props.sessionId]?.runKey ?? null,
  );
  const sessionActivityStatus = props.draftOnly
    ? "idle"
    : storedSessionActivityStatus;
  const sessionActivityError =
    props.draftOnly || sessionActivityStatus !== "error"
      ? null
      : storedSessionActivityError || t("app.error_request_failed");
  const draft = useComposerStateStore((state) =>
    getComposerDraft(state, props.sessionId),
  );
  const [internalAssistantCategoryId, setInternalAssistantCategoryId] =
    useState<AssistantCategoryId>("office");
  const assistantCategoryId =
    props.personalAssistantCategoryId ?? internalAssistantCategoryId;
  const assistantFeatureCategoryId =
    props.assistantFeatureCategoryId ?? assistantCategoryId;
  const assistantOfficeFeaturesActive =
    props.personalAssistantHome || props.assistantFeatureCategoryId === "office";
  const assistantCodeFeaturesActive =
    props.personalAssistantHome || props.assistantFeatureCategoryId === "code";
  const setAssistantCategoryId =
    props.onPersonalAssistantCategoryChange ?? setInternalAssistantCategoryId;
  const [assistantScenarioId, setAssistantScenarioId] = useState<string | null>(
    null,
  );
  const [showFolderRequiredBubble, setShowFolderRequiredBubble] =
    useState(false);
  const [dismissedPlanBySessionId, setDismissedPlanBySessionId] =
    useState<Record<string, boolean>>({});
  const [dismissedGoalBySessionId, setDismissedGoalBySessionId] =
    useState<Record<string, boolean>>({});
  const planDismissedForSession =
    dismissedPlanBySessionId[props.sessionId] === true;
  const goalDismissedForSession =
    dismissedGoalBySessionId[props.sessionId] === true;
  const {
    effectiveAccessMode,
    effectiveCollaborationMode,
    updateAccessMode,
    updateCollaborationMode,
  } = useSessionSurfaceCollaboration({
    sessionAccessMode: props.sessionAccessMode,
    onSessionAccessModeChange: props.onSessionAccessModeChange,
    sessionCollaborationMode: props.sessionCollaborationMode,
    onSessionCollaborationModeChange: props.onSessionCollaborationModeChange,
    onPlanRuntimeChange: props.onPlanRuntimeChange,
    onGoalRuntimeChange: props.onGoalRuntimeChange,
    assistantOfficeFeaturesActive,
    assistantFeatureCategoryId,
  });
  const attachments = useComposerStateStore((state) =>
    getComposerAttachments(state, props.sessionId),
  );
  const mentions = useComposerStateStore((state) =>
    getComposerMentions(state, props.sessionId),
  );
  const pasteParts = useComposerStateStore((state) =>
    getComposerPasteParts(state, props.sessionId),
  );
  const setComposerDraft = useComposerStateStore((state) => state.setDraft);
  const setComposerAttachments = useComposerStateStore(
    (state) => state.setAttachments,
  );
  const setComposerMentions = useComposerStateStore(
    (state) => state.setMentions,
  );
  const setComposerPasteParts = useComposerStateStore(
    (state) => state.setPasteParts,
  );
  const clearComposerSession = useComposerStateStore(
    (state) => state.clearSession,
  );
  const assistantCategory =
    PERSONAL_ASSISTANT_CATEGORIES.find(
      (category) => category.id === assistantCategoryId,
    ) ?? PERSONAL_ASSISTANT_CATEGORIES[1]!;
  const assistantScenarioTags = assistantCategory.scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
  }));
  // Composer middle flyout: short list ranked by onboarding role/industry/tasks.
  const personalizedPromptTemplates = useMemo(() => {
    if (!props.personalAssistantHome || !props.draftOnly) return undefined;
    return personalizeAssistantScenariosForMenu(
      assistantCategory.scenarios,
      local.prefs.onboardingProfile,
    );
  }, [
    assistantCategory.scenarios,
    local.prefs.onboardingProfile,
    props.draftOnly,
    props.personalAssistantHome,
  ]);
  useEffect(() => {
    if (!props.personalAssistantHome) return;
    props.onPersonalAssistantCategoryActive?.(assistantCategoryId);
  }, [assistantCategoryId, props.personalAssistantHome, props.onPersonalAssistantCategoryActive]);

  useEffect(() => {
    if (!assistantScenarioId) return;
    if (draft.includes(assistantScenarioDraftToken(assistantScenarioId))) return;
    setAssistantScenarioId(null);
  }, [assistantScenarioId, draft]);

  const { effectiveAgent } = useSessionSurfacePendingAgent({
    personalAssistantHome: props.personalAssistantHome,
    sessionId: props.sessionId,
    agentContext: props.agentContext,
  });
  const [notice, setNotice] = useState<ReactComposerNotice | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [dismissedErrorMessage, setDismissedErrorMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [awaitingAssistantBaseline, setAwaitingAssistantBaseline] = useState<
    number | null
  >(null);
  const [
    noVisibleAssistantOutputBaseline,
    setNoVisibleAssistantOutputBaseline,
  ] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{
    sessionId: string;
    snapshot: OnMyAgentSessionSnapshot;
  } | null>(null);
  const [toolSkills, setToolSkills] = useState<SkillCard[]>([]);
  const [toolMcpServers, setToolMcpServers] = useState<McpServerEntry[]>([]);
  const [toolMcpStatus, setToolMcpStatus] = useState<string | null>(null);
  const [toolMcpStatuses, setToolMcpStatuses] = useState<McpStatusMap>({});
  const [toolImportedPlugins, setToolImportedPlugins] = useState<
    CloudImportedPlugin[]
  >([]);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  const opencodeClient = useMemo(
    () =>
      createClient(props.opencodeBaseUrl, undefined, {
        token: props.onmyagentToken,
        mode: "onmyagent",
      }),
    [props.opencodeBaseUrl, props.onmyagentToken],
  );

  const snapshotQueryKey = useMemo(
    () => ["react-session-snapshot", props.workspaceId, props.sessionId],
    [props.workspaceId, props.sessionId],
  );
  const transcriptQueryKey = useMemo(
    () => reactTranscriptKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const statusQueryKey = useMemo(
    () => reactStatusKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const snapshotQuery = useQuery<OnMyAgentSessionSnapshot>({
    queryKey: snapshotQueryKey,
    enabled: !props.draftOnly,
    queryFn: async () =>
      (
        await props.client.getSessionSnapshot(
          props.workspaceId,
          props.sessionId,
          { limit: 140, directory: props.workspaceRoot },
        )
      ).item,
    staleTime: 500,
  });
  const currentSnapshot =
    snapshotQuery.data?.session.id === props.sessionId
      ? snapshotQuery.data
      : null;
  const transcriptState = useSharedQueryState<UIMessage[]>(
    transcriptQueryKey,
    EMPTY_TRANSCRIPT,
  );
  const statusState = useSharedQueryState(
    statusQueryKey,
    currentSnapshot?.status ?? IDLE_STATUS,
  );
  const [compactBoundaryBySessionId, setCompactBoundaryBySessionId] =
    useState<Record<string, number>>({});
  const [transcriptNoticesBySessionId, setTranscriptNoticesBySessionId] =
    useState<Record<string, SessionTranscriptNotice[]>>(
      readSessionTranscriptNotices,
    );
  const [stallRecoveryBySessionId, setStallRecoveryBySessionId] =
    useState<Record<string, boolean>>({});
  const activeRunStartedAtRef = useRef<number | null>(null);
  const activeRunKeyRef = useRef<string | null>(null);
  const compactWasActiveRef = useRef<Record<string, boolean>>({});
  const autoApprovedPermissionNoticeRef = useRef<Record<string, string>>({});
  useEffect(() => {
    writeSessionTranscriptNotices(transcriptNoticesBySessionId);
  }, [transcriptNoticesBySessionId]);
  const compactBoundary = compactBoundaryBySessionId[props.sessionId] ?? null;

  useEffect(() => {
    if (!currentSnapshot) return;
    setRendered({ sessionId: props.sessionId, snapshot: currentSnapshot });
  }, [props.sessionId, currentSnapshot]);

  useEffect(() => {
    hydratedKeyRef.current = null;
    setError(null);
    setSending(false);
    setShowDelayedLoading(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    activeRunStartedAtRef.current = null;
    activeRunKeyRef.current = null;
    // Composer draft state lives in the shared store keyed by session id, so
    // switching sessions preserves each session's own in-progress composer.
    setNotice(null);
  }, [props.sessionId]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!props.personalAssistantHome) return;
    setAssistantScenarioId(null);
    setComposerDraft(props.sessionId, "");
  }, [
    assistantCategoryId,
    props.personalAssistantHome,
    props.sessionId,
    setComposerDraft,
  ]);

  // Publish a composer inspector slice so external drivers can read draft
  // state, attachments, mentions, and sending status from the running app.
  useEffect(() => {
    const dispose = publishInspectorSlice("composer", () => ({
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
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
    props.sessionId,
    props.workspaceId,
    sending,
  ]);

  useEffect(() => {
    recordInspectorEvent("session.mounted", {
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
    });
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [currentSnapshot, props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const key = `${props.sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [props.sessionId, currentSnapshot, props.workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId: props.sessionId,
    currentSnapshot,
    cachedRendered: rendered,
  });
  const liveStatus = statusState ?? snapshot?.status ?? IDLE_STATUS;
  // User stop must clear the red stop button immediately. Backend may keep
  // reporting busy/retry briefly after abort (especially failed skill runs),
  // so respect stopRequested and don't keep the composer locked.
  const remoteBusy =
    liveStatus.type === "busy" || liveStatus.type === "retry";
  const stopHidesRemoteBusy =
    !props.draftOnly && storedSessionStopRequested;
  const chatStreaming =
    sending || (remoteBusy && !stopHidesRemoteBusy);
  const rawRenderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot }),
    [snapshot, transcriptState],
  );
  const renderedMessages = useMemo(
    () => filterCompactionMessages(rawRenderedMessages, compactBoundary),
    [compactBoundary, rawRenderedMessages],
  );
  const scrollToMessageByIdRef = useRef<
    ((messageId: string, behavior?: ScrollBehavior) => boolean) | null
  >(null);
  const {
    searchQuery,
    searchMatchIdSet,
    activeSearchMessageId,
  } = useSessionSurfaceSearch({
    messages: renderedMessages,
    searchQuery: props.searchQuery,
    activeMatchIndex: props.searchActiveMatchIndex,
    onSearchMatchCountChange: props.onSearchMatchCountChange,
    scrollToMessageById: (messageId, behavior) =>
      scrollToMessageByIdRef.current?.(messageId, behavior) ?? false,
  });
  const outputLimitedAssistantMessage = useMemo(
    () => latestOutputLimitedAssistantMessage(renderedMessages),
    [renderedMessages],
  );
  const handleOutputLimitContinue = useCallback(async () => {
    if (!outputLimitedAssistantMessage || sending || chatStreaming) return;
    setError(null);
    setDismissedErrorMessage(null);
    const startedAt = Date.now();
    const runKey = `${props.sessionId}:${startedAt}`;
    activeRunStartedAtRef.current = startedAt;
    activeRunKeyRef.current = runKey;
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(props.workspaceId, props.sessionId, {
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
      await props.onSendDraft(continuationDraft);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
    } finally {
      setSending(false);
    }
  }, [
    chatStreaming,
    outputLimitedAssistantMessage,
    props.draftOnly,
    props.onSendDraft,
    props.sessionId,
    props.workspaceId,
    renderedMessages.length,
    sending,
  ]);
  const renderedMessageCountRef = useRef(renderedMessages.length);
  renderedMessageCountRef.current = renderedMessages.length;
  const appendTranscriptNotice = useCallback(
    (notice: SessionTranscriptNotice) => {
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[props.sessionId] ?? [];
        return {
          ...current,
          [props.sessionId]: [...existing, notice].slice(
            -MAX_TRANSCRIPT_NOTICES_PER_SESSION,
          ),
        };
      });
    },
    [props.sessionId],
  );
  const updateLatestTranscriptNotice = useCallback(
    (
      predicate: (notice: SessionTranscriptNotice) => boolean,
      update: (notice: SessionTranscriptNotice) => SessionTranscriptNotice,
    ) => {
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[props.sessionId] ?? [];
        let targetIndex = -1;
        for (let index = existing.length - 1; index >= 0; index -= 1) {
          const notice = existing[index];
          if (notice && predicate(notice)) {
            targetIndex = index;
            break;
          }
        }
        if (targetIndex < 0) return current;
        const next = [...existing];
        const target = next[targetIndex];
        if (!target) return current;
        next[targetIndex] = update(target);
        return { ...current, [props.sessionId]: next };
      });
    },
    [props.sessionId],
  );
  useEffect(() => {
    const noticeId = props.autoApprovedPermissionNoticeId?.trim();
    if (!noticeId) return;
    if (autoApprovedPermissionNoticeRef.current[props.sessionId] === noticeId) {
      return;
    }
    autoApprovedPermissionNoticeRef.current = {
      ...autoApprovedPermissionNoticeRef.current,
      [props.sessionId]: noticeId,
    };
    appendTranscriptNotice({
      id: `${props.sessionId}:permission-auto-approved:${noticeId}`,
      kind: "permission-auto-approved",
      afterMessageCount: renderedMessages.length,
    });
  }, [
    appendTranscriptNotice,
    props.autoApprovedPermissionNoticeId,
    props.sessionId,
    renderedMessages.length,
  ]);
  useEffect(() => {
    const compacting = sessionActivityStatus === "compacting";
    const wasCompacting = compactWasActiveRef.current[props.sessionId] === true;
    if (compacting) {
      if (!wasCompacting) {
        setCompactBoundaryBySessionId((current) => ({
          ...current,
          [props.sessionId]: rawRenderedMessages.length,
        }));
        appendTranscriptNotice({
          id: `${props.sessionId}:compacting:${renderedMessages.length}:${Date.now()}`,
          kind: "compacting",
          afterMessageCount: renderedMessages.length,
        });
      }
      compactWasActiveRef.current = {
        ...compactWasActiveRef.current,
        [props.sessionId]: true,
      };
      return;
    }
    if (wasCompacting) {
      compactWasActiveRef.current = {
        ...compactWasActiveRef.current,
        [props.sessionId]: false,
      };
      updateLatestTranscriptNotice(
        (notice) => notice.kind === "compacting",
        (notice) => ({ ...notice, kind: "compacted" }),
      );
    }
  }, [
    appendTranscriptNotice,
    props.sessionId,
    rawRenderedMessages.length,
    renderedMessages.length,
    sessionActivityStatus,
    updateLatestTranscriptNotice,
  ]);
  useSessionSurfacePlanGoalEffects({
    chatStreaming,
    renderedMessages,
    planRuntime: props.planRuntime,
    goalRuntime: props.goalRuntime,
    todos: props.todos,
    onPlanRuntimeChange: props.onPlanRuntimeChange,
    onGoalRuntimeChange: props.onGoalRuntimeChange,
  });
  const snapshotSessionError = useMemo(
    () => readSnapshotSessionError(snapshot),
    [snapshot],
  );
  const openTargets = useMemo(
    // Include file paths mentioned in assistant/user text so workspace-relative
    // deliverables (incl. CJK names) surface in the side-panel Files tab.
    () => deriveOpenTargets(renderedMessages, { includeFileMentions: true }),
    [renderedMessages],
  );
  const openTargetsFingerprint = useMemo(
    () =>
      openTargets
        .map((target) => `${target.kind}:${target.value}:${target.confidence}`)
        .join("|"),
    [openTargets],
  );
  const { verifiedOpenTargets } = useSessionSurfaceOpenTargets({
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    client: props.client,
    openTargets,
    openTargetsFingerprint,
    chatStreaming,
    onOpenTarget: props.onOpenTarget,
    onOpenTargetsChange: props.onOpenTargetsChange,
  });
  const pendingSessionLoad =
    !props.draftOnly &&
    !snapshot &&
    snapshotQuery.isLoading &&
    renderedMessages.length === 0;
  const assistantOutputAfterAwaitStart = useMemo(() => {
    if (awaitingAssistantBaseline === null) return false;
    return renderedMessages
      .slice(awaitingAssistantBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [awaitingAssistantBaseline, renderedMessages]);
  const noVisibleAssistantOutputText = useMemo(() => {
    if (noVisibleAssistantOutputBaseline === null) return "";
    return assistantFallbackText(
      renderedMessages,
      noVisibleAssistantOutputBaseline,
    );
  }, [noVisibleAssistantOutputBaseline, renderedMessages]);
  const assistantOutputAfterNoVisibleFallback = useMemo(() => {
    if (noVisibleAssistantOutputBaseline === null) return false;
    return renderedMessages
      .slice(noVisibleAssistantOutputBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [noVisibleAssistantOutputBaseline, renderedMessages]);
  const showAssistantWaitState =
    awaitingAssistantBaseline !== null && !assistantOutputAfterAwaitStart;
  const showAssistantRespondingState =
    awaitingAssistantBaseline !== null &&
    assistantOutputAfterAwaitStart &&
    chatStreaming;
  const effectiveActivityStatus: SessionActivityStatus =
    sessionActivityStatus !== "idle"
      ? sessionActivityStatus
      : showAssistantWaitState
        ? "thinking"
        : showAssistantRespondingState
          ? "responding"
          : "idle";
  const activePermissionNeedsApproval = Boolean(
    props.activePermission &&
      !resolveAccessModePermissionReply(
        effectiveAccessMode,
        props.activePermission.permission,
      ),
  );
  const assistantActivity = deriveAssistantActivity({
    status: effectiveActivityStatus,
    sending,
    hasActivePermission: activePermissionNeedsApproval,
    hasActiveQuestion: Boolean(props.activeQuestion),
    messages: renderedMessages,
  });
  const activityFingerprint = useMemo(
    () => messageActivityFingerprint(renderedMessages),
    [renderedMessages],
  );
  const activityVisible = shouldShowSessionActivity({
    chatStreaming,
    activityStatus: effectiveActivityStatus,
    goalRuntime: props.goalRuntime ?? null,
    stopRequested: props.draftOnly ? false : storedSessionStopRequested,
    runInterrupted:
      !props.draftOnly &&
      storedSessionRunKey !== null &&
      (transcriptNoticesBySessionId[props.sessionId] ?? []).some(
        (notice) =>
          (notice.kind === "cancelled" || notice.kind === "stopped") &&
          notice.runKey === storedSessionRunKey,
      ),
  });
  const { showStalledActivityNotice, shouldInjectStallRecovery } =
    useSessionSurfaceActivityStall({
      sessionId: props.sessionId,
      activityFingerprint,
      effectiveActivityStatus,
      liveStatusType: liveStatus.type,
      activityVisible,
    });
  const visibleError = [
    error,
    sessionActivityError ? { message: sessionActivityError } : null,
    snapshotSessionError,
  ].find((item) => item && item.message !== dismissedErrorMessage) ?? null;
  const cancelledError =
    visibleError && isUserCancelledError(visibleError) ? visibleError : null;
  const visibleTranscriptError = cancelledError ? null : visibleError;
  useEffect(() => {
    if (!shouldInjectStallRecovery) return;
    setStallRecoveryBySessionId((current) => {
      if (current[props.sessionId]) return current;
      return { ...current, [props.sessionId]: true };
    });
  }, [props.sessionId, shouldInjectStallRecovery]);
  const interruptionDividers = useMemo<SessionTranscriptDivider[]>(() => {
    const notices = transcriptNoticesBySessionId[props.sessionId] ?? [];
    return notices.map((notice) => ({
      id: notice.id,
      afterMessageCount: notice.afterMessageCount,
      label: transcriptNoticeLabel(notice),
      variant: notice.kind,
    }));
  }, [props.sessionId, transcriptNoticesBySessionId]);
  const hasTranscriptContent =
    renderedMessages.length > 0 || interruptionDividers.length > 0;
  const showNoVisibleAssistantOutput =
    noVisibleAssistantOutputBaseline !== null &&
    !assistantOutputAfterNoVisibleFallback;
  const showInlineActivityIndicator =
    hasTranscriptContent &&
    activityVisible &&
    effectiveActivityStatus !== "compacting" &&
    !visibleTranscriptError;
  const reserveAssistantStatusSpace =
    effectiveActivityStatus === "idle" &&
    awaitingAssistantBaseline !== null &&
    assistantOutputAfterAwaitStart &&
    !chatStreaming;
  // Keep footer identity stable across unrelated SessionSurface renders so
  // SessionTranscript's React.memo can skip (avoids full list re-render).
  const assistantStatusFooter = useMemo(() => {
    if (showInlineActivityIndicator) {
      return (
        <AssistantWaitingCard
          collapseLayout
          label={getAssistantActivityPhaseLabel(assistantActivity)}
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
          onContinue={() => {
            void handleOutputLimitContinue();
          }}
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
    outputLimitedAssistantMessage,
    reserveAssistantStatusSpace,
    sending,
    showInlineActivityIndicator,
    showNoVisibleAssistantOutput,
    visibleTranscriptError,
  ]);
  useReactRenderWatchdog("SessionSurface", {
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    messageCount: renderedMessages.length,
    liveStatus: liveStatus.type,
    sending,
    pendingSessionLoad,
    showAssistantWaitState,
    showAssistantRespondingState,
    noVisibleAssistantOutputBaseline,
    hasSnapshot: Boolean(snapshot),
  });

  useEffect(() => {
    if (!pendingSessionLoad) {
      setShowDelayedLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowDelayedLoading(true), 2000);
    return () => window.clearTimeout(id);
  }, [pendingSessionLoad]);

  useEffect(() => {
    if (!snapshotSessionError) return;
    setSending(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
  }, [snapshotSessionError]);

  useEffect(() => {
    setDismissedErrorMessage(null);
  }, [props.sessionId]);

  useEffect(() => {
    if (awaitingAssistantBaseline === null) return;
    if (assistantOutputAfterAwaitStart) {
      return;
    }
    if (
      sending ||
      liveStatus.type !== "idle" ||
      renderedMessages.length <= awaitingAssistantBaseline
    )
      return;
    const id = window.setTimeout(() => {
      setNoVisibleAssistantOutputBaseline(awaitingAssistantBaseline);
      setAwaitingAssistantBaseline(null);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [
    assistantOutputAfterAwaitStart,
    awaitingAssistantBaseline,
    liveStatus.type,
    renderedMessages.length,
    sending,
  ]);

  const model = deriveSessionRenderModel({
    intendedSessionId: props.sessionId,
    renderedSessionId:
      renderedMessages.length > 0 || snapshot ? props.sessionId : null,
    hasSnapshot: Boolean(snapshot) || renderedMessages.length > 0,
    isFetching: !props.draftOnly && snapshotQuery.isFetching,
    isError:
      (!props.draftOnly && snapshotQuery.isError) || Boolean(visibleError),
  });

  const buildDraft = useCallback(
    (text: string, nextAttachments: ComposerAttachment[]): ComposerDraft => {
      const parts: ComposerPart[] = text
        .split(/(\[\[assistant-scenario:[^\]]+\]\]|\[pasted text [^\]]+\]|@[^\s@]+)/)
        .flatMap((segment) => {
          if (!segment) return [] as ComposerDraft["parts"];
          if (/^\[\[assistant-scenario:[^\]]+\]\]$/.test(segment)) {
            return [] as ComposerDraft["parts"];
          }
          const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
          if (pasteMatch) {
            const target = pasteParts.find(
              (item) => item.label === pasteMatch[1],
            );
            if (target) {
              return [
                {
                  type: "paste",
                  id: target.id,
                  label: target.label,
                  text: target.text,
                  lines: target.lines,
                },
              ];
            }
          }
          if (segment.startsWith("@")) {
            const value = decodeComposerMentionValue(segment.slice(1));
            const kind = mentions[value];
            if (kind === "agent")
              return [
                {
                  type: "agent",
                  name: value,
                } satisfies ComposerDraft["parts"][number],
              ];
            if (kind === "file")
              return [
                {
                  type: "file",
                  path: value,
                  label: value,
                } satisfies ComposerDraft["parts"][number],
              ];
          }
          return [
            {
              type: "text",
              text: segment,
            } satisfies ComposerDraft["parts"][number],
          ];
        });
      // Expand paste placeholders in resolvedText so the model receives
      // the actual pasted content instead of "[pasted text <label>]".
      let resolved = text;
      for (const part of pasteParts) {
        resolved = resolved.replace(`[pasted text ${part.label}]`, part.text);
      }
      for (const value of Object.keys(mentions)) {
        resolved = resolved.replaceAll(
          `@${encodeComposerMentionValue(value)}`,
          `@${value}`,
        );
      }
      const resolvedSlashMatch = resolved.trim().match(/^\/([^\s]+)\s*(.*)$/);
      return {
        mode: "prompt",
        parts,
        attachments: nextAttachments,
        accessMode: effectiveAccessMode,
        collaborationMode: effectiveCollaborationMode,
        text,
        resolvedText: resolved,
        command: resolvedSlashMatch
          ? {
              name: resolvedSlashMatch[1] ?? "",
              arguments: resolvedSlashMatch[2] ?? "",
            }
          : undefined,
      };
    },
    [assistantFeatureCategoryId, assistantOfficeFeaturesActive, effectiveAccessMode, effectiveCollaborationMode, mentions, pasteParts],
  );

  const handleComposerDraftChange = useCallback(
    (value: string) => {
      setComposerDraft(props.sessionId, value);
    },
    [props.sessionId, setComposerDraft],
  );

  const recordSessionInterruption = useCallback(
    (
      kind: "cancelled" | "stopped",
      goalRuntime?: CollaborationGoalRuntime,
    ) => {
      const now = Date.now();
      const afterMessageCount = renderedMessageCountRef.current;
      const elapsedMs =
        kind === "stopped" && goalRuntime
          ? goalElapsedMs(goalRuntime, now)
          : undefined;
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[props.sessionId] ?? [];
        const latestTerminal = [...existing]
          .reverse()
          .find((notice) => notice.kind === "cancelled" || notice.kind === "stopped");
        const storedRunIdentity = useSessionActivityStore
          .getState()
          .getRunIdentity(props.workspaceId, props.sessionId);
        const runStartedAt =
          activeRunStartedAtRef.current ??
          storedRunIdentity?.runStartedAt ??
          goalRuntime?.lastRunStartedAt ??
          latestTerminal?.runStartedAt ??
          now;
        const runKey =
          activeRunKeyRef.current ??
          storedRunIdentity?.runKey ??
          latestTerminal?.runKey ??
          `${props.sessionId}:remote:${runStartedAt}`;
        const notice = createSessionInterruptionNotice({
          sessionId: props.sessionId,
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
          [props.sessionId]: [...existing, notice].slice(
            -MAX_TRANSCRIPT_NOTICES_PER_SESSION,
          ),
        };
      });
    },
    [
      props.sessionId,
      props.workspaceId,
    ],
  );

  useEffect(() => {
    if (!cancelledError) return;
    recordSessionInterruption("cancelled");
  }, [cancelledError?.message, recordSessionInterruption]);

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptToText(renderedMessages));
    } catch (nextError) {
      setError({
        message:
          nextError instanceof Error
            ? nextError.message
            : t("session.copy_transcript_failed"),
      });
    }
  };

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (
      assistantCodeFeaturesActive &&
      props.draftOnly &&
      assistantFeatureCategoryId === "code" &&
      !props.draftWorkspaceDirectory?.trim()
    ) {
      setShowFolderRequiredBubble(true);
      window.setTimeout(() => setShowFolderRequiredBubble(false), 2600);
      return;
    }
    // Intentionally allow sending while the assistant is still streaming.
    // OpenCode accepts follow-up user turns mid-run and queues them; if the
    // backend can't accept the follow-up it'll surface an error via the
    // catch below. This restores the "append a prompt while it's still
    // talking" behavior that the Solid composer had.
    setDismissedPlanBySessionId((current) =>
      removeRecordKey(current, props.sessionId),
    );
    setDismissedGoalBySessionId((current) =>
      removeRecordKey(current, props.sessionId),
    );
    setError(null);
    setDismissedErrorMessage(null);
    const startedAt = Date.now();
    const runKey = `${props.sessionId}:${startedAt}`;
    activeRunStartedAtRef.current = startedAt;
    activeRunKeyRef.current = runKey;
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(props.workspaceId, props.sessionId, {
          runKey,
          runStartedAt: startedAt,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    try {
      const nextDraft = buildDraft(text, attachments);
      if (stallRecoveryBySessionId[props.sessionId]) {
        nextDraft.hiddenSystemPrompt = [
          nextDraft.hiddenSystemPrompt,
          t("session.stall_recovery_hidden"),
        ]
          .filter(Boolean)
          .join("\n\n");
        setStallRecoveryBySessionId((current) =>
          removeRecordKey(current, props.sessionId),
        );
      }
      const goalMode =
        resolveSessionCollaborationKind(
          effectiveCollaborationMode,
          assistantFeatureCategoryId,
        ) === "goal";
      if (
        effectiveCollaborationMode.kind === "plan" ||
        effectiveCollaborationMode.planning
      ) {
        nextDraft.planningIntent = {
          originalPrompt: text,
          messageBaseline: renderedMessages.length,
        };
      }
      const currentGoalRuntime = isGoalIntentRuntime(props.goalRuntime)
        ? props.goalRuntime
        : null;
      if (goalMode && !currentGoalRuntime) {
        nextDraft.goalIntent = {
          objective: nextDraft.resolvedText ?? text,
          messageBaseline: renderedMessages.length,
        };
      } else if (goalMode && currentGoalRuntime) {
        const runtimeWithSummary = currentGoalRuntime.summary
          ? currentGoalRuntime
          : {
              ...currentGoalRuntime,
              summary: deriveGoalSummary(currentGoalRuntime.objective),
            };
        nextDraft.hiddenSystemPrompt = buildGoalHiddenSystemPrompt(runtimeWithSummary);
        props.onGoalRuntimeChange?.({
          ...runtimeWithSummary,
          status: "running",
          waitingReason: undefined,
          updatedAt: startedAt,
          lastRunStartedAt: startedAt,
          lastRunMessageBaseline: renderedMessages.length,
          completedAt: undefined,
        });
      }
      await props.onSendDraft(nextDraft);
      attachments.forEach(revokeAttachmentPreview);
      clearComposerSession(props.sessionId);
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      setComposerDraft(props.sessionId, "");
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    attachments,
    assistantCodeFeaturesActive,
    assistantFeatureCategoryId,
    buildDraft,
    clearComposerSession,
    draft,
    effectiveCollaborationMode.kind,
    effectiveCollaborationMode.planning,
    effectiveCollaborationMode.pursueGoal,
    props.onDraftChange,
    props.onGoalRuntimeChange,
    props.onSendDraft,
    props.draftOnly,
    props.draftWorkspaceDirectory,
    props.goalRuntime,
    props.sessionId,
    props.workspaceId,
    recordSessionInterruption,
    renderedMessages.length,
    setComposerDraft,
    stallRecoveryBySessionId,
  ]);

  const executeApprovedPlan = useCallback(async () => {
    const runtime = props.planRuntime;
    if (!runtime || runtime.status !== "awaiting_approval") return;
    const executionMode: ComposerCollaborationMode = {
      kind: "craft",
      planning: false,
      pursueGoal: effectiveCollaborationMode.pursueGoal,
    };
    const executionSystemPrompt = buildPlanExecutionHiddenSystemPrompt(runtime);
    const executionPrompt = t("session.plan_runtime_execute");

    setError(null);
    setDismissedErrorMessage(null);
    const startedAt = Date.now();
    const runKey = `${props.sessionId}:${startedAt}`;
    activeRunStartedAtRef.current = startedAt;
    activeRunKeyRef.current = runKey;
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(props.workspaceId, props.sessionId, {
          runKey,
          runStartedAt: startedAt,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    updateCollaborationMode(executionMode);
    props.onPlanRuntimeChange?.({
      ...runtime,
      status: "executing",
      approvedAt: Date.now(),
      executionBaseline: renderedMessages.length,
    });
    try {
      await props.onSendDraft({
        ...buildDraft(executionPrompt, []),
        messageID: `msg_onmyagent-internal-plan-execute-${crypto.randomUUID()}`,
        collaborationMode: executionMode,
        hiddenSystemPrompt: executionSystemPrompt,
      });
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      props.onPlanRuntimeChange?.(runtime);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    buildDraft,
    effectiveCollaborationMode.pursueGoal,
    props.draftOnly,
    props.onDraftChange,
    props.onPlanRuntimeChange,
    props.onSendDraft,
    props.planRuntime,
    props.sessionId,
    props.workspaceId,
    recordSessionInterruption,
    renderedMessages.length,
    updateCollaborationMode,
  ]);

  const resumeGoalRuntime = useCallback(async () => {
    const runtime = isGoalIntentRuntime(props.goalRuntime)
      ? props.goalRuntime
      : null;
    if (!runtime || runtime.status === "running" || runtime.status === "completed") return;
    const now = Date.now();
    const totalPausedMs =
      runtime.status === "paused" && runtime.pauseStartedAt
        ? runtime.totalPausedMs + Math.max(0, now - runtime.pauseStartedAt)
        : runtime.totalPausedMs;
    const goalMode: ComposerCollaborationMode = {
      planning: false,
      pursueGoal: true,
    };
    const nextRuntime: CollaborationGoalRuntime = {
      ...runtime,
      summary: runtime.summary || deriveGoalSummary(runtime.objective),
      status: "running",
      waitingReason: undefined,
      updatedAt: now,
      totalPausedMs,
      pauseStartedAt: undefined,
      lastRunStartedAt: now,
      lastRunMessageBaseline: renderedMessages.length,
      completedAt: undefined,
      lastKnownTodos: (props.todos ?? []).filter((todo) => todo.content.trim()),
    };

    setError(null);
    setDismissedErrorMessage(null);
    const runKey = `${props.sessionId}:${now}`;
    activeRunStartedAtRef.current = now;
    activeRunKeyRef.current = runKey;
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .startRun(props.workspaceId, props.sessionId, {
          runKey,
          runStartedAt: now,
        });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    updateCollaborationMode(goalMode);
    props.onGoalRuntimeChange?.(nextRuntime);
    try {
      await props.onSendDraft({
        ...buildDraft(t("session.goal_runtime_continue_prompt"), []),
        messageID: `msg_onmyagent-internal-goal-resume-${crypto.randomUUID()}`,
        collaborationMode: goalMode,
        hiddenSystemPrompt: buildGoalHiddenSystemPrompt(nextRuntime),
      });
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      props.onGoalRuntimeChange?.(runtime);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    buildDraft,
    props.draftOnly,
    props.goalRuntime,
    props.onDraftChange,
    props.onGoalRuntimeChange,
    props.onSendDraft,
    props.sessionId,
    props.todos,
    props.workspaceId,
    recordSessionInterruption,
    renderedMessages.length,
    updateCollaborationMode,
  ]);

  const stopActiveRun = useCallback(async () => {
    setError(null);
    setDismissedErrorMessage(null);
    setSending(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .markRunStopped(props.workspaceId, props.sessionId);
      // Optimistic idle so the send button restores even if the worker lags
      // on session.status after abort (common on stuck skill retries).
      queryClient.setQueryData(statusQueryKey, IDLE_STATUS);
      queryClient.setQueryData(
        snapshotQueryKey,
        (current: OnMyAgentSessionSnapshot | undefined) =>
          current && current.session.id === props.sessionId
            ? { ...current, status: IDLE_STATUS }
            : current,
      );
    }
    await abortSessionSafe(opencodeClient, props.sessionId);
    await snapshotQuery.refetch();
  }, [
    opencodeClient,
    props.draftOnly,
    props.sessionId,
    props.workspaceId,
    queryClient,
    snapshotQuery.refetch,
    snapshotQueryKey,
    statusQueryKey,
  ]);

  useEffect(() => {
    const runtime = props.goalRuntime;
    if (!isGoalIntentRuntime(runtime) || runtime.status !== "running") return;
    const baseline = runtime.lastRunMessageBaseline ?? runtime.messageBaseline;
    const assistantTexts = renderedMessages
      .slice(baseline)
      .filter((message) => message.role === "assistant")
      .map(messageToReadableText);
    if (!hasRepeatedGoalAssistantOutput(assistantTexts)) return;

    props.onGoalRuntimeChange?.({
      ...runtime,
      status: "waiting",
      waitingReason: "idle",
      updatedAt: Date.now(),
    });
    void stopActiveRun();
  }, [props.goalRuntime, props.onGoalRuntimeChange, renderedMessages, stopActiveRun]);

  const pauseGoalRuntime = useCallback(async () => {
    const runtime = isGoalIntentRuntime(props.goalRuntime)
      ? props.goalRuntime
      : null;
    if (
      runtime &&
      (runtime.status === "running" || runtime.status === "waiting")
    ) {
      const now = Date.now();
      recordSessionInterruption("stopped", runtime);
      const pausedRuntime = {
        ...runtime,
        status: "paused",
        waitingReason: "user",
        updatedAt: now,
        pauseStartedAt: now,
      } satisfies CollaborationGoalRuntime;
      props.onGoalRuntimeChange?.(pausedRuntime);
    }
    await stopActiveRun();
  }, [props.goalRuntime, props.onGoalRuntimeChange, recordSessionInterruption, stopActiveRun]);

  const handleAbort = useCallback(async () => {
    if (!chatStreaming) return;
    const collaborationKind = resolveSessionCollaborationKind(
      effectiveCollaborationMode,
      assistantFeatureCategoryId,
    );
    if (collaborationKind === "goal" && isGoalIntentRuntime(props.goalRuntime)) {
      await pauseGoalRuntime();
      return;
    }
    if (
      props.planRuntime &&
      (props.planRuntime.status === "executing" ||
        props.planRuntime.status === "drafting")
    ) {
      props.onPlanRuntimeChange?.({
        ...props.planRuntime,
        status: "blocked",
        blockedReason: "cancelled",
      });
    }
    recordSessionInterruption(
      manualStopNoticeKind(collaborationKind),
    );
    await stopActiveRun();
  }, [
    assistantFeatureCategoryId,
    chatStreaming,
    effectiveCollaborationMode,
    pauseGoalRuntime,
    props.goalRuntime,
    props.onPlanRuntimeChange,
    props.planRuntime,
    recordSessionInterruption,
    stopActiveRun,
  ]);

  const handleDismissError = useCallback(() => {
    if (visibleError?.message) {
      setDismissedErrorMessage(visibleError.message);
    }
    setError(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .clearError(props.workspaceId, props.sessionId);
    }
  }, [props.draftOnly, props.sessionId, props.workspaceId, visibleError]);

  useEffect(() => {
    if (liveStatus.type === "idle") {
      setSending(false);
    }
  }, [liveStatus.type]);

  useEffect(() => {
    props.onDraftChange(buildDraft(draft, attachments));
  }, [attachments, buildDraft, draft, props.onDraftChange]);

  const {
    handleAttachFiles,
    handleRemoveAttachment,
    handleInsertMention,
    handlePasteText,
    handleRevealPastedText,
    handleExpandPastedText,
    handleRemovePastedText,
    handleUnsupportedFileLinks,
    typeComposerText,
    listSkills,
    listMcp,
    listImportedPlugins,
    handleUploadInboxFiles,
  } = useSessionSurfaceComposerHandlers({
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    workspaceRoot: props.workspaceRoot,
    attachmentsEnabled: props.attachmentsEnabled,
    attachmentsDisabledReason: props.attachmentsDisabledReason,
    draft,
    attachments,
    mentions,
    pasteParts,
    setComposerDraft,
    setComposerAttachments,
    setComposerMentions,
    setComposerPasteParts,
    setNotice,
    setToolSkills,
    setToolMcpServers,
    setToolMcpStatuses,
    setToolMcpStatus,
    setToolImportedPlugins,
    buildDraft,
    onDraftChange: props.onDraftChange,
    client: props.client,
    opencodeClient,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolveTranscriptScrollElement = useCallback(() => scrollRef.current, []);
  const renderedMessageIds = useMemo(
    () => renderedMessages.map((message) => message.id),
    [renderedMessages],
  );
  const sessionScroll = useSessionScrollController({
    selectedSessionId: props.sessionId,
    renderedMessages,
    renderedMessageIds,
    containerRef: scrollRef,
    contentRef,
    active: chatStreaming,
    surfaceVisible: props.surfaceVisible !== false,
    sessionChangeScroll:
      props.personalAssistantHome && props.draftOnly ? "top" : "bottom",
  });

  useSessionSurfaceControlActions({
    composerShellRef,
    scrollRef,
    typeComposerText,
    onDraftChange: props.onDraftChange,
    buildDraft,
    attachments,
    draft,
    handleSend,
    handleAbort,
    modelUnavailable: props.modelUnavailable,
    transitionState: model.transitionState,
    chatStreaming,
    sessionId: props.sessionId,
    renderedMessages,
    jumpToLatest: sessionScroll.jumpToLatest,
  });

  const selectAssistantPromptTemplate = useCallback(
    (scenarioId: string, prompt: string) => {
      const scenario = assistantCategory.scenarios.find((item) => item.id === scenarioId);
      if (!scenario) return;
      setAssistantScenarioId(scenario.id);
      void typeComposerText(`${assistantScenarioDraftToken(scenario.id)} ${prompt}`);
    },
    [assistantCategory.scenarios, typeComposerText],
  );

  const {
    personalAssistantDraftHome,
    homeComposerLayout,
    composerOuterBorderVisible,
    draftWorkspaceAccessoryActive,
    assistantDraftHomeTitle,
    assistantDraftHomeSubtitle,
  } = deriveSessionSurfaceLayoutMode({
    personalAssistantHome: props.personalAssistantHome,
    draftOnly: props.draftOnly,
    hasAgentContext: Boolean(props.agentContext),
    hasEffectiveAgent: Boolean(effectiveAgent),
    renderedMessageCount: renderedMessages.length,
    hasTranscriptContent,
    hasVisibleTranscriptError: Boolean(visibleTranscriptError),
    activityIdle: effectiveActivityStatus === "idle",
    assistantCategoryId,
    assistantFeatureCategoryId: props.assistantFeatureCategoryId,
  });

  const [lastTodosBySessionId, setLastTodosBySessionId] =
    useState<Record<string, TodoItem[]>>({});
  const incomingTodos = props.todos ?? [];
  const incomingHasTodos = incomingTodos.some((todo) => todo.content.trim());
  useEffect(() => {
    if (!incomingHasTodos) return;
    setLastTodosBySessionId((current) => ({
      ...current,
      [props.sessionId]: incomingTodos,
    }));
  }, [incomingHasTodos, incomingTodos, props.sessionId]);

  const visiblePlanRuntime = planDismissedForSession
    ? null
    : props.planRuntime ?? null;
  const visibleGoalRuntime = resolveVisibleGoalRuntime({
    mode: effectiveCollaborationMode,
    categoryId: assistantFeatureCategoryId,
    goalRuntime: props.goalRuntime,
    dismissed: goalDismissedForSession,
  });
  const activeGoalWaitingReason: CollaborationGoalRuntime["waitingReason"] | null =
    activePermissionNeedsApproval
      ? "permission"
      : props.activeQuestion
        ? "question"
        : effectiveActivityStatus === "compacting"
          ? "compacting"
          : null;
  const visibleGoalRuntimeForUi = applyGoalWaitingReason(
    visibleGoalRuntime,
    activeGoalWaitingReason,
  );
  const visibleTodos = incomingHasTodos
    ? incomingTodos
    : lastTodosBySessionId[props.sessionId] ?? incomingTodos;
  const hasVisibleTodos = visibleTodos.some((todo) => todo.content.trim());
  const runPolicy = resolveSessionRunPolicy({
    accessMode: effectiveAccessMode,
    collaborationMode: effectiveCollaborationMode,
    categoryId: assistantFeatureCategoryId,
    activityStatus: effectiveActivityStatus,
    assistantActive: activityVisible,
    hasActivePermission: activePermissionNeedsApproval,
    hasActiveQuestion: Boolean(props.activeQuestion),
    planRuntime: visiblePlanRuntime,
    goalRuntime: visibleGoalRuntimeForUi,
    stalled: showStalledActivityNotice,
  });
  const respondPermissionWithTranscriptNotice = (
    requestID: string,
    reply: "reject" | "once" | "always",
  ) => {
    if (reply === "reject") {
      const now = Date.now();
      appendTranscriptNotice({
        id: `${props.sessionId}:permission-rejected:${renderedMessages.length}:${now}`,
        kind: "permission-rejected",
        afterMessageCount: renderedMessages.length,
      });
      if (
        visibleGoalRuntime &&
        visibleGoalRuntime.status !== "paused" &&
        visibleGoalRuntime.status !== "completed"
      ) {
        props.onGoalRuntimeChange?.({
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
        props.onPlanRuntimeChange?.({
          ...visiblePlanRuntime,
          status: "blocked",
          blockedReason: "permission_rejected",
        });
      }
    }
    props.respondPermission?.(requestID, reply);
  };
  const composerAccessory = renderSessionComposerAccessories({
    sessionId: props.sessionId,
    draftOnly: props.draftOnly,
    visiblePlanRuntime,
    goalRuntime: props.goalRuntime,
    visibleGoalRuntimeForUi,
    visibleTodos,
    hasVisibleTodos,
    busy: sending || chatStreaming,
    canPauseGoal: runPolicy.canPauseGoal,
    canResumeGoal: runPolicy.canResumeGoal,
    collaborationMode: effectiveCollaborationMode,
    goalDismissed: goalDismissedForSession,
    activeQuestion: props.activeQuestion,
    questionReplyBusy: props.questionReplyBusy,
    respondQuestion: props.respondQuestion,
    extraComposerAccessory: props.extraComposerAccessory,
    activePermission: props.activePermission,
    activePermissionNeedsApproval,
    permissionReplyBusy: props.permissionReplyBusy,
    respondPermission: respondPermissionWithTranscriptNotice,
    safeStringify: props.safeStringify,
    onExecutePlan: () => void executeApprovedPlan(),
    onPauseGoal: () => void pauseGoalRuntime(),
    onResumeGoal: () => void resumeGoalRuntime(),
    onClearGoalPreview: () => {
      updateCollaborationMode({ planning: false, pursueGoal: false });
    },
    onGoalRuntimeChange: props.onGoalRuntimeChange,
    onPlanRuntimeChange: props.onPlanRuntimeChange,
    setDismissedPlanBySessionId,
    setDismissedGoalBySessionId,
    setLastTodosBySessionId,
    onClearSessionProgress: props.onClearSessionProgress,
    stopActiveRun,
  });

  const chatHeaderAgent = effectiveAgent
    ? {
        name: effectiveAgent.name,
        avatarUrl: effectiveAgent.avatar.avatarUrl,
        avatarBackground: effectiveAgent.avatar.avatarBackground,
      }
    : props.personalAssistantHome
      ? {
          name: onmyagentAssistantName(),
          avatarUrl: resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR),
          avatarBackground: "#eef7f2",
        }
      : {
          name: props.agentLabel || t("nav.agents"),
          avatarUrl: null,
          avatarBackground: null,
        };
  // Code toolbar (打开位置 / git) is for an active code session — not the empty
  // "新建任务" draft home (draftOnly), where only the open-location chip would show.
  const codeSceneToolbar =
    assistantCodeFeaturesActive &&
    assistantFeatureCategoryId === "code" &&
    !(props.draftOnly ?? false)
      ? (
          <CodeSceneToolbar
            sessionId={props.sessionId}
            draftOnly={false}
            workspacePath={props.workspaceRoot}
          />
         )
       : null;
  const downloadCodePath = useCallback(async (filePath: string) => {
    const normalizedRoot = props.workspaceRoot.replace(/[\\/]+$/, "");
    const normalizedPath = filePath.trim();
    const relativePath = normalizedRoot && (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}/`) ||
      normalizedPath.startsWith(`${normalizedRoot}\\`)
    )
      ? normalizedPath.slice(normalizedRoot.length).replace(/^[\\/]+/, "")
      : normalizedPath.replace(/^\.\//, "");
    const result = await props.client.downloadWorkspaceFile(
      props.workspaceId,
      relativePath,
    );
    const url = URL.createObjectURL(new Blob(
      [result.data],
      { type: result.contentType ?? "application/octet-stream" },
    ));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = relativePath.split(/[\\/]/).at(-1) ?? "artifact";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, [props.client, props.workspaceId, props.workspaceRoot]);

  return (
    <SessionSurfaceView
      personalAssistantDraftHome={Boolean(personalAssistantDraftHome)}
      homeComposerLayout={Boolean(homeComposerLayout)}
      composerOuterBorderVisible={Boolean(composerOuterBorderVisible)}
      draftWorkspaceAccessoryActive={Boolean(draftWorkspaceAccessoryActive)}
      conversationTabs={props.conversationTabs}
      chatHeaderAgent={chatHeaderAgent}
      codeSceneToolbar={codeSceneToolbar}
      personalAssistantHome={props.personalAssistantHome}
      onOpenAgentSettings={props.onOpenAgentSettings}
      headerActions={props.headerActions}
      transitionState={model.transitionState}
      renderSource={model.renderSource}
      showDelayedLoading={showDelayedLoading}
      pendingSessionLoad={pendingSessionLoad}
      snapshotQueryError={snapshotQuery.isError}
      snapshotErrorMessage={
        snapshotQuery.error instanceof Error
          ? snapshotQuery.error.message
          : "Failed to load session."
      }
      snapshot={snapshot}
      model={model}
      developerMode={props.developerMode}
      sessionId={props.sessionId}
      scrollRef={scrollRef}
      contentRef={contentRef}
      onWheel={(event) => {
        sessionScroll.markWheelGesture(event.deltaY, event.target);
      }}
      onTouchStart={(event) => {
        sessionScroll.markScrollGesture(event.target);
      }}
      onTouchMove={(event) => {
        sessionScroll.markScrollGesture(event.target);
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        sessionScroll.markScrollGesture(event.currentTarget);
      }}
      onScroll={sessionScroll.handleScroll}
      onJumpToLatest={() => {
        sessionScroll.jumpToLatest("auto");
      }}
      visibleTranscriptError={visibleTranscriptError}
      hasTranscriptContent={hasTranscriptContent}
      activityIdle={effectiveActivityStatus === "idle"}
      draftOnly={props.draftOnly}
      effectiveAgent={effectiveAgent}
      typeComposerText={typeComposerText}
      assistantActivity={assistantActivity}
      onDismissError={handleDismissError}
      onChangeModel={props.onChangeModel}
      onOpenModelPicker={props.onModelClick}
      renderedMessages={renderedMessages}
      chatStreaming={chatStreaming}
      showThinking={showThinking}
      interruptionDividers={interruptionDividers}
      resolveTranscriptScrollElement={resolveTranscriptScrollElement}
      onRevertToMessage={props.onRevertToMessage}
      verifiedOpenTargets={verifiedOpenTargets}
      onOpenTarget={props.onOpenTarget}
      onDownloadCodePath={downloadCodePath}
      workspaceRoot={props.workspaceRoot}
      assistantStatusFooter={assistantStatusFooter}
      searchQuery={searchQuery}
      searchMatchIdSet={searchMatchIdSet}
      activeSearchMessageId={activeSearchMessageId}
      scrollToMessageByIdRef={scrollToMessageByIdRef}
      assistantCategoryId={assistantCategoryId}
      assistantDraftHomeTitle={assistantDraftHomeTitle}
      assistantDraftHomeSubtitle={assistantDraftHomeSubtitle}
      composerShellRef={composerShellRef}
      draft={draft}
      mentions={mentions}
      assistantScenarioTags={assistantScenarioTags}
      personalizedPromptTemplates={personalizedPromptTemplates}
      onSelectPromptTemplate={selectAssistantPromptTemplate}
      onDraftChange={handleComposerDraftChange}
      onSend={handleSend}
      onStop={handleAbort}
      modelUnavailable={Boolean(props.modelUnavailable)}
      effectiveAccessMode={effectiveAccessMode}
      onAccessModeChange={updateAccessMode}
      effectiveCollaborationMode={effectiveCollaborationMode}
      onCollaborationModeChange={updateCollaborationMode}
      collaborationModeVariant={
        assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office"
          ? "office"
          : "legacy"
      }
      modelPickerOpen={props.modelPickerOpen}
      selectedModel={props.selectedModel}
      onModelPickerOpenChange={props.onModelPickerOpenChange}
      onModelChange={props.onModelChange}
      attachments={attachments}
      onAttachFiles={handleAttachFiles}
      onRemoveAttachment={handleRemoveAttachment}
      attachmentsEnabled={props.attachmentsEnabled}
      attachmentsDisabledReason={props.attachmentsDisabledReason}
      modelVariantLabel={props.modelVariantLabel}
      modelVariant={props.modelVariant}
      modelBehaviorOptions={props.modelBehaviorOptions}
      onModelVariantChange={props.onModelVariantChange}
      agentLabel={props.agentLabel}
      selectedAgent={props.selectedAgent}
      listAgents={props.listAgents}
      onSelectAgent={props.onSelectAgent}
      listCommands={props.listCommands}
      listSkills={listSkills}
      skills={toolSkills}
      listMcp={listMcp}
      mcpServers={toolMcpServers}
      mcpStatus={toolMcpStatus}
      mcpStatuses={toolMcpStatuses}
      listImportedPlugins={listImportedPlugins}
      importedPlugins={toolImportedPlugins}
      onOpenSettingsSection={props.onOpenSettingsSection}
      onOpenSkillsMarketplace={props.onOpenSkillsMarketplace}
      onOpenConnectorsMarketplace={props.onOpenConnectorsMarketplace}
      onOpenCustomConnector={props.onOpenCustomConnector}
      recentFiles={props.recentFiles}
      searchFiles={props.searchFiles}
      onInsertMention={handleInsertMention}
      notice={notice}
      onNotice={setNotice}
      onPasteText={handlePasteText}
      onUnsupportedFileLinks={handleUnsupportedFileLinks}
      pastedText={pasteParts}
      onExpandPastedText={handleExpandPastedText}
      onRevealPastedText={handleRevealPastedText}
      onRemovePastedText={handleRemovePastedText}
      isRemoteWorkspace={props.isRemoteWorkspace}
      isSandboxWorkspace={props.isSandboxWorkspace}
      onUploadInboxFiles={props.onUploadInboxFiles ?? handleUploadInboxFiles}
      composerAccessory={composerAccessory}
      draftWorkspaceDirectory={props.draftWorkspaceDirectory}
      draftWorkspaceOwnerId={props.draftWorkspaceOwnerId}
      assistantFeatureCategoryId={assistantFeatureCategoryId}
      showFolderRequiredBubble={showFolderRequiredBubble}
      onDismissFolderRequiredBubble={() => setShowFolderRequiredBubble(false)}
      onSelectDraftWorkspace={props.onSelectDraftWorkspace}
      onCreateDraftWorkspace={props.onCreateDraftWorkspace}
      onPickDraftWorkspace={props.onPickDraftWorkspace}
      onClearDraftWorkspace={props.onClearDraftWorkspace}
    />
  );
}
