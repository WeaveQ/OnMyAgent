/**
 * Session chrome barrel — rail, conversation lists, panel constants.
 * Former home: components/shared-pages/ (cleared).
 */

export { OnMyAgentRail, isAutomationRailView } from "./main-rail";
export { isProjectsRailVisible } from "./projects-rail-visibility";
export { isTaskCenterRailVisible } from "./task-center-rail-visibility";
export type { OnMyAgentPrimaryView } from "./main-rail";

export {
  buildAgentConversationGroups,
  workspaceTaskStatus,
} from "./conversation-model";
export type { TaskStatusIndicator, AgentConversationGroup } from "./conversation-model";

export {
  ensureAgentSessionGroupVisible,
  ensureAgentSessionsVisible,
  ensureSelectedAgentSessionGroupVisible,
  ensureSelectedAgentSessionVisible,
} from "./agent-session-visibility";

export {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  DEFAULT_AGENT_TEMPLATE_ID,
  STARTUP_SKELETON_ROWS,
  sessionTitleForId,
  shouldShowSessionStartupSkeleton,
} from "./session-panel-model";

export { AgentConversationPanel } from "./agent-conversation-panel";
export { AgentPanelResizeHandle } from "./agent-panel-resize-handle";
export { SidebarPaneCollapseToggle } from "./sidebar-pane-collapse-toggle";
export {
  AgentSessionTabs,
  mergeStableSessionTabOrder,
} from "./agent-session-tabs";

export {
  mergeKeepOrderWithNewcomers,
  readExpertSidebarOrderIds,
  resolveExpertListOrderIds,
  sortExpertListByOrderIds,
  writeExpertSidebarOrderIds,
} from "./expert-list-order";
export type { ExpertListOrderItem } from "./expert-list-order";

export {
  readExpertSessionSelection,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
} from "./expert-session-selection-memory";

export {
  hiddenAccessibleTargetsStorageKey,
  readHiddenAccessibleTargetIds,
  writeHiddenAccessibleTargetIds,
} from "./hidden-accessible-targets-storage";

export {
  readAssistantSelectionMemory,
  resolveAssistantSelectionMemory,
  writeAssistantSelectionMemory,
} from "./assistant-selection-memory";
export type { AssistantSelectionMemory } from "./assistant-selection-memory";
