/** @jsxImportSource react */
import type {
  OpenworkServerClient,
  OpenworkServerStatus,
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
import type { ShareWorkspaceModalProps } from "../../shared/workspace-modal-types";
import type { AgentCardItem, AgentRegistry } from "../../shared/agent-registry-types";
import type {
  SidebarAccountInfo,
  SidebarPrimaryView,
} from "../sidebar/app-sidebar";
import type {
  SessionSurfaceProps,
} from "../surface/session-surface";
import type { StatusBarProps } from "../components/status-bar";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import type { AssistantPageProps } from "./assistant";
import type { ExpertPageProps } from "./expert";
import { AssistantPage } from "./assistant";
import { ExpertPage } from "./expert";

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
  opencodeBaseUrl?: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  onmyagentServerStatus: OpenworkServerStatus;
  onmyagentServerClient: OpenworkServerClient | null;
  onmyagentServerToken?: string | null;
  developerMode: boolean;
  headerStatus: string;
  busyHint: string | null;
  startupPhase: BootPhase;
  providerConnectedIds: string[];
  providers?: ProviderListItem[];
  mcpConnectedCount: number;
  onSendFeedback: () => void;
  onOpenSettings: () => void;
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  history?: SessionPageHistoryControls | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  shareWorkspaceModal?: ShareWorkspaceModalProps | null;
  providerAuthModal?: import("../../shared/provider-auth-modal").ProviderAuthModalProps | null;
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => void;
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
  onSignOut?: () => void;
  onCreateSessionForAgent?: () => void;
  onCreateFreshSessionForAgent?: (workspaceId: string) => void | Promise<void>;
  renderAgentsPage: (props: {
    workspaceId: string;
    workspaceRoot: string;
    client: OpenworkServerClient | null;
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
  action: "createProvider";
};

export type SessionPageWithModeProps = Omit<SessionPageProps, never> & {
  mode: PageMode;
  onNavigateToMode: (mode: PageMode) => void;
  agentManagementIntent?: SessionAgentManagementIntent | null;
  onAgentManagementIntentConsumed?: (key: string) => void;
};

export function SessionPage(props: SessionPageWithModeProps) {
  if (props.mode === "assistant") {
    return (
      <AssistantPage
        {...props}
        onNavigateToMode={props.onNavigateToMode}
      />
    );
  }
  return (
    <ExpertPage
      {...props}
      onNavigateToMode={props.onNavigateToMode}
    />
  );
}
