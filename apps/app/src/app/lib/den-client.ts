/** Den HTTP client factory and active-org session helper. */

import type { DenOrgSkillCard } from "../types";
import {
  DEFAULT_DEN_AUTH_NAME,
  normalizeDenDesktopConfig,
  resolveDenBaseUrls,
} from "./den-config";
import {
  DenApiError,
  type DenAppVersionMetadata,
  type DenAuthResult,
  type DenBillingSubscription,
  type DenBillingSummary,
  type DenDesktopConfig,
  type DenDesktopHandoffExchange,
  type DenOrgLlmProvider,
  type DenOrgLlmProviderConnection,
  type DenOrgMarketplace,
  type DenOrgMarketplaceResolved,
  type DenOrgPlugin,
  type DenOrgPluginResolved,
  type DenOrgSkillHub,
  type DenOrgSkillHubSummary,
  type DenOrgSummary,
  type DenWorkerSummary,
  type DenWorkerTokens,
} from "./den-api-types";
import type { DenUser } from "./den-types";
import {
  getCreatedOrgSkillId,
  getDenAppVersionMetadata,
  getDenOrgLlmProviderConnection,
  getDenOrgLlmProviders,
  getDenOrgSkillHubsFromPayload,
  getDenOrgSkillsFromPayload,
  getOrgList,
  getOrgSkillHubSummaries,
  getToken,
  getUser,
  getWorkerTokens,
  getWorkers,
} from "./den-api-parse";
import {
  getBillingSubscription,
  getBillingSummary,
} from "./den-api-parse-billing";
import {
  getOrgMarketplaceResolved,
  getOrgMarketplaces,
  getOrgPluginResolved,
} from "./den-api-parse-extensions";
import { isRecord } from "./den-url-parse";
import {
  ensureActiveOrganization,
  requestJson,
  requestJsonRaw,
} from "./den-request";

