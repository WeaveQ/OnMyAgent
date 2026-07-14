/** @jsxImportSource react */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import {
  PanelRight,
  Zap,
} from "lucide-react";

import { t } from "../../../../i18n";
import { ONMYAGENT_EXTENSION_CATALOG } from "../../../../app/constants";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft, SidebarSessionItem } from "../../../../app/types";
import {
  isCollectibleArtifactTarget,
  isLocalhostBrowserTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProviderAuthModal } from "../../connections";
import { RenameSessionModal } from "../modals/rename-session-modal";
import {
  SessionSurface,
} from "../surface/session-surface";
import { useComposerStateStore } from "../surface/composer-state-store";
import { ShareWorkspaceModal } from "../../workspace";
import { OwDotTicker, type OnMyAgentControlAction, type SidePanelItem, useControlAction, useReactRenderWatchdog, useUiStateStore, useWorkspaceShellLayout } from "../../../shell";
import {
  isElectronRuntime,
} from "../../../../app/utils";
import {
  installBuiltinSkillPackage,
  listExpertPackages,
  type ExpertPackageListEntry,
} from "../../../../app/lib/desktop";
import { VoicePanel } from "../voice/voice-panel";
import {
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
} from "../../shared";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { PersonalLocalAgentPage } from "../chat/personal-local-agent-page";
import { CodeWorkspaceSidePanel } from "../surface/code-workspace-side-panel";
import { SessionArchivePage, type SessionArchiveResumeRequest } from "../chat/session-page-session-archive-page";
import { InfiniteCanvasPanel, createCanvasSessionKey } from "../infinite-canvas";
import {
  expertMarketplaceCategoryLabel,
  normalizeExpertMarketplaceCategoryId,
} from "../expert-marketplace/categories";
import {
  findBuiltinMarketplaceExpertById,
  isBuiltinMarketplaceExpertAgentId,
} from "../expert-marketplace/data";
import { installSummonedMarketplaceExpert } from "../expert-marketplace/install";
import { buildPendingAgentFromMarketplaceExpert } from "../expert-marketplace/pending-agent";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import { writeAssistantSelectionMemory } from "../components/shared-pages/assistant-selection-memory";

import type { SessionPageProps } from "./index";
import type { AgentConversationGroup } from "../components/shared-pages/conversation-model";

import type { AgentCardItem } from "../../agents";
import {
  buildAgentToolAccess,
  buildAgentSystemPrompt,
  type PendingAgentContext,
  usePendingAgentStore,
} from "../../agents";
import { buildPendingAgentFromRecord } from "../../agents";
import {
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  useAgentRegistryStore,
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
  buildAgentConversationGroups,
  ensureAgentSessionGroupVisible,
  ensureAgentSessionsVisible,
  ensureSelectedAgentSessionGroupVisible,
  ensureSelectedAgentSessionVisible,
  AgentConversationPanel,
  AgentSessionTabs,
  BillingPage,
  DevicesPage,
  EmptyArtifactsPanel,
  ProjectsComingSoonPage,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarPaneCollapseToggle,
  SidebarFeaturePlaceholder,
  STARTUP_SKELETON_ROWS,
  StorePage,
  OnMyAgentRail,
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  hiddenAccessibleTargetsStorageKey,
  readHiddenAccessibleTargetIds,
  sessionTitleForId,
  writeHiddenAccessibleTargetIds,
  workspaceTaskStatus,
  type OnMyAgentPrimaryView,
  type StorePrimaryTab,
} from "../components/shared-pages";

const NO_EXPERT_CONVERSATIONS_ASSET = "/empty-states/no-expert-conversations.png";
const EXPERT_SIDE_PANEL_DEFAULT_WIDTH = 360;
const EXPERT_SIDE_PANEL_MIN_WIDTH = 300;
const CREATE_EXPERT_SKILL_NAME = "expert-manager";
const CREATE_EXPERT_PROMPT =
  "/expert-manager Help me create a XXX expert skilled in XXXXX. My experience: [add your industry background and relevant experience]";

function isVisibleExpertPackageEntry(entry: ExpertPackageListEntry): boolean {
  const values = [entry.packageName, entry.displayName, entry.packagePath];
  return values.every((value) => !value.split(/[\\/]/).includes(".expert-plugin"));
}

function packageEntryToMarketplaceExpert(
  entry: ExpertPackageListEntry,
): ExpertMarketplaceEntry {
  const categoryId = normalizeExpertMarketplaceCategoryId(entry.categoryId);
  return {
    ...entry,
    categoryId,
    categoryIds: categoryId === "all" ? [] : [categoryId],
    categoryLabel: expertMarketplaceCategoryLabel(categoryId),
    categoryLabels:
      categoryId === "all" ? [] : [expertMarketplaceCategoryLabel(categoryId)],
  };
}

function expertFeatureCategoryForCategoryId(
  categoryId: string | null | undefined,
): AssistantCategoryId {
  return normalizeExpertMarketplaceCategoryId(categoryId) ===
    "product-development"
    ? "code"
    : "office";
}

function expertFeatureCategoryForAgent(
  agentId: string | null | undefined,
): AssistantCategoryId {
  if (!agentId) return "office";
  return expertFeatureCategoryForCategoryId(
    findBuiltinMarketplaceExpertById(agentId)?.categoryId,
  );
}

function marketplaceExpertMatchesAgentId(
  expert: ExpertMarketplaceEntry,
  agentId: string | null | undefined,
): boolean {
  const normalized = agentId?.trim();
  if (!normalized) return false;
  if (expert.source === "builtin") {
    return isBuiltinMarketplaceExpertAgentId(expert, normalized);
  }
  return (
    normalized === expert.id ||
    normalized === expert.packageName ||
    normalized === expert.leadAgentName
  );
}

