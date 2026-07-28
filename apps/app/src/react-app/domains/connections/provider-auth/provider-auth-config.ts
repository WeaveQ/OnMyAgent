/**
 * Pure provider-auth config / error helpers used by createProviderAuthStore.
 * Extracted so store.ts stays under the file-size baseline and unit tests
 * can exercise the shipped transforms without mounting the full store.
 */
import { applyEdits, modify, parse } from "jsonc-parser";
import type { ProviderConfig } from "@opencode-ai/sdk/v2/client";

import { t } from "../../../../i18n";
import type {
  DenOrgLlmProvider,
  DenOrgLlmProviderConnection,
} from "../../../../app/lib/den";
import { safeStringify } from "../../../../app/utils";
import {
  nextDisabledProvidersList,
  normalizeDisabledProviders,
} from "./disabled-and-disconnect";
import type { ProviderAuthMethod } from "../../connections/provider-auth-types";

export function getStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

export function getCloudProviderEnv(config: Record<string, unknown>): string[] {
  return getStringList(config.env);
}

export function sortStrings(values: string[]): string[] {
  return values.toSorted();
}

export function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function getCloudManagedProviderId(
  provider: Pick<DenOrgLlmProvider, "id" | "providerId" | "source">,
): string {
  return provider.source === "onmyagent" ? "onmyagent" : provider.id.trim();
}

export function buildCloudProviderMethod(
  provider: DenOrgLlmProvider,
): ProviderAuthMethod {
  return {
    type: "cloud",
    label:
      provider.name.trim().toLowerCase() ===
      provider.providerId.trim().toLowerCase()
        ? "Use organization provider"
        : `Use ${provider.name}`,
    cloudProviderId: provider.id,
    description:
      provider.models.length > 0
        ? `${provider.models.length} curated model${
            provider.models.length === 1 ? "" : "s"
          } managed by your organization.`
        : "Use the provider and credential managed by your organization.",
    env: getCloudProviderEnv(provider.providerConfig),
    modelCount: provider.models.length,
  };
}

export function buildCloudProviderConfig(
  provider: DenOrgLlmProviderConnection,
): ProviderConfig {
  const models = Object.fromEntries(
    provider.models.map((model) => {
      const next: NonNullable<ProviderConfig["models"]>[string] = {
        id: model.id,
        name: model.name,
      };
      const raw = model.config;
      for (const key of [
        "family",
        "release_date",
        "attachment",
        "reasoning",
        "temperature",
        "tool_call",
        "interleaved",
        "cost",
        "limit",
        "modalities",
        "status",
        "options",
        "headers",
        "provider",
        "variants",
      ] as const) {
        const value = raw[key];
        if (value !== undefined) {
          (next as Record<string, unknown>)[key] = value;
        }
      }
      return [model.id, next];
    }),
  );

  const next: ProviderConfig = {
    id: provider.providerId,
    name: provider.name,
    env: getCloudProviderEnv(provider.providerConfig),
    models,
  };

  if (
    typeof provider.providerConfig.npm === "string" &&
    provider.providerConfig.npm.trim()
  ) {
    next.npm = provider.providerConfig.npm;
  }
  if (
    typeof provider.providerConfig.api === "string" &&
    provider.providerConfig.api.trim()
  ) {
    next.api = provider.providerConfig.api;
  }
  if (
    provider.providerConfig.options &&
    typeof provider.providerConfig.options === "object"
  ) {
    next.options = provider.providerConfig.options as Record<string, unknown>;
  }
  if (Array.isArray(provider.providerConfig.whitelist)) {
    next.whitelist = getStringList(provider.providerConfig.whitelist);
  }
  if (Array.isArray(provider.providerConfig.blacklist)) {
    next.blacklist = getStringList(provider.providerConfig.blacklist);
  }

  return next;
}

