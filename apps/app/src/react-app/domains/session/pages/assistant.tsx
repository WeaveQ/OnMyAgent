/** @jsxImportSource react */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
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
import { ProviderAuthModal } from "../../connections";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { SessionSurface } from "../surface/session-surface";
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
import { openInAppBrowser } from "../browser/open-in-app-browser";
import { useAutoOpenBrowserPanel } from "../browser/use-auto-open-browser-panel";
import {
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
} from "../../shared";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { PersonalLocalAgentPage } from "../../local-agents";
import { CodeWorkspaceSidePanel } from "../surface/code-workspace-side-panel";
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { SessionArchivePage, type SessionArchiveResumeRequest } from "../chat/session-page-session-archive-page";
import { InfiniteCanvasPanel, createCanvasSessionKey } from "../infinite-canvas";
import {
  expertMarketplaceCategoryLabel,
  normalizeExpertMarketplaceCategoryId,
} from "../expert-marketplace/categories";
import { installSummonedMarketplaceExpert } from "../expert-marketplace/install";
import { buildPendingAgentFromMarketplaceExpert } from "../expert-marketplace/pending-agent";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";

import type {
  SessionAgentManagementIntent,
  SessionPageProps,
} from "./index";

import { usePendingAgentStore } from "../../agents";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";

import { AgentManagementPage } from "../../local-agents";
import { AutomationPage, MessagingChannelsPage } from "../../messaging";
import { WorkspaceFilesPage } from "../../workspace";
import { permanentlyRemoveAssistantArchivedTask } from "../../shared";
import {
  AgentConversationPanel,
  SidebarPaneCollapseToggle,
  STARTUP_SKELETON_ROWS,
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
  readAssistantSelectionMemory,
  resolveAssistantSelectionMemory,
  writeAssistantSelectionMemory,
  type OnMyAgentPrimaryView,
  type AssistantSelectionMemory,
} from "../sidebar/session-chrome";
import {
  KeepAlivePane,
  useVisitedRailViews,
} from "../sidebar/keep-alive-pane";
import {
  isPrimarySessionRailView,
  readAssistantCategoryMemory,
  readRailView,
  writeAssistantCategoryMemory,
  writeRailView,
} from "../sidebar/rail-navigation-memory";
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

export type AssistantPageProps = SessionPageProps & {
  onNavigateToMode: (mode: "assistant" | "expert") => void;
  agentManagementIntent?: SessionAgentManagementIntent | null;
  onAgentManagementIntentConsumed?: (key: string) => void;
};

import {
  isVisibleExpertPackageEntry,
  packageEntryToMarketplaceExpert,
  isTrackableAccessibleTarget,
  setComposerDraftAfterNewTask,
} from "./shared-page-utils";

const ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH = 360;
const ASSISTANT_SIDE_PANEL_MIN_WIDTH = 300;
const CREATE_EXPERT_SKILL_NAME = "expert-manager";

