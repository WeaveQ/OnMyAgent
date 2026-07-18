/**
 * On-demand page loaders for settings tabs.
 *
 * Shell must import only domain barrels (not `pages/*` deep paths). These
 * factories keep the settings host free of static page graphs so opening
 * Settings does not evaluate every tab module up front.
 */

export const loadGeneralSettingsView = () => import("./pages/general-view");
export const loadPreferencesView = () => import("./pages/preferences-view");
export const loadMemoryView = () => import("./pages/memory-view");
export const loadConversationMemoryView = () =>
  import("./pages/conversation-memory-view");
export const loadSystemAuthorizationsView = () =>
  import("./pages/system-authorizations-view");
export const loadAiSettingsView = () => import("./pages/ai-view");
export const loadEnvironmentView = () => import("./pages/environment-view");
export const loadUpdatesView = () => import("./pages/updates-view");
export const loadDebugView = () => import("./pages/debug-view");
export const loadArchivedTasksView = () => import("./pages/archived-tasks-view");
export const loadAuthorizedFoldersPanel = () =>
  import("./panels/authorized-folders-panel");
export const loadCloudProvidersView = () =>
  import("./pages/cloud-providers-view");
export const loadCloudMarketplacesView = () =>
  import("./pages/cloud-marketplaces-view");
export const loadExtensionsView = () => import("./pages/extensions-view");
export const loadMcpView = () => import("./pages/mcp-view");
export const loadMessagingView = () => import("./pages/messaging-view");