export function formatConfigWithProviderDisabledState(
  raw: string,
  providerId: string,
  disabled: boolean,
): string {
  const resolvedProviderId = providerId.trim();
  let updated = raw.trim()
    ? raw
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const parsed = parse(updated) as Record<string, unknown> | undefined;
  const currentDisabled = normalizeDisabledProviders(parsed?.disabled_providers);
  const nextDisabled = nextDisabledProvidersList(
    currentDisabled,
    resolvedProviderId,
    disabled,
  );

  const disabledEdits = modify(
    updated,
    ["disabled_providers"],
    nextDisabled.length ? nextDisabled : undefined,
    { formattingOptions: { insertSpaces: true, tabSize: 2 } },
  );
  updated = applyEdits(updated, disabledEdits);
  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cloudProviderComment(
  provider: Pick<DenOrgLlmProvider, "id" | "name">,
): string {
  return `// OnMyAgent Cloud import: ${provider.name
    .replace(/\s+/g, " ")
    .trim()} (${provider.id}). Manage this entry from Cloud settings.`;
}

export function removeCloudProviderComment(
  raw: string,
  providerId: string,
): string {
  return raw.replace(
    new RegExp(
      `(^[ \t]*)// OnMyAgent Cloud import:.*\\n\\1(?="${escapeRegExp(providerId)}":)`,
      "m",
    ),
    "$1",
  );
}

export function addCloudProviderComment(
  raw: string,
  provider: Pick<DenOrgLlmProvider, "id" | "name">,
  localProviderId: string,
): string {
  const withoutExisting = removeCloudProviderComment(raw, localProviderId);
  const propertyPattern = new RegExp(
    `^([ \t]*)"${escapeRegExp(localProviderId)}":`,
    "m",
  );
  return withoutExisting.replace(
    propertyPattern,
    `$1${cloudProviderComment(provider)}\n$1"${localProviderId}":`,
  );
}

export function getProviderModelIds(
  provider: Pick<DenOrgLlmProvider, "models">,
): string[] {
  return provider.models
    .flatMap((model) => {
      const id = model.id.trim();
      return id ? [id] : [];
    })
    .sort();
}

export function formatConfigWithCloudProvider(
  raw: string,
  provider: DenOrgLlmProviderConnection,
  localProviderId: string,
  previousProviderId: string | null | undefined,
  disabledProviders: string[],
): string {
  const nextProviderConfig = buildCloudProviderConfig(provider);
  let updated = raw.trim()
    ? raw
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

  if (previousProviderId && previousProviderId !== localProviderId) {
    updated = removeCloudProviderComment(updated, previousProviderId);
    const previousEdits = modify(
      updated,
      ["provider", previousProviderId],
      undefined,
      {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      },
    );
    updated = applyEdits(updated, previousEdits);
  }

  const providerEdits = modify(
    updated,
    ["provider", localProviderId],
    nextProviderConfig,
    {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    },
  );
  updated = applyEdits(updated, providerEdits);
  updated = addCloudProviderComment(updated, provider, localProviderId);

  const disabledToRemove = new Set([localProviderId, previousProviderId ?? ""]);
  if (disabledProviders.some((id) => disabledToRemove.has(id))) {
    const nextDisabled = disabledProviders.filter(
      (id) => !disabledToRemove.has(id),
    );
    const disabledEdits = modify(updated, ["disabled_providers"], nextDisabled, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    updated = applyEdits(updated, disabledEdits);
  }

  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

export function formatConfigWithoutCloudProvider(
  raw: string,
  providerId: string,
  disabledProviders: string[],
): string {
  let updated = raw.trim()
    ? raw
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  updated = removeCloudProviderComment(updated, providerId);
  const providerEdits = modify(updated, ["provider", providerId], undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  updated = applyEdits(updated, providerEdits);

  const nextDisabled = disabledProviders.filter((id) => id !== providerId);
  const disabledEdits = modify(updated, ["disabled_providers"], nextDisabled, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  updated = applyEdits(updated, disabledEdits);
  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

export function describeProviderError(error: unknown, fallback: string): string {
  const readString = (value: unknown, max = 700) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
  };

  const records: Record<string, unknown>[] = [];
  const root =
    error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  if (root) {
    records.push(root);
    if (root.data && typeof root.data === "object") {
      records.push(root.data as Record<string, unknown>);
    }
    if (root.cause && typeof root.cause === "object") {
      const cause = root.cause as Record<string, unknown>;
      records.push(cause);
      if (cause.data && typeof cause.data === "object") {
        records.push(cause.data as Record<string, unknown>);
      }
    }
  }

  const firstString = (keys: string[]) => {
    for (const record of records) {
      for (const key of keys) {
        const value = readString(record[key]);
        if (value) return value;
      }
    }
    return null;
  };

  const firstNumber = (keys: string[]) => {
    for (const record of records) {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
    }
    return null;
  };

  const status = firstNumber(["statusCode", "status"]);
  const provider = firstString(["providerID", "providerId", "provider"]);
  const code = firstString(["code", "errorCode"]);
  const response = firstString(["responseBody", "body", "response"]);
  const raw =
    (error instanceof Error ? readString(error.message) : null) ||
    firstString(["message", "detail", "reason", "error"]) ||
    (typeof error === "string" ? readString(error) : null);

  const generic = raw && /^unknown\s+error$/i.test(raw);
  const isPluginHookMismatch =
    typeof raw === "string" &&
    (/fn\d+\s+is not a function/i.test(raw) ||
      (/is not a function/i.test(raw) && /plugin\/index\.ts/i.test(raw)));
  const heading = (() => {
    if (isPluginHookMismatch) {
      return t("providers.plugin_hook_mismatch");
    }
    if (status === 401 || status === 403) return t("providers.auth_failed");
    if (status === 429) return t("providers.rate_limit_exceeded");
    if (provider) return t("providers.provider_error", { provider });
    return fallback;
  })();

  const lines = [heading];
  if (isPluginHookMismatch) {
    lines.push(t("providers.plugin_hook_mismatch_hint"));
  }
  if (raw && !generic && raw !== heading) lines.push(raw);
  if (status && !heading.includes(String(status))) lines.push(`Status: ${status}`);
  if (provider && !heading.includes(provider)) lines.push(`Provider: ${provider}`);
  if (code) lines.push(`Code: ${code}`);
  if (response) lines.push(`Response: ${response}`);
  if (lines.length > 1) return lines.join("\n");

  if (raw && !generic) return raw;
  if (error && typeof error === "object") {
    const serialized = safeStringify(error);
    if (serialized && serialized !== "{}") return serialized;
  }
  return fallback;
}
