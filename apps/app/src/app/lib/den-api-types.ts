/**
 * Den API / domain types and DenApiError.
 * Leaf module: no den session/client imports (avoids cycles).
 */

import type { DesktopConfig as SharedDesktopConfig } from "@onmyagent/types/den/desktop-policies";
import type { DenOrgSkillCard } from "../types";
import type {
  OnMyAgentExtensionManifest,
  OnMyAgentExtensionSourceFormat,
} from "../extensions";
import type { DenUser } from "./den-types";

export type DenBaseUrls = {
  baseUrl: string;
  apiBaseUrl: string;
};

export type DenBootstrapConfig = DenBaseUrls & {
  requireSignin: boolean;
};

export type DenDesktopConfig = SharedDesktopConfig;

export type DenOrgSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
};

export type DenWorkerSummary = {
  workerId: string;
  workerName: string;
  status: string;
  instanceUrl: string | null;
  provider: string | null;
  isMine: boolean;
  createdAt: string | null;
};

export type DenWorkerTokens = {
  clientToken: string | null;
  ownerToken: string | null;
  hostToken: string | null;
  onmyagentUrl: string | null;
  workspaceId: string | null;
};

export type DenOrgLlmProviderModel = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string | null;
};

export type DenOrgLlmProvider = {
  id: string;
  source: "models_dev" | "custom" | "onmyagent";
  providerId: string;
  name: string;
  providerConfig: Record<string, unknown>;
  hasApiKey: boolean;
  models: DenOrgLlmProviderModel[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type DenOrgLlmProviderConnection = DenOrgLlmProvider & {
  apiKey: string | null;
};

export type DenPluginConfigObjectType = "skill" | "agent" | "command" | "tool" | "mcp" | "hook" | "context" | "custom";

export type DenPluginConfigObjectVersion = {
  id: string;
  rawSourceText: string | null;
  normalizedPayloadJson: Record<string, unknown> | null;
  sourceRevisionRef: string | null;
  createdAt: string | null;
};

export type DenPluginConfigObject = {
  id: string;
  objectType: DenPluginConfigObjectType;
  title: string;
  description: string | null;
  currentFileName: string | null;
  currentFileExtension: string | null;
  currentRelativePath: string | null;
  status: string;
  updatedAt: string | null;
  latestVersion: DenPluginConfigObjectVersion | null;
};

export type DenPluginMembership = {
  id: string;
  pluginId: string;
  configObjectId: string;
  configObject?: DenPluginConfigObject;
};

export type DenOrgExtensionProjection = {
  id: string;
  name: string;
  description: string | null;
  sourceFormat: OnMyAgentExtensionSourceFormat;
  manifest: OnMyAgentExtensionManifest | null;
};

export type DenOrgPlugin = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  memberCount: number;
  updatedAt: string | null;
  componentCounts: Record<string, number>;
  /** Preferred Den surface: plugins are normalized into OnMyAgent extensions. */
  extension?: DenOrgExtensionProjection | null;
};

export type DenOrgMarketplace = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  pluginCount: number;
  updatedAt: string | null;
};

export type DenOrgMarketplaceResolved = {
  marketplace: DenOrgMarketplace;
  plugins: DenOrgPlugin[];
};

export type DenOrgPluginResolved = {
  plugin: DenOrgPlugin;
  memberships: DenPluginMembership[];
  /** Future Den extension manifest; absent while Claude plugin imports are resource-only. */
  extension?: DenOrgExtensionProjection | null;
};

export type DenBillingPrice = {
  amount: number | null;
  currency: string | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
};

export type DenBillingSubscription = {
  id: string;
  status: string;
  amount: number | null;
  currency: string | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
};

export type DenBillingInvoice = {
  id: string;
  createdAt: string | null;
  status: string;
  totalAmount: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
};

export type DenBillingSummary = {
  featureGateEnabled: boolean;
  hasActivePlan: boolean;
  checkoutRequired: boolean;
  checkoutUrl: string | null;
  portalUrl: string | null;
  price: DenBillingPrice | null;
  subscription: DenBillingSubscription | null;
  invoices: DenBillingInvoice[];
  productId: string | null;
  benefitId: string | null;
};

export type DenAuthResult = {
  user: DenUser | null;
  token: string | null;
};

export type DenDesktopHandoffExchange = {
  user: DenUser | null;
  token: string | null;
};

export type DenAppVersionMetadata = {
  minAppVersion: string;
  latestAppVersion: string;
};

export class DenApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "DenApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type DenOrgSkillHub = { id: string; name: string; skills: DenOrgSkillCard[] };

export type DenOrgSkillHubSummary = {
  id: string;
  name: string;
  canManage: boolean;
};

export type RawJsonResponse<T> = {
  ok: boolean;
  status: number;
  json: T | null;
};
