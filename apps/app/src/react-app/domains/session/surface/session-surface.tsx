/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveAccessModePermissionReply } from "../../../../app/lib/access-mode";
import { t } from "../../../../i18n";
import type { CloudImportedPlugin } from "../../../../app/cloud/import-state";
import type {
  ComposerAttachment,
  ComposerDraft,
  McpServerEntry,
  McpStatusMap,
  SkillCard,
  TodoItem,
} from "../../../../app/types";
import { useReactRenderWatchdog } from "../../../shell";
import { CodeSceneToolbar } from "./code-scene-toolbar";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import type { ReactComposerNotice } from "./composer/notice";
import { deriveRenderedSessionMessages } from "./session-render-state";
import { useLocal } from "../../../kernel/local-provider";
import { deriveSessionRenderModel } from "../sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import { useSessionActivityStore } from "../status/session-activity-store";
import { deriveOpenTargets } from "../artifacts/open-target";
import { latestOutputLimitedAssistantMessage } from "../sync/output-limit-recovery";
import { resolveSessionRunPolicy } from "./session-run-controller";
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
import { transcriptToText } from "./session-surface-model";
import {
  readSnapshotSessionError,
  type SessionError,
} from "./session-surface-support";
import { filterCompactionMessages } from "./transcript/message-compaction";
import { useSessionFollowUpFooter } from "./use-session-follow-up-footer";
import { useSessionSurfaceControlActions } from "./session-surface-control-actions";
import { useSessionSurfaceComposerHandlers } from "./session-surface-composer-handlers";
import { useSessionSurfaceCollaboration } from "./session-surface-collaboration";
import { useSessionSurfacePendingAgent } from "./session-surface-pending-agent";
import { useExpertDirectoryStore } from "../../../capabilities/session-identity/expert-directory-store";
import { useSessionSurfaceOpenTargets } from "./session-surface-open-targets";
import { useSessionSurfaceActivityStall } from "./session-surface-activity-stall";
import { useSessionSurfacePlanGoalEffects } from "./session-surface-plan-goal-effects";
import { useSessionSurfaceTranscriptNotices } from "./session-surface-transcript-notices";
import { useSessionSurfaceActivityModel } from "./session-surface-activity-model";
import { SessionSurfaceView } from "./session-surface-view";
import { deriveSessionSurfaceLayoutMode } from "./session-surface-layout-mode";
import { assistantScenarioDraftToken, isUserCancelledError } from "./chrome/personal-assistant";
import {
  applyGoalWaitingReason,
  resolveVisibleGoalRuntime,
} from "./session-surface-goal";
import {
  buildComposerDraft,
  deriveActiveGoalWaitingReason,
  deriveChatStreaming,
  derivePendingSessionLoad,
  hasIncompleteTodos,
  isRemoteSessionBusy,
  openTargetsFingerprint,
  pickVisibleSessionError,
  resolveCollaborationModeVariant,
  resolveWorkspaceRelativeDownloadPath,
  shouldShowCodeSceneToolbar,
  snapshotQueryErrorMessage,
} from "./session-surface-helpers";
import { useSessionSurfaceSnapshot } from "./session-surface-snapshot";
import { useSessionSurfaceRunHandlers } from "./session-surface-run-handlers";
import { useSessionSurfaceAssistantStatusFooter } from "./session-surface-assistant-status-footer";
import {
  buildSessionComposerAccessory,
  respondPermissionWithTranscriptNotice,
} from "./session-surface-permission-chrome";
import { useSessionSurfaceMentionLoaders } from "./session-surface-mention-loaders";
import { useSessionSurfaceSessionEffects } from "./session-surface-session-effects";
import { addOptimisticSessionUserMessage } from "../sync/optimistic-session-user-message";
import { skillTurnTextsEquivalent } from "./skill-reference";

export type { SessionSurfaceProps } from "./session-surface-types";
import type { SessionSurfaceProps } from "./session-surface-types";
import { flattenSessionSurfaceProps } from "./session-surface-types";
import { useSessionSurfaceSearch } from "./session-surface-search";
import { stripExpertDraftSuggestionFromText } from "../../agents";

