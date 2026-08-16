/**
 * OAuth start / complete and API-key submit actions extracted from
 * createProviderAuthStore for file-size hygiene.
 */
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import { t } from "../../../../i18n";
import { unwrap } from "../../../../app/lib/opencode";
import type { Client } from "../../../../app/types";
import { describeProviderError } from "./provider-auth-config";
import type {
  ProviderAuthMethod,
  ProviderOAuthStartResult,
} from "../../connections/provider-auth-types";

export type ProviderAuthOAuthActionsContext = {
  options: {
    client: () => Client | null;
  };
  get state(): { providerAuthMethods: Record<string, ProviderAuthMethod[]> };
  setStateField: (key: "providerAuthError", value: string | null) => void;
  getProviderAuthWorkerType: () => "local" | "remote";
  loadProviderAuthMethods: (
    workerType: "local" | "remote",
  ) => Promise<Record<string, ProviderAuthMethod[]>>;
  assertProviderAllowedByDesktopPolicy: (providerId: string) => void;
  refreshProviders: (optionsArg?: { dispose?: boolean }) => Promise<ProviderListResponse | null>;
  assertNoClientError: (result: unknown) => void;
};

export function createProviderAuthOAuthActions(ctx: ProviderAuthOAuthActionsContext) {
  const options = ctx.options;
  const setStateField = ctx.setStateField;
  const getProviderAuthWorkerType = ctx.getProviderAuthWorkerType;
  const loadProviderAuthMethods = ctx.loadProviderAuthMethods;
  const assertProviderAllowedByDesktopPolicy = ctx.assertProviderAllowedByDesktopPolicy;
  const refreshProviders = ctx.refreshProviders;
  const assertNoClientError = ctx.assertNoClientError;

  async function startProviderAuth(
    providerId?: string,
    methodIndex?: number,
  ): Promise<ProviderOAuthStartResult> {
    setStateField("providerAuthError", null);
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }
    try {
      const cachedMethods = ctx.state.providerAuthMethods;
      const authMethods = Object.keys(cachedMethods).length
        ? cachedMethods
        : await loadProviderAuthMethods(getProviderAuthWorkerType());
      const providerIds = Object.keys(authMethods).sort();
      if (!providerIds.length) {
        throw new Error(t("providers.no_providers_available"));
      }

      const resolved = providerId?.trim() ?? "";
      if (!resolved) {
        throw new Error(t("providers.provider_id_required"));
      }
      assertProviderAllowedByDesktopPolicy(resolved);

      const methods = authMethods[resolved];
      if (!methods || !methods.length) {
        throw new Error(`${t("providers.unknown_provider")}: ${resolved}`);
      }

      const oauthIndex =
        methodIndex !== undefined
          ? methodIndex
          : (methods.find((method) => method.type === "oauth")?.methodIndex ?? -1);
      if (oauthIndex === -1) {
        throw new Error(
          `${t("providers.no_oauth_prefix")} ${resolved}. ${t("providers.use_api_key_suffix")}`,
        );
      }

      const selectedMethod = methods.find((method) => method.methodIndex === oauthIndex);
      if (!selectedMethod || selectedMethod.type !== "oauth") {
        throw new Error(`${t("providers.not_oauth_flow_prefix")} ${resolved}.`);
      }

      const auth = unwrap(
        await c.provider.oauth.authorize({ providerID: resolved, method: oauthIndex }),
      );
      return { methodIndex: oauthIndex, authorization: auth };
    } catch (error) {
      const message = describeProviderError(error, t("providers.connect_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function completeProviderAuthOAuth(providerId: string, methodIndex: number, code?: string) {
    setStateField("providerAuthError", null);
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }

    const resolved = providerId?.trim();
    if (!resolved) {
      throw new Error(t("providers.provider_id_required"));
    }
    assertProviderAllowedByDesktopPolicy(resolved);

    if (!Number.isInteger(methodIndex) || methodIndex < 0) {
      throw new Error(t("providers.oauth_method_required"));
    }

    const waitForProviderConnection = async (timeoutMs = 15000, pollMs = 2000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        try {
          const updated = await refreshProviders({ dispose: true });
          const connected = new Set(updated?.connected ?? []);
          if (connected.has(resolved)) {
            return true;
          }
        } catch {
          // ignore and retry
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return false;
    };

    const isPendingOauthError = (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error ?? "");
      return /request timed out/i.test(text) || /ProviderAuthOauthMissing/i.test(text);
    };

    try {
      const trimmedCode = code?.trim();
      const result = await c.provider.oauth.callback({
        providerID: resolved,
        method: methodIndex,
        code: trimmedCode || undefined,
      });
      assertNoClientError(result);
      const updated = await refreshProviders({ dispose: true });
      const connectedNow =
        Array.isArray(updated?.connected) && updated.connected.includes(resolved);
      if (connectedNow) {
        return { connected: true, message: `${t("status.connected")} ${resolved}` };
      }
      const connected = await waitForProviderConnection();
      if (connected) {
        return { connected: true, message: `${t("status.connected")} ${resolved}` };
      }
      return { connected: false, pending: true };
    } catch (error) {
      if (isPendingOauthError(error)) {
        const updated = await refreshProviders({ dispose: true });
        if (Array.isArray(updated?.connected) && updated.connected.includes(resolved)) {
          return { connected: true, message: `${t("status.connected")} ${resolved}` };
        }
        const connected = await waitForProviderConnection();
        if (connected) {
          return { connected: true, message: `${t("status.connected")} ${resolved}` };
        }
        return { connected: false, pending: true };
      }
      const message = describeProviderError(error, t("providers.oauth_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function submitProviderApiKey(providerId: string, apiKey: string) {
    setStateField("providerAuthError", null);
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }

    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error(t("providers.api_key_required"));
    }
    assertProviderAllowedByDesktopPolicy(providerId);

    try {
      await c.auth.set({ providerID: providerId, auth: { type: "api", key: trimmed } });
      await refreshProviders({ dispose: true });
      return `${t("status.connected")} ${providerId}`;
    } catch (error) {
      const message = describeProviderError(error, t("providers.save_api_key_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  return {
    startProviderAuth,
    completeProviderAuthOAuth,
    submitProviderApiKey,
  };
}
