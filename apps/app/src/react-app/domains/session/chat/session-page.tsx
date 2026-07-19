/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import {
  Bot,
  ClipboardCheck,
  Expand,
  Folder,
  Globe,
  Heart,
  KanbanSquare,
  PanelLeft,
  PanelRight,
  Plus,
  RectangleHorizontal,
  Search,
  SlidersHorizontal,
  SquareTerminal,
  Zap,
} from "lucide-react";

import { t } from "../../../../i18n";
import { ONMYAGENT_EXTENSION_CATALOG } from "../../../../app/constants";
import {
  type OnMyAgentServerClient,
  type OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type {
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import type { ShareWorkspaceModalProps } from "../../workspace";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import {
  ProviderAuthModal,
  type ProviderAuthModalProps,
} from "../../connections";
import { RenameSessionModal } from "../modals/rename-session-modal";
import {
  type SidebarAccountInfo,
  type SidebarPrimaryView,
} from "../sidebar/app-sidebar";
import {
  SessionSurface,
  type SessionSurfaceProps,
} from "../surface/session-surface";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ShareWorkspaceModal } from "../../workspace";
import type { StatusBarProps } from "../components/status-bar";
import { OwDotTicker, type SidePanelItem, useReactRenderWatchdog, useUiStateStore } from "../../../shell";
import type { AgentCardItem, AgentRegistry } from "../../agents";
import {
  buildAgentToolAccess,
  buildAgentSystemPrompt,
  usePendingAgentStore,
} from "../../agents";
import { buildPendingAgentFromRecord } from "../../agents";
import {
  readCustomAgentIdForSession,
  useAgentRegistryStore,
} from "../../agents";
import {
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
} from "../../agents";

import { isElectronRuntime } from "../../../../app/utils";
import { BrowserPanel } from "../browser/browser-panel";
import { ArtifactPanel } from "../artifacts/artifact-panel";
import type { OpenTarget } from "../artifacts/open-target";
import {
  useOpenFirstSessionOnChatView,
  useSessionPageAgentPanel,
} from "./session-page-agent-panel";
import { AgentConversationPanel } from "./session-page-agent-conversation-panel";
import { BillingPage } from "./session-page-billing-page";
import { DevicesPage } from "./session-page-devices-page";
import { SidebarFeaturePlaceholder } from "./session-page-feature-placeholder";
import { EmptyArtifactsPanel, ProjectsComingSoonPage } from "./session-page-light-pages";
import {
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  STARTUP_SKELETON_ROWS,
  sessionTitleForId,
  type TaskStatusIndicator,
} from "./session-page-model";
import { OnMyAgentRail } from "./session-page-rail";
import { useSessionPageSessionActions } from "./session-page-session-actions";
import { useSessionPageSidePanel } from "./session-page-side-panel";
import {
  buildSessionPageViewModel,
  useDelayedSessionLoadingState,
} from "./session-page-view-model";
import { MessagingChannelsPage } from "../../messaging";
import { WorkspaceFilesPage } from "../../workspace";
import { StorePage, type StorePrimaryTab } from "../components/side-panel-pages";
import { VoicePanel } from "../voice/voice-panel";
import { useSessionPageVoiceControls } from "./session-page-voice-controls";
import {
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  ONMYAGENT_EXTENSION_STATE_CHANGED,
} from "../../shared";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { PersonalLocalAgentPage } from "../../local-agents";

import type { AssistantCategoryId } from "../surface/personal-assistant-config";

const messagingTextClass = {
  pageTitle: "text-xl font-medium text-dls-text",
  panelTitle: "text-base font-medium text-dls-text",
};

type CodeRailPanelId = "review" | "terminal" | "browser" | "artifacts";

const codeRailItems: Array<{
  id: CodeRailPanelId;
  labelKey: string;
  icon: typeof ClipboardCheck;
}> = [
  { id: "review", labelKey: "session.code_side_panel_review", icon: ClipboardCheck },
  { id: "terminal", labelKey: "session.code_side_panel_terminal", icon: SquareTerminal },
  { id: "browser", labelKey: "session.code_side_panel_browser", icon: Globe },
  { id: "artifacts", labelKey: "session.code_side_panel_files", icon: Folder },
];

const codeRailShortcutById: Record<CodeRailPanelId, string> = {
  review: "⌃⇧G",
  terminal: "",
  browser: "⌘T",
  artifacts: "⌘P",
};

function CodeSidePanelMenu(props: {
  activePanel: SidePanelItem | null;
  onClose: () => void;
  onSelect: (id: CodeRailPanelId) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background" data-code-side-panel-menu="true">
      <header
        data-panel-titlebar="true"
        className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-dls-mist px-3 text-dls-secondary mac:titlebar-drag"
      >
        <Button type="button" variant="ghost" size="icon-xs" className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text" aria-label={t("session.code_side_panel_expand")} title={t("session.code_side_panel_expand")}>
          <Expand className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text" aria-label={t("session.code_side_panel_minimize")} title={t("session.code_side_panel_minimize")}>
          <RectangleHorizontal className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" data-code-side-panel-close="true" className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text" onClick={props.onClose} aria-label={t("session.code_side_panel_close")} title={t("session.code_side_panel_close")}>
          <PanelRight className="size-3.5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="w-full max-w-[520px] space-y-2">
          {codeRailItems.map((item) => {
            const Icon = item.icon;
            const selected = props.activePanel === item.id;
            const shortcut = codeRailShortcutById[item.id];
            return (
              <button
                key={item.id}
                type="button"
                data-code-side-panel-menu-item={item.id}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-3 text-left text-sm text-dls-text transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                  selected && "bg-dls-hover text-dls-text",
                )}
                onClick={() => props.onSelect(item.id)}
                aria-pressed={selected}
              >
                <Icon className="size-4 text-dls-secondary" />
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                {shortcut ? (
                  <kbd
                    className="inline-flex items-center rounded-sm border border-dls-border bg-dls-surface-muted px-1 py-0.5 text-xs leading-none text-dls-secondary"
                  >
                    {shortcut}
                  </kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CodeSidePanelPlaceholder(props: {
  icon: typeof ClipboardCheck;
  title: string;
  description: string;
  onClose: () => void;
}) {
  const Icon = props.icon;
  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <header
        data-panel-titlebar="true"
        className="flex h-12 shrink-0 items-center justify-between border-b border-dls-mist px-4 mac:titlebar-drag"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-dls-text">
          <Icon className="size-4 text-dls-secondary" />
          {props.title}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-dls-secondary hover:text-dls-text"
          onClick={props.onClose}
          aria-label={t("session.code_side_panel_close")}
          title={t("common.close")}
        >
          <PanelRight className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <div className="max-w-xs space-y-3 text-dls-secondary">
          <Icon className="mx-auto size-8 opacity-45" />
          <div className="text-sm font-medium text-dls-text">{props.title}</div>
          <p className="text-sm leading-6">{props.description}</p>
        </div>
      </div>
    </div>
  );
}

type StatusBarOverrides = Pick<
  StatusBarProps,
  "loading" | "showSettingsButton" | "settingsOpen"
>;

export type SessionPageHistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  busyAction: "undo" | "redo" | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
};

export type SessionPageSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  sessionStatusById: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  sidebarHydratedFromCache: boolean;
  startupPhase: BootPhase;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onCreateTaskWithPrompt?: (workspaceId: string, prompt: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (
    workspaceId: string,
  ) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (
    workspaceId: string,
  ) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void;
};

export type SessionPageSurfaceProps = Omit<
  SessionSurfaceProps,
  "client" | "workspaceId" | "sessionId" | "opencodeBaseUrl" | "onmyagentToken"
>;

export type SessionPageProps = {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceDisplay: {
    id?: string;
    name?: string;
    displayName?: string;
    workspaceType?: WorkspaceInfo["workspaceType"];
  };
  selectedWorkspaceRoot: string;
  selectedSessionFileRoot?: string | null;
  selectedWorkspaceError?: string | null;
  runtimeWorkspaceId: string | null;
  /**
   * Pre-built OpenCode SDK base URL for the selected workspace's owning
   * server. The parent route resolves this through `resolveWorkspaceEndpoint`
   * so we never compose `<baseUrl>/workspace/<id>/opencode` here.
   */
  opencodeBaseUrl?: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerClient: OnMyAgentServerClient | null;
  onmyagentServerToken?: string | null;
  developerMode: boolean;
  headerStatus: string;
  busyHint: string | null;
  startupPhase: BootPhase;
  providerConnectedIds: string[];
  providers?: ProviderListItem[];
  mcpConnectedCount: number;
  onSendFeedback: () => void;
  /** Open settings; optional route like `/settings/usage`. */
  onOpenSettings: (route?: string) => void;
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  history?: SessionPageHistoryControls | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  shareWorkspaceModal?: ShareWorkspaceModalProps | null;
  providerAuthModal?: ProviderAuthModalProps | null;
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => void;
  autoApprovedPermissionNoticeId?: string | null;
  safeStringify?: (value: unknown) => string;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  statusBar?: Partial<StatusBarOverrides>;
  notFoundMessage?: string | null;
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
  account?: SidebarAccountInfo | null;
  onOpenAccountSettings?: () => void;
  onSignOut?: () => void;
  renderAgentsPage: (props: {
    workspaceId: string;
    workspaceRoot: string;
    client: OnMyAgentServerClient | null;
    providers?: ProviderListItem[];
    connectedProviderIds?: string[];
    initialEditingAgentId?: string | null;
    editRequestKey?: number;
    dialogOnly?: boolean;
    onStartConversation?: (item: AgentCardItem, registry: AgentRegistry) => void;
  }) => React.ReactNode;
  /** Settings content rendered inside the right pane when the settings rail icon is active. */
  settingsSlot?: React.ReactNode;
};

export function SessionPage(props: SessionPageProps) {
  const localAuthUser = useMemo(() => readLocalAuthUser(), []);
  const [activeAssistantCategoryId, setActiveAssistantCategoryId] =
    useState<AssistantCategoryId>("office");
  const [storeActiveTab, setStoreActiveTab] =
    useState<StorePrimaryTab>("skills");
  const agentRegistry = useAgentRegistryStore((state) => state.registry);
  const agentPanel = useSessionPageAgentPanel(props.selectedSessionId);
  const sidePanelScopeId =
    agentPanel.activeSidebarView === "localAgent"
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
  const [, setExtensionStateVersion] = useState(0);
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
  useReactRenderWatchdog("SessionPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  useOpenFirstSessionOnChatView({
    isChatView: agentPanel.isChatView,
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.sidebar.selectedWorkspaceId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onOpenSession: props.sidebar.onOpenSession,
  });

  const sessionActions = useSessionPageSessionActions({
    selectedSessionId: props.selectedSessionId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onRenameSession: props.onRenameSession,
    onDeleteSession: props.onDeleteSession,
  });
  const browserPanelRef = usePanelRef();

  const resolveConversationDisplay = useCallback(
    (session: WorkspaceSessionGroup["sessions"][number]) => {
      const fallbackTitle = sessionTitleForId(
        props.sidebar.workspaceSessionGroups,
        session.id,
      ) || t("session.default_title");
      const agentId = readCustomAgentIdForSession(session.id);
      const agent =
        agentRegistry && agentId
          ? (agentRegistry.agents.find((item) => item.id === agentId) ??
            agentRegistry.templates.find((item) => item.id === agentId))
          : null;
      const restoredAgent =
        agent && agentRegistry
          ? buildPendingAgentFromRecord(agent, agentRegistry)
          : null;
      return {
        name: restoredAgent?.name ?? fallbackTitle,
        avatarUrl: restoredAgent?.avatar.avatarUrl,
        avatarBackground: restoredAgent?.avatar.avatarBackground,
      };
    },
    [agentRegistry, props.sidebar.workspaceSessionGroups],
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

      // Prefer the SDK IDs saved at wizard time when they describe an
      // actual SDK model. Filter out the wizard's "自动" placeholder — it's
      // not a real SDK provider/model, and we want the chat surface to
      // fall back to the user's global default model in that case.
      const modelRef = isValidSdkModelRef(
        source.sdkProviderID,
        source.sdkModelID,
      )
        ? { providerID: source.sdkProviderID!, modelID: source.sdkModelID! }
        : friendlyModelNameToModelRef(source.modelProvider, source.model);

      const pending = {
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
        // Fresh conversation start — always a new nonce, even if the user
        // clicks "对话" on the same agent card multiple times.
        conversationStartId: Date.now(),
      };
      // If the user is already inside a session, navigate to the "+新任务"
      // (no-session) state so SessionSurface renders the agent welcome card
      // with the composer beneath it. `onCreateTaskInWorkspace` clears the
      // pending agent store as a side effect, so we set the agent AFTER
      // calling it to make sure our payload wins.
      if (props.selectedSessionId) {
        props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
      }
      usePendingAgentStore.getState().setAgent(pending);
      agentPanel.openChatView();
    },
    [props.selectedSessionId, props.sidebar, props.selectedWorkspaceId],
  );

  const {
    activeSidePanel,
    sidePanelOpen,
    browserRailActive,
    artifactRailActive,
    reviewRailActive,
    terminalRailActive,
    codeMenuRailActive,
    visibleArtifactTarget,
    artifactFileTargets,
    artifactTargetCount,
    hasArtifactTargets,
    browserPanelDefaultWidth,
    commitBrowserPanelWidth,
    setCurrentSidePanel,
    openTarget,
    handleOpenTargetsChange,
    closeRightPane,
    openBrowserRailPane,
    openArtifactRailPane,
    openReviewRailPane,
    openTerminalRailPane,
    openCodeMenuRailPane,
  } = useSessionPageSidePanel({
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: sidePanelScopeId,
    sessionSidePanel,
    voiceSidePanelOpen,
    voiceExtensionEnabled,
    browserPanelRef,
    setSidePanelState,
    toggleSidePanelState,
    onAccessibleTargetsChange: props.onAccessibleTargetsChange,
  });

  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ONMYAGENT_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useSessionPageVoiceControls({
    activeSidePanel,
    setCurrentSidePanel,
    voiceExtensionEnabled,
  });
  const sessionActionTitle = sessionActions.sessionActionTitle;
  const pageView = useMemo(
    () =>
      buildSessionPageViewModel({
        activeSidebarView: agentPanel.activeSidebarView,
        clientConnected: props.clientConnected,
        onmyagentServerClient: props.onmyagentServerClient,
        onmyagentServerStatus: props.onmyagentServerStatus,
        onmyagentServerToken: props.onmyagentServerToken,
        opencodeBaseUrl: props.opencodeBaseUrl,
        runtimeWorkspaceId: props.runtimeWorkspaceId,
        selectedSessionId: props.selectedSessionId,
        selectedWorkspaceDisplay: props.selectedWorkspaceDisplay,
        selectedWorkspaceError: props.selectedWorkspaceError,
        selectedWorkspaceId: props.selectedWorkspaceId,
        sessionLoadingById: props.sessionLoadingById,
        sidebar: props.sidebar,
        startupPhase: props.startupPhase,
        statusBarLoading: props.statusBar?.loading,
        surface: props.surface,
        workspaceCount: props.workspaces.length,
      }),
    [
      agentPanel.activeSidebarView,
      props.clientConnected,
      props.onmyagentServerClient,
      props.onmyagentServerStatus,
      props.onmyagentServerToken,
      props.opencodeBaseUrl,
      props.runtimeWorkspaceId,
      props.selectedSessionId,
      props.selectedWorkspaceDisplay,
      props.selectedWorkspaceError,
      props.selectedWorkspaceId,
      props.sessionLoadingById,
      props.sidebar,
      props.startupPhase,
      props.statusBar?.loading,
      props.surface,
      props.workspaces.length,
    ],
  );

  const showDelayedSessionLoadingState = useDelayedSessionLoadingState(
    pageView.showSessionLoadingState,
  );

  const showCodeSideRail = pageView.isSessionSurfaceView && activeAssistantCategoryId === "code";
  const openCodeSidePanelMenu = useCallback(() => {
    openCodeMenuRailPane();
  }, [openCodeMenuRailPane]);

  const headerPanelControls = (
    <div className="flex items-center gap-1 text-dls-secondary mac:titlebar-no-drag">
      {showCodeSideRail ? (
        !sidePanelOpen ? (
            <Button
              data-code-side-panel-toggle="true"
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                openCodeSidePanelMenu();
              }}
              title={t("session.code_side_panel_toggle")}
              aria-label={t("session.code_side_panel_toggle")}
              aria-pressed={sidePanelOpen || codeMenuRailActive}
            >
              <PanelRight className="size-3.5" />
            </Button>
          ) : null
        ) : (
            <>
              {isElectronRuntime() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "transition-colors hover:bg-dls-surface-muted hover:text-dls-text",
                    browserRailActive &&
                      "bg-dls-decision-soft text-dls-primary hover:bg-dls-decision-soft hover:text-dls-primary",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openBrowserRailPane}
                  title="Browser"
                  aria-label="Browser"
                  aria-pressed={browserRailActive}
                >
                  <Globe size={16} />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "relative transition-colors hover:bg-dls-surface-muted hover:text-dls-text",
                  artifactRailActive &&
                    "bg-dls-decision-soft text-dls-primary hover:bg-dls-decision-soft hover:text-dls-primary",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openArtifactRailPane}
                title={hasArtifactTargets ? `Artifacts (${artifactTargetCount})` : "No artifacts yet"}
                aria-label={hasArtifactTargets ? `Artifacts (${artifactTargetCount})` : "No artifacts yet"}
                aria-pressed={artifactRailActive}
              >
                <PanelRight size={16} />
                {artifactTargetCount > 0 ? (
                  <CountBadge size="dot" className="absolute right-0 top-0 translate-x-1 -translate-y-1 bg-primary text-primary-foreground">
                    {artifactTargetCount > 9 ? "9+" : artifactTargetCount}
                  </CountBadge>
                ) : null}
              </Button>
            </>
          )}
    </div>
  );
  const canShowRightSidePanel =
    pageView.isSessionSurfaceView || pageView.isLocalAgentView;
  const railActiveView =
    agentPanel.activeSidebarView === "scheduledTasks"
      ? "personalAssistant"
      : agentPanel.activeSidebarView;

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-dls-background mac:bg-dls-background">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <OnMyAgentRail
            activeView={railActiveView}
            account={props.account}
            onOpenView={agentPanel.openSidebarView}
            onOpenAccountSettings={props.onOpenAccountSettings}
            onSignOut={props.onSignOut}
            onOpenDevices={agentPanel.openDevicesView}
            onOpenBilling={agentPanel.openBillingView}
          />
          <div className="relative flex min-h-0 flex-1 overflow-hidden mac:titlebar-no-drag">
            {agentPanel.activeSidebarView === "chat" && !agentPanel.agentPanelCollapsed ? (
              <AgentConversationPanel
                width={agentPanel.agentPanelWidth}
                client={props.onmyagentServerClient}
                taskStatusVariant={pageView.taskStatus.variant}
                collapsed={agentPanel.agentPanelCollapsed}
                groups={props.sidebar.workspaceSessionGroups}
                selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
                selectedSessionId={props.sidebar.selectedSessionId}
                sessionStatusById={props.sidebar.sessionStatusById}
                query={agentPanel.agentSearch}
                disabledNewTask={props.sidebar.newTaskDisabled}
                onQueryChange={agentPanel.setAgentSearch}
                onToggleCollapsed={agentPanel.toggleAgentPanelCollapsed}
                onOpenAgents={agentPanel.openAgentsDialog}
                onOpenSession={(workspaceId, sessionId) => {
                  agentPanel.openChatView();
                  props.sidebar.onOpenSession(workspaceId, sessionId);
                }}
                onPrefetchSession={props.sidebar.onPrefetchSession}
                resolveSessionDisplay={resolveConversationDisplay}
              />
            ) : null}
            {agentPanel.activeSidebarView === "chat" && agentPanel.agentPanelCollapsed ? (
              <div className="flex w-10 shrink-0 bg-dls-surface px-2 pb-5 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={agentPanel.expandAgentPanel}
                  title={t("session.expand_session_list")}
                  aria-label={t("session.expand_session_list")}
                >
                  <PanelLeft className="size-3.5" />
                </Button>
              </div>
            ) : null}
            {agentPanel.activeSidebarView === "chat" && !agentPanel.agentPanelCollapsed ? (
              <div
                role="separator"
                aria-label={t("session.resize_agent_list")}
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={agentPanel.startAgentPanelResize}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    agentPanel.resizeAgentPanelBy(
                      event.key === "ArrowLeft" ? -16 : 16,
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
                <main className="flex h-full min-w-0 flex-col overflow-hidden border-r border-dls-border bg-dls-background">
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="relative min-w-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background">
                      {agentPanel.activeSidebarView === "agents" ? (
                        <props.renderAgentsPage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          providers={props.providers}
                          connectedProviderIds={props.providerConnectedIds}
                          onStartConversation={handleStartAgentConversation}
                        />
                      ) : null}

                      {agentPanel.activeSidebarView === "localAgent" ? (
                        <PersonalLocalAgentPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          workspaceName={props.selectedWorkspaceDisplay.name}
                          onOpenArtifact={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                          onmyagentServerClient={props.onmyagentServerClient}
                          runtimeWorkspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                        />
                      ) : null}

                      {agentPanel.activeSidebarView === "store" ? (
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          activeTab={storeActiveTab}
                          onActiveTabChange={setStoreActiveTab}
                        />
                      ) : null}

                      {agentPanel.activeSidebarView === "files" ? (
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

                      {agentPanel.activeSidebarView === "projects" ? (
                        <ProjectsComingSoonPage />
                      ) : null}

                      {agentPanel.activeSidebarView === "devices" ? <DevicesPage /> : null}

                      {agentPanel.activeSidebarView === "channels" ? (
                        <MessagingChannelsPage workspaceRoot={props.selectedWorkspaceRoot} />
                      ) : null}

                      {agentPanel.activeSidebarView === "billing" ? <BillingPage /> : null}

                      {pageView.activePlaceholderView &&
                      agentPanel.activeSidebarView !== "agents" &&
                      agentPanel.activeSidebarView !== "files" &&
                      agentPanel.activeSidebarView !== "store" &&
                      agentPanel.activeSidebarView !== "projects" &&
                      agentPanel.activeSidebarView !== "localAgent" &&
                      agentPanel.activeSidebarView !== "devices" &&
                      agentPanel.activeSidebarView !== "channels" &&
                      agentPanel.activeSidebarView !== "billing" ? (
                        <SidebarFeaturePlaceholder
                          view={pageView.activePlaceholderView}
                        />
                      ) : null}

                      {pageView.isSessionSurfaceView &&
                      !pageView.activePlaceholderView &&
                      pageView.showStartupSkeleton ? (
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

                      {pageView.isSessionSurfaceView &&
                      !pageView.activePlaceholderView &&
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

                      {pageView.isSessionSurfaceView &&
                      !pageView.activePlaceholderView &&
                      !showDelayedSessionLoadingState &&
                      pageView.canRenderReactSurface ? (
                        <SessionSurface
                          key={pageView.renderedSessionId}
                          // Spread `surface` first so the explicit per-workspace
                          // routing props below CAN'T be silently overridden by
                          // anything that leaks into `surface`. SessionSurface's
                          // server target (client/workspaceId/sessionId/opencodeBaseUrl/onmyagentToken)
                          // must come from the resolved workspace endpoint passed by
                          // SessionRoute, not from anything in `surface`.
                          {...props.surface!}
                          client={props.onmyagentServerClient!}
                          workspaceId={props.runtimeWorkspaceId!}
                          sessionId={pageView.renderedSessionId}
                          draftOnly={pageView.isDraftSession}
                          opencodeBaseUrl={pageView.reactSessionBaseUrl}
                          onmyagentToken={pageView.reactSessionToken}
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
                              t("session.user_initial"),
                          }}
                          onPersonalAssistantCategoryActive={setActiveAssistantCategoryId}
                          onOpenAgentSettings={agentPanel.openAgentsDialog}
                          headerActions={headerPanelControls}
                          onOpenTarget={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                          onOpenSkillsMarketplace={() => {
                            setStoreActiveTab("skills");
                            agentPanel.openSidebarView("store");
                          }}
                        />
                      ) : null}

                      {pageView.isSessionSurfaceView &&
                      !pageView.activePlaceholderView &&
                      !showDelayedSessionLoadingState &&
                      !pageView.canRenderReactSurface &&
                      !pageView.showStartupSkeleton ? (
                        <div
                          className={`mx-auto max-w-[800px] px-6 ${pageView.showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}
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
                          ) : pageView.showWorkspaceSetupEmptyState ? (
                            <div className="space-y-6 px-6 text-center">
                              <IconTile size="2xl" shape="xl" border className="mx-auto rounded-xl">
                                <Zap className="text-dls-secondary" />
                              </IconTile>
                              <div className="space-y-2">
                                <h3 className={messagingTextClass.pageTitle}>
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
                          ) : pageView.showSelectedWorkspaceError ? (
                            <div className="px-6 py-16">
                              <NoticeBox className="mx-auto max-w-lg text-left" size="comfortable" tone="error">
                                <div className="font-medium">
                                  {pageView.selectedWorkspaceErrorTitle}
                                </div>
                                <p className="mt-2 whitespace-pre-wrap wrap-anywhere leading-6">
                                  {pageView.selectedWorkspaceErrorMessage}
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
                          ) : (
                            <div className="flex flex-1 items-center justify-center px-6 py-16">
                              <div className="w-full max-w-md space-y-6">
                                <div className="space-y-1 text-center">
                                  <h2 className={messagingTextClass.panelTitle}>
                                    {t("session.select_or_create_session")}
                                  </h2>
                                  <p className="text-xs text-dls-secondary">
                                    {t("session.empty_try_starters")}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <ActionRowButton
                                    type="button"

                                    onClick={() => {
                                      props.sidebar.onCreateTaskWithPrompt?.(
                                        props.selectedWorkspaceId,
                                        "Create a sample CSV file with 20 rows of fake customer data (name, email, company, revenue). Then show me a summary of the data.",
                                      );
                                    }}
                                  >
                                    <img
                                      src="https://cdn.simpleicons.org/googlesheets"
                                      alt=""
                                      width={20}
                                      height={20}
                                      className="mt-0.5 shrink-0"
                                    />
                                    <div>
                                      <div className="text-sm font-medium text-dls-text">
                                        {t("session.starter_csv_title")}
                                      </div>
                                      <div className="mt-0.5 text-xs text-dls-secondary">
                                        {t("session.starter_csv_desc")}
                                      </div>
                                    </div>
                                  </ActionRowButton>
                                  <ActionRowButton
                                    type="button"

                                    onClick={() => {
                                      props.sidebar.onCreateTaskWithPrompt?.(
                                        props.selectedWorkspaceId,
                                        "Open craigslist.org in the browser and search for couches for sale. Show me the top 5 results with prices.",
                                      );
                                    }}
                                  >
                                    <img
                                      src={resolvePublicAssetUrl(
                                        "/on-my-agent-logo.png",
                                      )}
                                      alt=""
                                      width={20}
                                      height={20}
                                      className="mt-0.5 shrink-0"
                                    />
                                    <div>
                                      <div className="text-sm font-medium text-dls-text">
                                        {t("session.starter_browser_title")}
                                      </div>
                                      <div className="mt-0.5 text-xs text-dls-secondary">
                                        {t("session.starter_browser_desc")}
                                      </div>
                                    </div>
                                  </ActionRowButton>
                                  <ActionRowButton
                                    type="button"

                                    onClick={() => {
                                      props.onOpenSettings?.();
                                    }}
                                  >
                                    <img
                                      src="https://cdn.simpleicons.org/hackthebox"
                                      alt=""
                                      width={20}
                                      height={20}
                                      className="mt-0.5 shrink-0"
                                    />
                                    <div>
                                      <div className="text-sm font-medium text-dls-text">
                                        {t("session.starter_extension_title")}
                                      </div>
                                      <div className="mt-0.5 text-xs text-dls-secondary">
                                        {t("session.starter_extension_desc")}
                                      </div>
                                    </div>
                                  </ActionRowButton>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </main>
              </ResizablePanel>
              {canShowRightSidePanel && sidePanelOpen ? (
                <>
                  <ResizableHandle withHandle className="hidden lg:flex" />
                  <ResizablePanel
                    panelRef={browserPanelRef}
                    defaultSize={`${activeAssistantCategoryId === "code" ? Math.max(browserPanelDefaultWidth, 560) : activeSidePanel === "extensions" ? Math.max(browserPanelDefaultWidth, 480) : browserPanelDefaultWidth}px`}
                    minSize={
                      activeAssistantCategoryId === "code" ? "560px" : activeSidePanel === "extensions" ? "420px" : "320px"
                    }
                    maxSize="70%"
                    className="min-h-0 overflow-hidden bg-dls-surface lg:flex lg:flex-col"
                  >
                    {activeSidePanel === "codeMenu" ? (
                      <CodeSidePanelMenu
                        activePanel={activeSidePanel}
                        onClose={closeRightPane}
                        onSelect={(id) => {
                          if (id === "review") {
                            openReviewRailPane();
                            return;
                          }
                          if (id === "terminal") {
                            openTerminalRailPane();
                            return;
                          }
                          if (id === "browser") {
                            openBrowserRailPane();
                            return;
                          }
                          if (id === "artifacts") {
                            openArtifactRailPane();
                          }
                        }}
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
                    ) : activeSidePanel === "artifacts" &&
                      visibleArtifactTarget &&
                      props.onmyagentServerClient &&
                      props.runtimeWorkspaceId ? (
                      <ArtifactPanel
                        client={props.onmyagentServerClient}
                        workspaceId={props.runtimeWorkspaceId}
                        workspaceRoot={props.selectedWorkspaceRoot}
                        isRemoteWorkspace={
                          props.surface?.isRemoteWorkspace ?? false
                        }
                        target={visibleArtifactTarget}
                        targets={artifactFileTargets}
                        onSelectTarget={openTarget}
                        onClose={closeRightPane}
                      />
                    ) : activeSidePanel === "artifacts" ? (
                      <EmptyArtifactsPanel onClose={closeRightPane} />
                    ) : activeSidePanel === "review" ? (
                      <CodeSidePanelPlaceholder
                        icon={ClipboardCheck}
                        title={t("session.code_side_panel_review")}
                        description={t("session.code_side_panel_review_desc")}
                        onClose={closeRightPane}
                      />
                    ) : activeSidePanel === "terminal" ? (
                      <CodeSidePanelPlaceholder
                        icon={SquareTerminal}
                        title={t("session.code_side_panel_terminal")}
                        description={t("session.code_side_panel_terminal_desc")}
                        onClose={closeRightPane}
                      />
                    ) : (
                      <BrowserPanel
                        sessionId={props.selectedSessionId}
                        onClose={closeRightPane}
                      />
                    )}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          </div>
        </div>
      </div>

      <Dialog open={agentPanel.agentsDialogOpen} onOpenChange={agentPanel.setAgentsDialogOpen}>
        <DialogContent className="flex h-[min(820px,calc(100vh-72px))] !w-[min(1280px,calc(100vw-96px))] !max-w-[min(1280px,calc(100vw-96px))] flex-col overflow-hidden rounded-xl bg-dls-background p-0 sm:!max-w-[min(1280px,calc(100vw-96px))]">
          <props.renderAgentsPage
            workspaceId={props.selectedWorkspaceId}
            workspaceRoot={props.selectedWorkspaceRoot}
            client={props.onmyagentServerClient}
            providers={props.providers}
            connectedProviderIds={props.providerConnectedIds}
            onStartConversation={(item, registry) => {
              handleStartAgentConversation(item, registry);
              agentPanel.closeAgentsDialog();
            }}
          />
        </DialogContent>
      </Dialog>

      {props.providerAuthModal ? (
        <ProviderAuthModal {...props.providerAuthModal} />
      ) : null}

      {props.onRenameSession ? (
        <RenameSessionModal
          open={sessionActions.renameOpen}
          title={sessionActions.renameTitle}
          busy={sessionActions.renameBusy}
          canSave={sessionActions.canSaveRename}
          onClose={sessionActions.closeRenameModal}
          onSave={() => void sessionActions.submitRename()}
          onTitleChange={sessionActions.setRenameTitle}
        />
      ) : null}

      {props.onDeleteSession ? (
        <ConfirmModal
          open={sessionActions.deleteOpen}
          title={t("session.delete_session_title")}
          message={
            sessionActionTitle.trim()
              ? t("session.delete_named_session_message", {
                  title: sessionActionTitle.trim(),
                })
              : t("session.delete_session_generic")
          }
          confirmLabel={
            sessionActions.deleteBusy ? t("session.deleting") : t("session.delete")
          }
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => void sessionActions.confirmDelete()}
          onCancel={sessionActions.closeDeleteModal}
        />
      ) : null}

      {props.shareWorkspaceModal ? (
        <ShareWorkspaceModal {...props.shareWorkspaceModal} />
      ) : null}

      {/* Cloud provider notifications are now handled globally by CloudProvidersToast in app-root.tsx */}
    </div>
  );
}