type PendingOutgoingUserMessage = {
  id: string;
  text: string;
  createdAt: number;
};

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
  /** Code track removed — never enable code-only chrome. */
  const assistantCodeFeaturesActive = false;
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
    ) ?? PERSONAL_ASSISTANT_CATEGORIES[0]!;
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
  const expertDirectoryIdentity = useExpertDirectoryStore((state) =>
    state.getIdentity(props.workspaceId),
  );
  const { effectiveAgent } = useSessionSurfacePendingAgent({
    personalAssistantHome: props.personalAssistantHome,
    sessionId: props.sessionId,
    agentContext: props.agentContext,
    expertDirectoryIdentity,
  });
  const [notice, setNotice] = useState<ReactComposerNotice | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [dismissedErrorMessage, setDismissedErrorMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingOutgoingUserMessage, setPendingOutgoingUserMessage] =
    useState<PendingOutgoingUserMessage | null>(null);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [awaitingAssistantBaseline, setAwaitingAssistantBaseline] = useState<
    number | null
  >(null);
  const [
    noVisibleAssistantOutputBaseline,
    setNoVisibleAssistantOutputBaseline,
  ] = useState<number | null>(null);
  const [toolSkills, setToolSkills] = useState<SkillCard[]>([]);
  const [toolMcpServers, setToolMcpServers] = useState<McpServerEntry[]>([]);
  const [toolMcpStatus, setToolMcpStatus] = useState<string | null>(null);
  const [toolMcpStatuses, setToolMcpStatuses] = useState<McpStatusMap>({});
  const [toolImportedPlugins, setToolImportedPlugins] = useState<
    CloudImportedPlugin[]
  >([]);
  const composerShellRef = useRef<HTMLDivElement>(null);

  const {
    opencodeClient,
    snapshotQueryKey,
    statusQueryKey,
    snapshotQuery,
    transcriptState,
    snapshot,
    liveStatus,
    resetHydrationKey,
  } = useSessionSurfaceSnapshot({
    workspaceId: props.workspaceId,
    sessionId: props.sessionId,
    workspaceRoot: props.workspaceRoot,
    draftOnly: props.draftOnly,
    opencodeBaseUrl: props.opencodeBaseUrl,
    onmyagentToken: props.onmyagentToken,
    client: props.client,
  });

  useEffect(() => {
    if (!props.personalAssistantHome) return;
    setAssistantScenarioId(null);
    setComposerDraft(props.sessionId, "");
  }, [
    assistantCategoryId,
    props.personalAssistantHome,
    props.sessionId,
  ]);

  const chatStreaming = deriveChatStreaming({
    sending,
    remoteBusy: isRemoteSessionBusy(liveStatus.type),
    draftOnly: props.draftOnly,
    stopRequested: storedSessionStopRequested,
  });
  const rawRenderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot }),
    [snapshot, transcriptState],
  );
  const {
    compactBoundary,
    transcriptNoticesBySessionId,
    setTranscriptNoticesBySessionId,
    stallRecoveryBySessionId,
    setStallRecoveryBySessionId,
    markStallRecovery,
    appendTranscriptNotice,
    interruptionDividers,
  } = useSessionSurfaceTranscriptNotices({
    sessionId: props.sessionId,
    rawRenderedMessageCount: rawRenderedMessages.length,
    renderedMessageCount: rawRenderedMessages.length,
    sessionActivityStatus,
    autoApprovedPermissionNoticeId: props.autoApprovedPermissionNoticeId,
  });
  // Drop local optimistic bubble once the real transcript catches the same turn
  // (or any later user message), so we never stack duplicates after navigate/SSE.
  useEffect(() => {
    if (!pendingOutgoingUserMessage) return;
    const pendingText = pendingOutgoingUserMessage.text;
    const matched = rawRenderedMessages.some((message) => {
      if (message.role !== "user") return false;
      if (message.id === pendingOutgoingUserMessage.id) return true;
      return message.parts.some(
        (part) =>
          part.type === "text" && skillTurnTextsEquivalent(part.text, pendingText),
      );
    });
    if (matched) setPendingOutgoingUserMessage(null);
  }, [pendingOutgoingUserMessage, rawRenderedMessages]);

  useEffect(() => {
    setPendingOutgoingUserMessage(null);
  }, [props.sessionId]);

  const renderedMessages = useMemo(() => {
    let filtered = filterCompactionMessages(rawRenderedMessages, compactBoundary);
    // Creation-coach embed: never paint machine form payloads in the transcript.
    if (props.chrome === "embedded") {
      filtered = filtered.map((message) => {
        if (message.role !== "assistant") return message;
        let changed = false;
        const parts = message.parts.map((part) => {
          if (part.type !== "text") return part;
          const text = typeof part.text === "string" ? part.text : "";
          if (!text) return part;
          const stripped = stripExpertDraftSuggestionFromText(text);
          if (stripped === text) return part;
          changed = true;
          return { ...part, text: stripped };
        });
        return changed ? { ...message, parts } : message;
      });
    }
    if (!pendingOutgoingUserMessage) return filtered;
    return addOptimisticSessionUserMessage(filtered, {
      messageId: pendingOutgoingUserMessage.id,
      text: pendingOutgoingUserMessage.text,
      createdAt: pendingOutgoingUserMessage.createdAt,
    });
  }, [
    compactBoundary,
    pendingOutgoingUserMessage,
    props.chrome,
    rawRenderedMessages,
  ]);
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
  const renderedMessageCountRef = useRef(renderedMessages.length);
  renderedMessageCountRef.current = renderedMessages.length;
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
  const openTargetsFingerprintValue = useMemo(
    () => openTargetsFingerprint(openTargets),
    [openTargets],
  );
  const { verifiedOpenTargets } = useSessionSurfaceOpenTargets({
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    sessionRoot: props.sessionFileRoot?.trim() || props.workspaceRoot,
    client: props.client,
    openTargets,
    openTargetsFingerprint: openTargetsFingerprintValue,
    chatStreaming,
    onOpenTarget: props.onOpenTarget,
    onOpenTargetsChange: props.onOpenTargetsChange,
  });
  const pendingSessionLoad = derivePendingSessionLoad({
    draftOnly: props.draftOnly,
    hasSnapshot: Boolean(snapshot),
    isLoading: snapshotQuery.isLoading,
    messageCount: renderedMessages.length,
  });
  const activePermissionNeedsApproval = Boolean(
    props.activePermission &&
      !resolveAccessModePermissionReply(
        effectiveAccessMode,
        props.activePermission.permission,
      ),
  );
  const {
    assistantOutputAfterAwaitStart,
    noVisibleAssistantOutputText,
    showAssistantWaitState,
    showAssistantRespondingState,
    effectiveActivityStatus,
    assistantActivity,
    activityFingerprint,
    activityVisible,
    showNoVisibleAssistantOutput,
  } = useSessionSurfaceActivityModel({
    renderedMessages,
    awaitingAssistantBaseline,
    noVisibleAssistantOutputBaseline,
    sessionActivityStatus,
    chatStreaming,
    sending,
    activePermissionNeedsApproval,
    hasActiveQuestion: Boolean(props.activeQuestion),
    goalRuntime: props.goalRuntime,
    draftOnly: props.draftOnly,
    stopRequested: storedSessionStopRequested,
    storedSessionRunKey,
    transcriptNotices: transcriptNoticesBySessionId[props.sessionId] ?? [],
  });
  const { showStalledActivityNotice, shouldInjectStallRecovery } =
    useSessionSurfaceActivityStall({
      sessionId: props.sessionId,
      activityFingerprint,
      effectiveActivityStatus,
      liveStatusType: liveStatus.type,
      activityVisible,
    });
  useEffect(() => {
    if (!shouldInjectStallRecovery) return;
    markStallRecovery();
  }, [markStallRecovery, shouldInjectStallRecovery]);
  const visibleError = pickVisibleSessionError(
    [
      error,
      sessionActivityError ? { message: sessionActivityError } : null,
      snapshotSessionError,
    ],
    dismissedErrorMessage,
  );
  const cancelledError =
    visibleError && isUserCancelledError(visibleError) ? visibleError : null;
  const visibleTranscriptError = cancelledError ? null : visibleError;
  const hasTranscriptContent =
    renderedMessages.length > 0 || interruptionDividers.length > 0;
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
    (text: string, nextAttachments: ComposerAttachment[]): ComposerDraft =>
      buildComposerDraft({
        text,
        attachments: nextAttachments,
        pasteParts,
        mentions,
        accessMode: effectiveAccessMode,
        collaborationMode: effectiveCollaborationMode,
      }),
    [effectiveAccessMode, effectiveCollaborationMode, mentions, pasteParts],
  );

  const handleComposerDraftChange = useCallback(
    (value: string) => {
      setComposerDraft(props.sessionId, value);
    },
    [props.sessionId, setComposerDraft],
  );

  const {
    resetActiveRunRefs,
    handleOutputLimitContinue,
    handleSend,
    executeApprovedPlan,
    resumeGoalRuntime,
    stopActiveRun,
    pauseGoalRuntime,
    handleAbort,
    handleDismissError,
  } = useSessionSurfaceRunHandlers({
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    draftOnly: props.draftOnly,
    draftWorkspaceDirectory: props.draftWorkspaceDirectory,
    assistantCodeFeaturesActive,
    assistantFeatureCategoryId,
    draft,
    attachments,
    effectiveCollaborationMode,
    goalRuntime: props.goalRuntime,
    planRuntime: props.planRuntime,
    todos: props.todos,
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
    onSendDraft: props.onSendDraft,
    onDraftChange: props.onDraftChange,
    onGoalRuntimeChange: props.onGoalRuntimeChange,
    onPlanRuntimeChange: props.onPlanRuntimeChange,
    outputLimitedAssistantMessage,
    opencodeClient,
    queryClient,
    snapshotQueryKey,
    statusQueryKey,
    snapshotQuery,
    visibleError,
    cancelledError,
  });

  useSessionSurfaceSessionEffects({
    workspaceId: props.workspaceId,
    sessionId: props.sessionId,
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
    liveStatusType: liveStatus.type,
    renderedMessageCount: renderedMessages.length,
    buildDraft,
    onDraftChange: props.onDraftChange,
  });

  const assistantStatusFooter = useSessionSurfaceAssistantStatusFooter({
    showInlineActivityIndicator,
    assistantActivity,
    showNoVisibleAssistantOutput,
    noVisibleAssistantOutputText,
    outputLimitedAssistantMessage,
    visibleTranscriptError,
    sending,
    chatStreaming,
    reserveAssistantStatusSpace,
    onOutputLimitContinue: () => {
      void handleOutputLimitContinue();
    },
  });

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
  void handleCopyTranscript; // retained parity with pre-extract surface

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
    typeComposerTemplate,
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

  const {
    searchSessionMentionTargets,
    listSessionMentionFolder,
    loadSessionMentionFiles,
  } = useSessionSurfaceMentionLoaders({
    client: props.client,
    workspaceId: props.workspaceId,
    // Prefer catalog workspace root so uploads/ list+download stay aligned
    // (session cwd may be an isolated expert subdirectory).
    workspaceRoot: props.filesWorkspaceRoot?.trim() || props.workspaceRoot,
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
  const transcriptStatusFooter = useSessionFollowUpFooter({
    chatStreaming, sending, showInlineActivityIndicator, showNoVisibleAssistantOutput,
    outputLimitedAssistantMessage, draftOnly: props.draftOnly, renderedMessages,
    agentId: effectiveAgent?.id, quickPrompts: effectiveAgent?.quickPrompts,
    assistantStatusFooter, reserveAssistantStatusSpace, typeComposerText,
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
    setLastTodosBySessionId((current) => {
      const previous = current[props.sessionId];
      if (
        previous &&
        previous.length === incomingTodos.length &&
        previous.every(
          (todo, index) =>
            todo.id === incomingTodos[index]?.id &&
            todo.content === incomingTodos[index]?.content &&
            todo.status === incomingTodos[index]?.status,
        )
      ) {
        return current;
      }
      return {
        ...current,
        [props.sessionId]: incomingTodos,
      };
    });
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
  const activeGoalWaitingReason = deriveActiveGoalWaitingReason({
    activePermissionNeedsApproval,
    hasActiveQuestion: Boolean(props.activeQuestion),
    effectiveActivityStatus,
  });
  const visibleGoalRuntimeForUi = applyGoalWaitingReason(
    visibleGoalRuntime,
    activeGoalWaitingReason,
  );
  const visibleTodos = incomingTodos;
  const hasVisibleTodos = hasIncompleteTodos(visibleTodos);
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
  const composerAccessory = buildSessionComposerAccessory({
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
    respondPermission: (requestID, reply) =>
      respondPermissionWithTranscriptNotice({
        requestID,
        reply,
        sessionId: props.sessionId,
        renderedMessageCount: renderedMessages.length,
        appendTranscriptNotice,
        visibleGoalRuntime,
        visiblePlanRuntime,
        onGoalRuntimeChange: props.onGoalRuntimeChange,
        onPlanRuntimeChange: props.onPlanRuntimeChange,
        respondPermission: props.respondPermission,
      }),
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
  const codeSceneToolbar = shouldShowCodeSceneToolbar({
    assistantCodeFeaturesActive,
    assistantFeatureCategoryId,
    draftOnly: props.draftOnly,
  })
    ? (
        <CodeSceneToolbar
          sessionId={props.sessionId}
          draftOnly={false}
          workspacePath={props.workspaceRoot}
        />
      )
    : null;
  const downloadCodePath = useCallback(async (filePath: string) => {
    const relativePath = resolveWorkspaceRelativeDownloadPath(
      props.workspaceRoot,
      filePath,
    );
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
      chrome={props.chrome}
      emptyContent={props.emptyContent}
      conversationTabs={props.conversationTabs}
      chatHeaderAgent={chatHeaderAgent}
      codeSceneToolbar={codeSceneToolbar}
      onOpenShortcutsSettings={props.onOpenShortcutsSettings}
      personalAssistantHome={props.personalAssistantHome}
      onOpenAgentSettings={props.onOpenAgentSettings}
      headerActions={props.headerActions}
      surfaceVisible={props.surfaceVisible !== false}
      transitionState={model.transitionState}
      renderSource={model.renderSource}
      showDelayedLoading={showDelayedLoading}
      pendingSessionLoad={pendingSessionLoad}
      snapshotQueryError={snapshotQuery.isError}
      snapshotErrorMessage={snapshotQueryErrorMessage(snapshotQuery.error)}
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
      typeComposerTemplate={typeComposerTemplate}
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
      connectedProviderIds={props.connectedProviderIds}
      assistantStatusFooter={transcriptStatusFooter}
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
      composerDisabled={Boolean(props.composerDisabled)}
      modelUnavailable={Boolean(props.modelUnavailable)}
      effectiveAccessMode={effectiveAccessMode}
      onAccessModeChange={updateAccessMode}
      effectiveCollaborationMode={effectiveCollaborationMode}
      onCollaborationModeChange={updateCollaborationMode}
      collaborationModeVariant={resolveCollaborationModeVariant({
        assistantOfficeFeaturesActive,
        assistantFeatureCategoryId,
      })}
      modelPickerOpen={props.modelPickerOpen}
      modelPickerVisible={props.modelPickerVisible}
      selectedModel={props.selectedModel}
      catalogContextWindow={props.catalogContextWindow}
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
      searchFiles={searchSessionMentionTargets}
      listFolderFiles={listSessionMentionFolder}
      loadWorkspaceFiles={loadSessionMentionFiles}
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
