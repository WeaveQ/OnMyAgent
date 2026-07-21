// Page components are intentionally not static re-exports: shell hosts load
// them through `lazy-pages` factories so Settings host can stay thin.
export type {
  AiSettingsConnectedProvider,
  AiSettingsViewProps,
} from "./pages/ai-view";
export type { PreferencesViewProps } from "./pages/preferences-view";
export type { MemoryViewProps } from "./pages/memory-view";
export type { ConversationMemoryViewProps } from "./pages/conversation-memory-view";
export type { GeneralSettingsViewProps } from "./pages/general-view";
export type { SystemAuthorizationsViewProps } from "./pages/system-authorizations-view";
export type { CloudMarketplacesViewProps } from "./pages/cloud-marketplaces-view";
export type { CloudProvidersViewProps } from "./pages/cloud-providers-view";
export type { DebugViewProps } from "./pages/debug-view";
export type { EnvironmentViewProps } from "./pages/environment-view";
export type { ArchivedTasksViewProps } from "./pages/archived-tasks-view";
export type {
  MessagingChannel,
  MessagingViewExpandedChannel,
  MessagingViewProps,
  MessagingViewTab,
} from "./pages/messaging-view";
export type { UpdatesViewProps } from "./pages/updates-view";
export type { UsageSettingsViewProps } from "./pages/usage-view";

/** Deferred page loaders — shell hosts must use these (not static page imports). */
export {
  loadAiSettingsView,
  loadArchivedTasksView,
  loadAuthorizedFoldersPanel,
  loadCloudMarketplacesView,
  loadCloudProvidersView,
  loadConversationMemoryView,
  loadDebugView,
  loadEnvironmentView,
  loadGeneralSettingsView,
  loadMemoryView,
  loadMessagingView,
  loadPreferencesView,
  loadSystemAuthorizationsView,
  loadUpdatesView,
  loadUsageView,
} from "./lazy-pages";
export {
  FieldLabel,
  ToggleChip,
  industryOptions,
  normalizeProfileOptionValue,
  normalizeProfileOptionValues,
  roleOptions,
  taskOptions,
  toolOptions,
} from "./pages/onboarding-profile-shared";
export type { ProfileOption } from "./pages/onboarding-profile-shared";

export type { AuthorizedFoldersPanelProps } from "./panels/authorized-folders-panel";

export {
  RefreshButton,
  SettingsActionRow,
  SettingsCard,
  SettingsInset,
  SettingsNotice,
  SettingsPanel,
  SettingsPill,
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderActions,
  SettingsSectionHeaderContent,
  SettingsSectionHeaderDescription,
  SettingsSectionHeaderTitle,
  SettingsSectionHint,
  SettingsStack,
  SettingsStatusBadge,
  Spinner,
} from "./settings-section";
export type {
  RefreshButtonProps,
  SectionItemHeaderProps,
  SettingsActionRowProps,
  SettingsCardProps,
  SettingsLayoutProps,
  SettingsNoticeProps,
  SettingsPanelProps,
  SettingsStatusBadgeProps,
  SpinnerProps,
} from "./settings-section";

export {
  getExtensionConfigSlot,
  getExtensionConnected,
  registerExtensionConfig,
  registerExtensionRuntime,
} from "./extension-registry";
export type {
  ExtensionConfigContext,
  ExtensionConfigFactory,
  ExtensionRuntimeContext,
  OnMyAgentExtensionRuntime,
} from "./extension-registry";

export { useDebugViewModel } from "./state/debug-view-model";
export { useMessagingViewProps } from "./state/messaging-view-state";
export { useElectronUpdaterState } from "./state/electron-updater-state";
export type { SettingsUpdateStatus } from "./state/electron-updater-state";
export {
  createExtensionsStore,
  useExtensionsStoreSnapshot,
} from "./state/extensions-store";
export type { ExtensionsStore } from "./state/extensions-store";

export { CloudSessionProvider, useCloudSession } from "./cloud/cloud-session-provider";
export { useDenSession } from "./cloud/use-den-session";
export type { UseDenSessionProps } from "./cloud/use-den-session";

export { SettingsShell } from "./shell/settings-shell";
export type { SettingsShellProps } from "./shell/settings-shell";

export {
  IMAGE_GENERATION_EXTENSION_CONFIG_PATH,
  IMAGE_GENERATION_PLUGIN_CONTENT,
  IMAGE_GENERATION_PLUGIN_PATH,
  OLLAMA_PROVIDER_CONFIG,
  OPENAI_API_KEY_ENV_KEY,
  OPENAI_IMAGE_EXTENSION_ID,
  OPENAI_IMAGE_MODEL,
  base64ToArrayBuffer,
  installOpenAiImageExtensionFiles,
  openAiImageResponseToArrayBuffer,
  requestOpenAiImage,
  slugifyImageArtifactName,
} from "./openai-image-extension";
export type { LocalProviderInstallInput } from "./openai-image-extension";

import "./openai-image-gen-config";
import "./ollama-config";
import "./computer-use-config";
import "./onmyagent-voice-config";
import "./browser-config";
