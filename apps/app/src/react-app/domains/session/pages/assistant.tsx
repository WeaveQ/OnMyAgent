/** @jsxImportSource react */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  PanelRight,
  Search,
  X,
  Zap,
} from "lucide-react";

import { t } from "../../../../i18n";
import { formatShortcut } from "../../../../lib/format-shortcut";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft } from "../../../../app/types";
import {
  type OpenTarget,
} from "../artifacts/open-target";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { ProviderAuthModal } from "../../connections";
import { SessionSurface } from "../surface/session-surface";
import { ShareWorkspaceModal } from "../../workspace";
import { OwDotTicker, type SidePanelItem, useReactRenderWatchdog, useUiStateStore } from "../../../shell";
import {
  isElectronRuntime,
} from "../../../../app/utils";
import {
  installBuiltinSkillPackage,
} from "../../../../app/lib/desktop";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { PersonalLocalAgentPage } from "../../local-agents";
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { SessionHistorySearchChrome } from "./session-history-search-chrome";
import { SessionArchivePage } from "../chat/session-page-session-archive-page";
import { createCanvasSessionKey } from "../infinite-canvas";
import {
  LazyCodeWorkspaceSidePanel,
  LazyInfiniteCanvasPanel,
  LazyVoicePanel,
} from "./lazy-session-side-panels";
import { installSummonedMarketplaceExpert } from "../expert-marketplace/install";
import { buildPendingAgentFromMarketplaceExpert } from "../expert-marketplace/pending-agent";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";

import type {
  SessionAgentManagementIntent,
  SessionPageProps,
} from "./session-page-types";

import {
  addAssistantSession,
  usePendingAgentStore,
  writeAssistantSessionCategory,
} from "../../agents";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";

import { AgentManagementPage } from "../../local-agents";
import {
  AutomationPage,
  MessagingChannelsPage,
  syncAutomationSessionRecords,
} from "../../messaging";
import {
  consumeAutomationFocus,
  writeAutomationFocus,
} from "../artifacts/automation-focus-memory";
import { useSessionAutomationOffer } from "../artifacts/use-session-automation-offer";
import { WorkspaceFilesPage } from "../../workspace";
import { permanentlyRemoveAssistantArchivedTask } from "../../shared";
import {
  AgentConversationPanel,
  SidebarPaneCollapseToggle,
  shouldShowSessionStartupSkeleton,
  OnMyAgentRail,
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  workspaceTaskStatus,
  readAssistantSelectionMemory,
  resolveAssistantSelectionMemory,
  writeAssistantSelectionMemory,
  type OnMyAgentPrimaryView,
  type AssistantSelectionMemory,
} from "../sidebar/session-chrome";
import {
  readAssistantCategoryMemory,
  writeAssistantCategoryMemory,
} from "../sidebar/rail-navigation-memory";
import {
  SessionPageMainColumn,
  SessionRailKeepAliveStack,
} from "./session-page-shell";
import { SessionStartupSkeleton } from "./session-startup-skeleton";
import {
  BillingPage,
  DevicesPage,
  ProjectsComingSoonPage,
  SidebarFeaturePlaceholder,
  StorePage,
  type StorePrimaryTab,
} from "../components/side-panel-pages";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CustomConnectorDialog } from "@/react-app/domains/plugins";
import { useStatusToasts } from "../../shell-feedback";

export type AssistantPageProps = SessionPageProps & {
  onNavigateToMode: (mode: "assistant" | "expert") => void;
  agentManagementIntent?: SessionAgentManagementIntent | null;
  onAgentManagementIntentConsumed?: (key: string) => void;
};

import {
  appendComposerFileMention,
  setComposerDraftAfterNewTask,
} from "./shared-page-utils";
import { useCustomConnectorDialog } from "./use-custom-connector-dialog";
import { useMyExpertPackages } from "./use-my-expert-packages";
import { useAgentPanelResize } from "./use-agent-panel-resize";
import { useSessionPageHostState } from "./use-session-page-host-state";
import { useSummonMarketplaceExpert } from "./use-summon-marketplace-expert";
import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";
import { isStreamingSessionStatus } from "../sidebar/utils";

const ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH = 360;
const ASSISTANT_SIDE_PANEL_MIN_WIDTH = 300;
const CREATE_EXPERT_SKILL_NAME = "expert-manager";

type AssistantGroupDeleteTarget = {
  kind: "automation";
  /** Stable automation task id — required to remove the schedule itself. */
  groupId: string;
  title: string;
  sessionIds: string[];
};

