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
import { ProviderAuthModal } from "../../connections";
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
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { SessionHistorySearchChrome } from "./session-history-search-chrome";
import { SessionArchivePage, type SessionArchiveResumeRequest } from "../chat/session-page-session-archive-page";
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
} from "./index";

import {
  addAssistantSession,
  usePendingAgentStore,
  writeAssistantSessionCategory,
} from "../../agents";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";

import { AgentManagementPage } from "../../local-agents";
import { AutomationPage, MessagingChannelsPage } from "../../messaging";
import { consumeAutomationFocus } from "../artifacts/automation-focus-memory";
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
  writeHiddenAccessibleTargetIds,
  workspaceTaskStatus,
  readAssistantSelectionMemory,
  resolveAssistantSelectionMemory,
  writeAssistantSelectionMemory,
  type OnMyAgentPrimaryView,
  type AssistantSelectionMemory,
} from "../sidebar/session-chrome";
import {
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
  SessionPageMainColumn,
  SessionRailKeepAliveStack,
} from "./session-page-shell";
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
  isVisibleExpertPackageEntry,
  packageEntryToMarketplaceExpert,
  isTrackableAccessibleTarget,
  setComposerDraftAfterNewTask,
} from "./shared-page-utils";
import { useCustomConnectorDialog } from "./use-custom-connector-dialog";
import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";

const ASSISTANT_SIDE_PANEL_DEFAULT_WIDTH = 360;
const ASSISTANT_SIDE_PANEL_MIN_WIDTH = 300;
const CREATE_EXPERT_SKILL_NAME = "expert-manager";

type AssistantGroupDeleteTarget = {
  kind: "automation";
  title: string;
  sessionIds: string[];
};

export function AssistantPage(props: AssistantPageProps) {
  const { showToast } = useStatusToasts();
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const sidePanelSessionKey =
    props.selectedSessionId ?? `assistant-draft:${props.selectedWorkspaceId}`;
  /** Browser tab scope: real session id, or workspace draft key on new task. */
  const browserSessionScopeId = sidePanelSessionKey;
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
  const {
    customConnectorOpen,
    setCustomConnectorOpen,
    customConnectorInitialView,
    openCustomConnector,
  } = useCustomConnectorDialog();
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

  const [focusAutomationId, setFocusAutomationId] = useState<string | null>(null);

  const openScheduledTasksView = useCallback(() => {
    writeRailView("assistant", props.selectedWorkspaceId, "scheduledTasks");
    setActiveSidebarView("scheduledTasks");
  }, [props.selectedWorkspaceId]);

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

  const prevSessionIdRef = useRef(props.selectedSessionId);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = props.selectedSessionId;
    if (props.selectedSessionId?.trim() && prev !== props.selectedSessionId) {
      setActiveSidebarView("assistant");
    }
  }, [props.selectedSessionId]);

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
    // Only auto-open for a real chat session — never for draft / new-task.
    if (!props.selectedSessionId) return;
    setCurrentSidePanel("browser");
  }, [props.selectedSessionId, setCurrentSidePanel]);
  useAutoOpenBrowserPanel(openBrowserPanelFromAgent, props.selectedSessionId);

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
      for (const sessionId of target.sessionIds) {
        permanentlyRemoveAssistantArchivedTask(
          props.selectedWorkspaceId,
          sessionId,
        );
        await props.onDeleteSession(sessionId);
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
  const showStartupSkeleton =
    !props.selectedSessionId &&
    !props.clientConnected &&
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready";
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
  /** Only paint SessionSurface on assistant/chat — hide under keep-alive secondary rails. */
  const isPrimarySessionView = isPrimarySessionRailView(activeSidebarView);
  // Workspace side panel only belongs on chat surfaces (not 市场/管理/本地/文件…).
  const sidePanelVisibleOnSession =
    sidePanelVisible && isPrimarySessionView;

  // Leaving 助理/专家 chat for other rail pages must close the workspace panel.
  useEffect(() => {
    if (isPrimarySessionView) return;
    setCurrentSidePanel(null);
  }, [isPrimarySessionView, setCurrentSidePanel]);

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
                            writeRailView(
                              "assistant",
                              props.selectedWorkspaceId,
                              "agentManagement",
                            );
                            setActiveSidebarView("agentManagement");
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
                      ),
                      files: (
                        <WorkspaceFilesPage
                          client={props.onmyagentServerClient}
                          workspaceId={
                            props.runtimeWorkspaceId ??
                            props.selectedWorkspaceId
                          }
                          workspaceRoot={props.selectedWorkspaceRoot}
                          onOpenArtifact={openTarget}
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
                            onOpenConnectorsMarketplace={() => {
                              setStoreActiveTab("plugins");
                              setActiveSidebarView("store");
                            }}
                            onOpenCustomConnector={() => openCustomConnector("config")}
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
                        fileRoot={props.selectedSessionFileRoot ?? ""}
                        fileTargets={artifactFileTargets}
                        workspaceId={props.runtimeWorkspaceId}
                        sessionId={browserSessionScopeId}
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