function pendingAgentMatchesMarketplaceExpert(
  agent: PendingAgentContext,
  expert: ExpertMarketplaceEntry,
): boolean {
  return (
    marketplaceExpertMatchesAgentId(expert, agent.id) ||
    agent.marketplaceExpert?.packageName === expert.packageName ||
    agent.marketplaceExpert?.packagePath === expert.packagePath
  );
}

export type ExpertPageProps = SessionPageProps & {
  onNavigateToMode: (mode: "assistant" | "expert") => void;
};

function isTrackableAccessibleTarget(target: OpenTarget) {
  return (
    isCollectibleArtifactTarget(target) || isLocalhostBrowserTarget(target)
  );
}

function setComposerDraftAfterNewTask(workspaceId: string, draft: string) {
  const sessionId = `draft:${workspaceId}`;
  const apply = () => {
    useComposerStateStore.getState().setDraft(sessionId, draft);
  };
  apply();
  window.setTimeout(apply, 0);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(apply);
  });
}

export function ExpertPage(props: ExpertPageProps) {
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const [activeSidebarView, setActiveSidebarView] =
    useState<OnMyAgentPrimaryView>("chat");
  const [pendingArchiveResume, setPendingArchiveResume] = useState<SessionArchiveResumeRequest | null>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(
    AGENT_PANEL_DEFAULT_WIDTH,
  );
  const [storeActiveTab, setStoreActiveTab] =
    useState<StorePrimaryTab>("experts");
  const [myExpertPackages, setMyExpertPackages] = useState<
    ExpertMarketplaceEntry[]
  >([]);
  const [agentCreateRequestKey, setAgentCreateRequestKey] =
    useState<number | null>(null);
  const [draftSessionActive, setDraftSessionActive] = useState(false);
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);
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

  useEffect(() => {
    if (activeSidebarView !== "store" || storeActiveTab !== "experts") {
      return undefined;
    }
    if (!isElectronRuntime()) {
      setMyExpertPackages([]);
      return undefined;
    }

    let cancelled = false;
    listExpertPackages("my-experts")
      .then((entries) => {
        if (cancelled) return;
        setMyExpertPackages(
          entries
            .filter(isVisibleExpertPackageEntry)
            .map(packageEntryToMarketplaceExpert),
        );
      })
      .catch((error) => {
        console.warn("Failed to load local expert packages", error);
        if (!cancelled) setMyExpertPackages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSidebarView, storeActiveTab]);

  const activeConversationAgentId = draftSessionActive
    ? draftAgentId
    : currentConversationAgentId;
  const activeDraftSessionId =
    draftSessionActive && draftAgentId
      ? `draft:${props.selectedWorkspaceId}:${draftAgentId}`
      : null;
  const rawWorkspaceSessions = useMemo(() => {
    const group = props.sidebar.workspaceSessionGroups.find(
      (item) => item.workspace.id === props.sidebar.selectedWorkspaceId,
    );
    return group?.sessions ?? [];
  }, [props.sidebar.selectedWorkspaceId, props.sidebar.workspaceSessionGroups]);
  const visibleAgentSessions = useMemo(
    () =>
      readCustomAgentSessionEntries().filter((entry) =>
        isExpertSession(entry.sessionId),
      ),
    [props.selectedSessionId, props.sidebar.workspaceSessionGroups],
  );
  const workspaceSessions = useMemo(
    () =>
      ensureAgentSessionsVisible({
        sessions: ensureSelectedAgentSessionVisible({
          sessions: rawWorkspaceSessions,
          selectedSessionId: props.selectedSessionId,
          selectedAgentId: currentConversationAgentId,
        }),
        agentSessions: visibleAgentSessions,
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
      ensureAgentSessionGroupVisible({
        groups: ensureSelectedAgentSessionGroupVisible({
          groups: props.sidebar.workspaceSessionGroups,
          selectedWorkspaceId: props.sidebar.selectedWorkspaceId,
          selectedSessionId: props.selectedSessionId,
          selectedAgentId: currentConversationAgentId,
        }),
        selectedWorkspaceId: props.sidebar.selectedWorkspaceId,
        agentSessions: visibleAgentSessions,
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
  const draftAgentGroups = useMemo<AgentConversationGroup[]>(() => {
    return Object.values(draftAgentContexts).flatMap((agent) => {
      if (agent.boundSessionId) return [];
      const draftSession: SidebarSessionItem = {
        id: `draft:${props.selectedWorkspaceId}:${agent.id}`,
        title: agent.name,
        time: agent.conversationStartId
          ? {
              created: agent.conversationStartId,
              updated: agent.conversationStartId,
            }
          : undefined,
      };
      return [
        {
          key: `draft-agent:${agent.id}`,
          agentId: agent.id,
          name: agent.name,
          description:
            agent.description.trim() || t("session.cmd_new_session_title"),
          avatarUrl: agent.avatar.avatarUrl,
          avatarBackground:
            agent.avatar.avatarBackground ?? "var(--ow-primary-light)",
          sessions: [draftSession],
          latestSession: draftSession,
        },
      ];
    });
  }, [draftAgentContexts, props.selectedWorkspaceId]);
  const draftAgentGroup = useMemo(
    () =>
      draftAgentGroups.find((group) => group.agentId === draftAgentId) ?? null,
    [draftAgentGroups, draftAgentId],
  );
  const hasAnyExpertConversation = useMemo(
    () =>
      workspaceSessions.some(
        (session) =>
          isExpertSession(session.id) &&
          Boolean(readCustomAgentIdForSession(session.id)),
      ),
    [workspaceSessions],
  );
  const currentAgentSessions = useMemo(() => {
    let sessions: SidebarSessionItem[];
    if (!activeConversationAgentId) {
      sessions = workspaceSessions.filter(
        (session) =>
          session.id === props.selectedSessionId &&
          isExpertSession(session.id),
      );
    } else {
      sessions = workspaceSessions.filter(
        (session) =>
          readCustomAgentIdForSession(session.id) ===
            activeConversationAgentId &&
          isExpertSession(session.id),
      );
    }
    if (draftSessionActive) {
      return [
        {
          id: activeDraftSessionId ?? `draft:${props.selectedWorkspaceId}`,
          title: t("session.cmd_new_session_title"),
        } as SidebarSessionItem,
        ...sessions,
      ];
    }
    return sessions;
  }, [
    currentConversationAgentId,
    activeConversationAgentId,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    workspaceSessions,
    draftSessionActive,
    activeDraftSessionId,
  ]);
  const activeConversationGroup = useMemo(() => {
    if (!activeConversationAgentId) return null;
    const activeDraftGroup = draftAgentGroups.find(
      (group) => group.agentId === activeConversationAgentId,
    );
    if (activeDraftGroup) return activeDraftGroup;
    return (
      conversationGroups.find(
        (group) => group.agentId === activeConversationAgentId,
      ) ?? null
    );
  }, [activeConversationAgentId, conversationGroups, draftAgentGroups]);
  const activeExpertFeatureCategoryId = expertFeatureCategoryForAgent(
    activeConversationAgentId,
  );
  const activeAgentContext = useMemo<PendingAgentContext | null>(() => {
    if (!activeConversationAgentId) return null;
    const draftContext = draftAgentContexts[activeConversationAgentId];
    if (draftContext) return draftContext;
    if (pendingAgent?.id === activeConversationAgentId) return pendingAgent;
    const registryAgent = registry
      ? (registry.agents.find((item) => item.id === activeConversationAgentId) ??
        registry.templates.find((item) => item.id === activeConversationAgentId))
      : null;
    const restoredAgent =
      registryAgent && registry
        ? buildPendingAgentFromRecord(registryAgent, registry)
        : null;
    if (restoredAgent) return restoredAgent;
    const marketplaceExpert = findBuiltinMarketplaceExpertById(
      activeConversationAgentId,
    );
    if (marketplaceExpert) {
      return {
        id: marketplaceExpert.id,
        name: marketplaceExpert.displayName,
        description: marketplaceExpert.description,
        avatar: {
          avatarStyle: "robot",
          avatarOptionId: "marketplace-expert",
          customAvatarDataUrl: null,
          avatarUrl: marketplaceExpert.avatarUrl,
          avatarBackground: "var(--ow-primary-light)",
        },
        systemPrompt: marketplaceExpert.systemPrompt,
        runtime: marketplaceExpert.runtime ?? undefined,
        quickPrompts: marketplaceExpert.quickPrompts.slice(0, 3),
        marketplaceExpert: {
          source: "builtin",
          packageName: marketplaceExpert.packageName,
          packagePath: marketplaceExpert.packagePath,
        },
      };
    }
    if (!activeConversationGroup) return null;
    return {
      id: activeConversationAgentId,
      name: activeConversationGroup.name,
      description: activeConversationGroup.description,
      avatar: {
        avatarStyle: "robot",
        avatarOptionId: "marketplace-expert",
        customAvatarDataUrl: null,
        avatarUrl: activeConversationGroup.avatarUrl,
        avatarBackground: activeConversationGroup.avatarBackground,
      },
      systemPrompt: activeConversationGroup.description,
    };
  }, [
    activeConversationAgentId,
    activeConversationGroup,
    draftAgentContexts,
    pendingAgent,
    registry,
  ]);

  const sidePanelScopeId =
    activeSidebarView === "localAgent"
      ? `localAgent:${props.selectedWorkspaceId}`
      : props.selectedSessionId;
  const sessionSidePanel = useUiStateStore((state) =>
    sidePanelScopeId
      ? (state.sidePanelState[sidePanelScopeId] ?? null)
      : null,
  );
  const voiceSidePanelOpen = useUiStateStore(
    (state) => state.sidePanelState[GLOBAL_VOICE_SIDE_PANEL_KEY] === "voice",
  );
  const setSidePanelState = useUiStateStore((state) => state.setSidePanelState);
  const toggleSidePanelState = useUiStateStore(
    (state) => state.toggleSidePanelState,
  );
  const [artifactTarget, setArtifactTarget] = useState<OpenTarget | null>(null);
  const [openTargets, setOpenTargets] = useState<OpenTarget[]>([]);
  const [hiddenAccessibleTargetIds, setHiddenAccessibleTargetIds] = useState<
    Set<string>
  >(() => new Set());
  const [, setExtensionStateVersion] = useState(0);
  const loadedHiddenTargetsKeyRef = useRef<string | null>(null);
  const accessibleTargets = useMemo(
    () =>
      openTargets.filter(
        (target) =>
          isTrackableAccessibleTarget(target) &&
          !hiddenAccessibleTargetIds.has(target.id),
      ),
    [hiddenAccessibleTargetIds, openTargets],
  );
  const artifactFileTargets = useMemo(
    () => accessibleTargets.filter(isCollectibleArtifactTarget),
    [accessibleTargets],
  );
  const visibleArtifactTarget =
    artifactTarget ?? artifactFileTargets[0] ?? null;
  const artifactTargetCount = artifactFileTargets.length;
  const hasArtifactTargets = artifactTargetCount > 0;
  const activeSidePanel = voiceSidePanelOpen ? "voice" : sessionSidePanel;
  const sidePanelOpen = activeSidePanel !== null;
  const codeWorkspacePath =
    props.surface?.draftWorkspaceDirectory?.trim() ||
    props.selectedWorkspaceRoot;
  const codeWorkspaceCatalogRoot =
    props.workspaces.find((workspace) => workspace.id === props.selectedWorkspaceId)
      ?.path?.trim() || props.selectedWorkspaceRoot;
  const voiceExtension = useMemo(
    () =>
      ONMYAGENT_EXTENSION_CATALOG.find(
        (entry) => getExtensionId(entry) === "onmyagent-voice",
      ) ?? null,
    [],
  );
  const voiceExtensionEnabled = voiceExtension
    ? isOnMyAgentExtensionEnabled(voiceExtension)
    : false;

  const startAgentPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = agentPanelWidth;
      const controller = new AbortController();

      const resize = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(
          AGENT_PANEL_MAX_WIDTH,
          Math.max(
            AGENT_PANEL_MIN_WIDTH,
            startWidth + moveEvent.clientX - startX,
          ),
        );
        setAgentPanelWidth(nextWidth);
      };
      const stop = () => controller.abort();

      window.addEventListener("pointermove", resize, {
        signal: controller.signal,
      });
      window.addEventListener("pointerup", stop, {
        once: true,
        signal: controller.signal,
      });
      window.addEventListener("pointercancel", stop, {
        once: true,
        signal: controller.signal,
      });
    },
    [agentPanelWidth],
  );

  useReactRenderWatchdog("ExpertPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  const prevSessionIdRef = useRef(props.selectedSessionId);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = props.selectedSessionId;
    if (props.selectedSessionId?.trim() && prev?.trim()) {
      setActiveSidebarView("chat");
    }
  }, [props.selectedSessionId]);

  useEffect(() => {
    if (activeSidebarView !== "chat" || props.selectedSessionId) return;
    if (
      pendingAgent?.conversationStartId &&
      !pendingAgent.boundSessionId &&
      pendingAgent.draftSource === "agent-selection"
    )
      return;
    const group = props.sidebar.workspaceSessionGroups.find(
      (item) => item.workspace.id === props.sidebar.selectedWorkspaceId,
    );
    const firstExpert = group?.sessions.find((s) => isExpertSession(s.id));
    if (!firstExpert) return;
    props.sidebar.onOpenSession(props.sidebar.selectedWorkspaceId, firstExpert.id);
  }, [
    activeSidebarView,
    props.selectedSessionId,
    props.sidebar,
    pendingAgent?.boundSessionId,
    pendingAgent?.conversationStartId,
    pendingAgent?.draftSource,
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

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const browserPanelRef = usePanelRef();
  const preserveSidePanelOnPanelOpenRef = useRef(false);
  const activateDraftAgent = useCallback(
    (agent: PendingAgentContext) => {
      setDraftAgentContexts((current) => ({ ...current, [agent.id]: agent }));
      usePendingAgentStore.getState().setAgent(agent);
      setDraftAgentId(agent.id);
      setDraftSessionActive(true);
      setActiveSidebarView("chat");
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
  const handleOpenExpertSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      setDraftSessionActive(false);
      setDraftAgentId(null);
      setActiveSidebarView("chat");
      props.sidebar.onOpenSession(workspaceId, sessionId);
    },
    [props.sidebar],
  );
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
    setActiveSidebarView("store");
  }, []);
  const openFreshExpertDraft = useCallback(() => {
    props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
  }, [props.selectedWorkspaceId, props.sidebar]);

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
    writeAssistantSelectionMemory(
      props.selectedWorkspaceId,
      "office",
      { kind: "newTask" },
    );
    props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
    setComposerDraftAfterNewTask(props.selectedWorkspaceId, CREATE_EXPERT_PROMPT);
    props.onNavigateToMode("assistant");
  }, [props.onNavigateToMode, props.selectedWorkspaceId, props.sidebar]);

  const handleStartMarketplaceExpert = useCallback(
    (expert: ExpertMarketplaceEntry) => {
      void installSummonedMarketplaceExpert(expert).catch((error) => {
        console.warn("[expert-marketplace] failed to install expert package", error);
      });
      const existingConversationGroup = conversationGroups.find((group) =>
        marketplaceExpertMatchesAgentId(expert, group.agentId),
      );
      if (existingConversationGroup) {
        usePendingAgentStore.getState().setAgent(null);
        handleOpenExpertSession(
          props.sidebar.selectedWorkspaceId,
          existingConversationGroup.latestSession.id,
        );
        return;
      }

      const existingDraftAgent = Object.values(draftAgentContexts).find(
        (agent) => pendingAgentMatchesMarketplaceExpert(agent, expert),
      );
      if (existingDraftAgent) {
        openFreshExpertDraft();
        activateDraftAgent(existingDraftAgent);
        return;
      }

      openFreshExpertDraft();
      activateDraftAgent(buildPendingAgentFromMarketplaceExpert(expert));
      setActiveSidebarView("chat");
    },
    [
      activateDraftAgent,
      conversationGroups,
      draftAgentContexts,
      handleOpenExpertSession,
      openFreshExpertDraft,
      props.sidebar.selectedWorkspaceId,
    ],
  );

  const handleCreateCurrentAgentSession = useCallback(() => {
    const agentId =
      activeAgentContext?.id ??
      activeConversationAgentId ??
      draftAgentId ??
      currentConversationAgentId;
    if (!agentId) {
      openExpertMarket();
      return;
    }
    let nextAgent: PendingAgentContext | null = null;
    if (activeAgentContext?.id === agentId) {
      nextAgent = {
        ...activeAgentContext,
        boundSessionId: undefined,
        conversationStartId: Date.now(),
        draftSource: "new-session",
      };
    } else if (registry) {
      const agent =
        registry.agents.find((item) => item.id === agentId) ??
        registry.templates.find((item) => item.id === agentId);
      const restored = agent
        ? buildPendingAgentFromRecord(agent, registry)
        : null;
      if (restored) {
        nextAgent = {
          ...restored,
          conversationStartId: Date.now(),
          draftSource: "new-session",
        };
      }
    }
    if (!nextAgent && pendingAgent?.id === agentId) {
      nextAgent = {
        ...pendingAgent,
        boundSessionId: undefined,
        conversationStartId: Date.now(),
        draftSource: "new-session",
      };
    }
    if (nextAgent) {
      activateDraftAgent(nextAgent);
    } else if (props.onCreateFreshSessionForAgent) {
      void Promise.resolve(
        props.onCreateFreshSessionForAgent(props.selectedWorkspaceId),
      );
    }
    setActiveSidebarView("chat");
  }, [
    activeAgentContext,
    activeConversationAgentId,
    activateDraftAgent,
    currentConversationAgentId,
    draftAgentId,
    pendingAgent,
    openExpertMarket,
    props.onCreateFreshSessionForAgent,
    props.selectedWorkspaceId,
    registry,
  ]);

  const wrappedOnSendDraft = useCallback(
    async (draft: ComposerDraft) => {
      if (draftSessionActive && props.onCreateSessionForAgent) {
        props.onCreateSessionForAgent();
      }
      return props.surface?.onSendDraft({
        ...draft,
        agentRuntime: activeAgentContext?.runtime,
        sessionStartIntent: props.selectedSessionId
          ? undefined
          : { mode: "expert" },
      });
    },
    [
      activeAgentContext?.runtime,
      draftSessionActive,
      props.onCreateSessionForAgent,
      props.surface,
    ],
  );

  useEffect(() => {
    if (props.selectedSessionId) {
      setDraftSessionActive(false);
      setDraftAgentId(null);
    }
  }, [props.selectedSessionId]);

  const setCurrentSidePanel = useCallback(
    (panel: SidePanelItem | null) => {
      setSidePanelState(
        GLOBAL_VOICE_SIDE_PANEL_KEY,
        panel === "voice" ? "voice" : null,
      );
      if (panel === "voice") return;
      setSidePanelState(sidePanelScopeId, panel);
    },
    [setSidePanelState, sidePanelScopeId],
  );

  const toggleCurrentSidePanel = useCallback(
    (panel: SidePanelItem) => {
      if (panel === "voice") {
        toggleSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, "voice");
        return;
      }
      setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
      toggleSidePanelState(sidePanelScopeId, panel);
    },
    [setSidePanelState, sidePanelScopeId, toggleSidePanelState],
  );

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const browser = (window as Window).__ONMYAGENT_ELECTRON__?.browser;
    if (!browser) return;
    const unsubOpen = browser.onPanelOpened?.(() => {
      if (preserveSidePanelOnPanelOpenRef.current) {
        preserveSidePanelOnPanelOpenRef.current = false;
        return;
      }
      setCurrentSidePanel("browser");
    });
    const unsubClose = browser.onPanelClosed?.(() => setCurrentSidePanel(null));
    return () => {
      unsubOpen?.();
      unsubClose?.();
    };
  }, [setCurrentSidePanel]);
  const {
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
  } = useWorkspaceShellLayout({
    expandedRightWidth: EXPERT_SIDE_PANEL_DEFAULT_WIDTH,
    minRightWidth: EXPERT_SIDE_PANEL_MIN_WIDTH,
  });
  const openExpertSidePanelMenu = useCallback(() => {
    setBrowserPanelWidth(EXPERT_SIDE_PANEL_DEFAULT_WIDTH);
    setCurrentSidePanel("codeMenu");
  }, [setBrowserPanelWidth, setCurrentSidePanel]);
  useEffect(() => {
    loadedHiddenTargetsKeyRef.current = hiddenAccessibleTargetsStorageKey(
      props.selectedWorkspaceId,
      props.selectedSessionId,
    );
    setArtifactTarget(null);
    setOpenTargets([]);
    setHiddenAccessibleTargetIds(
      readHiddenAccessibleTargetIds(
        props.selectedWorkspaceId,
        props.selectedSessionId,
      ),
    );
  }, [props.selectedSessionId, props.selectedWorkspaceId]);
  useEffect(() => {
    if (
      loadedHiddenTargetsKeyRef.current !==
      hiddenAccessibleTargetsStorageKey(
        props.selectedWorkspaceId,
        props.selectedSessionId,
      )
    )
      return;
    writeHiddenAccessibleTargetIds(
      props.selectedWorkspaceId,
      props.selectedSessionId,
      hiddenAccessibleTargetIds,
    );
  }, [
    hiddenAccessibleTargetIds,
    props.selectedSessionId,
    props.selectedWorkspaceId,
  ]);
  useEffect(() => {
    props.onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, props.onAccessibleTargetsChange]);
  const commitBrowserPanelWidth = useCallback(() => {
    const size = browserPanelRef.current?.getSize();
    if (size?.inPixels) setBrowserPanelWidth(Math.round(size.inPixels));
  }, [browserPanelRef, setBrowserPanelWidth]);
  const browserUrlForTarget = useCallback((target: OpenTarget) => {
    if (/^wss?:\/\//i.test(target.value))
      return target.value.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    return target.value;
  }, []);
  const openTarget = useCallback(
    async (target: OpenTarget, options?: { auto?: boolean }) => {
      if (target.kind === "url" || target.preview === "browser") {
        const url = browserUrlForTarget(target);
        if (isElectronRuntime()) {
          setCurrentSidePanel("browser");
          const createTab = window.__ONMYAGENT_ELECTRON__?.browser?.createTab;
          if (!createTab) throw new Error("Browser bridge is unavailable.");
          await createTab(url);
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (options?.auto && artifactTarget?.id === target.id) return;
      setArtifactTarget(target);
      preserveSidePanelOnPanelOpenRef.current = true;
      setCurrentSidePanel("artifacts");
    },
    [artifactTarget?.id, browserUrlForTarget, setCurrentSidePanel],
  );
  const handleOpenTargetsChange = useCallback((targets: OpenTarget[]) => {
    setOpenTargets(targets);
    setArtifactTarget((current) => {
      if (!current) return current;
      const updated = targets.find(
        (target) => target.id === current.id || target.value === current.value,
      );
      if (!updated) return current;
      return isCollectibleArtifactTarget(updated) ? updated : null;
    });
  }, []);
  const closeRightPane = useCallback(() => {
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);
  const removeAccessibleTarget = useCallback((target: OpenTarget) => {
    setHiddenAccessibleTargetIds((current) => new Set(current).add(target.id));
    setArtifactTarget((current) =>
      current?.id === target.id ? null : current,
    );
  }, []);
  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target =
        accessibleTargets.find(
          (item) =>
            item.id === requested?.id || item.value === requested?.value,
        ) ?? (requested?.kind && requested?.value ? requested : null);
      if (target) openTarget(target);
    };
    const hide = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find(
        (item) => item.id === requested?.id || item.value === requested?.value,
      );
      if (target) removeAccessibleTarget(target);
    };
    window.addEventListener("onmyagent-open-accessible-target", open);
    window.addEventListener("onmyagent-hide-accessible-target", hide);
    return () => {
      window.removeEventListener("onmyagent-open-accessible-target", open);
      window.removeEventListener("onmyagent-hide-accessible-target", hide);
    };
  }, [accessibleTargets, openTarget, removeAccessibleTarget]);
  useEffect(() => {
    const handler = () => setCurrentSidePanel(null);
    window.addEventListener("onmyagent-close-right-pane", handler);
    return () =>
      window.removeEventListener("onmyagent-close-right-pane", handler);
  }, [setCurrentSidePanel]);
  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => {
    if (activeSidePanel === "voice" && !voiceExtensionEnabled) {
      setCurrentSidePanel(null);
    }
  }, [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);

  const openVoicePanelControlAction = useMemo<OnMyAgentControlAction | null>(
    () =>
      voiceExtensionEnabled
        ? {
            id: "voice.panel.open",
            label: t("session.open_voice_mode"),
            description: t("session.open_voice_mode_desc"),
            sideEffect: "none",
            execute: () => {
              setCurrentSidePanel("voice");
              return { open: true };
            },
          }
        : null,
    [setCurrentSidePanel, voiceExtensionEnabled],
  );
  useControlAction(openVoicePanelControlAction);

  const closeVoicePanelControlAction = useMemo<OnMyAgentControlAction | null>(
    () =>
      voiceExtensionEnabled && activeSidePanel === "voice"
        ? {
            id: "voice.panel.close",
            label: t("session.close_voice_mode"),
            description: t("session.close_voice_mode_desc"),
            sideEffect: "none",
            execute: () => {
              setCurrentSidePanel(null);
              return { open: false };
            },
          }
        : null,
    [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled],
  );
  useControlAction(closeVoicePanelControlAction);
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] =
    useState(false);

  const sessionActionTitle = useMemo(
    () =>
      sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionActionId),
    [props.sidebar.workspaceSessionGroups, sessionActionId],
  );
  const showWorkspaceSetupEmptyState =
    props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton =
    !props.selectedSessionId &&
    !props.clientConnected &&
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready";
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
      : "OpenCode unavailable";
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
    activeSidebarView === "connectors"
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

  useEffect(() => {
    setRenameOpen(false);
    setDeleteOpen(false);
    setRenameBusy(false);
    setDeleteBusy(false);
    setSessionActionId(null);
  }, [props.selectedSessionId]);

  const openRenameModal = (sessionId: string, title: string) => {
    if (!props.onRenameSession) return;
    setSessionActionId(sessionId);
    setRenameTitle(title);
    setRenameOpen(true);
  };

  const openDeleteModal = (sessionId: string) => {
    if (!props.onDeleteSession) return;
    setSessionActionId(sessionId);
    setDeleteOpen(true);
  };

  const submitRename = async () => {
    const sessionId = sessionActionId;
    const nextTitle = renameTitle.trim();
    if (
      !sessionId ||
      !props.onRenameSession ||
      !nextTitle ||
      nextTitle === sessionActionTitle.trim()
    )
      return;
    setRenameBusy(true);
    try {
      await props.onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDelete = async () => {
    const sessionId = sessionActionId;
    if (!sessionId || !props.onDeleteSession) return;
    setDeleteBusy(true);
    try {
      await props.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const headerPanelControls = !sidePanelOpen ? (
    <div className="flex items-center gap-1 text-muted-foreground mac:titlebar-no-drag">
      <Button
        data-code-side-panel-toggle="true"
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          openExpertSidePanelMenu();
        }}
        title={t("session.code_side_panel_toggle")}
        aria-label={t("session.code_side_panel_toggle")}
        aria-expanded={sidePanelOpen}
      >
        <PanelRight className="size-3.5" />
      </Button>
    </div>
  ) : null;

  const conversationTabs =
    activeSidebarView === "chat" ? (
      <AgentSessionTabs
        client={props.onmyagentServerClient}
        workspaceId={props.selectedWorkspaceId}
        selectedSessionId={
          draftSessionActive ? activeDraftSessionId : props.selectedSessionId
        }
        sessions={currentAgentSessions}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-dls-surface mac:bg-dls-surface">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <OnMyAgentRail
            activeView={activeSidebarView}
            account={props.account}
            onOpenView={(view) => {
              if (view === "assistant") {
                props.onNavigateToMode("assistant");
                return;
              }
              setActiveSidebarView(view);
              if (view === "chat") {
                setAgentPanelCollapsed(false);
              }
            }}
            onOpenAccountSettings={props.onOpenAccountSettings}
            onSignOut={props.onSignOut}
            onOpenDevices={() => setActiveSidebarView("devices")}
            onOpenBilling={() => setActiveSidebarView("billing")}
          />
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
                onOpenAgentStarter={handleStartAgentById}
                onCreateTask={handleCreateCurrentAgentSession}
                onOpenSession={handleOpenExpertSession}
                onOpenDraftAgent={handleOpenDraftSession}
                onPrefetchSession={props.sidebar.onPrefetchSession}
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
                sidePanelOpen ? commitBrowserPanelWidth : undefined
              }
              className="min-h-0 flex-1"
            >
              <ResizablePanel minSize="360px" className="min-w-0">
                <main className="flex h-full min-w-0 flex-col overflow-hidden border-r border-dls-border bg-dls-surface">
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="relative min-w-0 flex-1 overflow-hidden bg-dls-surface mac:bg-dls-surface">
                      {activeSidebarView === "agents" ? (
                        props.renderAgentsPage({
                          workspaceId: props.selectedWorkspaceId,
                          workspaceRoot: props.selectedWorkspaceRoot,
                          client: props.onmyagentServerClient,
                          providers: props.providers,
                          connectedProviderIds: props.providerConnectedIds,
                          onStartConversation: handleStartAgentConversation,
                        })
                      ) : null}

                      {activeSidebarView === "store" ? (
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          activeTab={storeActiveTab}
                          myExperts={myExpertPackages}
                          onActiveTabChange={setStoreActiveTab}
                          onSummonMarketplaceExpert={handleStartMarketplaceExpert}
                          onCreateExpert={handleCreateExpert}
                        />
                      ) : null}

                      {activeSidebarView === "localAgent" ? (
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
                      ) : null}

                      {activeSidebarView === "agentManagement" ? (
                        <AgentManagementPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          sessionArchiveSlot={(
                            <SessionArchivePage
                              client={props.onmyagentServerClient}
                              workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                              onResume={(request) => {
                                setPendingArchiveResume(request);
                                setActiveSidebarView("localAgent");
                              }}
                            />
                          )}
                        />
                      ) : null}

                      {activeSidebarView === "files" ? (
                        <WorkspaceFilesPage
                          client={props.onmyagentServerClient}
                          workspaceId={
                            props.runtimeWorkspaceId ??
                            props.selectedWorkspaceId
                          }
                          workspaceRoot={props.selectedWorkspaceRoot}
                          onOpenArtifact={openTarget}
                        />
                      ) : null}

                      {activeSidebarView === "projects" ? (
                        <ProjectsComingSoonPage />
                      ) : null}

                      {activeSidebarView === "devices" ? <DevicesPage /> : null}

                      {activeSidebarView === "channels" ? (
                        <MessagingChannelsPage workspaceRoot={props.selectedWorkspaceRoot} />
                      ) : null}

                      {activeSidebarView === "billing" ? <BillingPage /> : null}

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

                      {!activePlaceholderView &&
                      showBlockingStartupSkeleton ? (
                        <div
                          className="px-6 py-14"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="mx-auto max-w-2xl space-y-6">
                            <div className="space-y-2">
                              <div className="h-4 w-32 animate-pulse rounded-full bg-dls-surface-muted" />
                              <div className="h-3 w-64 animate-pulse rounded-full bg-dls-surface-muted" />
                            </div>
                            <div className="space-y-3">
                              {STARTUP_SKELETON_ROWS.map((row) => (
                                <div
                                  key={row.id}
                                  className="rounded-xl border border-dls-border bg-dls-surface-muted p-4"
                                >
                                  <div
                                    className="mb-3 h-3 animate-pulse rounded-full bg-dls-surface-muted"
                                    style={{ width: row.titleWidth }}
                                  />
                                  <div className="space-y-2">
                                    <div className="h-2.5 animate-pulse rounded-full bg-dls-surface-muted" />
                                    <div
                                      className="h-2.5 animate-pulse rounded-full bg-dls-surface-muted"
                                      style={{ width: row.bodyWidth }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {!activePlaceholderView &&
                      showNoExpertConversationEmptyState ? (
                        <div className="flex h-full min-h-0 items-center justify-center px-8 py-10">
                          <div className="flex max-w-md flex-col items-center text-center">
                            <img
                              src={resolvePublicAssetUrl(NO_EXPERT_CONVERSATIONS_ASSET)}
                              alt=""
                              className="mb-6 w-full max-w-xs select-none object-contain"
                              draggable={false}
                            />
                            <h2 className="text-xl font-medium text-dls-text">
                              {t("session.no_expert_conversations_title")}
                            </h2>
                            <p className="mt-2 max-w-sm text-sm leading-6 text-dls-secondary">
                              {t("session.no_expert_conversations_desc")}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {!activePlaceholderView &&
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

                      {!activePlaceholderView &&
                      !showNoExpertConversationEmptyState &&
                      !showDelayedSessionLoadingState &&
                      canRenderReactSurface ? (
                        <SessionSurface
                          key={renderedSessionId}
                          {...props.surface!}
                          onSendDraft={wrappedOnSendDraft}
                          client={props.onmyagentServerClient!}
                          workspaceId={props.runtimeWorkspaceId!}
                          sessionId={renderedSessionId}
                          draftOnly={isDraftSession}
                          opencodeBaseUrl={reactSessionBaseUrl}
                          onmyagentToken={reactSessionToken}
                          todos={props.todos}
                          activePermission={props.activePermission}
                          permissionReplyBusy={props.permissionReplyBusy}
                          respondPermission={props.respondPermission}
                          autoApprovedPermissionNoticeId={
                            props.autoApprovedPermissionNoticeId
                          }
                          activeQuestion={props.activeQuestion}
                          questionReplyBusy={props.questionReplyBusy}
                          respondQuestion={props.respondQuestion}
                          safeStringify={props.safeStringify}
                          userIdentity={{
                            name:
                              localAuthUser?.username ||
                              props.account?.name ||
                              props.account?.email ||
                              t("session.current_user"),
                          }}
                          headerActions={headerPanelControls}
                          conversationTabs={conversationTabs}
                          onOpenTarget={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                          personalAssistantHome={false}
                          assistantFeatureCategoryId={activeExpertFeatureCategoryId}
                          agentContext={activeAgentContext}
                          onOpenSkillsMarketplace={() => {
                            setStoreActiveTab("skills");
                            setActiveSidebarView("store");
                          }}
                        />
                      ) : null}

                      {!activePlaceholderView &&
                      !showNoExpertConversationEmptyState &&
                      !showDelayedSessionLoadingState &&
                      !canRenderReactSurface &&
                      !showBlockingStartupSkeleton &&
                      activeSidebarView !== "agentManagement" ? (
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
                      ) : null}
                    </div>
                  </div>
                </main>
              </ResizablePanel>
              {sidePanelOpen ? (
                <>
                  <ResizableHandle className="hidden bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-dls-border/70 before:transition-colors after:w-3 hover:before:bg-dls-border-strong focus-visible:before:bg-dls-accent lg:flex" />
                  <ResizablePanel
                    key={activeExpertFeatureCategoryId === "code" ? "code-side-panel" : "office-side-panel"}
                    panelRef={browserPanelRef}
                    defaultSize={`${EXPERT_SIDE_PANEL_DEFAULT_WIDTH}px`}
                    minSize={
                      `${EXPERT_SIDE_PANEL_MIN_WIDTH}px`
                    }
                    maxSize="70%"
                    className="min-h-0 overflow-hidden lg:flex lg:flex-col"
                  >
                    {activeSidePanel === "canvas" ? (
                      <InfiniteCanvasPanel
                        canvasKey={canvasSessionKey}
                        onClose={closeRightPane}
                      />
                    ) : activeSidePanel === "extensions" && props.settingsSlot ? (
                      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                        {props.settingsSlot}
                      </div>
                    ) : activeSidePanel === "voice" ? (
                      <VoicePanel
                        client={props.onmyagentServerClient}
                        sessionId={props.selectedSessionId}
                        onClose={closeRightPane}
                      />
                    ) : (
                      <CodeWorkspaceSidePanel
                        workspacePath={codeWorkspacePath}
                        workspaceCatalogRoot={codeWorkspaceCatalogRoot}
                        fileRoot={props.selectedSessionFileRoot ?? ""}
                        fileTargets={artifactFileTargets}
                        workspaceId={props.runtimeWorkspaceId}
                        sessionId={props.selectedSessionId}
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
                        hiddenKinds={
                          activeExpertFeatureCategoryId === "office"
                            ? ["review", "terminal"]
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

      {props.onRenameSession ? (
        <RenameSessionModal
          open={renameOpen}
          title={renameTitle}
          busy={renameBusy}
          canSave={
            renameTitle.trim().length > 0 &&
            renameTitle.trim() !== sessionActionTitle.trim()
          }
          onClose={() => {
            if (!renameBusy) setRenameOpen(false);
          }}
          onSave={() => void submitRename()}
          onTitleChange={setRenameTitle}
        />
      ) : null}

      {props.onDeleteSession ? (
        <ConfirmModal
          open={deleteOpen}
          title={t("session.delete_session_title")}
          message={
            sessionActionTitle.trim()
              ? t("session.delete_named_session_message", {
                  title: sessionActionTitle.trim(),
                })
              : t("session.delete_session_generic")
          }
          confirmLabel={
            deleteBusy ? t("session.deleting") : t("session.delete")
          }
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!deleteBusy) setDeleteOpen(false);
          }}
        />
      ) : null}

      {props.shareWorkspaceModal ? (
        <ShareWorkspaceModal {...props.shareWorkspaceModal} />
      ) : null}
    </div>
  );
}