export function createDenClient(options: { baseUrl: string; apiBaseUrl?: string | null; token?: string | null }) {
  const baseUrls = resolveDenBaseUrls({
    baseUrl: options.baseUrl,
    apiBaseUrl: options.apiBaseUrl,
  });
  const token = options.token?.trim() ?? null;

  return {
    async setActiveOrganization(input: { organizationId?: string | null; organizationSlug?: string | null }): Promise<void> {
      await ensureActiveOrganization(baseUrls, token, input);
    },

    async signInEmail(email: string, password: string): Promise<DenAuthResult> {
      const payload = await requestJson<unknown>(baseUrls, "/api/auth/sign-in/email", {
        method: "POST",
        body: {
          email: email.trim(),
          password,
        },
      });
      return { user: getUser(payload), token: getToken(payload) };
    },

    async signUpEmail(email: string, password: string): Promise<DenAuthResult> {
      const payload = await requestJson<unknown>(baseUrls, "/api/auth/sign-up/email", {
        method: "POST",
        body: {
          name: DEFAULT_DEN_AUTH_NAME,
          email: email.trim(),
          password,
        },
      });
      return { user: getUser(payload), token: getToken(payload) };
    },

    async signOut() {
      await requestJsonRaw(baseUrls, "/api/auth/sign-out", {
        method: "POST",
        token,
        body: {},
      });
    },

    async getSession(): Promise<DenUser> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/me", {
        method: "GET",
        token,
      });
      const user = getUser(payload);
      if (!user) {
        throw new DenApiError(500, "invalid_session_payload", "Session response did not include a user.");
      }
      return user;
    },

    async getAppVersionMetadata(): Promise<DenAppVersionMetadata> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/app-version", {
        method: "GET",
      });
      const appVersionMetadata = getDenAppVersionMetadata(payload);
      if (!appVersionMetadata) {
        throw new DenApiError(500, "invalid_app_version_payload", "App version response was missing version details.");
      }
      return appVersionMetadata;
    },

    async getDesktopConfig(): Promise<DenDesktopConfig> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/me/desktop-config", {
        method: "GET",
        token,
      });
      return normalizeDenDesktopConfig(payload);
    },

    async exchangeDesktopHandoff(grant: string): Promise<DenDesktopHandoffExchange> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/auth/desktop-handoff/exchange", {
        method: "POST",
        body: { grant },
      });
      return { user: getUser(payload), token: getToken(payload) };
    },

    async listOrgs(): Promise<{ orgs: DenOrgSummary[]; activeOrgId: string | null; activeOrgSlug: string | null; defaultOrgId: string | null }> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/me/orgs", {
        method: "GET",
        token,
      });

      const activeOrgId = isRecord(payload) && typeof payload.activeOrgId === "string"
        ? payload.activeOrgId
        : null;
      const activeOrgSlug = isRecord(payload) && typeof payload.activeOrgSlug === "string"
        ? payload.activeOrgSlug
        : null;

      return {
        orgs: getOrgList(payload),
        activeOrgId,
        activeOrgSlug,
        defaultOrgId: activeOrgId,
      };
    },

    async listWorkers(orgId: string, limit = 20): Promise<DenWorkerSummary[]> {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      const payload = await requestJson<unknown>(baseUrls, `/v1/workers?${params.toString()}`, {
        method: "GET",
        token,
        organizationId: orgId,
      });
      return getWorkers(payload);
    },

    async getWorkerTokens(workerId: string, orgId: string): Promise<DenWorkerTokens> {
      const payload = await requestJson<unknown>(baseUrls, `/v1/workers/${encodeURIComponent(workerId)}/tokens`, {
        method: "POST",
        token,
        organizationId: orgId,
        body: {},
      });
      const tokens = getWorkerTokens(payload);
      if (!tokens) {
        throw new DenApiError(500, "invalid_worker_token_payload", "Worker token response was missing token values.");
      }
      return tokens;
    },

    async listOrgSkills(orgId: string): Promise<DenOrgSkillCard[]> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/skills", {
        method: "GET",
        token,
        organizationId: orgId,
      });
      return getDenOrgSkillsFromPayload(payload);
    },

    async listOrgSkillHubs(orgId: string): Promise<DenOrgSkillHub[]> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/skill-hubs", {
        method: "GET",
        token,
        organizationId: orgId,
      });
      return getDenOrgSkillHubsFromPayload(payload);
    },

    async listOrgSkillHubSummaries(orgId: string): Promise<DenOrgSkillHubSummary[]> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/skill-hubs", {
        method: "GET",
        token,
        organizationId: orgId,
      });
      return getOrgSkillHubSummaries(payload);
    },

    async createOrgSkill(
      orgId: string,
      input: { skillText: string; shared?: "org" | "public" | null },
    ): Promise<{ id: string }> {
      const body = {
        skillText: input.skillText,
        shared: input.shared === undefined ? ("org" as const) : input.shared,
      };
      const payload = await requestJson<unknown>(baseUrls, "/v1/skills", {
        method: "POST",
        token,
        organizationId: orgId,
        body,
      });
      const id = getCreatedOrgSkillId(payload);
      if (!id) {
        throw new DenApiError(500, "invalid_skill_payload", "Skill response was missing id.");
      }
      return { id };
    },

    async addOrgSkillToHub(orgId: string, skillHubId: string, skillId: string): Promise<void> {
      await requestJson<unknown>(
        baseUrls,
        `/v1/skill-hubs/${encodeURIComponent(skillHubId)}/skills`,
        {
          method: "POST",
          token,
          organizationId: orgId,
          body: { skillId },
        },
      );
    },

    async listOrgLlmProviders(orgId: string): Promise<DenOrgLlmProvider[]> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/llm-providers", {
        method: "GET",
        token,
        organizationId: orgId,
      });
      return getDenOrgLlmProviders(payload);
    },

    async getOrgLlmProviderConnection(orgId: string, llmProviderId: string): Promise<DenOrgLlmProviderConnection> {
      const payload = await requestJson<unknown>(
        baseUrls,
        `/v1/llm-providers/${encodeURIComponent(llmProviderId)}/connect`,
        {
          method: "GET",
          token,
          organizationId: orgId,
        },
      );
      const provider = getDenOrgLlmProviderConnection(payload);
      if (!provider) {
        throw new DenApiError(500, "invalid_llm_provider_payload", "LLM provider response was missing connection details.");
      }
      return provider;
    },

    async listOrgMarketplaces(orgId: string): Promise<DenOrgMarketplace[]> {
      const payload = await requestJson<unknown>(
        baseUrls,
        `/v1/marketplaces?status=active&limit=100`,
        { method: "GET", token, organizationId: orgId },
      );
      return getOrgMarketplaces(payload);
    },

    async getOrgMarketplaceResolved(orgId: string, marketplaceId: string): Promise<DenOrgMarketplaceResolved> {
      const payload = await requestJson<unknown>(
        baseUrls,
        `/v1/marketplaces/${encodeURIComponent(marketplaceId)}/resolved`,
        { method: "GET", token, organizationId: orgId },
      );
      const resolved = getOrgMarketplaceResolved(payload);
      if (!resolved) {
        throw new DenApiError(500, "invalid_marketplace_payload", "Marketplace response was missing plugin details.");
      }
      return resolved;
    },

    async getOrgPluginResolved(orgId: string, plugin: DenOrgPlugin): Promise<DenOrgPluginResolved> {
      const payload = await requestJson<unknown>(
        baseUrls,
        `/v1/plugins/${encodeURIComponent(plugin.id)}/resolved`,
        { method: "GET", token, organizationId: orgId },
      );
      return getOrgPluginResolved(plugin, payload);
    },

    async getBillingStatus(options: { includeCheckout?: boolean; includePortal?: boolean; includeInvoices?: boolean } = {}): Promise<DenBillingSummary> {
      const params = new URLSearchParams();
      if (options.includeCheckout) {
        params.set("includeCheckout", "1");
      }
      if (options.includePortal === false) {
        params.set("excludePortal", "1");
      }
      if (options.includeInvoices === false) {
        params.set("excludeInvoices", "1");
      }

      const path = params.size > 0 ? `/v1/workers/billing?${params.toString()}` : "/v1/workers/billing";
      const payload = await requestJson<unknown>(baseUrls, path, {
        method: "GET",
        token,
      });
      const summary = getBillingSummary(payload);
      if (!summary) {
        throw new DenApiError(500, "invalid_billing_payload", "Billing response was missing details.");
      }
      return summary;
    },

    async updateSubscriptionCancellation(cancelAtPeriodEnd: boolean): Promise<{ subscription: DenBillingSubscription | null; billing: DenBillingSummary }> {
      const payload = await requestJson<unknown>(baseUrls, "/v1/workers/billing/subscription", {
        method: "POST",
        token,
        body: { cancelAtPeriodEnd },
      });
      const billing = getBillingSummary(payload);
      if (!billing) {
        throw new DenApiError(500, "invalid_billing_payload", "Subscription update response was missing billing details.");
      }

      return {
        subscription: isRecord(payload) ? getBillingSubscription(payload.subscription) : null,
        billing,
      };
    },
  };
}

export type DenClient = ReturnType<typeof createDenClient>;
