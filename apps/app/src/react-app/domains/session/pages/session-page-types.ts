/** @jsxImportSource react */
/**
 * Session page prop types — leaf module so assistant/expert can import types
 * without cycling through the SessionPage composition barrel.
 */
import type {
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import type {
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import type { ShareWorkspaceModalProps } from "../../workspace";
import type { AgentCardItem, AgentRegistry } from "../../agents";
import type {
  SidebarAccountInfo,
  SidebarPrimaryView,
} from "../sidebar/app-sidebar-types";
import type {
  SessionSurfaceProps,
} from "../surface/session-surface";
import type { StatusBarProps } from "../components/status-bar";
import type { BootPhase } from "../../../../app/lib/startup-boot";

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
  /**
   * OnMyAgent-selected workspace folder path (registry `workspace.path`).
   * Used by the Files rail so the list does not follow session/tool directories.
   * When omitted, falls back to `selectedWorkspaceRoot`.
   */
  workspaceFilesRoot?: string | null;
  selectedSessionFileRoot?: string | null;
  selectedWorkspaceError?: string | null;
  runtimeWorkspaceId: string | null;
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
  /**
   * Session-route mount began during app cold boot (overlay / engine still
   * settling). Enables first-screen skeleton even when workspace id is
   * cache-hydrated. False for settings "Back to app" remounts.
   */
  coldBootShell?: boolean;
  /** Called after the assistant's runtime-independent draft home commits. */
  onStaticHomeReady?: () => void;
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
  providerAuthModal?: import("../../connections").ProviderAuthModalProps | null;
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
  statusBar?: Partial<Pick<StatusBarProps, "loading" | "showSettingsButton" | "settingsOpen">>;
  notFoundMessage?: string | null;
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  onAccessibleTargetsChange?: (targets: import("../artifacts/open-target").OpenTarget[]) => void;
  account?: SidebarAccountInfo | null;
  onOpenAccountSettings?: () => void;
  /** Settings → Personal profile (avatar / name). */
  onOpenProfile?: () => void;
  onSignOut?: () => void;
  onCreateSessionForAgent?: () => void;
  onCreateFreshSessionForAgent?: (workspaceId: string) => void | Promise<void>;
  renderAgentsPage: (props: {
    workspaceId: string;
    workspaceRoot: string;
    client: OnMyAgentServerClient | null;
    providers?: ProviderListItem[];
    connectedProviderIds?: string[];
    initialEditingAgentId?: string | null;
    editRequestKey?: number;
    initialCreateRequestKey?: number;
    dialogOnly?: boolean;
    onStartConversation?: (item: AgentCardItem, registry: AgentRegistry) => void;
  }) => React.ReactNode;
  settingsSlot?: React.ReactNode;
};

export type PageMode = "assistant" | "expert";

export type SessionAgentManagementIntent = {
  key: string;
  action: "openPanel";
  panel?: "agents" | "skills";
};

export type SessionPageWithModeProps = Omit<SessionPageProps, never> & {
  mode: PageMode;
  onNavigateToMode: (mode: PageMode) => void;
  agentManagementIntent?: SessionAgentManagementIntent | null;
  onAgentManagementIntentConsumed?: (key: string) => void;
};