export function AssistantPage(props: AssistantPageProps) {
  const { showToast } = useStatusToasts();
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const agentManagementIntent = props.agentManagementIntent;
  const onAgentManagementIntentConsumed =
    props.onAgentManagementIntentConsumed;
  const consumedAgentManagementIntentRef = useRef<string | null>(null);
  const {
    activeSidebarView,
    openRailView,
    visitedRailViews,
    pendingArchiveResume,
    setPendingArchiveResume,
    sidePanelSessionKey,
    browserSessionScopeId,
    sessionSidePanel,
    setSidePanelState,
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
    voiceExtensionEnabled,
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
    handleHistorySelectPrompt,
    openHistorySearch,
    closeHistorySearch,
    commitBrowserPanelWidth,
    openTarget,
    closeRightPane,
    isPrimarySessionView,
  } = useSessionPageHostState({
    mode: "assistant",
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceRoot: props.selectedWorkspaceRoot,
    workspaces: props.workspaces,
    draftWorkspaceDirectory:
      props.surface?.draftWorkspace?.draftWorkspaceDirectory,
    onAccessibleTargetsChange: props.onAccessibleTargetsChange,
    historySearchViews: ["assistant", "chat", "scheduledTasks"],
    sidePanelDefaultWidth: ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH,
    sidePanelMinWidth: ASSISTANT_SIDE_PANEL_MIN_WIDTH,
  });
  const [agentManagementPageIntent, setAgentManagementPageIntent] =
    useState(agentManagementIntent);
  const [assistantCategoryId, setAssistantCategoryId] =
    useState<AssistantCategoryId>(() =>
      readAssistantCategoryMemory(props.selectedWorkspaceId, "office"),
    );
  const setAssistantCategoryAndRemember = useCallback(
    (categoryId: AssistantCategoryId) => {
      setAssistantCategoryId(categoryId);
      writeAssistantCategoryMemory(props.selectedWorkspaceId, categoryId);
    },
    [props.selectedWorkspaceId],
  );
  const [storeActiveTab, setStoreActiveTab] =
    useState<StorePrimaryTab>("experts");
  const myExpertPackages = useMyExpertPackages({
    enabled: activeSidebarView === "store",
  });
  const {
    customConnectorOpen,
    setCustomConnectorOpen,
    customConnectorInitialView,
    openCustomConnector,
  } = useCustomConnectorDialog();
  const handleSummonMarketplaceExpert = useSummonMarketplaceExpert({
    selectedWorkspaceId: props.selectedWorkspaceId,
    onCreateTaskInWorkspace: props.sidebar.onCreateTaskInWorkspace,
    onNavigateToMode: props.onNavigateToMode,
  });
  const [agentSearch] = useState("");
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const { agentPanelWidth, setAgentPanelWidth, startAgentPanelResize } =
    useAgentPanelResize(AGENT_PANEL_DEFAULT_WIDTH);
  const sidePanelVisible = sidePanelOpen && activeSidebarView !== "scheduledTasks";


  const openAssistantSessionView = useCallback(() => {
    openRailView("assistant");
  }, [openRailView]);

  const [focusAutomationId, setFocusAutomationId] = useState<string | null>(null);

  const openScheduledTasksView = useCallback(() => {
    openRailView("scheduledTasks");
  }, [openRailView]);

  useEffect(() => {
    if (activeSidebarView !== "scheduledTasks") return;
    const focus = consumeAutomationFocus(props.selectedWorkspaceId);
    if (!focus) return;
    if (focus.scene !== assistantCategoryId) {
      setAssistantCategoryAndRemember(focus.scene);
    }
    setFocusAutomationId(focus.automationId);
  }, [
    activeSidebarView,
    assistantCategoryId,
    props.selectedWorkspaceId,
    setAssistantCategoryAndRemember,
  ]);

  const assistantWorkspaceSessions = useMemo(
    () =>
      props.sidebar.workspaceSessionGroups.find(
        (item) => item.workspace.id === props.selectedWorkspaceId,
      )?.sessions ?? [],
    [
      props.selectedWorkspaceId,
      props.sidebar.workspaceSessionGroups,
    ],
  );

  const selectedAssistantSessionDirectory =
    assistantWorkspaceSessions.find(
      (session) => session.id === props.selectedSessionId,
    )?.directory ?? null;

  const openCreatedAutomation = useCallback(
    (row: { id: string; scene: "office" | "code" }) => {
      const workspaceId = props.selectedWorkspaceId.trim();
      if (!workspaceId) return;
      writeAutomationFocus({
        workspaceId,
        automationId: row.id,
        scene: row.scene,
      });
      setAssistantCategoryAndRemember(row.scene);
      writeAssistantSelectionMemory(workspaceId, row.scene, {
        kind: "automation",
      });
      openScheduledTasksView();
    },
    [
      openScheduledTasksView,
      props.selectedWorkspaceId,
      setAssistantCategoryAndRemember,
    ],
  );

  const automationOffer = useSessionAutomationOffer({
    client: props.onmyagentServerClient,
    workspaceId:
      props.runtimeWorkspaceId?.trim() || props.selectedWorkspaceId.trim(),
    catalogRoot: codeWorkspaceCatalogRoot,
    sessionRoot: props.selectedWorkspaceRoot,
    selectedSessionId: props.selectedSessionId,
    sessionDirectory: selectedAssistantSessionDirectory,
    selectedModel: props.surface?.model.selectedModel,
    activeQuestion: props.activeQuestion,
    questionReplyBusy: props.questionReplyBusy,
    respondQuestion: props.respondQuestion,
    sessionBusy: isStreamingSessionStatus(
      props.selectedSessionId
        ? props.sidebar.sessionStatusById?.[props.selectedSessionId]
        : undefined,
    ),
    openTargets,
    onViewCreatedAutomation: openCreatedAutomation,
  });

  const openAssistantNewTask = useCallback(
    (categoryId: AssistantCategoryId) => {
      writeAssistantSelectionMemory(
        props.selectedWorkspaceId,
        categoryId,
        { kind: "newTask" },
      );
      // Close any draft-scoped rail before navigating so new-task starts clean.
      setSidePanelState(`assistant-draft:${props.selectedWorkspaceId}`, null);
      setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
      if (isElectronRuntime()) {
        void window.__ONMYAGENT_ELECTRON__?.browser?.hide?.();
      }
      openAssistantSessionView();
      props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
    },
    [
      openAssistantSessionView,
      props.selectedWorkspaceId,
      props.sidebar,
      setSidePanelState,
    ],
  );

  const handleCreateExpert = useCallback(async () => {
    if (isElectronRuntime()) {
      try {
        await installBuiltinSkillPackage({
          source: "builtin",
          packageName: CREATE_EXPERT_SKILL_NAME,
          skillName: CREATE_EXPERT_SKILL_NAME,
        });
      } catch (error) {
        console.warn("[expert-marketplace] failed to install expert-manager", error);
      }
    }
    setAssistantCategoryId("office");
    openAssistantNewTask("office");
    setComposerDraftAfterNewTask(
      props.selectedWorkspaceId,
      t("session.create_expert_prompt"),
    );
  }, [openAssistantNewTask, props.selectedWorkspaceId]);

  const applyAssistantSelection = useCallback(
    (
      categoryId: AssistantCategoryId,
      selection: AssistantSelectionMemory,
      options?: { persistFallback?: boolean },
    ) => {
      const resolved = resolveAssistantSelectionMemory({
        workspaceId: props.selectedWorkspaceId,
        categoryId,
        selection,
        sessions: assistantWorkspaceSessions,
      });
      if (options?.persistFallback && resolved.kind !== selection.kind) {
        writeAssistantSelectionMemory(
          props.selectedWorkspaceId,
          categoryId,
          resolved,
        );
      }
      if (resolved.kind === "automation") {
        openScheduledTasksView();
        return;
      }
      if (resolved.kind === "session") {
        openAssistantSessionView();
        props.sidebar.onOpenSession(props.selectedWorkspaceId, resolved.sessionId);
        return;
      }
      openAssistantNewTask(categoryId);
    },
    [
      assistantWorkspaceSessions,
      openAssistantNewTask,
      openAssistantSessionView,
      openScheduledTasksView,
      props.selectedWorkspaceId,
      props.sidebar,
    ],
  );

  const handleAssistantCategoryChange = useCallback(
    (categoryId: AssistantCategoryId) => {
      setAssistantCategoryId(categoryId);
      applyAssistantSelection(
        categoryId,
        readAssistantSelectionMemory(props.selectedWorkspaceId, categoryId),
        { persistFallback: true },
      );
    },
    [
      applyAssistantSelection,
      props.selectedWorkspaceId,
    ],
  );

  useReactRenderWatchdog("AssistantPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  // Do NOT force openRailView("assistant") when selectedSessionId changes.
  // Session open already navigates to a clean path (no ?view=) so the primary
  // rail wins for user clicks. Forcing primary here steals history Back: POP to
  // /sessionA?view=files would immediately push a clean URL and leave files.

  const wrappedOnSendDraft = useCallback(
    async (draft: ComposerDraft) => {
      if (!props.selectedSessionId) {
        usePendingAgentStore.getState().setAgent(null);
        if (props.onCreateSessionForAgent) {
          props.onCreateSessionForAgent();
        }
      }
      // Always stamp assistant intent so force-new / auto-new-session creates
      // are registered as assistant sessions. Missing intent left sessions
      // unlisted in isAssistantSession → restore jumped to first task.
      return props.surface?.onSendDraft({
        ...draft,
        sessionStartIntent: {
          mode: "assistant",
          assistantCategory: assistantCategoryId,
        },
      });
    },
    [assistantCategoryId, props.selectedSessionId, props.onCreateSessionForAgent, props.surface],
  );

  // Leaving a session for new-task: close draft-scoped side panel and hide
  // the shared browser surface so the previous chat's rail does not carry over.
  const previousSelectedSessionIdRef = useRef(props.selectedSessionId);
  useEffect(() => {
    const previous = previousSelectedSessionIdRef.current;
    previousSelectedSessionIdRef.current = props.selectedSessionId;
    if (!previous || props.selectedSessionId) return;
    const draftKey = `assistant-draft:${props.selectedWorkspaceId}`;
    setSidePanelState(draftKey, null);
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
    if (isElectronRuntime()) {
      void window.__ONMYAGENT_ELECTRON__?.browser?.hide?.();
    }
  }, [props.selectedSessionId, props.selectedWorkspaceId, setSidePanelState]);

  const openAssistantSidePanelMenu = openWorkspaceSidePanelMenu;
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] =
    useState(false);

  const executeAssistantDelete = useCallback(
    async (
      target:
        | { kind: "session"; sessionId: string }
        | AssistantGroupDeleteTarget,
    ) => {
      if (!props.onDeleteSession) return;
      if (target.kind === "session") {
        permanentlyRemoveAssistantArchivedTask(
          props.selectedWorkspaceId,
          target.sessionId,
        );
        await props.onDeleteSession(target.sessionId);
        return;
      }
      // 1) Delete every run session under the group (history rows).
      // Ghost sessions (already missing in OpenCode) must not abort the loop —
      // otherwise the schedule definition is never deleted and "定时" returns.
      for (const sessionId of target.sessionIds) {
        permanentlyRemoveAssistantArchivedTask(
          props.selectedWorkspaceId,
          sessionId,
        );
        try {
          await props.onDeleteSession(sessionId);
        } catch (error) {
          console.warn(
            "[assistant] failed to delete automation run session; continuing",
            sessionId,
            error,
          );
        }
      }
      // 2) Delete the automation definition itself. Without this, the schedule
      // keeps firing and the "定时" group reappears — feels like "删不掉".
      const automationId = target.groupId.trim();
      const client = props.onmyagentServerClient;
      const workspaceId = props.selectedWorkspaceId.trim();
      if (!client || !workspaceId || !automationId) return;
      try {
        const result = await client.deleteAutomation(workspaceId, automationId);
        syncAutomationSessionRecords(workspaceId, result.items ?? []);
      } catch (error) {
        console.warn(
          "[assistant] failed to delete automation definition",
          automationId,
          error,
        );
        showToast({
          tone: "error",
          title: t("session.delete_task"),
          description:
            error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [
      props.onDeleteSession,
      props.onmyagentServerClient,
      props.selectedWorkspaceId,
      showToast,
    ],
  );

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
  } = useSessionTaskRenameDelete<AssistantGroupDeleteTarget>({
    selectedSessionId: props.selectedSessionId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onRenameSession: props.onRenameSession,
    onDeleteSession: props.onDeleteSession,
    executeDelete: executeAssistantDelete,
    requireGroupSessionIds: true,
  });

  const openDeleteAutomationGroupModal = useCallback(
    (target: { groupId: string; title: string; sessionIds: string[] }) => {
      openDeleteGroupModal({
        kind: "automation",
        groupId: target.groupId.trim(),
        title: target.title.trim(),
        sessionIds: target.sessionIds,
      });
    },
    [openDeleteGroupModal],
  );

  const assistantDeleteTitle = t("session.delete_task_title");
  const assistantDeleteMessage =
    deleteTarget?.kind === "automation"
      ? deleteTarget.title
        ? t("session.delete_named_task_message", {
            title: deleteTarget.title,
          })
        : t("session.delete_task_generic")
      : sessionActionTitle.trim()
        ? t("session.delete_named_task_message", {
            title: sessionActionTitle.trim(),
          })
        : t("session.delete_task_generic");
  const assistantDeleteConfirmLabel = deleteBusy
    ? t("session.deleting")
    : t("session.delete_task");

  const showWorkspaceSetupEmptyState =
    props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton = shouldShowSessionStartupSkeleton({
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    coldBootShell: props.coldBootShell === true,
  });
  // Same as expert: draft home/new-session must not be masked by prior session loading.
  const showSessionLoadingState =
    Boolean(props.selectedSessionId) &&
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
  const selectedWorkspaceErrorTitle =
    props.selectedWorkspaceDisplay.workspaceType === "remote"
      ? "Remote workspace unavailable"
      : "Agent runtime unavailable";

  const reactSessionBaseUrl = props.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    props.onmyagentServerToken?.trim() ||
    props.onmyagentServerClient?.token?.trim() ||
    "";
  const draftSessionId = `draft:${props.selectedWorkspaceId}`;
  const isDraftSession = !props.selectedSessionId;
  const renderedSessionId = props.selectedSessionId ?? draftSessionId;
  const canvasSessionKey = createCanvasSessionKey({
    workspaceId: props.selectedWorkspaceId,
    sessionId: renderedSessionId,
    surface: assistantCategoryId === "code" ? "assistant-code" : "assistant-office",
  });
  const canRenderReactSurface = Boolean(
    props.runtimeWorkspaceId &&
    props.onmyagentServerClient &&
    reactSessionBaseUrl &&
    reactSessionToken &&
    props.surface,
  );
  const showBlockingStartupSkeleton =
    showStartupSkeleton && !canRenderReactSurface;
  const activePlaceholderView =
    activeSidebarView === "chat" ||
    activeSidebarView === "assistant" ||
    activeSidebarView === "files" ||
    activeSidebarView === "store" ||
    activeSidebarView === "projects" ||
    activeSidebarView === "localAgent" ||
    activeSidebarView === "agentManagement" ||
    activeSidebarView === "skills" ||
    activeSidebarView === "connectors"
      ? null
      : activeSidebarView;
  const railActiveView =
    activeSidebarView === "scheduledTasks" ? "assistant" : activeSidebarView;
  // Workspace side panel only belongs on chat surfaces (not 市场/管理/本地/文件…).
  const sidePanelVisibleOnSession =
    sidePanelVisible && isPrimarySessionView;

  useEffect(() => {
    const intent = agentManagementIntent;
    if (!intent || consumedAgentManagementIntentRef.current === intent.key) {
      return;
    }
    consumedAgentManagementIntentRef.current = intent.key;
    if (intent.action === "createProvider") {
      setAgentManagementPageIntent(intent);
      openRailView("agentManagement");
      onAgentManagementIntentConsumed?.(intent.key);
    }
  }, [agentManagementIntent, onAgentManagementIntentConsumed, openRailView]);

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
        sessionId={props.selectedSessionId}
          onSelectPrompt={handleHistorySelectPrompt}
        />
      }
      sidePanelOpen={sidePanelOpen}
      onToggleSidePanel={(event) => {
        event.stopPropagation();
        openAssistantSidePanelMenu();
      }}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 mac:pointer-events-auto mac:titlebar-drag" />
      {/*
        Keep primary rail outside bg-dls-background so mac vibrancy can show
        through the strip (WeChat). Background wash only covers list + content.
      */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <OnMyAgentRail
          activeView={railActiveView}
          account={props.account}
          onOpenView={(view) => {
            if (view === "chat") {
              props.onNavigateToMode("expert");
              return;
            }
            // Rail changes push history via ?view= (bookmark still written for cold start).
            if (view === "assistant") {
              setAgentPanelCollapsed(false);
              openAssistantSessionView();
              return;
            }
            openRailView(view);
          }}
          onOpenAccountSettings={props.onOpenAccountSettings}
          onSignOut={props.onSignOut}
          onOpenDevices={() => {
            openRailView("devices");
          }}
          onOpenBilling={() => {
            openRailView("billing");
          }}
        />
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background">
            {(activeSidebarView === "chat" ||
              activeSidebarView === "assistant" ||
              activeSidebarView === "scheduledTasks") &&
            !agentPanelCollapsed ? (
              <AgentConversationPanel
                mode="assistant"
                width={agentPanelWidth}
                client={props.onmyagentServerClient}
                taskStatusVariant={taskStatus.variant}
                collapsed={agentPanelCollapsed}
                groups={props.sidebar.workspaceSessionGroups}
                selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
                selectedSessionId={props.sidebar.selectedSessionId}
                sessionStatusById={props.sidebar.sessionStatusById}
                query={agentSearch}
                onQueryChange={() => {}}
                onToggleCollapsed={() =>
                  setAgentPanelCollapsed((value) => !value)
                }
                onOpenAgents={() => {}}
                onCreateTask={() => {
                  openAssistantNewTask(assistantCategoryId);
                }}
                assistantCategoryId={assistantCategoryId}
                onAssistantCategoryChange={handleAssistantCategoryChange}
                automationActive={activeSidebarView === "scheduledTasks"}
                onOpenAssistant={openAssistantSessionView}
                onOpenAutomation={() => {
                  writeAssistantSelectionMemory(
                    props.selectedWorkspaceId,
                    assistantCategoryId,
                    { kind: "automation" },
                  );
                  openScheduledTasksView();
                }}
                onOpenSession={(workspaceId, sessionId) => {
                  // Heal registry so restore / page-mode checks never drop this session.
                  addAssistantSession(sessionId);
                  writeAssistantSessionCategory(sessionId, assistantCategoryId);
                  writeAssistantSelectionMemory(
                    workspaceId,
                    assistantCategoryId,
                    { kind: "session", sessionId },
                  );
                  openAssistantSessionView();
                  props.sidebar.onOpenSession(workspaceId, sessionId);
                }}
                onPrefetchSession={props.sidebar.onPrefetchSession}
                onRenameSession={openRenameModal}
                onDeleteSession={openDeleteModal}
                onDeleteAutomationGroup={openDeleteAutomationGroupModal}
              />
            ) : null}
            {(activeSidebarView === "chat" ||
              activeSidebarView === "assistant" ||
              activeSidebarView === "scheduledTasks") ? (
              <SidebarPaneCollapseToggle
                collapsed={agentPanelCollapsed}
                onToggle={() => setAgentPanelCollapsed((value) => !value)}
                style={{
                  left: agentPanelCollapsed ? 0 : agentPanelWidth,
                }}
              />
            ) : null}
            {(activeSidebarView === "chat" ||
              activeSidebarView === "assistant" ||
              activeSidebarView === "scheduledTasks") &&
            !agentPanelCollapsed ? (
              <div
                role="separator"
                aria-label={t("session.resize_agent_list")}
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={startAgentPanelResize}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setAgentPanelWidth((width) =>
                      Math.min(
                        AGENT_PANEL_MAX_WIDTH,
                        Math.max(
                          AGENT_PANEL_MIN_WIDTH,
                          width + (event.key === "ArrowLeft" ? -16 : 16),
                        ),
                      ),
                    );
                  }
                }}
                className="group relative z-10 cursor-col-resize touch-none outline-none"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-focus-visible:bg-dls-accent" />
              </div>
            ) : null}
            <ResizablePanelGroup
              orientation="horizontal"
              onLayoutChanged={
                sidePanelVisibleOnSession ? commitBrowserPanelWidth : undefined
              }
              className="min-h-0 flex-1"
            >
              <ResizablePanel minSize="360px" className="min-w-0">
                <SessionPageMainColumn
                  activeSidebarView={activeSidebarView}
                  sidePanelBorderOpen={sidePanelVisibleOnSession}
                >
                  <SessionRailKeepAliveStack
                    activeSidebarView={activeSidebarView}
                    visitedRailViews={visitedRailViews}
                    isPrimarySessionView={isPrimarySessionView}
                    primarySessionActive={
                      isPrimarySessionView && !showDelayedSessionLoadingState
                    }
                    panes={{
                      store: (
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          activeTab={storeActiveTab}
                          myExperts={myExpertPackages}
                          onActiveTabChange={setStoreActiveTab}
                          onSummonMarketplaceExpert={handleSummonMarketplaceExpert}
                          onCreateExpert={handleCreateExpert}
                          onOpenCustomConnector={() => openCustomConnector("list")}
                        />
                      ),
                      localAgent: (
                        <PersonalLocalAgentPage
                          resumeRequest={pendingArchiveResume}
                          onResumeConsumed={() => setPendingArchiveResume(null)}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          workspaceName={props.selectedWorkspaceDisplay.name}
                          onmyagentServerClient={props.onmyagentServerClient}
                          runtimeWorkspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                          onOpenArtifact={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                          onOpenAgentManagement={(panel) => {
                            setAgentManagementPageIntent({
                              key: `open-panel-${Date.now()}`,
                              action: "openPanel",
                              panel: panel ?? "skills",
                            });
                            openRailView("agentManagement");
                          }}
                        />
                      ),
                      agentManagement: (
                        <AgentManagementPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          intent={agentManagementPageIntent}
                          sessionArchiveSlot={(
                            <SessionArchivePage
                              client={props.onmyagentServerClient}
                              workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                              onResume={(request) => {
                                setPendingArchiveResume(request);
                                openRailView("localAgent");
                              }}
                            />
                          )}
                        />
                      ),
                      files: (
                        <WorkspaceFilesPage
                          client={props.onmyagentServerClient}
                          workspaceId={
                            props.runtimeWorkspaceId ??
                            props.selectedWorkspaceId
                          }
                          workspaceRoot={
                            props.workspaceFilesRoot?.trim() ||
                            props.selectedWorkspaceRoot
                          }
                          // Always OnMyAgent registry workspace path — not sessionWorkspaceRoot.
                          fileRoot={
                            props.workspaceFilesRoot?.trim() ||
                            props.selectedWorkspaceRoot
                          }
                          onOpenArtifact={openTarget}
                          onAddToTask={(relativePath) => {
                            if (!appendComposerFileMention(renderedSessionId, relativePath)) {
                              return;
                            }
                            openRailView("assistant");
                            showToast({
                              tone: "success",
                              title: t("files.added_to_task_title"),
                              description: t("files.added_to_task"),
                              dismissLabel: t("common.dismiss"),
                            });
                          }}
                          onEditError={() => showToast({
                            tone: "error",
                            title: t("files.edit_file_failed"),
                            dismissLabel: t("common.dismiss"),
                            durationMs: 0,
                          })}
                        />
                      ),
                      projects: <ProjectsComingSoonPage />,
                      devices: <DevicesPage />,
                      channels: (
                        <MessagingChannelsPage workspaceRoot={props.selectedWorkspaceRoot} />
                      ),
                      billing: <BillingPage />,
                    }}
                    middle={
                      <>
                      {activeSidebarView === "scheduledTasks" ? (
                        <AutomationPage
                          scene={assistantCategoryId}
                          client={props.onmyagentServerClient}
                          workspaceId={props.selectedWorkspaceId}
                          focusAutomationId={focusAutomationId}
                          onFocusAutomationConsumed={() => setFocusAutomationId(null)}
                          // Same OpenCode command.list + skill sources as session + menu.
                          listOpenCodeCommands={props.surface?.listCommands}
                          listSkills={
                            props.onmyagentServerClient && props.selectedWorkspaceId
                              ? () =>
                                  props
                                    .onmyagentServerClient!.listSkills(
                                      props.selectedWorkspaceId,
                                      { includeGlobal: true },
                                    )
                                    .then((result) => result.items)
                              : undefined
                          }
                          listMcp={
                            props.onmyagentServerClient && props.selectedWorkspaceId
                              ? () =>
                                  props
                                    .onmyagentServerClient!.listMcp(
                                      props.selectedWorkspaceId,
                                    )
                                    .then((result) => ({
                                      servers: result.items.map((item) => ({
                                        name: item.name,
                                        id: item.name,
                                      })),
                                    }))
                              : undefined
                          }
                          onOpenSession={(workspaceId, sessionId) => {
                            writeAssistantSelectionMemory(
                              workspaceId,
                              assistantCategoryId,
                              { kind: "session", sessionId },
                            );
                            openAssistantSessionView();
                            props.sidebar.onOpenSession(workspaceId, sessionId);
                          }}
                        />
                      ) : null}

                      {activePlaceholderView &&
                      activeSidebarView !== "files" &&
                      activeSidebarView !== "store" &&
                      activeSidebarView !== "projects" &&
                      activeSidebarView !== "localAgent" &&
                      activeSidebarView !== "agentManagement" &&
                      activeSidebarView !== "devices" &&
                      activeSidebarView !== "channels" &&
                      activeSidebarView !== "scheduledTasks" &&
                      activeSidebarView !== "billing" ? (
                        <SidebarFeaturePlaceholder
                          view={activePlaceholderView}
                        />
                      ) : null}

                      {isPrimarySessionView && showBlockingStartupSkeleton ? (
                        <SessionStartupSkeleton />
                      ) : null}

                      {isPrimarySessionView &&
                      showDelayedSessionLoadingState ? (
                        <div className="px-6 py-16">
                          <div
                            className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                            role="status"
                            aria-live="polite"
                          >
                            <OwDotTicker size="md" />
                            <div className="text-xs leading-5 text-dls-secondary">
                              {t("session.loading_detail")}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      </>
                    }
                    primarySession={
                      canRenderReactSurface ? (
                          <SessionSurface
                            key={renderedSessionId}
                            {...props.surface!}
                            onSendDraft={wrappedOnSendDraft}
                            client={props.onmyagentServerClient!}
                            workspaceId={props.runtimeWorkspaceId!}
                            sessionId={renderedSessionId}
                            draftOnly={isDraftSession}
                            surfaceVisible={
                              isPrimarySessionView && !showDelayedSessionLoadingState
                            }
                            opencodeBaseUrl={reactSessionBaseUrl}
                            onmyagentToken={reactSessionToken}
                            todos={props.todos}
                            permission={{
                              ...props.surface!.permission,
                              activePermission: props.activePermission,
                              permissionReplyBusy: props.permissionReplyBusy,
                              respondPermission: props.respondPermission,
                              autoApprovedPermissionNoticeId:
                                props.autoApprovedPermissionNoticeId,
                              activeQuestion: automationOffer.activeQuestion,
                              questionReplyBusy:
                                automationOffer.questionReplyBusy,
                              respondQuestion: automationOffer.respondQuestion,
                            }}
                            extraComposerAccessory={
                              automationOffer.resultAccessory
                            }
                            safeStringify={props.safeStringify}
                            userIdentity={{
                              name:
                                localAuthUser?.username ||
                                props.account?.name ||
                                props.account?.email ||
                                t("session.current_user"),
                            }}
                            headerActions={headerPanelControls}
                            conversationTabs={null}
                            searchQuery={historySearchOpen ? historySearchQuery : ""}
                            searchActiveMatchIndex={historyActiveMatch}
                            onSearchMatchCountChange={setHistoryMatchCount}
                            onOpenTarget={openTarget}
                            onOpenTargetsChange={handleOpenTargetsChange}
                            personalAssistantHome={true}
                            personalAssistantCategoryId={assistantCategoryId}
                            onPersonalAssistantCategoryChange={setAssistantCategoryAndRemember}
                            onPersonalAssistantCategoryActive={setAssistantCategoryAndRemember}
                            marketplace={{
                              ...props.surface!.marketplace,
                              onOpenSkillsMarketplace: () => {
                                setStoreActiveTab("skills");
                                openRailView("store");
                              },
                              onOpenConnectorsMarketplace: () => {
                                setStoreActiveTab("plugins");
                                openRailView("store");
                              },
                              onOpenCustomConnector: () => openCustomConnector("config"),
                            }}
                          />
                      ) : null
                    }
                    afterPrimary={
                      isPrimarySessionView &&
                      !showDelayedSessionLoadingState &&
                      !canRenderReactSurface &&
                      !showStartupSkeleton ? (
                        <div
                          className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}
                        >
                          {props.notFoundMessage ? (
                            <div className="px-6 py-16 text-center">
                              <div className="mx-auto max-w-md rounded-xl border border-dls-border bg-dls-card px-5 py-6">
                                <h3 className="text-base font-medium text-dls-text">
                                  Workspace or session not found
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-dls-secondary">
                                  {props.notFoundMessage}
                                </p>
                              </div>
                            </div>
                          ) : showWorkspaceSetupEmptyState ? (
                            <div className="space-y-6 px-6 text-center">
                              <IconTile size="2xl" shape="xl" border className="mx-auto rounded-xl">
                                <Zap className="text-dls-secondary" />
                              </IconTile>
                              <div className="space-y-2">
                                <h3 className="text-xl font-medium">
                                  {t("session.create_or_connect_workspace")}
                                </h3>
                                <p className="mx-auto max-w-sm text-sm text-dls-secondary">
                                  {t("workspace.empty_state_body")}
                                </p>
                              </div>
                              <div className="flex justify-center">
                                <Button
                                  onClick={props.sidebar.onOpenCreateWorkspace}
                                >
                                  {t("workspace.create_workspace")}
                                </Button>
                              </div>
                            </div>
                          ) : showSelectedWorkspaceError ? (
                            <div className="px-6 py-16">
                              <NoticeBox className="mx-auto max-w-lg text-left" size="comfortable" tone="error">
                                <div className="font-medium">
                                  {selectedWorkspaceErrorTitle}
                                </div>
                                <p className="mt-2 whitespace-pre-wrap wrap-anywhere leading-6">
                                  {selectedWorkspaceErrorMessage}
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      props.sidebar.onCreateTaskInWorkspace(
                                        props.selectedWorkspaceId,
                                      )
                                    }
                                  >
                                    Retry
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void Promise.resolve(
                                        props.sidebar.onTestWorkspaceConnection(
                                          props.selectedWorkspaceId,
                                        ),
                                      )
                                    }
                                  >
                                    {t("workspace_list.test_connection")}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      props.sidebar.onEditWorkspaceConnection(
                                        props.selectedWorkspaceId,
                                      )
                                    }
                                  >
                                    {t("workspace_list.edit_connection")}
                                  </Button>
                                  {props.sidebar.workspaceConnectionStateById[
                                    props.selectedWorkspaceId
                                  ]?.status === "error" ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        void Promise.resolve(
                                          props.sidebar.onRecoverWorkspace(
                                            props.selectedWorkspaceId,
                                          ),
                                        )
                                      }
                                    >
                                      {t("workspace_list.recover")}
                                    </Button>
                                  ) : null}
                                </div>
                              </NoticeBox>
                            </div>
                          ) : props.selectedSessionId ? (
                            <div className="px-6 py-16 text-center text-sm text-dls-secondary">
                              {t("session.loading_detail")}
                            </div>
                          ) : null}
                        </div>
                      ) : null
                    }
                  />
                </SessionPageMainColumn>

              </ResizablePanel>
              {sidePanelVisibleOnSession ? (
                <>
                  {/* Single 1px rule — base handle also paints bg-border; avoid before: double line. */}
                  <ResizableHandle className="hidden lg:flex" />
                  <ResizablePanel
                    key={assistantCategoryId === "code" ? "code-side-panel" : "office-side-panel"}
                    panelRef={browserPanelRef}
                    defaultSize={`${ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH}px`}
                    minSize={
                      `${ASSISTANT_SIDE_PANEL_MIN_WIDTH}px`
                    }
                    maxSize="70%"
                    className="min-h-0 overflow-hidden bg-dls-surface lg:flex lg:flex-col"
                  >
                    {activeSidePanel === "canvas" ? (
                      <LazyInfiniteCanvasPanel
                        canvasKey={canvasSessionKey}
                        onClose={closeRightPane}
                      />
                    ) : activeSidePanel === "extensions" && props.settingsSlot ? (
                      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-dls-background">
                        {props.settingsSlot}
                      </div>
                    ) : activeSidePanel === "voice" ? (
                      <LazyVoicePanel
                        client={props.onmyagentServerClient}
                        sessionId={props.selectedSessionId}
                        onClose={closeRightPane}
                      />
                    ) : (
                      <LazyCodeWorkspaceSidePanel
                        workspacePath={codeWorkspacePath}
                        workspaceCatalogRoot={codeWorkspaceCatalogRoot}
                        fileRoot={props.selectedSessionFileRoot ?? null}
                        fileTargets={artifactFileTargets}
                        focusPath={artifactTarget?.value ?? null}
                        focusToken={artifactFocusToken}
                        workspaceId={
                          props.runtimeWorkspaceId ??
                          props.selectedWorkspaceId ??
                          null
                        }
                        sessionId={browserSessionScopeId ?? null}
                        automationSourceSessionId={props.selectedSessionId ?? null}
                        client={props.onmyagentServerClient}
                        initialKind={
                          activeSidePanel === "review"
                            ? "review"
                            : activeSidePanel === "terminal"
                              ? "terminal"
                              : activeSidePanel === "browser"
                                ? "browser"
                                : activeSidePanel === "artifacts"
                                  ? "files"
                                  : null
                        }
                        onClose={closeRightPane}
                        onViewAutomation={openCreatedAutomation}
                        hiddenKinds={
                          assistantCategoryId === "office"
                            ? ["review"]
                            : undefined
                        }
                      />
                    )}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          </div>
        </div>

      {props.providerAuthModal ? (
        <ProviderAuthModal {...props.providerAuthModal} />
      ) : null}

      <SessionTaskRenameDeleteModals
        canRename={Boolean(props.onRenameSession)}
        renameOpen={renameOpen}
        renameTitle={renameTitle}
        renameBusy={renameBusy}
        canSaveRename={canSaveRename}
        onRenameClose={closeRenameModal}
        onRenameSave={() => void submitRename()}
        onRenameTitleChange={setRenameTitle}
        showDelete={Boolean(props.onDeleteSession)}
        deleteOpen={deleteOpen}
        deleteBusy={deleteBusy}
        deleteTitle={assistantDeleteTitle}
        deleteMessage={assistantDeleteMessage}
        deleteConfirmLabel={assistantDeleteConfirmLabel}
        onDeleteConfirm={() => void confirmDelete()}
        onDeleteCancel={closeDeleteModal}
      />

      {props.shareWorkspaceModal ? (
        <ShareWorkspaceModal {...props.shareWorkspaceModal} />
      ) : null}

      <CustomConnectorDialog
        open={customConnectorOpen}
        onOpenChange={setCustomConnectorOpen}
        workspaceRoot={props.selectedWorkspaceRoot}
        initialView={customConnectorInitialView}
        onSaved={() => {
          showToast({
            title: t("plugins.custom_connector_saved"),
            tone: "success",
          });
        }}
      />
    </div>
  );
}
