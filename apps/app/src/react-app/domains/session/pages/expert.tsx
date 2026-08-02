/** @jsxImportSource react */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  PanelRight,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-react";

import { t } from "../../../../i18n";
import { formatShortcut } from "../../../../lib/format-shortcut";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft, SidebarSessionItem } from "../../../../app/types";
import {
  type OpenTarget,
} from "../artifacts/open-target";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProviderAuthModal } from "../../connections";
import {
  SessionSurface,
} from "../surface/session-surface";
import { useComposerStateStore } from "../surface/composer-state-store";
import { COMPOSER_TEMPLATE_EVENTS } from "../surface/composer/capability-template";
import { ShareWorkspaceModal } from "../../workspace";
import { OwDotTicker, type SidePanelItem, useReactRenderWatchdog, useUiStateStore } from "../../../shell";
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
import {
  SessionPageMainColumn,
  SessionRailKeepAliveStack,
} from "./session-page-shell";

import type { SessionPageProps } from "./session-page-types";

import type { AgentCardItem } from "../../agents";
import {
  buildAgentToolAccess,
  buildAgentSystemPrompt,
  type PendingAgentContext,
  usePendingAgentStore,
} from "../../agents";
import {
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  useAgentRegistryStore, useExpertCreationController,
} from "../../agents";
import { isExpertSession } from "../../agents";
import {
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
} from "../../agents";
import type { AgentRegistry } from "../../agents";
import { AgentManagementPage } from "../../local-agents";
import { MessagingChannelsPage } from "../../messaging";
import { WorkspaceFilesPage } from "../../workspace";
import {
  AgentConversationPanel,
  AgentSessionTabs,
  mergeStableSessionTabOrder,
  readExpertSessionSelection,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
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
import { EmptyArtifactsPanel } from "../surface/chrome/empty-artifacts-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CustomConnectorDialog } from "@/react-app/domains/plugins";
import { useStatusToasts } from "../../shell-feedback";

import {
  appendComposerFileMention,
  setComposerDraftAfterNewTask,
  setExpertComposerDraftAfterNewTask,
} from "./shared-page-utils";
import {
  expertFeatureCategoryForAgent,
} from "./expert-page-utils";
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
  listVisibleExpertAgentSessions,
  resolveActiveAgentContext,
  resolveActiveConversationGroup,
  selectRawWorkspaceSessions,
} from "./expert-conversation-model";
import { useExpertAutomationOffer } from "./use-expert-automation-offer";
import {
  resolveBoundExpertDraftSession,
  resolveReadyBoundExpertDraftSession,
  shouldKeepUnboundNewSessionDraft,
} from "./expert-draft-session";
import { resolveColdOpenExpertSessionId } from "./order-conversation-groups";
import { useExpertSessionStarters } from "./use-expert-session-starters";
import { useExpertWaybillPatch } from "./use-expert-waybill-patch";

import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";
import { useExpertSkillNavigation } from "./use-expert-skill-navigation";

const NO_EXPERT_CONVERSATIONS_ASSET = "/empty-states/no-expert-conversations.png";
const EXPERT_SIDE_PANEL_DEFAULT_WIDTH = 360;
const EXPERT_SIDE_PANEL_MIN_WIDTH = 300;

type ExpertGroupDeleteTarget = {
  kind: "expert";
  agentId: string;
  name: string;
  sessionIds: string[];
};

export type ExpertPageProps = SessionPageProps & {
  onNavigateToMode: (mode: "assistant" | "expert") => void;
};

