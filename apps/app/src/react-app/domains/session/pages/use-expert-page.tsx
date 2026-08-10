/** @jsxImportSource react */
/**
 * State, effects, and handlers for ExpertPage.
 * Extracted from expert.tsx (P1-5 residual file-size split).
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, PanelRight, Plus, Search, X, Zap } from "lucide-react";
import { t } from "../../../../i18n";
import { formatShortcut } from "../../../../lib/format-shortcut";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft, SidebarSessionItem } from "../../../../app/types";
import type { OpenTarget } from "../artifacts/open-target";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProviderAuthModal } from "../../connections";
import { SessionSurface } from "../surface/session-surface";
import { useComposerStateStore } from "../surface/composer-state-store";
import { COMPOSER_TEMPLATE_EVENTS } from "../surface/composer/capability-template";
import { ShareWorkspaceModal } from "../../workspace";
import {
  DEFAULT_BROWSER_SIDE_PANEL_WIDTH,
  OwDotTicker,
  type SidePanelItem,
  useReactRenderWatchdog,
  useUiStateStore,
} from "../../../shell";
import { cn } from "@/lib/utils";
import { PersonalLocalAgentPage } from "../../local-agents";
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { SessionHistorySearchChrome } from "./session-history-search-chrome";
import { SessionArchivePage } from "../chat/session-page-session-archive-page";
import { createCanvasSessionKey } from "../infinite-canvas";
import {
  LazyCodeWorkspaceSidePanel,
  LazyInfiniteCanvasPanel,
} from "./lazy-session-side-panels";
import {
  SessionPageMainColumn,
  SessionRailKeepAliveStack,
} from "./session-page-shell";

import type { SessionPageProps } from "./session-page-types";

import {
  type AgentCardItem,
  type AgentRegistry,
  buildAgentToolAccess,
  buildAgentSystemPrompt,
  friendlyModelNameToModelRef,
  isExpertSession,
  isValidSdkModelRef,
  type PendingAgentContext,
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  resolveAgentAvatarUrl,
  useAgentRegistryStore,
  usePendingAgentStore,
  useSessionOriginHydrationDegraded,
  useSessionOriginHydrated,
} from "../../agents";
import { AgentManagementPage } from "../../local-agents";
import { MessagingChannelsPage } from "../../messaging";
import { WorkspaceFilesPage } from "../../workspace";
import { buildFilesOpenSessionMeta } from "./session-files-open-meta";
import {
  resolveExpertDeleteCopy,
  useExpertSessionDelete,
  type ExpertGroupDeleteTarget,
} from "./use-expert-session-delete";
import { useExpertHardDeleteUi } from "./use-expert-hard-delete-ui";
import { prewarmOnMyAgentEnvSystemContext } from "../../shared";
import {
  AgentConversationPanel,
  AgentSessionTabs,
  mergeStableSessionTabOrder,
  readExpertSessionSelection,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
  AgentPanelResizeHandle,
  SidebarPaneCollapseToggle,
  OnMyAgentRail,
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  shouldShowSessionStartupSkeleton,
  workspaceTaskStatus,
  isAutomationRailView,
  type OnMyAgentPrimaryView,
} from "../sidebar/session-chrome";
import { openAutomationRailPath } from "./open-automation-rail";
import { SessionStartupSkeleton } from "./session-startup-skeleton";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "../sidebar/conversation-model";
import { useExpertUnreadStore } from "../status/expert-unread-store";
import {
  BillingPage,
  DevicesPage,
  ProjectsComingSoonPage,
  SidebarFeaturePlaceholder,
  StorePage,
  type StorePrimaryTab,
} from "../components/side-panel-pages";
import { CompanyRailPane } from "../components/company-rail-pane";
import { isPrimaryOrHostedRailView } from "../navigation/rail-view-guards";
import { EmptyArtifactsPanel } from "../surface/chrome/empty-artifacts-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CustomConnectorDialog } from "@/react-app/domains/plugins";
import { useStatusToasts } from "../../shell-feedback";
import {
  archiveAssistantTask,
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  permanentlyRemoveAssistantArchivedTask,
  readAssistantArchivedTasks,
} from "../../shared";

import {
  createWorkspaceFilesAgentHandlers,
  setComposerDraftAfterNewTask,
  setExpertComposerDraftAfterNewTask,
} from "./shared-page-utils";
import { buildAskAgentFileInstruction } from "../../../capabilities/artifacts/file-preview-policy";
import {
  EXPERT_SIDE_PANEL_DEFAULT_WIDTH,
  EXPERT_SIDE_PANEL_MIN_WIDTH,
  NO_EXPERT_CONVERSATIONS_ASSET,
  expertFeatureCategoryForAgent,
} from "./expert-page-utils";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import { useCustomConnectorDialog } from "./use-custom-connector-dialog";
import { useMyExpertPackages } from "./use-my-expert-packages";
import { useAgentPanelResize } from "./use-agent-panel-resize";
import { useSessionPageHostState } from "./use-session-page-host-state";
import {
  buildCurrentAgentSessions,
  buildDraftAgentGroups,
  buildExpertSidebarSessionGroups,
  buildExpertWorkspaceSessions,
  buildAgentConversationGroups,
  computeHasAnyExpertConversation,
  resolveExpertSidebarOpen,
  resolveActiveAgentContext,
  resolveActiveConversationGroup,
  selectRawWorkspaceSessions,
  shouldExitDraftForExpertSidebarTarget,
} from "./expert-conversation-model";
import { useExpertAutomationOffer } from "./use-expert-automation-offer";
import {
  shouldKeepUnboundExpertDraft,
} from "./expert-draft-session";
import {
  isLiveExpertSessionSelection,
  readRealSessionId,
  resolveExpertSurfaceMode,
} from "./expert-surface-mode";
import { useExpertBoundDraftTransition } from "./use-expert-bound-draft-transition";
import {
  resolveColdOpenExpertSessionId,
  resolveExpertColdOpenNavigation,
} from "./order-conversation-groups";
import { useExpertSessionStarters } from "./use-expert-session-starters";
import { useExpertWaybillPatch } from "./use-expert-waybill-patch";
import {
  resolveExpertOriginHydrationView,
  shouldBlockExpertSurfaceForWorkspaceError,
  shouldMountExpertSessionSurface,
} from "./expert-origin-hydration";
import { ExpertOriginRecoveryNotice } from "./expert-origin-recovery-notice";

import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";
import { useExpertSkillNavigation } from "./use-expert-skill-navigation";
import { useSessionExpertCreation } from "./use-session-expert-creation";
import { useOpenExpertSession } from "./use-open-expert-session";


export type ExpertPageProps = SessionPageProps & {
  onNavigateToMode: (mode: "assistant" | "expert") => void;
};

export function useExpertPage(props: ExpertPageProps) {
  const { showToast } = useStatusToasts();
  const navigate = useNavigate();
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const { agentPanelWidth, setAgentPanelWidth, startAgentPanelResize } =
    useAgentPanelResize(AGENT_PANEL_DEFAULT_WIDTH);
  const [storeActiveTab, setStoreActiveTab] =
    useState<StorePrimaryTab>("experts");
  const {
    customConnectorOpen,
    setCustomConnectorOpen,
    customConnectorInitialView,
    openCustomConnector,
  } = useCustomConnectorDialog();
  const [agentCreateRequestKey, setAgentCreateRequestKey] =
    useState<number | null>(null);
  // draftSessionActive is **intent** only (用户点了新会话/去聊天). Surface chrome
  // (draftOnly / tab / force-nav) comes from resolveExpertSurfaceMode — never
  // treat this boolean as draftOnly by itself.
  const [draftSessionActive, setDraftSessionActive] = useState(false);
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);
  const [pendingTabSessionId, setPendingTabSessionId] = useState<string | null>(null);
  const [sessionTabOrderIdsByScope, setSessionTabOrderIdsByScope] = useState<
    Record<string, string[]>
  >({});
  const [draftAgentContexts, setDraftAgentContexts] = useState<Record<string, PendingAgentContext>>({});
  const newSessionDraftCleanupRef = useRef({
    active: false,
    workspaceId: props.selectedWorkspaceId,
    sessionId: `draft:${props.selectedWorkspaceId}`,
  });
  const registry = useAgentRegistryStore((state) => state.registry);
  const pendingAgent = usePendingAgentStore((state) => state.agent);
  const sessionOriginHydrated = useSessionOriginHydrated(props.selectedWorkspaceId);
  const sessionOriginHydrationDegraded = useSessionOriginHydrationDegraded(props.selectedWorkspaceId);
  const pendingAgentDraftSource = pendingAgent?.draftSource;
  const rawWorkspaceSessions = useMemo(
    () =>
      selectRawWorkspaceSessions(
        props.sidebar.workspaceSessionGroups,
        props.sidebar.selectedWorkspaceId,
      ),
    [props.sidebar.selectedWorkspaceId, props.sidebar.workspaceSessionGroups],
  );
  const workspaceSessions = useMemo(
    () =>
      buildExpertWorkspaceSessions({
        rawWorkspaceSessions,
      }),
    [rawWorkspaceSessions],
  );
  const sidebarWorkspaceSessionGroups = useMemo(
    () =>
      buildExpertSidebarSessionGroups({
        groups: props.sidebar.workspaceSessionGroups,
      }),
    [props.sidebar.workspaceSessionGroups],
  );
  const conversationGroups = useMemo(
    () => buildAgentConversationGroups(workspaceSessions, registry),
    [registry, workspaceSessions],
  );
  const liveExpertSessionIds = useMemo(
    () => workspaceSessions.map((session) => session.id),
    [workspaceSessions],
  );
  // After expert/session hard-delete the URL can still hold a removed ses_*.
  // Inventory-ready + missing from list → treat as no selection (avoids 404 blank).
  const routeSessionLive = isLiveExpertSessionSelection({
    selectedSessionId: props.selectedSessionId,
    liveSessionIds: liveExpertSessionIds,
    inventoryReady: sessionOriginHydrated && !sessionOriginHydrationDegraded,
  });
  const effectiveSelectedSessionId = routeSessionLive
    ? props.selectedSessionId
    : null;
  const routeRealSessionId = readRealSessionId(effectiveSelectedSessionId);
  const currentConversationAgentId = routeRealSessionId
    ? readCustomAgentIdForSession(routeRealSessionId)
    : null;

  const expertSurfaceMode = useMemo(
    () =>
      resolveExpertSurfaceMode({
        selectedSessionId: effectiveSelectedSessionId,
        workspaceId: props.selectedWorkspaceId,
        draftIntent: draftSessionActive,
        draftAgentId,
        pendingAgentId: pendingAgent?.id ?? null,
        pendingBoundSessionId: pendingAgent?.boundSessionId,
        selectedSessionAgentId: currentConversationAgentId,
      }),
    [
      currentConversationAgentId,
      draftAgentId,
      draftSessionActive,
      effectiveSelectedSessionId,
      pendingAgent?.boundSessionId,
      pendingAgent?.id,
      props.selectedWorkspaceId,
    ],
  );
  const activeConversationAgentId = expertSurfaceMode.conversationAgentId;
  const activeDraftSessionId = expertSurfaceMode.draftTabSessionId;
  /** UI draft chrome (sidebar draft row / hide history chrome). Derived. */
  const showDraftChrome = expertSurfaceMode.showDraftChrome;
  const draftAgentGroups = useMemo(
    () => buildDraftAgentGroups(draftAgentContexts, props.selectedWorkspaceId),
    [draftAgentContexts, props.selectedWorkspaceId],
  );
  const draftAgentGroup = useMemo(
    () =>
      draftAgentGroups.find((group) => group.agentId === draftAgentId) ?? null,
    [draftAgentGroups, draftAgentId],
  );
  const hasAnyExpertConversation = useMemo(
    () => computeHasAnyExpertConversation(workspaceSessions),
    [workspaceSessions],
  );
  const [archivedRevision, setArchivedRevision] = useState(0);
  useEffect(() => {
    const onArchived = () => setArchivedRevision((value) => value + 1);
    window.addEventListener(assistantArchivedTasksChangedEvent, onArchived);
    return () =>
      window.removeEventListener(assistantArchivedTasksChangedEvent, onArchived);
  }, []);
  const archivedExpertSessionIds = useMemo(
    () =>
      archivedSessionIdSet(
        readAssistantArchivedTasks(props.selectedWorkspaceId),
      ),
    [archivedRevision, props.selectedWorkspaceId],
  );
  const currentAgentSessions = useMemo(() => {
    const sessions = buildCurrentAgentSessions({
      workspaceSessions,
      activeConversationAgentId,
      selectedSessionId: effectiveSelectedSessionId,
      selectedWorkspaceId: props.selectedWorkspaceId,
      draftSessionActive: showDraftChrome,
      activeDraftSessionId,
    });
    return sessions.filter((session) => !archivedExpertSessionIds.has(session.id));
  }, [
    activeConversationAgentId,
    activeDraftSessionId,
    archivedExpertSessionIds,
    effectiveSelectedSessionId,
    props.selectedWorkspaceId,
    showDraftChrome,
    workspaceSessions,
  ]);

  const filesOpenSessionMeta = useMemo(() => {
    const live = workspaceSessions.filter(
      (session) => !archivedExpertSessionIds.has(session.id),
    );
    return buildFilesOpenSessionMeta({
      workspaceId: props.selectedWorkspaceId,
      workspaceRoot:
        props.workspaceFilesRoot?.trim() || props.selectedWorkspaceRoot,
      liveSessions: live,
    });
  }, [
    archivedExpertSessionIds,
    props.selectedWorkspaceId,
    props.selectedWorkspaceRoot,
    props.workspaceFilesRoot,
    workspaceSessions,
  ]);
  const sessionTabOrderScope = [
    props.selectedWorkspaceId,
    activeConversationAgentId ?? "unbound",
  ].join(":");
  const sessionTabOrderIds = useMemo(
    () =>
      mergeStableSessionTabOrder(
        sessionTabOrderIdsByScope[sessionTabOrderScope] ?? [],
        currentAgentSessions,
      ),
    [
      currentAgentSessions,
      sessionTabOrderIdsByScope,
      sessionTabOrderScope,
    ],
  );
  useEffect(() => {
    setSessionTabOrderIdsByScope((current) => {
      const previous = current[sessionTabOrderScope] ?? [];
      if (
        previous.length === sessionTabOrderIds.length &&
        previous.every((id, index) => id === sessionTabOrderIds[index])
      ) {
        return current;
      }
      return {
        ...current,
        [sessionTabOrderScope]: sessionTabOrderIds,
      };
    });
  }, [sessionTabOrderIds, sessionTabOrderScope]);
  const activeConversationGroup = useMemo(
    () =>
      resolveActiveConversationGroup({
        activeConversationAgentId,
        draftAgentGroups,
        conversationGroups,
      }),
    [activeConversationAgentId, conversationGroups, draftAgentGroups],
  );
  const activeExpertFeatureCategoryId = expertFeatureCategoryForAgent(
    activeConversationAgentId,
  );
  const activeAgentContext = useMemo(
    () =>
      resolveActiveAgentContext({
        activeConversationAgentId,
        draftAgentContexts,
        pendingAgent,
        registry,
        activeConversationGroup,
      }),
    [
      activeConversationAgentId,
      activeConversationGroup,
      draftAgentContexts,
      pendingAgent,
      registry,
    ],
  );

  const expertHistorySessionId = showDraftChrome
    ? activeDraftSessionId
    : props.selectedSessionId;
  const {
    activeSidebarView,
    openRailView,
    visitedRailViews,
    pendingArchiveResume,
    setPendingArchiveResume,
    setCurrentSidePanel,
    toggleCurrentSidePanel,
    artifactTarget,
    setArtifactTarget,
    openTargets,
    accessibleTargets,
    artifactFileTargets,
    visibleArtifactTarget,
    artifactTargetCount,
    hasArtifactTargets,
    activeSidePanel,
    sidePanelOpen,
    handleOpenTargetsChange,
    artifactFocusToken,
    codeWorkspacePath,
    codeWorkspaceCatalogRoot,
    historySearchOpen,
    historySearchQuery,
    setHistorySearchQuery,
    historyMatchCount,
    setHistoryMatchCount,
    historyActiveMatch,
    setHistoryActiveMatch,
    historySearchInputRef,
    browserPanelRef,
    openWorkspaceSidePanelMenu,
    snapToBrowserWidth,
    handleHistorySelectPrompt,
    openHistorySearch,
    closeHistorySearch,
    commitBrowserPanelWidth,
    openTarget,
    closeRightPane,
    isPrimarySessionView,
  } = useSessionPageHostState({
    mode: "expert",
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceRoot: props.selectedWorkspaceRoot,
    workspaces: props.workspaces,
    draftWorkspaceDirectory:
      props.surface?.draftWorkspace?.draftWorkspaceDirectory,
    onAccessibleTargetsChange: props.onAccessibleTargetsChange,
    historySearchViews: ["chat"],
    sidePanelDefaultWidth: EXPERT_SIDE_PANEL_DEFAULT_WIDTH,
    sidePanelMinWidth: EXPERT_SIDE_PANEL_MIN_WIDTH,
    historyComposerSessionId: expertHistorySessionId,
  });
  const myExpertPackages = useMyExpertPackages({
    enabled: activeSidebarView === "chat" ||
      (activeSidebarView === "store" && storeActiveTab === "experts"),
  });
  const openExpertSidePanelMenu = openWorkspaceSidePanelMenu;

  useReactRenderWatchdog("ExpertPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  useEffect(() => {
    if (!sessionOriginHydrated || sessionOriginHydrationDegraded) return;
    if (activeSidebarView !== "chat") return;
    if (draftSessionActive || draftAgentId) return;
    if (
      pendingAgent?.conversationStartId &&
      !pendingAgent.boundSessionId &&
      pendingAgent.draftSource === "agent-selection"
    ) {
      return;
    }

    const workspaceId = props.sidebar.selectedWorkspaceId?.trim();
    if (!workspaceId) return;

    const selectedId = props.selectedSessionId?.trim() ?? "";
    // After hard-delete, localStorage expert-id is cleared so isExpertSession
    // is false while URL may still hold ses_*. During startup / switch, a
    // still-indexed expert can briefly miss inventory — keep it, do not steal
    // focus back to cold-open or blank the shell.
    const decision = resolveExpertColdOpenNavigation({
      selectedSessionId: selectedId,
      routeSessionLive,
      isExpertSession,
      coldOpenSessionId: resolveColdOpenExpertSessionId({
        workspaceId,
        conversationGroups,
        sessionTabOrderIdsByScope,
      }),
    });
    if (decision.action === "keep") return;
    if (decision.action === "open") {
      props.sidebar.onOpenSession(workspaceId, decision.sessionId);
      return;
    }
    if (decision.action === "clear-route") {
      props.sidebar.onOpenSession(workspaceId, "");
      return;
    }
    if (decision.action === "create-task") {
      props.sidebar.onCreateTaskInWorkspace(workspaceId);
    }
  }, [
    activeSidebarView,
    conversationGroups,
    draftAgentId,
    draftSessionActive,
    props.selectedSessionId,
    props.sidebar,
    pendingAgent?.boundSessionId,
    pendingAgent?.conversationStartId,
    pendingAgent?.draftSource,
    routeSessionLive,
    sessionOriginHydrated,
    sessionOriginHydrationDegraded,
    sessionTabOrderIdsByScope,
  ]);

  // NOTE: Do NOT re-activate agent-selection draft when selectedSessionId is
  // briefly null during tab navigation. That gap + stuck draftIntent used to
  // force idle_draft/draftOnly and blank the surface after multi-switch.
  // Marketplace / 去聊天 already double-activate after openFresh.

  useEffect(() => {
    if (activeSidebarView === "chat") return;
    if (!draftSessionActive || pendingAgentDraftSource !== "new-session") return;
    useComposerStateStore
      .getState()
      .clearSession(activeDraftSessionId ?? `draft:${props.selectedWorkspaceId}`);
    const currentAgent = usePendingAgentStore.getState().getAgent();
    if (
      currentAgent?.draftSource === "new-session" &&
      !currentAgent.boundSessionId
    ) {
      usePendingAgentStore.getState().setAgent(null);
      setDraftAgentContexts((current) => {
        const next = { ...current };
        delete next[currentAgent.id];
        return next;
      });
    }
    setDraftSessionActive(false);
    setDraftAgentId(null);
  }, [
    activeSidebarView,
    activeDraftSessionId,
    draftSessionActive,
    pendingAgentDraftSource,
    props.selectedWorkspaceId,
  ]);

  useEffect(() => {
    newSessionDraftCleanupRef.current = {
      active: draftSessionActive && pendingAgentDraftSource === "new-session",
      workspaceId: props.selectedWorkspaceId,
      sessionId: activeDraftSessionId ?? `draft:${props.selectedWorkspaceId}`,
    };
  }, [activeDraftSessionId, draftSessionActive, pendingAgentDraftSource, props.selectedWorkspaceId]);

  useEffect(
    () => () => {
      const cleanup = newSessionDraftCleanupRef.current;
      if (!cleanup.active) return;
      useComposerStateStore.getState().clearSession(cleanup.sessionId);
      const currentAgent = usePendingAgentStore.getState().getAgent();
      if (
        currentAgent?.draftSource === "new-session" &&
        !currentAgent.boundSessionId
      ) {
        usePendingAgentStore.getState().setAgent(null);
        setDraftAgentContexts((current) => {
          const next = { ...current };
          delete next[currentAgent.id];
          return next;
        });
      }
    },
    [],
  );

  const activateDraftAgent = useCallback((agent: PendingAgentContext) => {
    setDraftAgentContexts((current) => ({ ...current, [agent.id]: agent }));
    usePendingAgentStore.getState().setAgent(agent);
    setDraftAgentId(agent.id);
    setDraftSessionActive(true);
    // Prewarm while user types first message — shortens 准备中 on first send.
    prewarmOnMyAgentEnvSystemContext(props.onmyagentServerClient);
  }, [props.onmyagentServerClient]);
  const openFreshExpertDraft = useCallback(() => {
    props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
  }, [props.selectedWorkspaceId, props.sidebar]);
  const handleOpenDraftSession = useCallback(
    (sessionId: string) => {
      const agentId = sessionId.split(":").slice(2).join(":");
      const agent = agentId ? draftAgentContexts[agentId] : null;
      if (!agent) return;
      activateDraftAgent(agent);
      openFreshExpertDraft();
      activateDraftAgent(agent);
    },
    [activateDraftAgent, draftAgentContexts, openFreshExpertDraft],
  );
  const resolveSessionTabForAgent = useCallback(
    (agentId: string, sessionIds: readonly string[]) => {
      const workspaceId = props.selectedWorkspaceId.trim();
      const scope = `${workspaceId}:${agentId}`;
      const orderIds = sessionTabOrderIdsByScope[scope] ?? [];
      return resolveExpertSessionSelection({
        rememberedSessionId: readExpertSessionSelection(workspaceId, agentId),
        sessionIds,
        orderIds,
      });
    },
    [props.selectedWorkspaceId, sessionTabOrderIdsByScope],
  );

  /** Open a concrete session tab (user click / create). Records by session id. */
  const handleOpenExpertSession = useOpenExpertSession({
    sidebar: props.sidebar,
    draftAgentContexts,
    pendingAgent,
    draftAgentId,
    draftSessionActive,
    setDraftAgentContexts,
    setDraftAgentId,
    setDraftSessionActive,
    openRailView,
  });

  /**
   * Open an expert from the left list: restore last tab for that agent
   * (session id memory), else first tab in stable order — never force latest.
   */
  const handleOpenExpertFromSidebar = useCallback(
    (workspaceId: string, hintSessionId: string) => {
      const hint = hintSessionId.trim();
      const agentId =
        (hint && !hint.startsWith("draft:")
          ? readCustomAgentIdForSession(hint)
          : null) ||
        conversationGroups.find((group) =>
          group.sessions.some((session) => session.id === hint),
        )?.agentId ||
        null;
      if (!agentId) {
        handleOpenExpertSession(workspaceId, hintSessionId);
        return;
      }
      const group = conversationGroups.find((item) => item.agentId === agentId);
      const sessionIds =
        group?.sessions.map((session) => session.id) ??
        (hint ? [hint] : []);
      const scope = `${workspaceId.trim()}:${agentId}`;
      const target = resolveExpertSidebarOpen({
        hintSessionId,
        rememberedSessionId: readExpertSessionSelection(workspaceId, agentId),
        orderIds: sessionTabOrderIdsByScope[scope] ?? [],
        readySessionIds: sessionIds,
        selectedSessionId: props.selectedSessionId,
      });
      if (!target.sessionId) return;
      if (!target.shouldOpen) {
        if (shouldExitDraftForExpertSidebarTarget({
          draftAgentId,
          draftSessionActive,
          targetAgentId: agentId,
        })) {
          handleOpenExpertSession(workspaceId, target.sessionId);
          return;
        }
        openRailView("chat");
        return;
      }
      handleOpenExpertSession(workspaceId, target.sessionId);
    },
    [
      conversationGroups,
      draftAgentId,
      draftSessionActive,
      handleOpenExpertSession,
      props.selectedSessionId,
      sessionTabOrderIdsByScope,
    ],
  );

  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (!sessionId || sessionId.startsWith("draft:") || !isExpertSession(sessionId)) {
      return;
    }
    const agentId = readCustomAgentIdForSession(sessionId);
    if (!agentId) return;
    writeExpertSessionSelection(props.selectedWorkspaceId, agentId, sessionId);
  }, [props.selectedSessionId, props.selectedWorkspaceId]);
  useExpertBoundDraftTransition({
    activeDraftSessionId,
    draftAgentContexts,
    draftAgentId,
    draftSessionActive,
    pendingAgent,
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    sidebarSelectedWorkspaceId: props.sidebar.selectedWorkspaceId,
    selectedSessionAgentId: currentConversationAgentId,
    onOpenSession: props.sidebar.onOpenSession,
    setDraftAgentContexts,
    setDraftAgentId,
    setDraftSessionActive,
    setPendingTabSessionId,
  });
  const handleStartAgentConversation = useCallback(
    (
      item: AgentCardItem,
      registry: AgentRegistry,
    ) => {
      const source = item.kind === "template" ? item.template : item.agent;
      const customAvatarDataUrl =
        item.kind === "custom" ? item.agent.customAvatarDataUrl : null;
      const avatarInput = {
        avatarStyle: source.avatarStyle,
        avatarOptionId: source.avatarOptionId,
        customAvatarDataUrl,
      };
      const { url: avatarUrl, background: avatarBackground } =
        resolveAgentAvatarUrl(avatarInput, registry);

      const modelRef = isValidSdkModelRef(
        source.sdkProviderID,
        source.sdkModelID,
      )
        ? { providerID: source.sdkProviderID!, modelID: source.sdkModelID! }
        : friendlyModelNameToModelRef(source.modelProvider, source.model);

      const pending: PendingAgentContext = {
        id: source.id,
        name: source.name,
        description: source.description,
        avatar: {
          ...avatarInput,
          avatarUrl,
          avatarBackground,
        },
        systemPrompt: buildAgentSystemPrompt(source),
        tools: buildAgentToolAccess(source),
        model: modelRef ?? undefined,
        conversationStartId: Date.now(),
        draftSource: "agent-selection",
      };

      activateDraftAgent(pending);
      openFreshExpertDraft();
      activateDraftAgent(pending);
    },
    [activateDraftAgent, openFreshExpertDraft],
  );

  const handleStartAgentById = useCallback(
    (agentId: string) => {
      if (!registry) return;
      const agent =
        registry.agents.find((item) => item.id === agentId) ??
        registry.templates.find((item) => item.id === agentId);
      if (!agent) return;
      if ("showInOverview" in agent) {
        handleStartAgentConversation(
          { kind: "template", id: agent.id, template: agent },
          registry,
        );
        return;
      }
      handleStartAgentConversation(
        { kind: "custom", id: agent.id, agent },
        registry,
      );
    },
    [handleStartAgentConversation, registry],
  );

  const openExpertMarket = useCallback(() => {
    setStoreActiveTab("experts");
    openRailView("store");
  }, []);
  const {
    handleCreateSkill,
    handleChatWithSkill,
    handleEditSkill,
  } = useExpertSkillNavigation({
    workspaceId: props.selectedWorkspaceId,
    onNavigateToMode: props.onNavigateToMode,
    onCreateTaskInWorkspace: props.sidebar.onCreateTaskInWorkspace,
  });

  const { openExpertCreation, closeExpertCreation, closeExpertCreationThen, expertCreationPage, editableExpertIds, handleEditExpert } =
    useSessionExpertCreation({
      props,
      registry,
      showToast,
      onCreatedAgent: (createdAgent) => {
        activateDraftAgent(createdAgent);
        openFreshExpertDraft();
        activateDraftAgent(createdAgent);
        openRailView("chat");
      },
    });
  const seedChatDraft = useCallback(
    (draft: string) => {
      props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
      setComposerDraftAfterNewTask(props.selectedWorkspaceId, draft);
      openRailView("chat");
    },
    [openRailView, props.selectedWorkspaceId, props.sidebar],
  );

  const handleSelectArtifactPrompt = useCallback(
    ({ prompt }: { pluginId: string; skillId: string; prompt: string }) => {
      const value = prompt.trim();
      if (value) seedChatDraft(value);
    },
    [seedChatDraft],
  );
  const {
    handleStartMarketplaceExpert,
    handleCreateCurrentAgentSession,
    handleOpenExpertStarter,
  } = useExpertSessionStarters({
    conversationGroups,
    draftAgentContexts,
    registry,
    pendingAgent,
    activeAgentContext,
    activeConversationAgentId,
    currentConversationAgentId,
    draftAgentId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    sidebarSelectedWorkspaceId: props.sidebar.selectedWorkspaceId,
    onCreateFreshSessionForAgent: props.onCreateFreshSessionForAgent,
    activateDraftAgent,
    openFreshExpertDraft,
    openRailView,
    openExpertMarket,
    handleOpenExpertSession,
    resolveSessionTabForAgent,
    localExpertPackages: myExpertPackages,
    handleStartAgentById,
  });
  const {
    automationOfferFlow,
    effectiveActiveQuestion,
    effectiveRespondQuestion,
    automationResultAccessory,
    openCreatedAutomation,
  } = useExpertAutomationOffer({
    onmyagentServerClient: props.onmyagentServerClient,
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedWorkspaceRoot: props.selectedWorkspaceRoot,
    runtimeWorkspaceId: props.runtimeWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    selectedModel: props.surface?.model.selectedModel,
    draftSessionActive: showDraftChrome,
    draftAgentId,
    activeDraftSessionId,
    codeWorkspaceCatalogRoot,
    rawWorkspaceSessions,
    currentAgentSessions,
    openTargets,
    activeQuestion: props.activeQuestion,
    respondQuestion: props.respondQuestion,
    sessionStatusById: props.sidebar.sessionStatusById,
    onNavigateToMode: props.onNavigateToMode,
  });

  const wrappedOnSendDraft = useCallback(
    async (draft: ComposerDraft) => {
      if (draftSessionActive && props.onCreateSessionForAgent) {
        props.onCreateSessionForAgent();
      }

      return props.surface?.onSendDraft({
        ...draft,
        sessionStartIntent: { mode: "expert" },
      });
    },
    [
      draftSessionActive,
      props.onCreateSessionForAgent,
      props.surface,
    ],
  );

  useExpertWaybillPatch({
    client: props.onmyagentServerClient,
    workspaceId:
      props.runtimeWorkspaceId?.trim() || props.selectedWorkspaceId.trim(),
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceRoot: props.selectedWorkspaceRoot,
    catalogRoot: codeWorkspaceCatalogRoot,
    rawWorkspaceSessions,
    currentAgentSessions,
    showToast,
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          template?: string;
          targetSessionId?: string;
        }>
      ).detail;
      const template = detail?.template;
      if (typeof template !== "string" || !template.trim()) return;
      const workspaceId =
        props.runtimeWorkspaceId?.trim() || props.selectedWorkspaceId.trim();
      if (!workspaceId) return;
      if (detail.targetSessionId) {
        useComposerStateStore
          .getState()
          .setDraft(detail.targetSessionId, template);
      } else if (props.selectedSessionId) {
        useComposerStateStore.getState().setDraft(
          props.selectedSessionId,
          template,
        );
      } else if (draftAgentId) {
        setExpertComposerDraftAfterNewTask(
          workspaceId,
          draftAgentId,
          template,
        );
      } else {
        return;
      }
    };
    for (const eventName of COMPOSER_TEMPLATE_EVENTS) {
      window.addEventListener(eventName, handler);
    }
    return () => {
      for (const eventName of COMPOSER_TEMPLATE_EVENTS) {
        window.removeEventListener(eventName, handler);
      }
    };
  }, [
    draftAgentId,
    props.runtimeWorkspaceId,
    props.selectedSessionId,
    props.selectedWorkspaceId,
  ]);

  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (!sessionId || sessionId.startsWith("draft:")) return;

    if (shouldKeepUnboundExpertDraft({
        draftSessionActive,
        draftAgentId,
        pendingDraftSource: pendingAgent?.draftSource,
        pendingAgentId: pendingAgent?.id,
        pendingBoundSessionId: pendingAgent?.boundSessionId,
        selectedSessionAgentId: readCustomAgentIdForSession(sessionId),
      })) {
      return;
    }

    setDraftSessionActive(false);
    setDraftAgentId(null);
  }, [
    draftAgentId,
    draftSessionActive,
    pendingAgent?.boundSessionId,
    pendingAgent?.draftSource,
    pendingAgent?.id,
    props.selectedSessionId,
  ]);

  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] =
    useState(false);

  const { executeExpertDelete } = useExpertSessionDelete({
    workspaceId: props.selectedWorkspaceId,
    workspaceRoot: props.selectedWorkspaceRoot,
    client: props.onmyagentServerClient,
    activeConversationAgentId,
    currentAgentSessions,
    onDeleteSession: props.onDeleteSession,
    registry,
  });

  const {
    renameOpen,
    renameTitle,
    setRenameTitle,
    renameBusy,
    canSaveRename,
    deleteOpen,
    deleteBusy,
    deleteTarget,
    sessionActionTitle,
    openRenameModal,
    openDeleteModal,
    openDeleteGroupModal,
    submitRename,
    confirmDelete,
    closeDeleteModal,
    closeRenameModal,
  } = useSessionTaskRenameDelete<ExpertGroupDeleteTarget>({
    selectedSessionId: props.selectedSessionId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onRenameSession: props.onRenameSession,
    onDeleteSession: props.onDeleteSession,
    executeDelete: executeExpertDelete,
    requireGroupSessionIds: false,
  });

  const { openDeleteExpertModal, deletableExpertIds } = useExpertHardDeleteUi({
    registry,
    conversationGroups,
    openDeleteGroupModal,
  });

  const {
    title: expertDeleteTitle,
    message: expertDeleteMessage,
    confirmLabel: expertDeleteConfirmLabel,
  } = resolveExpertDeleteCopy({
    deleteTarget,
    sessionActionTitle,
    deleteBusy,
  });

  const showWorkspaceSetupEmptyState =
    props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton = shouldShowSessionStartupSkeleton({
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    coldBootShell: props.coldBootShell === true,
  });
  const showSessionLoadingState =
    Boolean(routeRealSessionId) &&
    !showDraftChrome &&
    expertSurfaceMode.kind === "real_session" &&
    props.sessionLoadingById(props.selectedSessionId) &&
    !showWorkspaceSetupEmptyState;
  const taskStatus = useMemo(
    () =>
      workspaceTaskStatus(
        props.clientConnected,
        props.onmyagentServerStatus,
        props.statusBar?.loading ?? showStartupSkeleton,
      ),
    [
      props.clientConnected,
      props.onmyagentServerStatus,
      props.statusBar?.loading,
      showStartupSkeleton,
    ],
  );
  const selectedWorkspaceConnectionMessage = (() => {
    const state =
      props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId];
    if (state?.status === "error") return state.message?.trim() ?? "";
    return "";
  })();
  const selectedWorkspaceGroupError = (() => {
    const group = props.sidebar.workspaceSessionGroups.find(
      (item) => item.workspace.id === props.selectedWorkspaceId,
    );
    return group?.error?.trim() ?? "";
  })();
  const selectedWorkspaceErrorMessage =
    props.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceGroupError ||
    "";
  const showSelectedWorkspaceError = Boolean(selectedWorkspaceErrorMessage);
  const blockExpertSurfaceForWorkspaceError = shouldBlockExpertSurfaceForWorkspaceError({ selectedSessionId: props.selectedSessionId, showSelectedWorkspaceError });
  const selectedWorkspaceErrorTitle =
    props.selectedWorkspaceDisplay.workspaceType === "remote"
      ? "Remote workspace unavailable"
      : "Agent runtime unavailable";
  const reactSessionBaseUrl = props.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    props.onmyagentServerToken?.trim() ||
    props.onmyagentServerClient?.token?.trim() ||
    "";
  // Single surface mode owns sessionId + draftOnly (see expert-surface-mode.ts).
  const renderedSessionId = expertSurfaceMode.sessionId;
  const isDraftSession = expertSurfaceMode.draftOnly;
  const canvasSessionKey = createCanvasSessionKey({
    workspaceId: props.selectedWorkspaceId,
    sessionId: renderedSessionId,
    surface: "expert",
  });
  const canRenderReactSurface = Boolean(
    props.runtimeWorkspaceId &&
    props.onmyagentServerClient &&
    reactSessionBaseUrl &&
    reactSessionToken &&
    props.surface,
  );
  const showBlockingStartupSkeleton = showStartupSkeleton && !canRenderReactSurface;
  const expertOriginHydrationView = resolveExpertOriginHydrationView({
    activeChat: activeSidebarView === "chat" && !showDraftChrome,
    originHydrated: sessionOriginHydrated,
    originDegraded: sessionOriginHydrationDegraded,
    // Ghost deleted ses_* must not block empty-market / cold-open CTAs.
    selectedSessionId: effectiveSelectedSessionId,
    hasAnyExpertConversation,
    showWorkspaceSetupEmptyState,
    showSelectedWorkspaceError,
    showBlockingStartupSkeleton,
    showDraftChrome,
  });
  const showNoExpertConversationEmptyState =
    expertOriginHydrationView.showNoExpertConversation;
  const showExpertOriginHydrationLoading =
    expertOriginHydrationView.showPendingWithoutSelection;
  const showExpertOriginHydrationDegraded =
    expertOriginHydrationView.showDegradedWithoutSelection;
  const mountExpertSessionSurface = shouldMountExpertSessionSurface({
    canRenderReactSurface,
    blockForWorkspaceError: blockExpertSurfaceForWorkspaceError,
    showNoExpertConversationEmptyState,
    showExpertOriginHydrationDegraded,
    showExpertOriginHydrationLoading,
    isDraftSession,
    showDraftChrome,
    surfaceSessionId: renderedSessionId,
  });
  const activePlaceholderView = isPrimaryOrHostedRailView(activeSidebarView)
    ? null
    : activeSidebarView;
  useEffect(() => {
    if (!showSessionLoadingState) {
      setShowDelayedSessionLoadingState(false);
      return;
    }
    const id = window.setTimeout(() => {
      setShowDelayedSessionLoadingState(true);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  const historySearchShortcut = formatShortcut(["Mod", "F"]);
  const historyMatchLabel =
    historySearchQuery.trim() && historyMatchCount > 0
      ? `${(historyActiveMatch % historyMatchCount) + 1}/${historyMatchCount}`
      : historySearchQuery.trim()
        ? "0/0"
        : "";

  const headerPanelControls = (
    <SessionHistorySearchChrome
      searchOpen={historySearchOpen}
      searchQuery={historySearchQuery}
      matchLabel={historyMatchLabel}
      matchCount={historyMatchCount}
      shortcutLabel={historySearchShortcut}
      inputRef={historySearchInputRef}
      onQueryChange={setHistorySearchQuery}
      onOpen={openHistorySearch}
      onClose={closeHistorySearch}
      onPrev={() =>
        setHistoryActiveMatch((i) =>
          historyMatchCount ? (i - 1 + historyMatchCount) % historyMatchCount : 0,
        )
      }
      onNext={() =>
        setHistoryActiveMatch((i) =>
          historyMatchCount ? (i + 1) % historyMatchCount : 0,
        )
      }
      onEnterNavigate={(shiftKey) =>
        setHistoryActiveMatch((i) =>
          shiftKey
            ? (i - 1 + historyMatchCount) % historyMatchCount
            : (i + 1) % historyMatchCount,
        )
      }
      historyPopover={
        <ConversationHistoryPopover
          client={props.onmyagentServerClient}
          workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
        sessionId={
          expertHistorySessionId &&
          !String(expertHistorySessionId).startsWith("draft:")
            ? expertHistorySessionId
            : props.selectedSessionId
        }
          onSelectPrompt={handleHistorySelectPrompt}
        />
      }
      sidePanelOpen={sidePanelOpen}
      onToggleSidePanel={(event) => {
        event.stopPropagation();
        openExpertSidePanelMenu();
      }}
    />
  );

  const handleArchiveExpertSession = useCallback(
    (sessionId: string, title: string) => {
      const workspaceId = props.selectedWorkspaceId.trim();
      const id = sessionId.trim();
      if (!workspaceId || !id) return;
      const match = currentAgentSessions.find((session) => session.id === id);
      archiveAssistantTask(workspaceId, {
        sessionId: id,
        title: title.trim() || match?.title || id,
        directory: match?.directory ?? null,
        archivedAt: Date.now(),
        category: "expert",
      });
      showToast({
        tone: "success",
        title: t("session.archive_task_done"),
      });
      if (props.selectedSessionId === id) {
      }
    },
    [currentAgentSessions, props.selectedSessionId, props.selectedWorkspaceId, showToast],
  );

  // Modal save still uses the real rename API (update + refresh). Auto-promote
  // no longer calls this on every tab snapshot (that path froze the UI).
  const commitExpertSessionTitle = useCallback(
    (sessionId: string, title: string) => {
      void props.onRenameSession?.(sessionId, title);
    },
    [props.onRenameSession],
  );

  const conversationTabs =
    activeSidebarView === "chat" ? (
      <AgentSessionTabs
        client={props.onmyagentServerClient}
        workspaceId={props.selectedWorkspaceId}
        selectedSessionId={expertSurfaceMode.sessionId}
        sessions={currentAgentSessions}
        orderIds={sessionTabOrderIds}
        pendingSessionId={
          pendingTabSessionId ?? expertSurfaceMode.creatingSessionId
        }
        onPendingSessionIdChange={setPendingTabSessionId}
        agentId={activeConversationAgentId}
        sessionStatusById={props.sidebar.sessionStatusById}
        onOpenSession={handleOpenExpertSession}
        onOpenDraftSession={handleOpenDraftSession}
        onPrefetchSession={props.sidebar.onPrefetchSession}
        onCreateSession={handleCreateCurrentAgentSession}
        onRenameSession={commitExpertSessionTitle}
        onRequestRename={openRenameModal}
        onArchiveSession={handleArchiveExpertSession}
        onDeleteSession={openDeleteModal}
      />
    ) : null;

  return {
    props,
    activeAgentContext,
    activeConversationAgentId,
    activeDraftSessionId,
    activeExpertFeatureCategoryId,
    activePlaceholderView,
    activeSidePanel,
    activeSidebarView,
    agentCreateRequestKey,
    agentPanelCollapsed,
    agentPanelWidth,
    agentSearch,
    artifactFileTargets,
    artifactFocusToken,
    artifactTarget,
    automationOfferFlow,
    automationResultAccessory,
    blockExpertSurfaceForWorkspaceError,
    browserPanelRef,
    canRenderReactSurface,
    canSaveRename,
    canvasSessionKey,
    mountExpertSessionSurface,
    closeDeleteModal,
    closeExpertCreation,
    closeExpertCreationThen,
    closeRenameModal,
    closeRightPane,
    codeWorkspaceCatalogRoot,
    codeWorkspacePath,
    commitBrowserPanelWidth,
    confirmDelete,
    conversationGroups,
    conversationTabs,
    customConnectorInitialView,
    customConnectorOpen,
    deletableExpertIds,
    deleteBusy,
    deleteOpen,
    draftAgentGroup,
    draftAgentGroups,
    // Layout/sidebar: derived chrome, not the raw intent flag.
    draftSessionActive: showDraftChrome,
    expertSurfaceMode,
    editableExpertIds,
    effectiveActiveQuestion,
    effectiveRespondQuestion,
    expertCreationPage,
    expertDeleteConfirmLabel,
    expertDeleteMessage,
    expertDeleteTitle,
    filesOpenSessionMeta,
    handleChatWithSkill,
    handleCreateCurrentAgentSession,
    handleCreateSkill,
    handleEditExpert,
    handleEditSkill,
    handleOpenDraftSession,
    handleOpenExpertFromSidebar,
    handleOpenExpertStarter,
    handleOpenTargetsChange,
    handleSelectArtifactPrompt,
    handleStartAgentConversation,
    handleStartMarketplaceExpert,
    headerPanelControls,
    historyActiveMatch,
    historySearchOpen,
    historySearchQuery,
    isDraftSession,
    isPrimarySessionView,
    localAuthUser,
    myExpertPackages,
    navigate,
    openCreatedAutomation,
    openCustomConnector,
    openDeleteExpertModal,
    openDeleteModal,
    openExpertCreation,
    openExpertMarket,
    openRailView,
    openTarget,
    pendingArchiveResume,
    reactSessionBaseUrl,
    reactSessionToken,
    renameBusy,
    renameOpen,
    renameTitle,
    renderedSessionId,
    selectedWorkspaceErrorMessage,
    selectedWorkspaceErrorTitle,
    setAgentCreateRequestKey,
    setAgentPanelCollapsed,
    setAgentPanelWidth,
    setAgentSearch,
    setCustomConnectorOpen,
    setHistoryMatchCount,
    setPendingArchiveResume,
    setRenameTitle,
    setStoreActiveTab,
    showBlockingStartupSkeleton,
    showDelayedSessionLoadingState,
    showExpertOriginHydrationDegraded,
    showExpertOriginHydrationLoading,
    showNoExpertConversationEmptyState,
    showSelectedWorkspaceError,
    showToast,
    showWorkspaceSetupEmptyState,
    sidePanelOpen,
    sidebarWorkspaceSessionGroups,
    snapToBrowserWidth,
    startAgentPanelResize,
    storeActiveTab,
    submitRename,
    taskStatus,
    visitedRailViews,
    wrappedOnSendDraft,
  };
}
