/** @jsxImportSource react */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import {
  PanelLeft,
  PanelRight,
  Zap,
} from "lucide-react";

import { t } from "../../../../i18n";
import { ONMYAGENT_EXTENSION_CATALOG } from "../../../../app/constants";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft } from "../../../../app/types";
import {
  isCollectibleArtifactTarget,
  isLocalhostBrowserTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import ProviderAuthModal from "../../shared/provider-auth-modal";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { SessionSurface } from "../surface/session-surface";
import { ShareWorkspaceModal } from "../../shared/share-workspace-modal";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import {
  type SidePanelItem,
  useUiStateStore,
} from "../../../shell/ui-state-store";
import {
  isElectronRuntime,
} from "../../../../app/utils";
import { VoicePanel } from "../voice/voice-panel";
import { useWorkspaceShellLayout } from "../../../shell/workspace-shell-layout";
import {
  useControlAction,
  type OpenworkControlAction,
} from "../../../shell/control/control-provider";
import {
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
} from "../../shared/extension-state";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { PersonalLocalAgentPage } from "../chat/personal-local-agent-page";
import { CodeWorkspaceSidePanel } from "../surface/code-workspace-side-panel";
import { SessionArchivePage } from "../chat/session-page-session-archive-page";
import { InfiniteCanvasPanel, createCanvasSessionKey } from "../infinite-canvas";
import { buildPendingAgentFromMarketplaceExpert } from "../expert-marketplace/pending-agent";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";

import type {
  SessionAgentManagementIntent,
  SessionPageProps,
} from "./index";

import {
  setPendingAssistantSessionCategory,
  setPendingAssistantTask,
} from "../../shared/agent-session-state";
import { usePendingAgentStore } from "../../shared/pending-agent-store";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";

import {
  AgentConversationPanel,
  AgentManagementPage,
  BillingPage,
  DevicesPage,
  MessagingChannelsPage,
  ProjectsComingSoonPage,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarFeaturePlaceholder,
  STARTUP_SKELETON_ROWS,
  StorePage,
  OnMyAgentRail,
  WorkspaceFilesPage,
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  AutomationPage,
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  hiddenAccessibleTargetsStorageKey,
  readHiddenAccessibleTargetIds,
  sessionTitleForId,
  writeHiddenAccessibleTargetIds,
  workspaceTaskStatus,
  type OnMyAgentPrimaryView,
} from "../components/shared-pages";
import {
  readAssistantSelectionMemory,
  resolveAssistantSelectionMemory,
  type AssistantSelectionMemory,
  writeAssistantSelectionMemory,
} from "../components/shared-pages/assistant-selection-memory";

export type AssistantPageProps = SessionPageProps & {
  onNavigateToMode: (mode: "assistant" | "expert") => void;
  agentManagementIntent?: SessionAgentManagementIntent | null;
  onAgentManagementIntentConsumed?: (key: string) => void;
};

const ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH = 360;
const ASSISTANT_SIDE_PANEL_MIN_WIDTH = 300;

function isTrackableAccessibleTarget(target: OpenTarget) {
  return (
    isCollectibleArtifactTarget(target) || isLocalhostBrowserTarget(target)
  );
}

export function AssistantPage(props: AssistantPageProps) {
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const sidePanelSessionKey =
    props.selectedSessionId ?? `assistant-draft:${props.selectedWorkspaceId}`;
  const agentManagementIntent = props.agentManagementIntent;
  const onAgentManagementIntentConsumed =
    props.onAgentManagementIntentConsumed;
  const consumedAgentManagementIntentRef = useRef<string | null>(null);
  const [activeSidebarView, setActiveSidebarView] =
    useState<OnMyAgentPrimaryView>("assistant");
  const [agentManagementPageIntent, setAgentManagementPageIntent] =
    useState(agentManagementIntent);
  const [assistantCategoryId, setAssistantCategoryId] =
    useState<AssistantCategoryId>("office");
  const handleSummonMarketplaceExpert = useCallback(
    (expert: ExpertMarketplaceEntry) => {
      usePendingAgentStore
        .getState()
        .setAgent(buildPendingAgentFromMarketplaceExpert(expert));
      props.onNavigateToMode("expert");
    },
    [props.onNavigateToMode],
  );
  const [agentSearch] = useState("");
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(
    AGENT_PANEL_DEFAULT_WIDTH,
  );
  const sidePanelScopeId =
    activeSidebarView === "localAgent"
      ? `localAgent:${props.selectedWorkspaceId}`
      : sidePanelSessionKey;
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
  const activeSidePanel = voiceSidePanelOpen ? "voice" : sessionSidePanel;
  const sidePanelOpen = activeSidePanel !== null;
  const sidePanelVisible = sidePanelOpen && activeSidebarView !== "scheduledTasks";
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

  const openAssistantSessionView = useCallback(() => {
    setActiveSidebarView("assistant");
  }, []);

  const openScheduledTasksView = useCallback(() => {
    setActiveSidebarView("scheduledTasks");
  }, []);

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

  const openAssistantNewTask = useCallback(
    (categoryId: AssistantCategoryId) => {
      writeAssistantSelectionMemory(
        props.selectedWorkspaceId,
        categoryId,
        { kind: "newTask" },
      );
      openAssistantSessionView();
      props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
    },
    [
      openAssistantSessionView,
      props.selectedWorkspaceId,
      props.sidebar,
    ],
  );

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

  const prevSessionIdRef = useRef(props.selectedSessionId);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = props.selectedSessionId;
    if (props.selectedSessionId?.trim() && prev !== props.selectedSessionId) {
      setActiveSidebarView("assistant");
    }
  }, [props.selectedSessionId]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const browserPanelRef = usePanelRef();
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const wrappedOnSendDraft = useCallback(
    async (draft: ComposerDraft) => {
      if (!props.selectedSessionId) {
        usePendingAgentStore.getState().setAgent(null);
        setPendingAssistantTask(true);
        setPendingAssistantSessionCategory(assistantCategoryId);
        if (props.onCreateSessionForAgent) {
          props.onCreateSessionForAgent();
        }
      }
      return props.surface?.onSendDraft(draft);
    },
    [assistantCategoryId, props.selectedSessionId, props.onCreateSessionForAgent, props.surface],
  );

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
    expandedRightWidth: ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH,
    minRightWidth: ASSISTANT_SIDE_PANEL_MIN_WIDTH,
  });
  const assistantSidePanelWidthRef = useRef(ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH);
  const openAssistantSidePanelMenu = useCallback(() => {
    assistantSidePanelWidthRef.current = ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH;
    setBrowserPanelWidth(ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH);
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
    if (size?.inPixels) {
      const next = Math.round(size.inPixels);
      if (assistantSidePanelWidthRef.current === next) return;
      assistantSidePanelWidthRef.current = next;
      setBrowserPanelWidth(next);
    }
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

  const openVoicePanelControlAction = useMemo<OpenworkControlAction | null>(
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

  const closeVoicePanelControlAction = useMemo<OpenworkControlAction | null>(
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

  useEffect(() => {
    const intent = agentManagementIntent;
    if (!intent || consumedAgentManagementIntentRef.current === intent.key) {
      return;
    }
    consumedAgentManagementIntentRef.current = intent.key;
    if (intent.action === "createProvider") {
      setAgentManagementPageIntent(intent);
      setActiveSidebarView("agentManagement");
      onAgentManagementIntentConsumed?.(intent.key);
    }
  }, [agentManagementIntent, onAgentManagementIntentConsumed]);

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

  const headerPanelControls = (
    <div className="flex items-center gap-1 text-muted-foreground mac:titlebar-no-drag">
      <Button
        data-code-side-panel-toggle="true"
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(
          "rounded-md transition-colors hover:bg-muted hover:text-foreground",
          sidePanelOpen &&
            activeSidePanel !== "canvas" &&
            "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        )}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (sidePanelOpen) {
            closeRightPane();
            return;
          }
          openAssistantSidePanelMenu();
        }}
        title={t("session.code_side_panel_toggle")}
        aria-label={t("session.code_side_panel_toggle")}
        aria-expanded={sidePanelOpen}
      >
        <PanelRight className="size-4" />
      </Button>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 mac:pointer-events-auto mac:titlebar-drag" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-dls-surface mac:bg-dls-surface">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <OnMyAgentRail
            activeView={railActiveView}
            account={props.account}
            onOpenView={(view) => {
              if (view === "chat") {
                props.onNavigateToMode("expert");
                return;
              }
              setActiveSidebarView(view);
              if (view === "assistant") {
                setAgentPanelCollapsed(false);
                props.sidebar.onCreateTaskInWorkspace(
                  props.selectedWorkspaceId,
                );
              }
            }}
            onOpenAccountSettings={props.onOpenAccountSettings}
            onSignOut={props.onSignOut}
            onOpenDevices={() => setActiveSidebarView("devices")}
            onOpenBilling={() => setActiveSidebarView("billing")}
          />
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
              />
            ) : null}
            {(activeSidebarView === "chat" ||
              activeSidebarView === "assistant" ||
              activeSidebarView === "scheduledTasks") &&
            agentPanelCollapsed ? (
              <div className="flex w-10 shrink-0 bg-dls-background px-2 pb-5 pt-2">
                <Button
                  type="button"
                  onClick={() => setAgentPanelCollapsed(false)}
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                  title={t("session.expand_session_list")}
                  aria-label={t("session.expand_session_list")}
                >
                  <PanelLeft className="size-3.5" />
                </Button>
              </div>
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
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-dls-border transition-colors group-hover:bg-dls-border-strong group-focus-visible:bg-dls-accent" />
              </div>
            ) : null}
            <ResizablePanelGroup
              orientation="horizontal"
              onLayoutChanged={
                sidePanelVisible ? commitBrowserPanelWidth : undefined
              }
              className="min-h-0 flex-1"
            >
              <ResizablePanel minSize="360px" className="min-w-0">
                <main className={cn(
                  "flex h-full min-w-0 flex-col overflow-hidden bg-dls-surface",
                  sidePanelVisible ? "border-r-0" : "border-r border-dls-border",
                )}>
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="relative min-w-0 flex-1 overflow-hidden bg-dls-surface mac:bg-dls-surface">
                      {activeSidebarView === "store" ? (
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          onSummonMarketplaceExpert={handleSummonMarketplaceExpert}
                        />
                      ) : null}

                      {activeSidebarView === "localAgent" ? (
                        <PersonalLocalAgentPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          workspaceName={props.selectedWorkspaceDisplay.name}
                          onOpenArtifact={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                          headerActions={headerPanelControls}
                        />
                      ) : null}

                      {activeSidebarView === "agentManagement" ? (
                        <AgentManagementPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          intent={agentManagementPageIntent}
                          sessionArchiveSlot={(
                            <SessionArchivePage
                              client={props.onmyagentServerClient}
                              workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
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

                      {activeSidebarView === "scheduledTasks" ? (
                        <AutomationPage
                          scene={assistantCategoryId}
                          client={props.onmyagentServerClient}
                          workspaceId={props.selectedWorkspaceId}
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

                      {!activePlaceholderView &&
                      activeSidebarView !== "scheduledTasks" &&
                      showBlockingStartupSkeleton ? (
                        <div
                          className="px-6 py-14"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="mx-auto max-w-2xl space-y-6">
                            <div className="space-y-2">
                              <div className="h-4 w-32 animate-pulse rounded-full bg-dls-hover/80" />
                              <div className="h-3 w-64 animate-pulse rounded-full bg-dls-hover/60" />
                            </div>
                            <div className="space-y-3">
                              {STARTUP_SKELETON_ROWS.map((row) => (
                                <div
                                  key={row.id}
                                  className="rounded-2xl border border-dls-border bg-dls-hover/40 p-4"
                                >
                                  <div
                                    className="mb-3 h-3 animate-pulse rounded-full bg-dls-hover/80"
                                    style={{ width: row.titleWidth }}
                                  />
                                  <div className="space-y-2">
                                    <div className="h-2.5 animate-pulse rounded-full bg-dls-hover/70" />
                                    <div
                                      className="h-2.5 animate-pulse rounded-full bg-dls-hover/60"
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
                      activeSidebarView !== "scheduledTasks" &&
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
                      activeSidebarView !== "scheduledTasks" &&
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
                          conversationTabs={null}
                          onOpenTarget={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                          personalAssistantHome={true}
                          personalAssistantCategoryId={assistantCategoryId}
                          onPersonalAssistantCategoryChange={setAssistantCategoryId}
                          onPersonalAssistantCategoryActive={setAssistantCategoryId}
                        />
                      ) : null}

                      {!activePlaceholderView &&
                      !showDelayedSessionLoadingState &&
                      !canRenderReactSurface &&
                      !showStartupSkeleton &&
                      activeSidebarView !== "scheduledTasks" &&
                      activeSidebarView !== "agentManagement" ? (
                        <div
                          className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}
                        >
                          {props.notFoundMessage ? (
                            <div className="px-6 py-16 text-center">
                              <div className="mx-auto max-w-md rounded-2xl border border-dls-border bg-dls-card px-5 py-6">
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
                              <IconTile size="2xl" shape="xl" border className="mx-auto rounded-3xl">
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
              {sidePanelVisible ? (
                <>
                  <ResizableHandle className="hidden bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-dls-border/70 before:transition-colors after:w-3 hover:before:bg-dls-border-strong focus-visible:before:bg-dls-accent lg:flex" />
                  <ResizablePanel
                    key={assistantCategoryId === "code" ? "code-side-panel" : "office-side-panel"}
                    panelRef={browserPanelRef}
                    defaultSize={`${ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH}px`}
                    minSize={
                      `${ASSISTANT_SIDE_PANEL_MIN_WIDTH}px`
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
                          assistantCategoryId === "office"
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