export function ExpertPage(props: ExpertPageProps) {
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
  const [draftSessionActive, setDraftSessionActive] = useState(false);
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);
  const [pendingTabSessionId, setPendingTabSessionId] = useState<string | null>(
    null,
  );
  const [sessionTabOrderIdsByScope, setSessionTabOrderIdsByScope] = useState<
    Record<string, string[]>
  >({});
  const [draftAgentContexts, setDraftAgentContexts] = useState<
    Record<string, PendingAgentContext>
  >({});
  const newSessionDraftCleanupRef = useRef({
    active: false,
    workspaceId: props.selectedWorkspaceId,
    sessionId: `draft:${props.selectedWorkspaceId}`,
  });
  const registry = useAgentRegistryStore((state) => state.registry);
  const pendingAgent = usePendingAgentStore((state) => state.agent);
  const pendingAgentDraftSource = pendingAgent?.draftSource;
  const currentConversationAgentId = props.selectedSessionId
    ? readCustomAgentIdForSession(props.selectedSessionId)
    : null;


  const activeConversationAgentId = draftSessionActive
    ? draftAgentId
    : currentConversationAgentId;
  const activeDraftSessionId =
    draftSessionActive && draftAgentId
      ? `draft:${props.selectedWorkspaceId}:${draftAgentId}`
      : null;
  const rawWorkspaceSessions = useMemo(
    () =>
      selectRawWorkspaceSessions(
        props.sidebar.workspaceSessionGroups,
        props.sidebar.selectedWorkspaceId,
      ),
    [props.sidebar.selectedWorkspaceId, props.sidebar.workspaceSessionGroups],
  );
  const visibleAgentSessions = useMemo(
    () => listVisibleExpertAgentSessions(),
    [props.selectedSessionId, props.sidebar.workspaceSessionGroups],
  );
  const workspaceSessions = useMemo(
    () =>
      buildExpertWorkspaceSessions({
        rawWorkspaceSessions,
        selectedSessionId: props.selectedSessionId,
        currentConversationAgentId,
        visibleAgentSessions,
      }),
    [
      currentConversationAgentId,
      props.selectedSessionId,
      rawWorkspaceSessions,
      visibleAgentSessions,
    ],
  );
  const sidebarWorkspaceSessionGroups = useMemo(
    () =>
      buildExpertSidebarSessionGroups({
        groups: props.sidebar.workspaceSessionGroups,
        selectedWorkspaceId: props.sidebar.selectedWorkspaceId,
        selectedSessionId: props.selectedSessionId,
        currentConversationAgentId,
        visibleAgentSessions,
      }),
    [
      currentConversationAgentId,
      props.selectedSessionId,
      props.sidebar.selectedWorkspaceId,
      props.sidebar.workspaceSessionGroups,
      visibleAgentSessions,
    ],
  );
  const conversationGroups = useMemo(
    () => buildAgentConversationGroups(workspaceSessions, registry),
    [registry, workspaceSessions],
  );
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
  const currentAgentSessions = useMemo(
    () =>
      buildCurrentAgentSessions({
        workspaceSessions,
        activeConversationAgentId,
        selectedSessionId: props.selectedSessionId,
        selectedWorkspaceId: props.selectedWorkspaceId,
        draftSessionActive,
        activeDraftSessionId,
      }),
    [
      activeConversationAgentId,
      activeDraftSessionId,
      draftSessionActive,
      props.selectedSessionId,
      props.selectedWorkspaceId,
      workspaceSessions,
    ],
  );
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

  const expertHistorySessionId = draftSessionActive
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
    enabled: activeSidebarView === "store" && storeActiveTab === "experts",
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

  // Do NOT force openRailView("chat") when selectedSessionId changes.
  // Opening a session navigates to a clean path (no ?view=). Forcing chat here
  // steals history Back when POP lands on a secondary rail URL (?view=files etc).

  useEffect(() => {
    if (activeSidebarView !== "chat") return;
    // Never steal focus while a marketplace/agent draft is being summoned —
    // otherwise the first expert session flashes then disappears.
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

    // Lock: never steal focus while an expert session is already selected.
    // List recency thrash / brief agent-binding gaps must not jump to
    // conversationGroups[0].latestSession (that was reordering tabs too).
    const selectedId = props.selectedSessionId?.trim() ?? "";
    if (selectedId && isExpertSession(selectedId)) return;

    // Cold open: stable left-rail order + remembered tab (not recency group[0]).
    const resolved = resolveColdOpenExpertSessionId({
      workspaceId,
      conversationGroups,
      sessionTabOrderIdsByScope,
    });
    if (resolved) {
      props.sidebar.onOpenSession(workspaceId, resolved);
      return;
    }

    // No summoned experts: leave non-expert sessions so empty state can show.
    if (selectedId && !isExpertSession(selectedId)) {
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
    sessionTabOrderIdsByScope,
  ]);

  useEffect(() => {
    if (props.selectedSessionId) return;
    if (!pendingAgent?.conversationStartId || pendingAgent.boundSessionId) return;
    if (pendingAgent.draftSource !== "agent-selection") return;
    if (draftSessionActive && draftAgentId === pendingAgent.id) return;
    setDraftAgentContexts((current) => ({
      ...current,
      [pendingAgent.id]: pendingAgent,
    }));
    setDraftAgentId(pendingAgent.id);
    setDraftSessionActive(true);
  }, [
    draftAgentId,
    draftSessionActive,
    pendingAgent?.boundSessionId,
    pendingAgent?.conversationStartId,
    pendingAgent?.draftSource,
    pendingAgent?.id,
    props.selectedSessionId,
  ]);

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

  const activateDraftAgent = useCallback(
    (agent: PendingAgentContext) => {
      setDraftAgentContexts((current) => ({ ...current, [agent.id]: agent }));
      usePendingAgentStore.getState().setAgent(agent);
      setDraftAgentId(agent.id);
      setDraftSessionActive(true);
      openRailView("chat");
    },
    [],
  );
  const handleOpenDraftSession = useCallback(
    (sessionId: string) => {
      const agentId = sessionId.split(":").slice(2).join(":");
      const agent = agentId ? draftAgentContexts[agentId] : null;
      if (!agent) return;
      activateDraftAgent(agent);
    },
    [activateDraftAgent, draftAgentContexts],
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
  const handleOpenExpertSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      setDraftSessionActive(false);
      setDraftAgentId(null);
      openRailView("chat");
      const trimmed = sessionId.trim();
      if (trimmed && !trimmed.startsWith("draft:") && isExpertSession(trimmed)) {
        const agentId = readCustomAgentIdForSession(trimmed);
        if (agentId) {
          writeExpertSessionSelection(workspaceId, agentId, trimmed);
        }
      }
      props.sidebar.onOpenSession(workspaceId, sessionId);
    },
    [props.sidebar],
  );

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
      // Already on this expert — keep the active tab (do not jump to latest).
      if (
        activeConversationAgentId === agentId &&
        props.selectedSessionId &&
        isExpertSession(props.selectedSessionId)
      ) {
        openRailView("chat");
        return;
      }
      const group = conversationGroups.find((item) => item.agentId === agentId);
      const sessionIds =
        group?.sessions.map((session) => session.id) ??
        (hint ? [hint] : []);
      const resolved =
        resolveSessionTabForAgent(agentId, sessionIds) ?? hintSessionId;
      handleOpenExpertSession(workspaceId, resolved);
    },
    [
      activeConversationAgentId,
      conversationGroups,
      handleOpenExpertSession,
      props.selectedSessionId,
      resolveSessionTabForAgent,
    ],
  );

  // Keep memory in sync for any path that sets selectedSessionId (route restore).
  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (!sessionId || sessionId.startsWith("draft:") || !isExpertSession(sessionId)) {
      return;
    }
    const agentId = readCustomAgentIdForSession(sessionId);
    if (!agentId) return;
    writeExpertSessionSelection(props.selectedWorkspaceId, agentId, sessionId);
  }, [props.selectedSessionId, props.selectedWorkspaceId]);
  useEffect(() => {
    const createdSessionId = resolveBoundExpertDraftSession({
      draftSessionActive,
      draftAgentId,
      pendingAgent,
    });
    if (!createdSessionId) return;
    // Lock the draft → real-session handoff as soon as creation binds the
    // expert. The route can still point at the prior tab for one render, so
    // explicitly drive it to the created session instead of allowing the
    // generic "first summoned expert" fallback to steal selection.
    setPendingTabSessionId(createdSessionId);
    if (props.selectedSessionId !== createdSessionId) {
      props.sidebar.onOpenSession(
        props.sidebar.selectedWorkspaceId,
        createdSessionId,
      );
      return;
    }
    const readySessionId = resolveReadyBoundExpertDraftSession({
      draftSessionActive,
      draftAgentId,
      pendingAgent,
      selectedSessionId: props.selectedSessionId,
    });
    if (!readySessionId) return;
    setDraftSessionActive(false);
    setDraftAgentId(null);
  }, [
    draftAgentId,
    draftSessionActive,
    pendingAgent,
    props.selectedSessionId,
    props.sidebar.onOpenSession,
    props.sidebar.selectedWorkspaceId,
  ]);
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
    },
    [activateDraftAgent],
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
  const openFreshExpertDraft = useCallback(() => {
    props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
  }, [props.selectedWorkspaceId, props.sidebar]);

  const {
    handleCreateExpert,
    handleCreateSkill,
    handleChatWithSkill,
    handleEditSkill,
  } = useExpertSkillNavigation({
    workspaceId: props.selectedWorkspaceId,
    onNavigateToMode: props.onNavigateToMode,
    onCreateTaskInWorkspace: props.sidebar.onCreateTaskInWorkspace,
  });

  const { openExpertCreation, expertCreationPage } = useExpertCreationController({
    registry,
    workspaceId: props.selectedWorkspaceId,
    workspaceRoot: props.selectedWorkspaceRoot,
    opencodeBaseUrl: props.opencodeBaseUrl ?? null,
    onmyagentServerToken: props.onmyagentServerToken ?? null,
    client: props.onmyagentServerClient,
    skills: registry?.skills ?? [],
    showToast,
  });
  const seedChatDraft = useCallback(
    (draft: string) => {
      // Expert-mode in-session seed: still force a new draft session.
      props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
      setComposerDraftAfterNewTask(props.selectedWorkspaceId, draft);
      openRailView("chat");
    },
    [openRailView, props.selectedWorkspaceId, props.sidebar],
  );

  const {
    handleStartMarketplaceExpert,
    handleCreateCurrentAgentSession,
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
    draftSessionActive,
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

      // Always stamp expert intent (incl. force-new / multi-session creates).
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
    // Empty / draft route: keep the in-progress "+ 新会话" draft.
    if (!sessionId || sessionId.startsWith("draft:")) return;

    // Unbound new-session drafts must survive the previous tab still being on
    // the route (or a brief restore) until the first send binds a real session.
    // Only drop when the user opens a *different* expert's real session.
    if (
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive,
        draftAgentId,
        pendingDraftSource: pendingAgent?.draftSource,
        pendingAgentId: pendingAgent?.id,
        pendingBoundSessionId: pendingAgent?.boundSessionId,
        selectedSessionAgentId: readCustomAgentIdForSession(sessionId),
      })
    ) {
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

  const executeExpertDelete = useCallback(
    async (
      target:
        | { kind: "session"; sessionId: string }
        | ExpertGroupDeleteTarget,
    ) => {
      if (target.kind === "session") {
        await props.onDeleteSession?.(target.sessionId);
        return;
      }
      if (props.onDeleteSession) {
        // Parallel: each session is local-first + budgeted remote; serial N×
        // waits made multi-session expert deletes feel stuck.
        const deleteOne = props.onDeleteSession;
        await Promise.allSettled(
          target.sessionIds.map((sessionId) => deleteOne(sessionId)),
        );
      }
      // Drop local expert pin + unread for this agent after sessions are gone.
      try {
        const pinned = readExpertPinnedAgentIds(props.selectedWorkspaceId);
        if (pinned.includes(target.agentId)) {
          writeExpertPinnedAgentIds(
            props.selectedWorkspaceId,
            pinned.filter((id) => id !== target.agentId),
          );
        }
        useExpertUnreadStore
          .getState()
          .markRead(props.selectedWorkspaceId, target.agentId);
      } catch {
        // Local cleanup only — ignore storage failures.
      }
    },
    [props.onDeleteSession, props.selectedWorkspaceId],
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
  } = useSessionTaskRenameDelete<ExpertGroupDeleteTarget>({
    selectedSessionId: props.selectedSessionId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onRenameSession: props.onRenameSession,
    onDeleteSession: props.onDeleteSession,
    executeDelete: executeExpertDelete,
    requireGroupSessionIds: false,
  });

  const openDeleteExpertModal = useCallback(
    (target: { agentId: string; name: string; sessionIds: string[] }) => {
      openDeleteGroupModal({
        kind: "expert",
        agentId: target.agentId.trim(),
        name: target.name.trim(),
        sessionIds: target.sessionIds,
      });
    },
    [openDeleteGroupModal],
  );

  const expertDeleteTitle =
    deleteTarget?.kind === "expert"
      ? t("session.delete_expert_title")
      : t("session.delete_session_title");
  const expertDeleteMessage =
    deleteTarget?.kind === "expert"
      ? deleteTarget.name
        ? t("session.delete_named_expert_message", {
            name: deleteTarget.name,
          })
        : t("session.delete_expert_generic")
      : sessionActionTitle.trim()
        ? t("session.delete_named_session_message", {
            title: sessionActionTitle.trim(),
          })
        : t("session.delete_session_generic");
  const expertDeleteConfirmLabel = deleteBusy
    ? t("session.deleting")
    : t("session.delete");

  const showWorkspaceSetupEmptyState =
    props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton = shouldShowSessionStartupSkeleton({
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    coldBootShell: props.coldBootShell === true,
  });
  // Draft “新会话” must not be blocked by loading state of the previously
  // selected real session (sessionLoadingById is tied to selectedSessionId).
  const showSessionLoadingState =
    Boolean(props.selectedSessionId) &&
    !draftSessionActive &&
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
  const renderedSessionId = draftSessionActive
    ? (activeDraftSessionId ?? draftSessionId)
    : (props.selectedSessionId ?? draftSessionId);
  const isDraftSession = draftSessionActive || !props.selectedSessionId;
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
  const showNoExpertConversationEmptyState =
    activeSidebarView === "chat" &&
    !draftSessionActive &&
    !hasAnyExpertConversation &&
    !showWorkspaceSetupEmptyState &&
    !showSelectedWorkspaceError &&
    !showBlockingStartupSkeleton;
  const activePlaceholderView =
    activeSidebarView === "chat" ||
    activeSidebarView === "assistant" ||
    activeSidebarView === "files" ||
    activeSidebarView === "store" ||
    activeSidebarView === "projects" ||
    activeSidebarView === "localAgent" ||
    activeSidebarView === "agentManagement" ||
    activeSidebarView === "skills" ||
    activeSidebarView === "connectors" ||
    isAutomationRailView(activeSidebarView)
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

  const conversationTabs =
    activeSidebarView === "chat" ? (
      <AgentSessionTabs
        client={props.onmyagentServerClient}
        workspaceId={props.selectedWorkspaceId}
        selectedSessionId={
          draftSessionActive ? activeDraftSessionId : props.selectedSessionId
        }
        sessions={currentAgentSessions}
        orderIds={sessionTabOrderIds}
        pendingSessionId={pendingTabSessionId}
        onPendingSessionIdChange={setPendingTabSessionId}
        agentId={activeConversationAgentId}
        sessionStatusById={props.sidebar.sessionStatusById}
        onOpenSession={handleOpenExpertSession}
        onOpenDraftSession={handleOpenDraftSession}
        onCreateSession={handleCreateCurrentAgentSession}
        onRenameSession={openRenameModal}
        onDeleteSession={openDeleteModal}
      />
    ) : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 mac:pointer-events-auto mac:titlebar-drag" />
      {/*
        Keep primary rail outside bg-dls-background so mac vibrancy can show
        through the strip (WeChat). Background wash only covers list + content.
      */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <OnMyAgentRail
          activeView={
            isAutomationRailView(activeSidebarView) ? "automation" : activeSidebarView
          }
          account={props.account}
          onOpenView={(view) => {
            if (view === "assistant") {
              props.onNavigateToMode("assistant");
              return;
            }
            // Automation hosts on assistant only — leave expert with ?view=automation.
            if (isAutomationRailView(view)) {
              const path = openAutomationRailPath(props.selectedWorkspaceId);
              if (path) navigate(path);
              return;
            }
            openRailView(view);
            if (view === "chat") setAgentPanelCollapsed(false);
          }}
          onOpenAccountSettings={props.onOpenAccountSettings}
          onSignOut={props.onSignOut}
          onOpenDevices={() => openRailView("devices")}
          onOpenBilling={() => openRailView("billing")}
        />
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background">
            {activeSidebarView === "chat" && !agentPanelCollapsed ? (
              <AgentConversationPanel
                mode="agent"
                width={agentPanelWidth}
                client={props.onmyagentServerClient}
                taskStatusVariant={taskStatus.variant}
                collapsed={agentPanelCollapsed}
                groups={sidebarWorkspaceSessionGroups}
                selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
                selectedSessionId={
                  draftSessionActive
                    ? activeDraftSessionId
                    : props.sidebar.selectedSessionId
                }
                selectedAgentId={activeConversationAgentId}
                sessionStatusById={props.sidebar.sessionStatusById}
                draftAgentGroup={draftAgentGroup}
                draftAgentGroups={draftAgentGroups}
                query={agentSearch}
                onQueryChange={setAgentSearch}
                onToggleCollapsed={() =>
                  setAgentPanelCollapsed((value) => !value)
                }
                onOpenAgents={openExpertMarket}
                onCreateExpert={openExpertCreation}
                onOpenAgentStarter={handleStartAgentById}
                onCreateTask={handleCreateCurrentAgentSession}
                onOpenSession={handleOpenExpertFromSidebar}
                onOpenDraftAgent={handleOpenDraftSession}
                onPrefetchSession={props.sidebar.onPrefetchSession}
                onDeleteSession={openDeleteModal}
                onDeleteExpert={openDeleteExpertModal}
              />
            ) : null}
            {activeSidebarView === "chat" ? (
              <SidebarPaneCollapseToggle
                collapsed={agentPanelCollapsed}
                onToggle={() => setAgentPanelCollapsed((value) => !value)}
                style={{
                  left: agentPanelCollapsed ? 0 : agentPanelWidth,
                }}
              />
            ) : null}
            {activeSidebarView === "chat" && !agentPanelCollapsed ? (
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
                sidePanelOpen && isPrimarySessionView
                  ? commitBrowserPanelWidth
                  : undefined
              }
              className="min-h-0 flex-1"
            >
              <ResizablePanel minSize="360px" className="min-w-0">
                <SessionPageMainColumn
                  activeSidebarView={activeSidebarView}
                  sidePanelBorderOpen={sidePanelOpen && isPrimarySessionView}
                >
                  <SessionRailKeepAliveStack
                    activeSidebarView={activeSidebarView}
                    visitedRailViews={visitedRailViews}
                    isPrimarySessionView={isPrimarySessionView}
                    primarySessionActive={isPrimarySessionView}
                    panes={{
                      agents: props.renderAgentsPage({
                        workspaceId: props.selectedWorkspaceId,
                        workspaceRoot: props.selectedWorkspaceRoot,
                        client: props.onmyagentServerClient,
                        providers: props.providers,
                        connectedProviderIds: props.providerConnectedIds,
                        onStartConversation: handleStartAgentConversation,
                      }),
                      store: (
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          activeTab={storeActiveTab}
                          myExperts={myExpertPackages}
                          onActiveTabChange={setStoreActiveTab}
                          onSummonMarketplaceExpert={handleStartMarketplaceExpert}
                          onCreateExpert={handleCreateExpert}
                          onCreateSkill={handleCreateSkill}
                          onChatWithSkill={handleChatWithSkill}
                          onEditSkill={handleEditSkill}
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
                        />
                      ),
                      agentManagement: (
                        <AgentManagementPage
                          workspaceRoot={props.selectedWorkspaceRoot}
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
                            openRailView("chat");
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
                      {activePlaceholderView &&
                      activeSidebarView !== "agents" &&
                      activeSidebarView !== "files" &&
                      activeSidebarView !== "store" &&
                      activeSidebarView !== "projects" &&
                      activeSidebarView !== "localAgent" &&
                      activeSidebarView !== "agentManagement" &&
                      activeSidebarView !== "devices" &&
                      activeSidebarView !== "channels" &&
                      activeSidebarView !== "billing" ? (
                        <SidebarFeaturePlaceholder
                          view={activePlaceholderView}
                        />
                      ) : null}

                      {isPrimarySessionView && showBlockingStartupSkeleton ? (
                        <SessionStartupSkeleton />
                      ) : null}

                      {isPrimarySessionView &&
                      showNoExpertConversationEmptyState ? (
                        <div className="flex h-full min-h-0 items-center justify-center px-8 py-10">
                          <div className="flex max-w-md flex-col items-center text-center">
                            <img
                              src={resolvePublicAssetUrl(NO_EXPERT_CONVERSATIONS_ASSET)}
                              alt=""
                              className="mb-5 w-full max-w-[220px] select-none object-contain"
                              draggable={false}
                            />
                            <h2 className="text-lg font-medium tracking-tight text-dls-text">
                              {t("session.no_expert_conversations_title")}
                            </h2>
                            <p className="mt-2 max-w-sm text-sm leading-6 text-dls-secondary">
                              {t("session.no_expert_conversations_desc")}
                            </p>
                            <Button
                              type="button"
                              size="default"
                              className="mt-5 gap-1.5"
                              onClick={openExpertMarket}
                              data-testid="expert-empty-open-market"
                            >
                              <Plus className="size-4" strokeWidth={2} />
                              {t("session.no_expert_conversations_action")}
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {isPrimarySessionView &&
                      !showNoExpertConversationEmptyState &&
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
                      canRenderReactSurface &&
                      !showNoExpertConversationEmptyState ? (
                          <SessionSurface
                            key={renderedSessionId}
                            {...props.surface!}
                            onSendDraft={wrappedOnSendDraft}
                            client={props.onmyagentServerClient!}
                            workspaceId={props.runtimeWorkspaceId!}
                            sessionId={renderedSessionId}
                            draftOnly={isDraftSession}
                            surfaceVisible={isPrimarySessionView}
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
                              activeQuestion: effectiveActiveQuestion,
                              questionReplyBusy:
                                props.questionReplyBusy || automationOfferFlow.busy,
                              respondQuestion: effectiveRespondQuestion,
                            }}
                            extraComposerAccessory={automationResultAccessory}
                            safeStringify={props.safeStringify}
                            userIdentity={{
                              name:
                                localAuthUser?.username ||
                                props.account?.name ||
                                props.account?.email ||
                                t("session.current_user"),
                            }}
                            headerActions={draftSessionActive ? null : headerPanelControls}
                            conversationTabs={conversationTabs}
                            searchQuery={historySearchOpen ? historySearchQuery : ""}
                            searchActiveMatchIndex={historyActiveMatch}
                            onSearchMatchCountChange={setHistoryMatchCount}
                            onOpenTarget={openTarget}
                            onOpenTargetsChange={handleOpenTargetsChange}
                            personalAssistantHome={false}
                            assistantFeatureCategoryId={activeExpertFeatureCategoryId}
                            agentContext={activeAgentContext}
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
                      !showNoExpertConversationEmptyState &&
                      !showDelayedSessionLoadingState &&
                      !canRenderReactSurface &&
                      !showBlockingStartupSkeleton ? (
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
              {sidePanelOpen && isPrimarySessionView ? (
                <>
                  {/* Single 1px rule — avoid base bg-border + before: double line. */}
                  <ResizableHandle className="hidden lg:flex" />
                  <ResizablePanel
                    key="office-side-panel"
                    panelRef={browserPanelRef}
                    defaultSize={`${EXPERT_SIDE_PANEL_DEFAULT_WIDTH}px`}
                    minSize={
                      `${EXPERT_SIDE_PANEL_MIN_WIDTH}px`
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
                        fileRoot={props.selectedSessionFileRoot ?? ""}
                        fileTargets={artifactFileTargets}
                        focusPath={artifactTarget?.value ?? null}
                        focusToken={artifactFocusToken}
                        workspaceId={props.runtimeWorkspaceId}
                        sessionId={props.selectedSessionId}
                        automationSourceSessionId={props.selectedSessionId}
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
                          activeExpertFeatureCategoryId === "office"
                            ? ["review"]
                            : undefined
                        }
                      />
                    )}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
            {expertCreationPage}
          </div>
        </div>

      {agentCreateRequestKey ? (
        props.renderAgentsPage({
          workspaceId: props.selectedWorkspaceId,
          workspaceRoot: props.selectedWorkspaceRoot,
          client: props.onmyagentServerClient,
          providers: props.providers,
          connectedProviderIds: props.providerConnectedIds,
          initialCreateRequestKey: agentCreateRequestKey,
          dialogOnly: true,
          onStartConversation: (item, registry) => {
            handleStartAgentConversation(item, registry);
            setAgentCreateRequestKey(null);
          },
        })
      ) : null}
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
        showDelete={deleteOpen}
        deleteOpen={deleteOpen}
        deleteBusy={deleteBusy}
        deleteTitle={expertDeleteTitle}
        deleteMessage={expertDeleteMessage}
        deleteConfirmLabel={expertDeleteConfirmLabel}
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
