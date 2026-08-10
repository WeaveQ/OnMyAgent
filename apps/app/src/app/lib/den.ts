/**
 * Den public surface (barrel).
 * Implementation lives in den-*.ts subdomain modules; keep this file as re-exports only.
 */

export type { SharedDesktopConfig } from "./den-config";
export {
  normalizeDesktopConfig,
  DEFAULT_DEN_AUTH_NAME,
  DEFAULT_DEN_BASE_URL,
  normalizeDenBaseUrl,
  resolveDenBaseUrls,
  buildDenAuthUrl,
  DEN_INFERENCE_PATH,
  normalizeDenDesktopConfig,
} from "./den-config";

export type { DenSettings, DenUser } from "./den-types";

export type {
  DenBootstrapConfig,
  DenDesktopConfig,
  DenOrgSummary,
  DenWorkerSummary,
  DenWorkerTokens,
  DenOrgLlmProviderModel,
  DenOrgLlmProvider,
  DenOrgLlmProviderConnection,
  DenPluginConfigObjectType,
  DenPluginConfigObjectVersion,
  DenPluginConfigObject,
  DenPluginMembership,
  DenOrgExtensionProjection,
  DenOrgPlugin,
  DenOrgMarketplace,
  DenOrgMarketplaceResolved,
  DenOrgPluginResolved,
  DenBillingPrice,
  DenBillingSubscription,
  DenBillingInvoice,
  DenBillingSummary,
  DenDesktopHandoffExchange,
  DenAppVersionMetadata,
  DenOrgSkillHub,
  DenOrgSkillHubSummary,
} from "./den-api-types";
export { DenApiError } from "./den-api-types";

export {
  getDenInferenceUrl,
  readDenBootstrapConfig,
  initializeDenBootstrapConfig,
  setDenBootstrapConfig,
  readDenSettings,
  writeDenSettings,
  clearDenSession,
} from "./den-session";

export {
  createDenClient,
} from "./den-client";
export type { DenClient } from "./den-client";

export {
  fetchDenOrgSkillsCatalog,
  ensureDenActiveOrganization,
} from "./den-skills";
