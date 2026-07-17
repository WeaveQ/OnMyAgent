/**
 * Session chrome barrel — rail, conversation lists, panel constants.
 * Former home: components/shared-pages/ (cleared).
 */

export { OnMyAgentRail } from "./main-rail";
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
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  STARTUP_SKELETON_ROWS,
  isVoiceExtensionEnabled,
  sessionTitleForId,
} from "./session-panel-model";

export { AgentConversationPanel } from "./agent-conversation-panel";
export { SidebarPaneCollapseToggle } from "./sidebar-pane-collapse-toggle";
export { AgentSessionTabs } from "./agent-session-tabs";

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
