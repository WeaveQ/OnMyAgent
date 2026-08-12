import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../../i18n";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { SidebarSessionItem } from "../../../../app/types";
import type { OpenTarget } from "../artifacts/open-target";
import { useReactRenderWatchdog } from "../../../shell";

import type { SessionPageProps } from "./session-page-types";

import {
  type PendingAgentContext,
} from "../../agents";
import {
  AGENT_PANEL_DEFAULT_WIDTH,
} from "../sidebar/session-chrome";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "../sidebar/conversation-model";
import type { StorePrimaryTab } from "../components/side-panel-pages";
import { useStatusToasts } from "../../shell-feedback";
import {
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
} from "./expert-conversation-model";
import { useExpertAutomationOffer } from "./use-expert-automation-offer";
import { useExpertSurfaceController } from "./use-expert-surface-controller";
import { useExpertSessionStarters } from "./use-expert-session-starters";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";
import { useExpertSkillNavigation } from "./use-expert-skill-navigation";
import { useSessionExpertCreation } from "./use-session-expert-creation";
import { buildExpertPageFilesOpenSessionMeta } from "./expert-page-artifacts-model";
import { buildExpertPageNavigationModel } from "./expert-page-navigation-model";
import { useExpertArchiveRevision } from "./use-expert-archive-revision";
import { useExpertSessionTabOrder } from "./use-expert-session-tab-order";
import { useExpertDraftCleanup } from "./use-expert-draft-cleanup";
import { useExpertRouteLifecycle } from "./use-expert-route-lifecycle";
import { useExpertPageIdentity } from "./use-expert-page-identity";
import { useExpertPageNavigation } from "./use-expert-page-navigation";
import { useExpertPageViewModel } from "./use-expert-page-view-model";
import { useExpertPageModals } from "./use-expert-page-modals";
import { useExpertConversationTabs } from "./use-expert-conversation-tabs";
import { useExpertPageSessionEffects } from "./use-expert-page-session-effects";
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
  const [draftAgentContexts, setDraftAgentContexts] = useState<Record<string, PendingAgentContext>>({});
  const {
    registry,
    pendingAgent,
    pendingAgentDraftSource,
    rawWorkspaceSessions,
    workspaceSessions,
    sidebarWorkspaceSessionGroups,
    expertDirectoryPage,
    expertDirectoryIdentity,
    expertDirectoryMissingSkills,
    expertDirectoryReady,
    routeSessionLive,
    effectiveSelectedSessionId,
    routeRealSessionId,
    currentConversationAgentId,
    conversationGroups,
    hasAnyExpertConversation,
  } = useExpertPageIdentity(props);
  const expertSurface = useExpertSurfaceController({
    workspaceId: props.selectedWorkspaceId,
    selectedSessionId: effectiveSelectedSessionId,
    selectedSessionAgentId: currentConversationAgentId,
  });
  const {
    state: expertSurfaceState,
    mode: expertSurfaceMode,
    dispatch: dispatchExpertSurface,
    openDraft: openExpertSurfaceDraft,
    clearDraft: clearExpertSurfaceDraft,
    setPendingTabSessionId,
    draftSessionActive,
    draftAgentId,
    pendingTabSessionId,
  } = expertSurface;
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
  const sessionHostState = useSessionPageHostState({
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
  } = sessionHostState;
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
    creatingSessionId: expertSurfaceMode.creatingSessionId,
    // Alias: surface pendingTabSessionId = tab strip highlight after CREATE_BOUND
    tabHighlightSessionId: pendingTabSessionId,
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
    clearSurfaceDraft: clearExpertSurfaceDraft,
  });

  const {
    activateDraftAgent,
    openFreshExpertDraft,
    handleOpenDraftSession,
    resolveSessionTabForAgent,
    handleOpenExpertSession,
    handleOpenExpertFromSidebar,
    handleStartAgentConversation,
    handleStartAgentById,
    openExpertMarket,
  } = useExpertPageNavigation({
    props,
    draftAgentContexts,
    setDraftAgentContexts,
    pendingAgent,
    draftAgentId,
    draftSessionActive,
    activeDraftSessionId,
    surfaceState: expertSurfaceState,
    dispatchSurface: dispatchExpertSurface,
    openSurfaceDraft: openExpertSurfaceDraft,
    clearSurfaceDraft: clearExpertSurfaceDraft,
    openRailView,
    identity: expertDirectoryIdentity,
    conversationGroups,
    sessionTabOrderIdsByScope,
    registry,
    setStoreActiveTab,
  });
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

  const wrappedOnSendDraft = useExpertPageSessionEffects({
    props,
    draftSessionActive,
    draftAgentId,
    pendingAgent,
    directoryPage: expertDirectoryPage,
    clearSurfaceDraft: clearExpertSurfaceDraft,
    codeWorkspaceCatalogRoot,
    rawWorkspaceSessions,
    currentAgentSessions,
    showToast,
  });

  const {
    renameOpen,
    renameTitle,
    setRenameTitle,
    renameBusy,
    canSaveRename,
    deleteOpen,
    deleteBusy,
    openRenameModal,
    openDeleteModal,
    openDeleteGroupModal,
    submitRename,
    confirmDelete,
    closeDeleteModal,
    closeRenameModal,
    openDeleteExpertModal,
    deletableExpertIds,
    expertDeleteTitle,
    expertDeleteMessage,
    expertDeleteConfirmLabel,
  } = useExpertPageModals({
    props,
    client: props.onmyagentServerClient,
    activeConversationAgentId,
    currentAgentSessions,
    registry,
    conversationGroups,
  });

  const {
    activePlaceholderView,
    blockExpertSurfaceForWorkspaceError,
    canRenderReactSurface,
    canvasSessionKey,
    headerPanelControls,
    isDraftSession,
    mountExpertSessionSurface,
    reactSessionBaseUrl,
    reactSessionToken,
    renderedSessionId,
    selectedWorkspaceErrorMessage,
    selectedWorkspaceErrorTitle,
    showBlockingStartupSkeleton,
    showDelayedSessionLoadingState,
    showExpertDirectoryIncomplete,
    showExpertDirectoryLoading,
    showNoExpertConversationEmptyState,
    showSelectedWorkspaceError,
    showWorkspaceSetupEmptyState,
    taskStatus,
  } = useExpertPageViewModel({
    props,
    hostState: sessionHostState,
    expertHistorySessionId,
    expertSurfaceMode,
    routeRealSessionId,
    showDraftChrome,
    directoryPage: expertDirectoryPage,
    effectiveSelectedSessionId,
    hasAnyExpertConversation,
    handleHistorySelectPrompt,
    openExpertSidePanelMenu,
  });

  const conversationTabs = useExpertConversationTabs({
    props,
    activeSidebarView,
    surfaceMode: expertSurfaceMode,
    currentAgentSessions,
    sessionTabOrderIds,
    pendingTabSessionId,
    setPendingTabSessionId,
    expertDirectoryReady,
    activeConversationAgentId,
    handleOpenExpertSession,
    handleOpenDraftSession,
    handleCreateCurrentAgentSession,
    openRenameModal,
    openDeleteModal,
    showToast,
  });

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
