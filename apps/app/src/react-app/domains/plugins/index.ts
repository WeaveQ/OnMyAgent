/**
 * Plugins / skills catalog domain.
 */
export {
  CAPABILITY_SHELF,
  isRecommendedOnSurface,
  recommendedIdsForSurface,
  recommendedManagedConnectorIds,
  shelfEntriesForSurface,
  shelfEntryById,
  type CapabilityKind,
  type CapabilityShelfEntry,
  type ShelfSurface,
} from "./capability-shelf";
export {
  ConnectorsPage,
  PluginsPage,
  SkillsPage,
  type ArtifactPluginPromptSelection,
} from "./plugins-page";
export {
  CustomConnectorDialog,
  CustomConnectorEntryButton,
} from "./custom-connector-dialog";
export { extensionIcon, extensionIconTileClassName } from "./extension-icon";
export { ArtifactPluginCard, type ArtifactPluginCardProps } from "./artifact-plugin-card";
export {
  ArtifactPluginDetail,
  ArtifactStarterPrompts,
  TryThisPromptsSection,
  type ArtifactPluginDetailLabels,
  type ArtifactPluginDetailProps,
} from "./artifact-plugin-detail";
export {
  ConnectorConnectDialog,
  type ConnectorConnectDialogProps,
} from "./connector-connect-dialog";
export {
  ConnectorStatusCard,
  type ConnectorCardStatus,
  type ConnectorStatusCardProps,
} from "./connector-status-card";
export {
  loadArtifactPluginCatalog,
  loadArtifactPluginDetail,
  type ArtifactPluginClient,
  type ArtifactPluginDetail as ArtifactPluginDetailModel,
} from "./artifact-plugin-client";
export { resolveBundledSkillDisplay } from "./bundled-skill-locale";
export {
  OfficeCliPluginCard,
  OfficeCliPluginSection,
} from "./officecli-plugin";
export {
  canUninstallOfficeCli,
  getOfficeCliPrimaryAction,
  getOfficeCliStatusTone,
  isOfficeCliBusy,
  type OfficeCliPrimaryAction,
  type OfficeCliStatusTone,
} from "./officecli-plugin-state";
export {
  LarkCliPluginCard,
  LarkCliPluginSection,
} from "./larkcli-plugin";
export { TencentDocsPluginCard } from "./tencent-docs-plugin";
export {
  canDisconnectTencentDocs,
  getTencentDocsPrimaryAction,
  getTencentDocsStatusTone,
  isTencentDocsBusy,
  type TencentDocsPrimaryAction,
} from "./tencent-docs-plugin-state";
export { BaiduDrivePluginCard } from "./baidu-drive-plugin";
export {
  canDisconnectBaiduDrive,
  getBaiduDrivePrimaryAction,
  getBaiduDriveStatusTone,
  isBaiduDriveBusy,
  type BaiduDrivePrimaryAction,
} from "./baidu-drive-plugin-state";
export { KdocsPluginCard } from "./kdocs-plugin";
export {
  canDisconnectKdocs,
  getKdocsPrimaryAction,
  getKdocsStatusTone,
  isKdocsBusy,
  type KdocsPrimaryAction,
} from "./kdocs-plugin-state";
export { DingtalkPluginCard } from "./dingtalk-plugin";
export {
  canDisconnectDingtalk,
  getDingtalkPrimaryAction,
  getDingtalkStatusTone,
  isDingtalkBusy,
  type DingtalkPrimaryAction,
} from "./dingtalk-plugin-state";
export { WecomPluginCard } from "./wecom-plugin";
export {
  canDisconnectWecom,
  getWecomPrimaryAction,
  getWecomStatusTone,
  isWecomBusy,
  type WecomPrimaryAction,
} from "./wecom-plugin-state";
export { TencentMeetingPluginCard } from "./tencent-meeting-plugin";
export {
  canDisconnectTencentMeeting,
  getTencentMeetingPrimaryAction,
  getTencentMeetingStatusTone,
  isTencentMeetingBusy,
  type TencentMeetingPrimaryAction,
} from "./tencent-meeting-plugin-state";
export {
  canUninstallLarkCli,
  getLarkCliPrimaryAction,
  getLarkCliStatusTone,
  isLarkCliBusy,
  type LarkCliPrimaryAction,
  type LarkCliStatusTone,
} from "./larkcli-plugin-state";
export {
  filterManagedDesktopConnectors,
  listConnectedManagedDesktopConnectors,
  managedDesktopConnectorMcpServerNames,
  type ManagedDesktopConnectorId,
  type ManagedDesktopConnectorItem,
} from "./managed-desktop-connectors";
export {
  recommendBrowserSurface,
  type BrowserSurfaceId,
  type BrowserSurfaceIntent,
} from "./browser-surface-selection";
export {
  ALL_SKILLS,
  LEGACY_SKILLS,
  type SkillCategory,
  type SkillItem,
} from "./skills-catalog";
export {
  LOCAL_ORIGIN_LABELS,
  SKILL_SCOPE_LABELS,
  classifyLocalOrigin,
  classifySkillScope,
  type LocalSkillOrigin,
  type SkillScope,
} from "./skill-scope";

/** Composer pin state shared with skills marketplace. */
export {
  readPinnedSkillIds,
  writePinnedSkillIds,
  togglePinnedSkillId,
  sortWithPinnedFirst,
} from "./pinned-skills";

/** Company / enterprise store (OnMyCompany catalog). */
export {
  CompanyStorePage,
  type CompanyStoreSubTab,
} from "./company-store-page";

/** Expert marketplace (catalog + install + UI). */
export {
  ExpertMarketplacePage,
  ExpertMarketplaceDialog,
  type ExpertMarketplaceView,
} from "./expert-marketplace/expert-marketplace-dialog";
export {
  EXPERT_MARKETPLACE_CATEGORIES,
  expertMarketplaceCategoryLabel,
  normalizeExpertMarketplaceCategoryId,
  type ExpertMarketplaceCategory,
} from "./expert-marketplace/categories";
export {
  BUILTIN_MARKETPLACE_EXPERTS,
  BUILTIN_EXPERT_REGISTRY,
  listBuiltinMarketplaceExperts,
  listBuiltinExpertRegistryRecords,
  expertRegistryRecordFromEntry,
  isBuiltinMarketplaceExpertAgentId,
  findBuiltinMarketplaceExpertById,
} from "./expert-marketplace/data";
export {
  ensureMarketplaceExpertInstalled,
  installSummonedMarketplaceExpert,
} from "./expert-marketplace/install";
export {
  resolveMarketplaceExpertStartPrompt,
  type MarketplaceExpertStartPrompt,
} from "./expert-marketplace/start-prompt";
export type {
  LocalizedText,
  ExpertMarketplaceSource,
  ExpertPromptTemplate,
  ExpertMarketplaceEntry,
  ExpertMarketplaceSummonHandler,
  ExpertRegistryRecord,
  ExpertTeamWorkflow,
  ExpertTeamWorkflowStage,
} from "./expert-marketplace/types";

/** Skills marketplace (catalog + UI). */
export { SkillsMarketplacePage } from "./skills-marketplace/skills-marketplace-page";
export {
  SKILL_MARKETPLACE_CATEGORIES,
  skillMarketplaceCategoryLabel,
  type SkillMarketplaceCategory,
} from "./skills-marketplace/categories";
export {
  BUILTIN_MARKETPLACE_SKILLS,
  listBuiltinMarketplaceSkills,
} from "./skills-marketplace/data";
export type { SkillMarketplaceEntry } from "./skills-marketplace/types";