export function AssistantPage(props: AssistantPageProps) {
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const sidePanelSessionKey =
    props.selectedSessionId ?? `assistant-draft:${props.selectedWorkspaceId}`;
  const agentManagementIntent = props.agentManagementIntent;
  const onAgentManagementIntentConsumed =
    props.onAgentManagementIntentConsumed;
  const consumedAgentManagementIntentRef = useRef<string | null>(null);
  const [activeSidebarView, setActiveSidebarView] =
    useState<OnMyAgentPrimaryView>(() =>
      readRailView("assistant", props.selectedWorkspaceId, "assistant"),
    );
  const [pendingArchiveResume, setPendingArchiveResume] = useState<SessionArchiveResumeRequest | null>(null);
  const [agentManagementPageIntent, setAgentManagementPageIntent] =
    useState(agentManagementIntent);
  const [assistantCategoryId, setAssistantCategoryId] =
    useState<AssistantCategoryId>(() =>
      readAssistantCategoryMemory(props.selectedWorkspaceId, "office"),
    );
  const visitedRailViews = useVisitedRailViews(
    activeSidebarView,
    props.selectedWorkspaceId,
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
  const [myExpertPackages, setMyExpertPackages] = useState<
    ExpertMarketplaceEntry[]
  >([]);
  const handleSummonMarketplaceExpert = useCallback(
    (expert: ExpertMarketplaceEntry) => {
      void installSummonedMarketplaceExpert(expert).catch((error) => {
        console.warn("[expert-marketplace] failed to install expert package", error);
      });
      props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
      usePendingAgentStore
        .getState()
        .setAgent(buildPendingAgentFromMarketplaceExpert(expert));
      props.onNavigateToMode("expert");
    },
    [props.onNavigateToMode, props.selectedWorkspaceId, props.sidebar],
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
  const artifactFileTargets = useMemo(
    () => accessibleTargets.filter(isCollectibleArtifactTarget),
    [accessibleTargets],
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

  useEffect(() => {
    if (activeSidebarView !== "store") {
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
  }, [activeSidebarView]);

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
    writeRailView("assistant", props.selectedWorkspaceId, "assistant");
    setActiveSidebarView("assistant");
  }, [props.selectedWorkspaceId]);

  const openScheduledTasksView = useCallback(() => {
    writeRailView("assistant", props.selectedWorkspaceId, "scheduledTasks");
    setActiveSidebarView("scheduledTasks");
  }, [props.selectedWorkspaceId]);

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
  /** Header find bar (expands in chrome like in-chat search). */
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyMatchCount, setHistoryMatchCount] = useState(0);
  const [historyActiveMatch, setHistoryActiveMatch] = useState(0);
  const historySearchInputRef = useRef<HTMLInputElement>(null);
  const browserPanelRef = usePanelRef();
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const wrappedOnSendDraft = useCallback(
    async (draft: ComposerDraft) => {
      if (!props.selectedSessionId) {
        usePendingAgentStore.getState().setAgent(null);
        if (props.onCreateSessionForAgent) {
          props.onCreateSessionForAgent();
        }
      }
      return props.surface?.onSendDraft({
        ...draft,
        sessionStartIntent: props.selectedSessionId
          ? undefined
          : { mode: "assistant", assistantCategory: assistantCategoryId },
      });
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

  const openBrowserPanelFromAgent = useCallback(() => {
    if (preserveSidePanelOnPanelOpenRef.current) {
      preserveSidePanelOnPanelOpenRef.current = false;
      return;
    }
    setCurrentSidePanel("browser");
  }, [setCurrentSidePanel]);
  useAutoOpenBrowserPanel(openBrowserPanelFromAgent, props.selectedSessionId);
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
    // Right rail stays workspace tools (not history — history is a header popover).
    setCurrentSidePanel("codeMenu");
  }, [setBrowserPanelWidth, setCurrentSidePanel]);

  const handleHistorySelectPrompt = useCallback(
    (text: string) => {
      const sessionId = props.selectedSessionId;
      if (!sessionId || !text.trim()) return;
      useComposerStateStore.getState().setDraft(sessionId, text);
    },
    [props.selectedSessionId],
  );

  /** Header find only — never opens the right workspace / history panel. */
  const openHistorySearch = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    setHistorySearchOpen(true);
    window.setTimeout(() => historySearchInputRef.current?.focus(), 0);
  }, []);

  const closeHistorySearch = useCallback(() => {
    setHistorySearchOpen(false);
    setHistorySearchQuery("");
    setHistoryActiveMatch(0);
    setHistoryMatchCount(0);
  }, []);

  useEffect(() => {
    setHistoryActiveMatch(0);
  }, [historySearchQuery, props.selectedSessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        // Prefer header history search when assistant chat is active.
        if (
          activeSidebarView === "assistant" ||
          activeSidebarView === "chat" ||
          activeSidebarView === "scheduledTasks"
        ) {
          event.preventDefault();
          openHistorySearch();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSidebarView, openHistorySearch]);
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
        await openInAppBrowser({
          openSidePanel: () => setCurrentSidePanel("browser"),
          url,
          sessionId: props.selectedSessionId,
        });
        return;
      }
      if (options?.auto && artifactTarget?.id === target.id) return;
      setArtifactTarget(target);
      preserveSidePanelOnPanelOpenRef.current = true;
      setCurrentSidePanel("artifacts");
    },
    [
      artifactTarget?.id,
      browserUrlForTarget,
      props.selectedSessionId,
      setCurrentSidePanel,
    ],
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

  // History is a header popover now; clear any persisted right-rail "history".
  useEffect(() => {
    if (sessionSidePanel === "history") {
      setCurrentSidePanel(null);
    }
  }, [sessionSidePanel, setCurrentSidePanel]);

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
  /** Only paint SessionSurface on assistant/chat — hide under keep-alive secondary rails. */
  const isPrimarySessionView = isPrimarySessionRailView(activeSidebarView);

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
      permanentlyRemoveAssistantArchivedTask(
        props.selectedWorkspaceId,
        sessionId,
      );
      await props.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const historySearchShortcut = formatShortcut(["Mod", "F"]);
  const historyMatchLabel =
    historySearchQuery.trim() && historyMatchCount > 0
      ? `${(historyActiveMatch % historyMatchCount) + 1}/${historyMatchCount}`
      : historySearchQuery.trim()
        ? "0/0"
        : "";

  // Header chrome: 🔍 find (inline expand) · 🕐 history questions popover · ▤ workspace rail
  const historyChrome = (
    <>
      {historySearchOpen ? (
        <div
          className={cn(
            "flex h-8 items-center gap-1 rounded-full border border-dls-border",
            "bg-dls-surface-muted/70 px-2 shadow-sm",
            "focus-within:border-dls-accent/40 focus-within:bg-dls-surface-solid",
          )}
        >
          <Search className="size-3.5 shrink-0 text-dls-secondary" aria-hidden />
          <input
            ref={historySearchInputRef}
            type="search"
            value={historySearchQuery}
            onChange={(event) => setHistorySearchQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!historyMatchCount) return;
                setHistoryActiveMatch((i) =>
                  event.shiftKey
                    ? (i - 1 + historyMatchCount) % historyMatchCount
                    : (i + 1) % historyMatchCount,
                );
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeHistorySearch();
              }
            }}
            placeholder={t("session.conversation_history_search_header_placeholder")}
            className="w-40 min-w-0 bg-transparent text-sm text-dls-text outline-none placeholder:text-dls-secondary/70 sm:w-52"
            aria-label={t("session.conversation_history_search_header_placeholder")}
          />
          {historyMatchLabel ? (
            <span className="shrink-0 tabular-nums text-xs text-dls-secondary">
              {historyMatchLabel}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-dls-secondary hover:text-dls-text"
            disabled={!historyMatchCount}
            onClick={() =>
              setHistoryActiveMatch((i) =>
                historyMatchCount
                  ? (i - 1 + historyMatchCount) % historyMatchCount
                  : 0,
              )
            }
            title={t("session.conversation_history_search_prev")}
            aria-label={t("session.conversation_history_search_prev")}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-dls-secondary hover:text-dls-text"
            disabled={!historyMatchCount}
            onClick={() =>
              setHistoryActiveMatch((i) =>
                historyMatchCount ? (i + 1) % historyMatchCount : 0,
              )
            }
            title={t("session.conversation_history_search_next")}
            aria-label={t("session.conversation_history_search_next")}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-dls-secondary hover:text-dls-text"
            onClick={closeHistorySearch}
            title={t("session.conversation_history_search_clear")}
            aria-label={t("session.conversation_history_search_clear")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            openHistorySearch(event);
          }}
          title={t("session.conversation_history_search_tooltip", {
            shortcut: historySearchShortcut,
          })}
          aria-label={t("session.conversation_history_search_tooltip", {
            shortcut: historySearchShortcut,
          })}
        >
          <Search className="size-3.5" />
        </Button>
      )}
      <ConversationHistoryPopover
        client={props.onmyagentServerClient}
        workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
        sessionId={props.selectedSessionId}
        onSelectPrompt={handleHistorySelectPrompt}
      />
    </>
  );
  const headerPanelControls = !sidePanelOpen ? (
    <div className="flex items-center gap-1 text-dls-secondary mac:titlebar-no-drag">
      {historyChrome}
      <Button
        data-code-side-panel-toggle="true"
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          openAssistantSidePanelMenu();
        }}
        title={t("session.code_side_panel_toggle")}
        aria-label={t("session.code_side_panel_toggle")}
        aria-expanded={sidePanelOpen}
      >
        <PanelRight className="size-3.5" />
      </Button>
    </div>
  ) : (
    <div className="flex items-center gap-1 text-dls-secondary mac:titlebar-no-drag">
      {historyChrome}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 mac:pointer-events-auto mac:titlebar-drag" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-dls-background mac:bg-dls-background">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <OnMyAgentRail
            activeView={railActiveView}
            account={props.account}
            onOpenView={(view) => {
              if (view === "chat") {
                props.onNavigateToMode("expert");
                return;
              }
              // Returning to 助理 must NOT force a new task — restore last selection.
              writeRailView("assistant", props.selectedWorkspaceId, view);
              if (view === "assistant") {
                setAgentPanelCollapsed(false);
                openAssistantSessionView();
                return;
              }
              setActiveSidebarView(view);
            }}
            onOpenAccountSettings={props.onOpenAccountSettings}
            onSignOut={props.onSignOut}
            onOpenDevices={() => {
              writeRailView("assistant", props.selectedWorkspaceId, "devices");
              setActiveSidebarView("devices");
            }}
            onOpenBilling={() => {
              writeRailView("assistant", props.selectedWorkspaceId, "billing");
              setActiveSidebarView("billing");
            }}
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
                sidePanelVisible ? commitBrowserPanelWidth : undefined
              }
              className="min-h-0 flex-1"
            >
              <ResizablePanel minSize="360px" className="min-w-0">
                <main className={cn(
                  "flex h-full min-w-0 flex-col overflow-hidden bg-dls-background",
                  sidePanelVisible ? "border-r-0" : "border-r border-dls-border",
                )}>
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="relative min-w-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background">
                      <KeepAlivePane
                        active={activeSidebarView === "store"}
                        mounted={visitedRailViews.has("store")}
                      >
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          activeTab={storeActiveTab}
                          myExperts={myExpertPackages}
                          onActiveTabChange={setStoreActiveTab}
                          onSummonMarketplaceExpert={handleSummonMarketplaceExpert}
                          onCreateExpert={handleCreateExpert}
                        />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "localAgent"}
                        mounted={visitedRailViews.has("localAgent")}
                      >
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
                            writeRailView(
                              "assistant",
                              props.selectedWorkspaceId,
                              "agentManagement",
                            );
                            setActiveSidebarView("agentManagement");
                          }}
                        />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "agentManagement"}
                        mounted={visitedRailViews.has("agentManagement")}
                      >
                        <AgentManagementPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          intent={agentManagementPageIntent}
                          sessionArchiveSlot={(
                            <SessionArchivePage
                              client={props.onmyagentServerClient}
                              workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                              onResume={(request) => {
                                setPendingArchiveResume(request);
                                writeRailView(
                                  "assistant",
                                  props.selectedWorkspaceId,
                                  "localAgent",
                                );
                                setActiveSidebarView("localAgent");
                              }}
                            />
                          )}
                        />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "files"}
                        mounted={visitedRailViews.has("files")}
                      >
                        <WorkspaceFilesPage
                          client={props.onmyagentServerClient}
                          workspaceId={
                            props.runtimeWorkspaceId ??
                            props.selectedWorkspaceId
                          }
                          workspaceRoot={props.selectedWorkspaceRoot}
                          onOpenArtifact={openTarget}
                        />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "projects"}
                        mounted={visitedRailViews.has("projects")}
                      >
                        <ProjectsComingSoonPage />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "devices"}
                        mounted={visitedRailViews.has("devices")}
                      >
                        <DevicesPage />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "channels"}
                        mounted={visitedRailViews.has("channels")}
                      >
                        <MessagingChannelsPage workspaceRoot={props.selectedWorkspaceRoot} />
                      </KeepAlivePane>

                      <KeepAlivePane
                        active={activeSidebarView === "billing"}
                        mounted={visitedRailViews.has("billing")}
                      >
                        <BillingPage />
                      </KeepAlivePane>

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

                      {isPrimarySessionView &&
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

                      {canRenderReactSurface ? (
                        <KeepAlivePane
                          active={
                            isPrimarySessionView && !showDelayedSessionLoadingState
                          }
                          mounted
                        >
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
                            onOpenSkillsMarketplace={() => {
                              setStoreActiveTab("skills");
                              setActiveSidebarView("store");
                            }}
                          />
                        </KeepAlivePane>
                      ) : null}

                      {isPrimarySessionView &&
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
                    className="min-h-0 overflow-hidden bg-dls-surface lg:flex lg:flex-col"
                  >
                    {activeSidePanel === "canvas" ? (
                      <InfiniteCanvasPanel
                        canvasKey={canvasSessionKey}
                        onClose={closeRightPane}
                      />
                    ) : activeSidePanel === "extensions" && props.settingsSlot ? (
                      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-dls-background">
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
          title={t("session.delete_task_title")}
          message={
            sessionActionTitle.trim()
              ? t("session.delete_named_task_message", {
                  title: sessionActionTitle.trim(),
                })
              : t("session.delete_task_generic")
          }
          confirmLabel={
            deleteBusy ? t("session.deleting") : t("session.delete_task")
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
