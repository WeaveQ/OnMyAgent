/** @jsxImportSource react */
/**
 * State, effects, and handlers for ExpertPage.
 * Extracted from expert.tsx (P1-5 residual file-size split).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../../i18n";
import { formatShortcut } from "../../../../lib/format-shortcut";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft, SidebarSessionItem } from "../../../../app/types";
import type { OpenTarget } from "../artifacts/open-target";
import {
  useReactRenderWatchdog,
} from "../../../shell";
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { SessionHistorySearchChrome } from "./session-history-search-chrome";
import { createCanvasSessionKey } from "../infinite-canvas";

import type { SessionPageProps } from "./session-page-types";

import {
  type AgentCardItem,
  type AgentRegistry,
  buildAgentToolAccess,
  buildAgentSystemPrompt,
  createExpertOperationId,
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  type PendingAgentContext,
  resolveAgentAvatarUrl,
  useAgentRegistryStore,
  usePendingAgentStore,
} from "../../agents";
import {
  resolveExpertDeleteCopy,
  useExpertSessionDelete,
  type ExpertGroupDeleteTarget,
} from "./use-expert-session-delete";
import { useExpertHardDeleteUi } from "./use-expert-hard-delete-ui";
import { prewarmOnMyAgentEnvSystemContext } from "../../shared";
import { createClient, unwrap } from "../../../../app/lib/opencode";
import { createIsolatedExpertSessionRuntimeDirectory } from "../../../capabilities/session-identity/expert-session-directory";
import { startExpertColdPrewarm } from "../sync/expert-cold-path";
import {
  AgentSessionTabs,
  readExpertSessionSelection,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
  AGENT_PANEL_DEFAULT_WIDTH,
  shouldShowSessionStartupSkeleton,
  workspaceTaskStatus,
} from "../sidebar/session-chrome";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "../sidebar/conversation-model";
import type { StorePrimaryTab } from "../components/side-panel-pages";
import { isPrimaryOrHostedRailView } from "../navigation/rail-view-guards";
import { useStatusToasts } from "../../shell-feedback";
import {
  archiveAssistantTask,
  archivedSessionIdSet,
  permanentlyRemoveAssistantArchivedTask,
  readAssistantArchivedTasks,
} from "../../shared";

import {
  createWorkspaceFilesAgentHandlers,
  setComposerDraftAfterNewTask,
} from "./shared-page-utils";
import { buildAskAgentFileInstruction } from "../../../capabilities/artifacts/file-preview-policy";
import {
  EXPERT_SIDE_PANEL_DEFAULT_WIDTH,
  EXPERT_SIDE_PANEL_MIN_WIDTH,
  NO_EXPERT_CONVERSATIONS_ASSET,
  expertFeatureCategoryForAgent,
} from "./expert-page-utils";
import { useCustomConnectorDialog } from "./use-custom-connector-dialog";
import { useMyExpertPackages } from "./use-my-expert-packages";
import { useAgentPanelResize } from "./use-agent-panel-resize";
import { useSessionPageHostState } from "./use-session-page-host-state";
import {
  buildCurrentAgentSessions,
  buildExpertSidebarSessionGroups,
  buildExpertWorkspaceSessions,
  resolveExpertSidebarOpen,
  selectRawWorkspaceSessions,
  shouldExitDraftForExpertSidebarTarget,
} from "./expert-conversation-model";
import { useExpertAutomationOffer } from "./use-expert-automation-offer";
import {
  shouldKeepUnboundExpertDraft,
} from "./expert-draft-session";
import {
  isLiveExpertSessionSelection,
  resolveExpertSurfaceMode,
} from "./expert-surface-mode";
import { useExpertBoundDraftTransition } from "./use-expert-bound-draft-transition";
import { useExpertSessionStarters } from "./use-expert-session-starters";
import { useExpertWaybillPatch } from "./use-expert-waybill-patch";
import {
  resolveExpertDirectoryView,
  shouldBlockExpertSurfaceForWorkspaceError,
  shouldMountExpertSessionSurface,
} from "./expert-directory-view";

import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";
import { useExpertSkillNavigation } from "./use-expert-skill-navigation";
import { useSessionExpertCreation } from "./use-session-expert-creation";
import { useOpenExpertSession } from "./use-open-expert-session";
import { useExpertDirectoryShadow } from "../../../capabilities/session-identity/expert-directory-query";
import {
  buildExpertDirectoryPageModel,
  selectAgentIdForSession,
  type ExpertDirectoryShadowDiff,
} from "../../../capabilities/session-identity/expert-directory-page-model";
import { buildExpertPageIdentityModel } from "./expert-page-identity-model";
import { buildExpertPageFilesOpenSessionMeta } from "./expert-page-artifacts-model";
import { buildExpertPageNavigationModel } from "./expert-page-navigation-model";
import { useExpertArchiveRevision } from "./use-expert-archive-revision";
import { useExpertSessionTabOrder } from "./use-expert-session-tab-order";
import { useExpertDraftCleanup } from "./use-expert-draft-cleanup";
import { useExpertComposerTemplateEvents } from "./use-expert-composer-template-events";
import { useExpertRouteLifecycle } from "./use-expert-route-lifecycle";


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
  const [draftAgentContexts, setDraftAgentContexts] = useState<Record<string, PendingAgentContext>>({});
  const registry = useAgentRegistryStore((state) => state.registry);
  const pendingAgent = usePendingAgentStore((state) => state.agent);
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
  const shadowLegacySnapshot = useMemo(
    () => [{
      agentId: "legacy",
      sessionIds: workspaceSessions.map((session) => session.id),
    }],
    [workspaceSessions],
  );
  const emitExpertDirectoryShadow = useCallback((event: ExpertDirectoryShadowDiff) => {
    const client = props.onmyagentServerClient;
    const workspaceId = (props.runtimeWorkspaceId ?? props.selectedWorkspaceId).trim();
    if (!client || !workspaceId) return;
    const changedFieldCount = [
      event.legacy.agentCount !== event.projection.agentCount,
      event.legacy.sessionCount !== event.projection.sessionCount,
      event.legacy.sessionIdsHash !== event.projection.sessionIdsHash,
    ].filter(Boolean).length;
    const change = changedFieldCount === 0
      ? "unchanged"
      : event.legacy.sessionCount === 0 && event.projection.sessionCount > 0
        ? "added"
        : event.projection.sessionCount === 0 && event.legacy.sessionCount > 0
          ? "removed"
          : "changed";
    // The diagnostics endpoint accepts only change/counts. Hashes remain local
    // and no workspace/session identity, path, prompt, or content is uploaded.
    void client.recordExpertDirectoryShadowDiff(workspaceId, {
      change,
      changedFieldCount,
      count: event.projection.sessionCount,
    }).catch(() => undefined);
  }, [props.onmyagentServerClient, props.runtimeWorkspaceId, props.selectedWorkspaceId]);
  const expertDirectoryQuery = useExpertDirectoryShadow({
    workspaceId: props.selectedWorkspaceId,
    serverWorkspaceId: props.runtimeWorkspaceId ?? props.selectedWorkspaceId,
    client: props.onmyagentServerClient,
    legacy: shadowLegacySnapshot,
    enabled: Boolean(props.onmyagentServerClient && props.selectedWorkspaceId.trim()),
    isDevelopment: import.meta.env.DEV,
    emit: emitExpertDirectoryShadow,
  });
  const expertDirectoryPage = buildExpertDirectoryPageModel({
    workspaceError: props.selectedWorkspaceError,
    query: {
      data: expertDirectoryQuery.data,
      lastComplete: expertDirectoryQuery.lastComplete,
      error: expertDirectoryQuery.error,
      isPending: expertDirectoryQuery.isPending,
      isLoading: expertDirectoryQuery.isLoading,
    },
  });
  const identityModel = useMemo(
    () =>
      buildExpertPageIdentityModel({
        directoryPage: expertDirectoryPage,
        workspaceSessions,
        registry,
        selectedSessionId: props.selectedSessionId,
      }),
    [expertDirectoryPage, props.selectedSessionId, registry, workspaceSessions],
  );
  const {
    expertDirectoryIdentity,
    expertDirectoryMissingSkills,
    expertDirectoryReady,
    routeSessionLive,
    effectiveSelectedSessionId,
    routeRealSessionId,
    currentConversationAgentId,
    conversationGroups,
    hasAnyExpertConversation,
  } = identityModel;
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
  const navigationModel = useMemo(
    () =>
      buildExpertPageNavigationModel({
        draftAgentContexts,
        selectedWorkspaceId: props.selectedWorkspaceId,
        draftAgentId,
        activeConversationAgentId,
        conversationGroups,
        pendingAgent,
        registry,
      }),
    [
      activeConversationAgentId,
      conversationGroups,
      draftAgentContexts,
      draftAgentId,
      pendingAgent,
      props.selectedWorkspaceId,
      registry,
    ],
  );
  const {
    draftAgentGroups,
    draftAgentGroup,
    activeAgentContext,
  } = navigationModel;
  const activeExpertFeatureCategoryId = expertFeatureCategoryForAgent(
    activeConversationAgentId,
  );
  const archivedRevision = useExpertArchiveRevision();
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
      identity: expertDirectoryIdentity,
    });
    return sessions.filter((session) => !archivedExpertSessionIds.has(session.id));
  }, [
    activeConversationAgentId,
    activeDraftSessionId,
    archivedExpertSessionIds,
    effectiveSelectedSessionId,
    expertDirectoryIdentity,
    props.selectedWorkspaceId,
    showDraftChrome,
    workspaceSessions,
  ]);

  const filesOpenSessionMeta = useMemo(
    () =>
      buildExpertPageFilesOpenSessionMeta({
        workspaceId: props.selectedWorkspaceId,
        workspaceRoot:
          props.workspaceFilesRoot?.trim() || props.selectedWorkspaceRoot,
        workspaceSessions,
        archivedSessionIds: archivedExpertSessionIds,
      }),
    [
      archivedExpertSessionIds,
      props.selectedWorkspaceId,
      props.selectedWorkspaceRoot,
      props.workspaceFilesRoot,
      workspaceSessions,
    ],
  );
  const {
    sessionTabOrderIdsByScope,
    sessionTabOrderIds,
  } = useExpertSessionTabOrder({
    workspaceId: props.selectedWorkspaceId,
    agentId: activeConversationAgentId,
    sessions: currentAgentSessions,
  });

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

  useExpertRouteLifecycle({
    expertDirectoryReady,
    activeSidebarView,
    draftSessionActive,
    draftAgentId,
    pendingAgent,
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    routeSessionLive,
    expertDirectoryIdentity,
    conversationGroups,
    sessionTabOrderIdsByScope,
    onOpenSession: props.sidebar.onOpenSession,
    onCreateTaskInWorkspace: props.sidebar.onCreateTaskInWorkspace,
  });

  // NOTE: Do NOT re-activate agent-selection draft when selectedSessionId is
  // briefly null during tab navigation. That gap + stuck draftIntent used to
  // force idle_draft/draftOnly and blank the surface after multi-switch.
  // Marketplace / 去聊天 already double-activate after openFresh.

  useExpertDraftCleanup({
    activeSidebarView,
    activeDraftSessionId,
    draftSessionActive,
    pendingAgentDraftSource,
    workspaceId: props.selectedWorkspaceId,
    setDraftAgentContexts,
    setDraftSessionActive,
    setDraftAgentId,
  });

  const activateDraftAgent = useCallback((agent: PendingAgentContext) => {
    setDraftAgentContexts((current) => ({ ...current, [agent.id]: agent }));
    usePendingAgentStore.getState().setAgent(agent);
    setDraftAgentId(agent.id);
    setDraftSessionActive(true);
    // Prewarm while user types first message — shortens 准备中 on first send.
    prewarmOnMyAgentEnvSystemContext(props.onmyagentServerClient);
    // A: isolate dir + session.create under global cold queue (B) before send.
    // Must use the *registry* workspace path (workspaceFilesRoot), not
    // selectedWorkspaceRoot which page-view sets to the session-scoped root.
    // Key must match send path: endpoint workspaceId + pending agent id.
    const workspaceId =
      props.runtimeWorkspaceId?.trim() ||
      props.selectedWorkspaceId?.trim() ||
      "";
    const workspaceRoot =
      props.workspaceFilesRoot?.trim() ||
      props.selectedWorkspaceRoot?.trim() ||
      "";
    const baseUrl = props.opencodeBaseUrl?.trim() ?? "";
    const token = props.onmyagentServerToken?.trim() ?? "";
    const client = props.onmyagentServerClient;
    if (!workspaceId || !workspaceRoot || !baseUrl || !client) return;
    const agentId = agent.id?.trim() || "";
    const agentName = agent.name?.trim() || "expert";
    const skillNames = agent.skillIds ?? [];
    const packageName = agent.marketplaceExpert?.packageName || agentId;
    const approvedAgentIds = agent.approvedAgentIds ?? [];
    // Defer past draft open paint so prewarm disk/OpenCode work does not
    // hitch the first frame of 「准备中」 chrome.
    window.setTimeout(() => {
      const still = usePendingAgentStore.getState().getAgent();
      if (!still || still.id?.trim() !== agentId) return;
      startExpertColdPrewarm(
        {
          workspaceId,
          agentId,
          agentName,
          packageName,
          approvedAgentIds,
          skillNames,
        },
        {
          createIsolatedDirectory: () =>
            createIsolatedExpertSessionRuntimeDirectory({
              client,
              workspaceId,
              workspaceRoot,
              agentName,
              agentId,
              packageName,
              approvedAgentIds,
              skillNames,
            }),
          createSession: async (directory) => {
            const opencode = createClient(baseUrl, directory || undefined, {
              mode: "onmyagent",
              token: token || undefined,
            });
            const created = unwrap(
              await opencode.session.create({ directory }),
            );
            return { id: created.id };
          },
        },
      );
    }, 400);
  }, [
    props.onmyagentServerClient,
    props.onmyagentServerToken,
    props.opencodeBaseUrl,
    props.runtimeWorkspaceId,
    props.selectedWorkspaceId,
    props.selectedWorkspaceRoot,
    props.workspaceFilesRoot,
  ]);
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
    expertDirectoryIdentity,
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
          ? expertDirectoryIdentity.agentIdBySessionId.get(hint) ?? null
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
      expertDirectoryIdentity,
      handleOpenExpertSession,
      props.selectedSessionId,
      sessionTabOrderIdsByScope,
    ],
  );

  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (
      !sessionId ||
      sessionId.startsWith("draft:") ||
      !expertDirectoryIdentity.sessionIds.has(sessionId)
    ) {
      return;
    }
    const agentId = expertDirectoryIdentity.agentIdBySessionId.get(sessionId);
    if (!agentId) return;
    writeExpertSessionSelection(props.selectedWorkspaceId, agentId, sessionId);
  }, [
    expertDirectoryIdentity,
    props.selectedSessionId,
    props.selectedWorkspaceId,
  ]);
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
        operationId: createExpertOperationId(),
        draftCreatedAt: Date.now(),
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

  useExpertComposerTemplateEvents({
    runtimeWorkspaceId: props.runtimeWorkspaceId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    draftAgentId,
  });

  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (!sessionId || sessionId.startsWith("draft:")) return;

    if (shouldKeepUnboundExpertDraft({
        draftSessionActive,
        draftAgentId,
        pendingDraftSource: pendingAgent?.draftSource,
        pendingAgentId: pendingAgent?.id,
        pendingBoundSessionId: pendingAgent?.boundSessionId,
        selectedSessionAgentId: selectAgentIdForSession(
          expertDirectoryPage.payload,
          sessionId,
        ),
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
    expertDirectoryPage.payload,
    props.selectedSessionId,
  ]);

  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] =
    useState(false);

  const { executeExpertDelete, deleteProgress } = useExpertSessionDelete({
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
    deleteProgress,
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
  const expertDirectoryView = resolveExpertDirectoryView({
    activeChat: activeSidebarView === "chat" && !showDraftChrome,
    directoryState: expertDirectoryPage.state,
    // Ghost deleted ses_* must not block empty-market / cold-open CTAs.
    selectedSessionId: effectiveSelectedSessionId,
    hasAnyExpertConversation,
    showWorkspaceSetupEmptyState,
    showSelectedWorkspaceError,
    showBlockingStartupSkeleton,
    showDraftChrome,
  });
  const showNoExpertConversationEmptyState =
    expertDirectoryView.showNoExpertConversation;
  const showExpertDirectoryLoading =
    expertDirectoryView.showLoadingWithoutSelection;
  const showExpertDirectoryIncomplete =
    expertDirectoryView.showIncompleteWithoutSelection;
  const mountExpertSessionSurface = shouldMountExpertSessionSurface({
    canRenderReactSurface,
    blockForWorkspaceError: blockExpertSurfaceForWorkspaceError,
    showNoExpertConversationEmptyState,
    showDirectoryIncomplete: showExpertDirectoryIncomplete,
    showDirectoryLoading: showExpertDirectoryLoading,
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
    host: { props, navigate, localAuthUser, showToast },
    rail: {
      activeConversationAgentId,
      activeDraftSessionId,
      activePlaceholderView,
      activeSidebarView,
      agentPanelCollapsed,
      agentPanelWidth,
      agentSearch,
      conversationGroups,
      conversationTabs,
      deletableExpertIds,
      expertDirectoryIdentity,
      draftAgentGroup,
      draftAgentGroups,
      draftSessionActive: showDraftChrome,
      editableExpertIds,
      handleChatWithSkill,
      handleCreateCurrentAgentSession,
      handleCreateSkill,
      handleEditExpert,
      handleEditSkill,
      handleOpenDraftSession,
      handleOpenExpertFromSidebar,
      handleOpenExpertStarter,
      handleSelectArtifactPrompt,
      handleStartAgentConversation,
      handleStartMarketplaceExpert,
      myExpertPackages,
      openCustomConnector,
      openDeleteExpertModal,
      openDeleteModal,
      openExpertCreation,
      openExpertMarket,
      openRailView,
      pendingArchiveResume,
      setAgentPanelCollapsed,
      setAgentPanelWidth,
      setAgentSearch,
      setPendingArchiveResume,
      setStoreActiveTab,
      sidebarWorkspaceSessionGroups,
      startAgentPanelResize,
      storeActiveTab,
      taskStatus,
      visitedRailViews,
    },
    surface: {
      activeAgentContext,
      activeExpertFeatureCategoryId,
      automationOfferFlow,
      automationResultAccessory,
      blockExpertSurfaceForWorkspaceError,
      canRenderReactSurface,
      effectiveActiveQuestion,
      effectiveRespondQuestion,
      headerPanelControls,
      historyActiveMatch,
      historySearchOpen,
      historySearchQuery,
      isDraftSession,
      isPrimarySessionView,
      mountExpertSessionSurface,
      reactSessionBaseUrl,
      reactSessionToken,
      renderedSessionId,
      selectedWorkspaceErrorMessage,
      selectedWorkspaceErrorTitle,
      setHistoryMatchCount,
      showBlockingStartupSkeleton,
      showDelayedSessionLoadingState,
      showExpertDirectoryIncomplete,
      showExpertDirectoryLoading,
      showNoExpertConversationEmptyState,
      showSelectedWorkspaceError,
      showWorkspaceSetupEmptyState,
      wrappedOnSendDraft,
      expertDirectoryMissingSkills,
    },
    sidePanel: {
      activeSidePanel,
      artifactFileTargets,
      artifactFocusToken,
      artifactTarget,
      browserPanelRef,
      canvasSessionKey,
      closeRightPane,
      codeWorkspaceCatalogRoot,
      codeWorkspacePath,
      commitBrowserPanelWidth,
      filesOpenSessionMeta,
      handleOpenTargetsChange,
      openCreatedAutomation,
      openTarget,
      sidePanelOpen,
      snapToBrowserWidth,
    },
    modals: {
      agentCreateRequestKey,
      canSaveRename,
      closeDeleteModal,
      closeExpertCreation,
      closeExpertCreationThen,
      closeRenameModal,
      confirmDelete,
      customConnectorInitialView,
      customConnectorOpen,
      deleteBusy,
      deleteOpen,
      expertCreationPage,
      expertDeleteConfirmLabel,
      expertDeleteMessage,
      expertDeleteTitle,
      handleStartAgentConversation,
      renameBusy,
      renameOpen,
      renameTitle,
      setAgentCreateRequestKey,
      setCustomConnectorOpen,
      setRenameTitle,
      submitRename,
    },
  };
}
