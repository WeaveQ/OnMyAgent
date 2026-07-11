export { OnMyAgentRail } from "./main-rail";
export type { OnMyAgentPrimaryView } from "./main-rail";

export {
  buildAgentConversationGroups,
  workspaceTaskStatus,
} from "./conversation-model";
export {
  ensureAgentSessionGroupVisible,
  ensureAgentSessionsVisible,
  ensureSelectedAgentSessionGroupVisible,
  ensureSelectedAgentSessionVisible,
} from "./agent-session-visibility";
export type { TaskStatusIndicator } from "./conversation-model";

export {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  DEFAULT_AGENT_TEMPLATE_ID,
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  STARTUP_SKELETON_ROWS,
  isVoiceExtensionEnabled,
  sessionTitleForId,
} from "./session-panel-model";

export {
  BillingPage,
  DevicesPage,
  ProjectsComingSoonPage,
  SidebarFeaturePlaceholder,
  SIDEBAR_VIEW_ICONS,
  SIDEBAR_VIEW_LABELS,
  StorePage,
} from "./side-panel-pages";
export type { StorePrimaryTab } from "./side-panel-pages";

export { AgentManagementPage } from "../../../local-agents";
export { WorkspaceFilesPage } from "../../../workspace/workspace-files-page";
export { MessagingChannelsPage } from "../../../messaging/messaging-channels-page";
export { EmptyArtifactsPanel } from "./empty-artifacts-panel";
export { AgentConversationPanel } from "./agent-conversation-panel";
export { SidebarPaneCollapseToggle } from "./sidebar-pane-collapse-toggle";
export { AgentSessionTabs } from "./agent-session-tabs";
export { AutomationPage } from "../../../messaging/automation-page";

export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

export {
  hiddenAccessibleTargetsStorageKey,
  readHiddenAccessibleTargetIds,
  writeHiddenAccessibleTargetIds,
} from "./hidden-accessible-targets-storage";

export type SessionPageHistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  busyAction: "undo" | "redo" | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
};
