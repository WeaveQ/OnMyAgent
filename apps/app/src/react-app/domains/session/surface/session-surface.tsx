/** @jsxImportSource react */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import type { UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
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
  OnMyAgentServerClient,
  OnMyAgentSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";
import type {
  ComposerAttachment,
  ComposerAccessMode,
  ComposerCollaborationMode,
  ComposerDraft,
  ComposerPart,
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  SkillCard,
  TodoItem,
} from "../../../../app/types";
import { DevProfiler, publishInspectorSlice, recordInspectorEvent, useReactRenderWatchdog } from "../../../shell";
import { ReactSessionComposer } from "./composer/composer";
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
import { StatusBadge } from "@/components/ui/status-badge";
import type { ReactComposerNotice } from "./composer/notice";
import { SessionDebugPanel } from "./debug-panel";
import {
  deriveRenderedSessionMessages,
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import {
  SessionTranscript,
  type SessionTranscriptDivider,
} from "./message-list";
import { useLocal } from "../../../kernel/local-provider";
import { deriveSessionRenderModel } from "../sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import {
  useSessionActivityStore,
  type SessionActivityStatus,
} from "../status/session-activity-store";
import { usePendingAgentStore } from "../../agents";
import type { PendingAgentContext } from "../../agents";
import { AgentPromptSuggestions } from "../../agents";
import { buildPendingAgentFromRecord } from "../../agents";
import {
  readCustomAgentIdForSession,
  useAgentRegistryStore,
} from "../../agents";
import {
  deriveOpenTargets,
  selectAutoOpenTarget,
  type OpenTarget,
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
  settleGoalRuntimeAfterRun,
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
import { cn } from "@/lib/utils";
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
  createComposerAttachments,
  parseSessionError,
  readSnapshotSessionError,
  revokeAttachmentPreview,
  type SessionError,
} from "./session-surface-support";
import {
  planTextFromMessages,
} from "./plan-goal/plan-parse";
import {
  filterCompactionMessages,
  messageActivityFingerprint,
} from "./transcript/message-compaction";
import { useSharedQueryState, waitForControl } from "./session-surface-hooks";
import { useSessionSurfaceControlActions } from "./session-surface-control-actions";
import { useSessionSurfaceComposerHandlers } from "./session-surface-composer-handlers";
import {
  SESSION_CONTENT_MAX_WIDTH_CLASS,
  SESSION_CONTENT_X_PADDING_CLASS,
  sessionSurfaceStateClass,
  sessionSurfaceTextClass,
} from "./surface-styles";
import { PendingAgentAvatar } from "./chrome/avatars";
import {
  AssistantNoVisibleOutputCard,
  AssistantStatusSpacer,
  AssistantWaitingCard,
  OutputLimitContinueCard,
  TranscriptHistorySkeleton,
} from "./chrome/assistant-status";
import { TranscriptScrollToLatest } from "./chrome/transcript-scroll-to-latest";
import {
  buildGoalHiddenSystemPrompt,
  buildLocaleRuntimeInstruction,
  buildPlanExecutionHiddenSystemPrompt,
  createSessionInterruptionNotice,
  goalElapsedMs,
  isGoalIntentRuntime,
  normalizedTodoItems,
  removeRecordKey,
  shouldRecordSessionInterruption,
  transcriptNoticeLabel,
  type SessionTranscriptNotice,
} from "./plan-goal/goal-runtime";
import {
  assistantScenarioDraftToken,
  isUserCancelledError,
  SessionErrorCard,
} from "./chrome/personal-assistant";

import {
  ASSISTANT_RECOVERY_HINT_MS,
  ASSISTANT_STALL_NOTICE_MS,
  EMPTY_TRANSCRIPT,
  IDLE_STATUS,
  MAX_TRANSCRIPT_NOTICES_PER_SESSION,
} from "./session-surface-constants";
import {
  SessionDraftWorkspaceAccessory,
  SessionSurfaceDraftHome,
  SessionSurfaceHeader,
} from "./session-surface-chrome";
import {
  renderSessionComposerAccessories,
  applyGoalWaitingReason,
  resolveVisibleGoalRuntime,
} from "./session-surface-goal";


export type { SessionSurfaceProps } from "./session-surface-types";
import type { SessionSurfaceProps } from "./session-surface-types";

export function SessionSurface(props: SessionSurfaceProps) {
  const local = useLocal();
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
  const [accessMode, setAccessMode] = useState<ComposerAccessMode>("default");
  const [collaborationMode, setCollaborationMode] =
    useState<ComposerCollaborationMode>({
      planning: false,
      pursueGoal: false,
    });
  const [dismissedPlanBySessionId, setDismissedPlanBySessionId] =
    useState<Record<string, boolean>>({});
  const [dismissedGoalBySessionId, setDismissedGoalBySessionId] =
    useState<Record<string, boolean>>({});
  const planDismissedForSession =
    dismissedPlanBySessionId[props.sessionId] === true;
  const goalDismissedForSession =
    dismissedGoalBySessionId[props.sessionId] === true;
  const [officeCollaborationMode, setOfficeCollaborationMode] =
    useState<ComposerCollaborationMode>({
      kind: "craft",
      planning: false,
      pursueGoal: false,
    });
  const effectiveAccessMode = props.sessionAccessMode ?? accessMode;
  const baseCollaborationMode =
    assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office"
      ? officeCollaborationMode
      : collaborationMode;
  const effectiveCollaborationMode =
    props.sessionCollaborationMode ?? baseCollaborationMode;
  const updateAccessMode = useCallback(
    (nextMode: ComposerAccessMode) => {
      setAccessMode(nextMode);
      props.onSessionAccessModeChange?.(nextMode);
    },
    [props.onSessionAccessModeChange],
  );
  const updateCollaborationMode = useCallback(
    (nextMode: ComposerCollaborationMode) => {
      if (nextMode.planning || nextMode.kind === "plan") {
        props.onGoalRuntimeChange?.(null);
      } else if (
        nextMode.pursueGoal === true &&
        nextMode.kind !== "craft"
      ) {
        props.onPlanRuntimeChange?.(null);
      }
      if (assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office") {
        setOfficeCollaborationMode(nextMode);
      } else {
        setCollaborationMode(nextMode);
      }
      props.onSessionCollaborationModeChange?.(nextMode);
    },
    [
      assistantFeatureCategoryId,
      assistantOfficeFeaturesActive,
      props.onGoalRuntimeChange,
      props.onPlanRuntimeChange,
      props.onSessionCollaborationModeChange,
    ],
  );
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
  const pendingAgent = usePendingAgentStore((state) => state.agent);

  useEffect(() => {
    if (!props.personalAssistantHome) return;
    props.onPersonalAssistantCategoryActive?.(assistantCategoryId);
  }, [assistantCategoryId, props.personalAssistantHome, props.onPersonalAssistantCategoryActive]);

  useEffect(() => {
    if (!assistantScenarioId) return;
    if (draft.includes(assistantScenarioDraftToken(assistantScenarioId))) return;
    setAssistantScenarioId(null);
  }, [assistantScenarioId, draft]);

  // Subscribe to the global registry store so we re-run the restore effect
  // after a hard reload (when the registry wasn't available on first mount).
  const registry = useAgentRegistryStore((state) => state.registry);

  // Restore the pending agent when a session is re-opened: read the cached
  // custom agent ID for this session from localStorage, look it up in the
  // global registry store, and rebuild a PendingAgentContext so the welcome
  // card and transcript avatar render correctly.
  useEffect(() => {
    if (props.personalAssistantHome) return;
    if (!props.sessionId || !registry) return;
    const current = usePendingAgentStore.getState().agent;
    // Already have the right agent for this session — nothing to do.
    if (current && current.boundSessionId === props.sessionId) {
      return;
    }
    const agentId = readCustomAgentIdForSession(props.sessionId);
    if (!agentId) return;
    // The current pending agent either doesn't match this session's agent
    // (navigation to a different agent) — overwrite with the correct agent.
    // This also fixes the "+ 新会话 -> switch agent" case where the pending
    // agent was set by handleCreateCurrentAgentSession (unbound) and the user
    // then navigated away to a different agent's session.
    if (current && current.id === agentId) {
      // Same agent, just bind it to this session (e.g. sending first message
      // in a draft navigates here) — keep other fields.
      usePendingAgentStore.getState().setAgent({
        ...current,
        boundSessionId: props.sessionId,
      });
      return;
    }
    // Different agent — look in BOTH custom agents AND templates to restore.
    const agent =
      registry.agents.find((a) => a.id === agentId) ??
      registry.templates.find((t) => t.id === agentId);
    if (!agent) return;
    const restored = buildPendingAgentFromRecord(agent, registry);
    if (restored) {
      usePendingAgentStore.getState().setAgent({
        ...restored,
        boundSessionId: props.sessionId,
      });
    }
  }, [props.sessionId, registry]);

  // Only use the pending agent if it's either unbound (draft-only state,
  // session doesn't exist yet) or bound to the session we're currently
  // viewing. This keeps the agent avatar/system prompt from bleeding into
  // unrelated sessions the user navigates to later.
  const effectiveAgent = props.personalAssistantHome
    ? null
    : props.agentContext
      ? props.agentContext
    : pendingAgent &&
        (!pendingAgent.boundSessionId ||
          pendingAgent.boundSessionId === props.sessionId)
      ? pendingAgent
      : null;
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
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>(
    [],
  );
  const composerShellRef = useRef<HTMLDivElement>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  const autoOpenedTargetRef = useRef<string | null>(null);
  const initializedAutoOpenSessionRef = useRef<string | null>(null);
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
    autoOpenedTargetRef.current = null;
    initializedAutoOpenSessionRef.current = null;
    setVerifiedOpenTargets([]);
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
  const chatStreaming =
    sending || liveStatus.type === "busy" || liveStatus.type === "retry";
  const rawRenderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot }),
    [snapshot, transcriptState],
  );
  const renderedMessages = useMemo(
    () => filterCompactionMessages(rawRenderedMessages, compactBoundary),
    [compactBoundary, rawRenderedMessages],
  );
  const searchQuery = props.searchQuery?.trim() ?? "";
  const searchMatchIds = useMemo(
    () => findTranscriptSearchMatchIds(renderedMessages, searchQuery),
    [renderedMessages, searchQuery],
  );
  const searchMatchIdSet = useMemo(
    () => new Set(searchMatchIds),
    [searchMatchIds],
  );
  const activeSearchMessageId =
    searchQuery && searchMatchIds.length > 0
      ? searchMatchIds[
          ((props.searchActiveMatchIndex ?? 0) % searchMatchIds.length +
            searchMatchIds.length) %
            searchMatchIds.length
        ] ?? null
      : null;
  const scrollToMessageByIdRef = useRef<
    ((messageId: string, behavior?: ScrollBehavior) => boolean) | null
  >(null);

  useEffect(() => {
    props.onSearchMatchCountChange?.(searchMatchIds.length);
  }, [props, searchMatchIds.length]);

  useEffect(() => {
    if (!activeSearchMessageId) return;
    const scroll = scrollToMessageByIdRef.current;
    if (!scroll) return;
    // Wait a frame so highlight marks / virtual rows can settle.
    window.requestAnimationFrame(() => {
      scroll(activeSearchMessageId, "smooth");
    });
  }, [activeSearchMessageId, searchQuery]);
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
  useEffect(() => {
    const runtime = props.planRuntime;
    if (!runtime || runtime.status !== "drafting" || chatStreaming) return;
    const planText = planTextFromMessages(
      renderedMessages.slice(runtime.messageBaseline),
    );
    if (!planText) return;
    props.onPlanRuntimeChange?.({
      ...runtime,
      status: "awaiting_approval",
      planText,
    });
  }, [
    chatStreaming,
    props.onPlanRuntimeChange,
    props.planRuntime,
    renderedMessages,
  ]);
  useEffect(() => {
    const runtime = props.goalRuntime;
    if (
      !isGoalIntentRuntime(runtime) ||
      runtime.status !== "running" ||
      chatStreaming
    ) {
      return;
    }
    const baseline = runtime.lastRunMessageBaseline ?? runtime.messageBaseline;
    const runText = planTextFromMessages(renderedMessages.slice(baseline));
    props.onGoalRuntimeChange?.(settleGoalRuntimeAfterRun({
      runtime,
      todos: normalizedTodoItems(props.todos),
      runText,
      now: Date.now(),
    }));
  }, [
    chatStreaming,
    props.goalRuntime,
    props.onGoalRuntimeChange,
    props.todos,
    renderedMessages,
  ]);
  useEffect(() => {
    const runtime = props.planRuntime;
    if (!runtime || runtime.status !== "executing" || chatStreaming) return;
    const executionBaseline = runtime.executionBaseline ?? runtime.messageBaseline;
    const executionText = planTextFromMessages(
      renderedMessages.slice(executionBaseline),
    );
    if (!executionText) return;
    props.onPlanRuntimeChange?.({
      ...runtime,
      status: "completed",
    });
  }, [
    chatStreaming,
    props.onPlanRuntimeChange,
    props.planRuntime,
    renderedMessages,
  ]);
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
  const autoOpenTarget = selectAutoOpenTarget(verifiedOpenTargets);
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
  const [activityPulseAt, setActivityPulseAt] = useState(Date.now());
  const [activityNow, setActivityNow] = useState(Date.now());
  useEffect(() => {
    const now = Date.now();
    setActivityPulseAt(now);
    setActivityNow(now);
  }, [
    activityFingerprint,
    effectiveActivityStatus,
    liveStatus.type,
    props.sessionId,
  ]);
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
  useEffect(() => {
    if (!activityVisible) return;
    const id = window.setInterval(() => setActivityNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activityVisible]);
  const showStalledActivityNotice =
    activityVisible &&
    effectiveActivityStatus !== "compacting" &&
    activityNow - activityPulseAt >= ASSISTANT_STALL_NOTICE_MS;
  const shouldInjectStallRecovery =
    activityVisible &&
    effectiveActivityStatus !== "compacting" &&
    activityNow - activityPulseAt >= ASSISTANT_RECOVERY_HINT_MS;
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
  const assistantStatusFooter =
    showInlineActivityIndicator ? (
      <AssistantWaitingCard
        collapseLayout
        label={getAssistantActivityPhaseLabel(assistantActivity)}
      />
    ) : showNoVisibleAssistantOutput ? (
      <AssistantNoVisibleOutputCard text={noVisibleAssistantOutputText} />
    ) : outputLimitedAssistantMessage && !visibleTranscriptError ? (
      <OutputLimitContinueCard
        key={outputLimitedAssistantMessage.id}
        busy={sending || chatStreaming}
        onContinue={() => {
          void handleOutputLimitContinue();
        }}
      />
    ) : reserveAssistantStatusSpace ? (
      <AssistantStatusSpacer />
    ) : null;
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
    if (!autoOpenTarget || chatStreaming) return;
    if (autoOpenedTargetRef.current === autoOpenTarget.id) return;
    autoOpenedTargetRef.current = autoOpenTarget.id;
    props.onOpenTarget?.(autoOpenTarget, { auto: true });
  }, [autoOpenTarget, chatStreaming, props.onOpenTarget]);

  useEffect(() => {
    let cancelled = false;
    function initializeAutoOpenState(targets: OpenTarget[]) {
      if (initializedAutoOpenSessionRef.current === props.sessionId) return;
      initializedAutoOpenSessionRef.current = props.sessionId;
      autoOpenedTargetRef.current = selectAutoOpenTarget(targets)?.id ?? null;
    }

    async function verifyTargets() {
      if (!openTargets.length) {
        initializeAutoOpenState([]);
        setVerifiedOpenTargets([]);
        return;
      }
      try {
        const response = await props.client.resolveArtifacts(
          props.workspaceId,
          openTargets,
        );
        if (!cancelled) {
          const nextTargets = response.items as OpenTarget[];
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      } catch {
        if (!cancelled) {
          const nextTargets = openTargets.map((target) => ({
            ...target,
            exists: target.kind === "url",
          }));
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      }
    }
    void verifyTargets();
    return () => {
      cancelled = true;
    };
  }, [
    openTargetsFingerprint,
    props.client,
    props.sessionId,
    props.workspaceId,
  ]);

  useEffect(() => {
    props.onOpenTargetsChange?.(verifiedOpenTargets);
  }, [props.onOpenTargetsChange, verifiedOpenTargets]);

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
    }
    await abortSessionSafe(opencodeClient, props.sessionId);
    await snapshotQuery.refetch();
  }, [
    opencodeClient,
    props.draftOnly,
    props.sessionId,
    props.workspaceId,
    snapshotQuery.refetch,
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
  const sessionScroll = useSessionScrollController({
    selectedSessionId: props.sessionId,
    renderedMessages,
    renderedMessageIds: renderedMessages.map((message) => message.id),
    containerRef: scrollRef,
    contentRef,
    active: chatStreaming,
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

  const personalAssistantDraftHome =
    props.personalAssistantHome &&
    props.draftOnly &&
    renderedMessages.length === 0 &&
    !visibleTranscriptError &&
    effectiveActivityStatus === "idle";
  const expertDraftHome =
    !props.personalAssistantHome &&
    props.draftOnly &&
    Boolean(props.agentContext) &&
    renderedMessages.length === 0 &&
    !visibleTranscriptError &&
    effectiveActivityStatus === "idle";
  /** Empty expert chat (draft or zero-message session) — same compact composer as assistant home. */
  const expertEmptyComposer =
    !props.personalAssistantHome &&
    Boolean(effectiveAgent || props.agentContext) &&
    renderedMessages.length === 0 &&
    !hasTranscriptContent &&
    !visibleTranscriptError &&
    effectiveActivityStatus === "idle";
  const homeComposerLayout =
    personalAssistantDraftHome || expertDraftHome || expertEmptyComposer;
  const composerOuterBorderVisible =
    personalAssistantDraftHome || expertDraftHome || expertEmptyComposer;
  const assistantDraftHomeTitle =
    assistantCategoryId === "code"
      ? t("session.assistant_code_title")
      : t("session.assistant_work_title");
  const assistantDraftHomeSubtitle =
    assistantCategoryId === "code"
      ? t("session.assistant_code_subtitle")
      : t("session.assistant_work_subtitle");

  const draftWorkspaceAccessoryActive =
    Boolean(props.personalAssistantHome || props.assistantFeatureCategoryId) &&
    Boolean(props.draftOnly);

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
  const codeSceneToolbar =
    assistantCodeFeaturesActive && assistantFeatureCategoryId === "code" ? (
      <CodeSceneToolbar
        sessionId={props.sessionId}
        draftOnly={props.draftOnly ?? false}
        workspacePath={
          props.draftOnly
            ? (props.draftWorkspaceDirectory?.trim() || props.workspaceRoot || null)
            : props.workspaceRoot
        }
      />
    ) : null;

  // When the multi-session tab strip is expanded it owns the bottom rule;
  // hide the header border so expert chrome does not draw two lines.
  const [sessionTabsExpanded, setSessionTabsExpanded] = useState(
    () => Boolean(props.conversationTabs),
  );
  useEffect(() => {
    if (!props.conversationTabs) setSessionTabsExpanded(false);
  }, [props.conversationTabs]);
  const conversationTabsNode = useMemo(() => {
    if (!props.conversationTabs || !isValidElement(props.conversationTabs)) {
      return props.conversationTabs ?? null;
    }
    return cloneElement(
      props.conversationTabs as ReactElement<{
        onExpandedChange?: (expanded: boolean) => void;
      }>,
      { onExpandedChange: setSessionTabsExpanded },
    );
  }, [props.conversationTabs]);

  return (
    <DevProfiler id="SessionSurface">
      <div className="flex h-full min-h-0 flex-col">
        {/* New-task / draft home: no top agent chrome — hero + composer own the canvas.
            Once a session has messages (or is loading), pin the header at the top. */}
        {!personalAssistantDraftHome ? (
          <SessionSurfaceHeader
            agent={chatHeaderAgent}
            codeSceneToolbar={codeSceneToolbar}
            personalAssistantHome={props.personalAssistantHome}
            onOpenAgentSettings={props.onOpenAgentSettings}
            headerActions={props.headerActions}
            showBottomBorder={!sessionTabsExpanded}
          />
        ) : null}
        {!personalAssistantDraftHome ? conversationTabsNode : null}
        {model.transitionState === "switching" && showDelayedLoading ? (
          <div className="flex justify-center px-6 pt-4">
            <StatusBadge tone="surface" size="default">
              {model.renderSource === "cache"
                ? "Switching session from cache..."
                : "Switching session..."}
            </StatusBadge>
          </div>
        ) : null}

        {/* Body: draft home centers title+composer; chat fills remaining height. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            personalAssistantDraftHome &&
              "items-center justify-center px-6 pb-[min(8vh,3.5rem)] pt-6",
          )}
        >
        <div
          className={cn(
            "relative min-h-0 flex-1",
            personalAssistantDraftHome && "hidden",
          )}
        >
          <div
            ref={scrollRef}
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
            className={cn(
              "absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain py-5",
              // Match composer horizontal inset so content + input share one column.
              SESSION_CONTENT_X_PADDING_CLASS,
            )}
          >
            <div
              ref={contentRef}
              className={cn("mx-auto w-full", SESSION_CONTENT_MAX_WIDTH_CLASS)}
            >
              {showDelayedLoading && pendingSessionLoad ? (
                <TranscriptHistorySkeleton pairCount={3} />
              ) : (snapshotQuery.isError || visibleTranscriptError) &&
                !snapshot &&
                !hasTranscriptContent ? (
                <div className="px-6 py-8">
                  {visibleTranscriptError ? (
                    <SessionErrorCard
                      error={visibleTranscriptError}
                      onDismiss={handleDismissError}
                      onChangeModel={props.onChangeModel}
                      onOpenModelPicker={props.onModelClick}
                    />
                  ) : (
                    <div className={sessionSurfaceStateClass.snapshotError}>
                      {snapshotQuery.error instanceof Error
                        ? snapshotQuery.error.message
                        : "Failed to load session."}
                    </div>
                  )}
                </div>
              ) : !hasTranscriptContent &&
                effectiveActivityStatus !== "idle" &&
                !visibleTranscriptError ? (
                <div className="px-6 py-12">
                  <AssistantWaitingCard
                    label={getAssistantActivityPhaseLabel(assistantActivity)}
                  />
                </div>
              ) : !hasTranscriptContent &&
                (props.draftOnly ||
                  (snapshot && snapshot.messages.length === 0)) ? (
                visibleTranscriptError ? (
                  <SessionErrorCard
                    error={visibleTranscriptError}
                    onDismiss={handleDismissError}
                    onChangeModel={props.onChangeModel}
                    onOpenModelPicker={props.onModelClick}
                  />
                ) : props.personalAssistantHome ? null : effectiveAgent ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 py-6">
                    <div className="flex shrink-0 flex-col items-center gap-2">
                      <PendingAgentAvatar
                        name={effectiveAgent.name}
                        avatarUrl={effectiveAgent.avatar.avatarUrl}
                        avatarBackground={
                          effectiveAgent.avatar.avatarBackground
                        }
                        className="size-16 text-3xl"
                      />
                      <h2 className={sessionSurfaceTextClass.agentEmptyTitle}>
                        {effectiveAgent.name}
                      </h2>
                      <p className={sessionSurfaceTextClass.agentEmptyDescription}>
                        {effectiveAgent.description}
                      </p>
                    </div>
                    <AgentPromptSuggestions
                      agentId={effectiveAgent.id}
                      quickPrompts={effectiveAgent.quickPrompts}
                      onSelect={(prompt) => void typeComposerText(prompt)}
                      className="shrink-0"
                    />
                  </div>
                ) : null
              ) : (
                <DevProfiler id="SessionTranscript">
                  <>
                    <SessionTranscript
                      messages={renderedMessages}
                      isStreaming={chatStreaming}
                      developerMode={props.developerMode}
                      showThinking={showThinking}
                      dividers={interruptionDividers}
                      scrollElement={resolveTranscriptScrollElement}
                      onRevertToMessage={props.onRevertToMessage}
                      onForkAtMessage={props.onForkAtMessage}
                      openTargets={verifiedOpenTargets}
                      onOpenTarget={props.onOpenTarget}
                      workspaceRoot={props.workspaceRoot}
                      footer={assistantStatusFooter}
                      assistantAvatar={chatHeaderAgent}
                      searchHighlightQuery={searchQuery || undefined}
                      searchMatchMessageIds={
                        searchQuery ? searchMatchIdSet : undefined
                      }
                      activeSearchMessageId={activeSearchMessageId}
                      setScrollToMessageById={(handler) => {
                        scrollToMessageByIdRef.current = handler;
                      }}
                    />
                    {visibleTranscriptError ? (
                      <SessionErrorCard
                        error={visibleTranscriptError}
                        onDismiss={handleDismissError}
                        onChangeModel={props.onChangeModel}
                        onOpenModelPicker={props.onModelClick}
                      />
                    ) : null}
                  </>
                </DevProfiler>
              )}
            </div>
          </div>
          <TranscriptScrollToLatest
            visible={!personalAssistantDraftHome && !sessionScroll.isAtBottom}
            label={t("session.jump_to_latest")}
            onActivate={() => {
              sessionScroll.jumpToLatest("auto");
            }}
          />
        </div>

        {/* Code tools on draft home: under pinned header. */}
        {personalAssistantDraftHome && codeSceneToolbar ? (
          <div className="absolute right-5 top-14 z-20 flex items-center gap-1.5 mac:titlebar-no-drag">
            {codeSceneToolbar}
          </div>
        ) : null}
        {/* Home: one max-w-2xl column so brand title + composer share width. */}
        <div
          className={cn(
            personalAssistantDraftHome &&
              "flex w-full max-w-2xl shrink-0 flex-col items-stretch",
          )}
        >
        {personalAssistantDraftHome ? (
          <SessionSurfaceDraftHome
            categoryId={assistantCategoryId}
            title={assistantDraftHomeTitle}
            subtitle={assistantDraftHomeSubtitle}
          />
        ) : null}
        <div
          ref={composerShellRef}
          className={cn(
            "shrink-0 px-0 pb-2 pt-2",
            (personalAssistantDraftHome || homeComposerLayout) && "w-full pb-0 pt-0",
          )}
        >
          <DevProfiler id="SessionComposer">
            <ReactSessionComposer
              draft={draft}
              mentions={mentions}
              scenarioTags={assistantScenarioTags}
              promptTemplates={personalizedPromptTemplates}
              onSelectPromptTemplate={selectAssistantPromptTemplate}
              onDraftChange={handleComposerDraftChange}
              onSend={handleSend}
              onStop={handleAbort}
              busy={chatStreaming}
              disabled={
                model.transitionState !== "idle" &&
                model.transitionState !== "failed"
              }
              modelUnavailable={Boolean(props.modelUnavailable)}
              accessMode={effectiveAccessMode}
              onAccessModeChange={updateAccessMode}
              collaborationMode={effectiveCollaborationMode}
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
              onUploadInboxFiles={
                props.onUploadInboxFiles ?? handleUploadInboxFiles
              }
              showOuterBorder={composerOuterBorderVisible}
              compactTopSpacing={Boolean(composerAccessory)}
              homeLayout={homeComposerLayout}
              topAccessory={composerAccessory}
              hideAccessPermissionSelect={draftWorkspaceAccessoryActive}
              bottomAccessory={
                draftWorkspaceAccessoryActive ? (
                  <SessionDraftWorkspaceAccessory
                    draftWorkspaceDirectory={props.draftWorkspaceDirectory}
                    ownerWorkspaceId={props.draftWorkspaceOwnerId}
                    assistantFeatureCategoryId={assistantFeatureCategoryId}
                    showFolderRequiredBubble={showFolderRequiredBubble}
                    onDismissFolderRequiredBubble={() => setShowFolderRequiredBubble(false)}
                    onSelectDraftWorkspace={props.onSelectDraftWorkspace}
                    onCreateDraftWorkspace={props.onCreateDraftWorkspace}
                    onPickDraftWorkspace={props.onPickDraftWorkspace}
                    onClearDraftWorkspace={props.onClearDraftWorkspace}
                    accessMode={effectiveAccessMode}
                    onAccessModeChange={updateAccessMode}
                  />
                ) : undefined
              }
            />
          </DevProfiler>
        </div>
        </div>
        </div>
        {/* Error display moved inline into the session conversation area */}
        {props.developerMode ? (
          <SessionDebugPanel model={model} snapshot={snapshot} />
        ) : null}
      </div>
    </DevProfiler>
  );
}
