import { useSyncExternalStore } from "react";

import { parse } from "jsonc-parser";
import type { ProviderAuthAuthorization, ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import { t } from "../../../../i18n";
import {
  createDenClient,
  readDenSettings,
  type DenOrgLlmProvider,
  type DenOrgLlmProviderConnection,
} from "../../../../app/lib/den";
import { unwrap, waitForHealthy } from "../../../../app/lib/opencode";
import {
  readOpencodeConfig,
  writeOpencodeConfig,
  workspaceOnMyAgentRead,
  workspaceOnMyAgentWrite,
} from "../../../../app/lib/desktop";
import type { Client, ProviderListItem, WorkspaceDisplay } from "../../../../app/types";
import { isDesktopRuntime } from "../../../../app/utils";
import { compareProviders, filterProviderList } from "../../../../app/utils/providers";
import { getReactQueryClient } from "../../../infra/query-client";
import { ensureProviderListQuery } from "../../connections/provider-list-query";
import {
  disabledProvidersListsEqual,
  isBuiltinOpenCodeZenProvider,
  nextDisabledProvidersList,
  normalizeDisabledProviders,
} from "./disabled-and-disconnect";
import {
  buildCloudProviderMethod,
  describeProviderError,
  formatConfigWithCloudProvider as formatConfigWithCloudProviderPure,
  formatConfigWithoutCloudProvider as formatConfigWithoutCloudProviderPure,
  formatConfigWithProviderDisabledState,
  getCloudManagedProviderId,
  getCloudProviderEnv,
  getProviderModelIds,
  sameStringList,
  sortStrings,
} from "./provider-auth-config";
import type { OnMyAgentServerStore } from "../../shared";
import {
  denSessionUpdatedEvent,
  type DenSessionUpdatedDetail,
} from "../../../../app/lib/den-session-events";
import {
  readWorkspaceCloudImports,
  withWorkspaceCloudImports,
  type CloudImportedProvider,
} from "../../../../app/cloud/import-state";
import { dispatchNewProviders } from "../../../../app/lib/provider-events";
import {
  isDesktopProviderBlocked,
  type DesktopAppRestrictionChecker,
} from "../../../../app/cloud/desktop-app-restrictions";
import type {
  ProviderAuthMethod,
  ProviderAuthProvider,
  ProviderOAuthStartResult,
} from "../../connections/provider-auth-types";

import { createProviderAuthCloudActions } from "./provider-auth-cloud";
import { createProviderAuthOAuthActions } from "./provider-auth-oauth";

type ProviderReturnFocusTarget = "none" | "composer";

type OpencodeTransportClient = {
  delete: (options: { url: string }) => Promise<unknown>;
};

/** Read the SDK's protected HTTP transport via Reflect (no double-cast). */
function readOpencodeTransportClient(client: Client): OpencodeTransportClient | null {
  if (!client || typeof client !== "object") return null;
  const transport = Reflect.get(client, "client");
  if (!transport || typeof transport !== "object") return null;
  const deleteFn = Reflect.get(transport, "delete");
  if (typeof deleteFn !== "function") return null;
  return {
    delete: (options) =>
      (deleteFn as (options: { url: string }) => Promise<unknown>).call(transport, options),
  };
}

export type ProviderAuthStoreSnapshot = {
  providerAuthModalOpen: boolean;
  providerAuthBusy: boolean;
  providerAuthError: string | null;
  providerAuthMethods: Record<string, ProviderAuthMethod[]>;
  providerAuthPreferredProviderId: string | null;
  providerAuthWorkerType: "local" | "remote";
  providerAuthProviders: ProviderAuthProvider[];
  cloudOrgProviders: DenOrgLlmProvider[];
  importedCloudProviders: Record<string, CloudImportedProvider>;
};

type CreateProviderAuthStoreOptions = {
  client: () => Client | null;
  providers: () => ProviderListItem[];
  providerDefaults: () => Record<string, string>;
  providerConnectedIds: () => string[];
  disabledProviders: () => string[];
  checkDesktopAppRestriction: DesktopAppRestrictionChecker;
  selectedWorkspaceDisplay: () => WorkspaceDisplay;
  selectedWorkspaceRoot: () => string;
  runtimeWorkspaceId: () => string | null;
  onmyagentServer: OnMyAgentServerStore;
  setProviders: (value: ProviderListItem[]) => void;
  setProviderDefaults: (value: Record<string, string>) => void;
  setProviderConnectedIds: (value: string[]) => void;
  setDisabledProviders: (value: string[]) => void;
  markOpencodeConfigReloadRequired: () => void;
  focusPromptSoon?: () => void;
};

type MutableState = {
  providerAuthModalOpen: boolean;
  providerAuthBusy: boolean;
  providerAuthError: string | null;
  providerAuthMethods: Record<string, ProviderAuthMethod[]>;
  providerAuthPreferredProviderId: string | null;
  providerAuthReturnFocusTarget: ProviderReturnFocusTarget;
  cloudOrgProviders: DenOrgLlmProvider[];
  importedCloudProviders: Record<string, CloudImportedProvider>;
};

export type ProviderAuthStore = ReturnType<typeof createProviderAuthStore>;

export function createProviderAuthStore(options: CreateProviderAuthStoreOptions) {
  const listeners = new Set<() => void>();

  let snapshot: ProviderAuthStoreSnapshot;
  let disposed = false;
  let started = false;
  let denSessionCleanup: (() => void) | null = null;
  let lastWorkspaceKey = "";

  let state: MutableState = {
    providerAuthModalOpen: false,
    providerAuthBusy: false,
    providerAuthError: null,
    providerAuthMethods: {},
    providerAuthPreferredProviderId: null,
    providerAuthReturnFocusTarget: "none",
    cloudOrgProviders: [],
    importedCloudProviders: {},
  };

  let cloudOrgProvidersLoadKey = "";
  let cloudOrgProvidersInFlightKey = "";
  let cloudOrgProvidersInFlight: Promise<DenOrgLlmProvider[]> | null = null;

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getProviderAuthWorkerType = (): "local" | "remote" =>
    options.selectedWorkspaceDisplay().workspaceType === "remote" ? "remote" : "local";

  const getProviderAuthProviders = (): ProviderAuthProvider[] => {
    const merged = new Map<string, ProviderAuthProvider>();

    for (const provider of options.providers()) {
      const id = provider.id?.trim();
      if (!id) continue;
      if (
        isDesktopProviderBlocked({
          providerId: id,
          checkRestriction: options.checkDesktopAppRestriction,
        })
      )
        continue;
      merged.set(id, {
        id,
        name: provider.name?.trim() || id,
        env: Array.isArray(provider.env) ? provider.env : [],
      });
    }

    for (const provider of state.cloudOrgProviders) {
      const id = provider.providerId.trim();
      if (!id || merged.has(id)) continue;
      if (
        isDesktopProviderBlocked({
          providerId: id,
          checkRestriction: options.checkDesktopAppRestriction,
        })
      )
        continue;
      merged.set(id, {
        id,
        name: provider.name.trim() || id,
        env: getCloudProviderEnv(provider.providerConfig),
      });
    }

    return Array.from(merged.values()).toSorted(compareProviders);
  };

  const refreshSnapshot = () => {
    snapshot = {
      providerAuthModalOpen: state.providerAuthModalOpen,
      providerAuthBusy: state.providerAuthBusy,
      providerAuthError: state.providerAuthError,
      providerAuthMethods: state.providerAuthMethods,
      providerAuthPreferredProviderId: state.providerAuthPreferredProviderId,
      providerAuthWorkerType: getProviderAuthWorkerType(),
      providerAuthProviders: getProviderAuthProviders(),
      cloudOrgProviders: state.cloudOrgProviders,
      importedCloudProviders: state.importedCloudProviders,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const readWorkspaceOnMyAgentConfigRecord = async (): Promise<Record<string, unknown>> => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.selectedWorkspaceDisplay().workspaceType === "local";
    const onmyagentSnapshot = options.onmyagentServer.getSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentCapabilities = onmyagentSnapshot.onmyagentServerCapabilities;
    const canUseOnMyAgentServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentCapabilities?.config?.read;

    if (canUseOnMyAgentServer) {
      const config = await onmyagentClient.getConfig(onmyagentWorkspaceId);
      return config.onmyagent ?? {};
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      return await workspaceOnMyAgentRead({
        workspacePath: root,
      });
    }

    return {};
  };

  const writeWorkspaceOnMyAgentConfigRecord = async (config: Record<string, unknown>) => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.selectedWorkspaceDisplay().workspaceType === "local";
    const onmyagentSnapshot = options.onmyagentServer.getSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentCapabilities = onmyagentSnapshot.onmyagentServerCapabilities;
    const canUseOnMyAgentServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentCapabilities?.config?.write;

    if (canUseOnMyAgentServer) {
      await onmyagentClient.patchConfig(onmyagentWorkspaceId, { onmyagent: config });
      return true;
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      const result = await workspaceOnMyAgentWrite({
        workspacePath: root,
        config: config as never,
      });
      const typed = result as { ok: boolean; stderr?: string; stdout?: string };
      if (!typed.ok) {
        throw new Error(typed.stderr || typed.stdout || "Failed to write .opencode/onmyagent.json");
      }
      return true;
    }

    return false;
  };

  const refreshImportedCloudProviders = async () => {
    try {
      const config = await readWorkspaceOnMyAgentConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudProviders", cloudImports.providers);
      return cloudImports.providers;
    } catch {
      setStateField("importedCloudProviders", {});
      return {};
    }
  };

  const persistImportedCloudProviders = async (
    nextProviders: Record<string, CloudImportedProvider>,
  ) => {
    const config = await readWorkspaceOnMyAgentConfigRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextConfig = withWorkspaceCloudImports(config, {
      ...cloudImports,
      providers: nextProviders,
    });
    const persisted = await writeWorkspaceOnMyAgentConfigRecord(nextConfig);
    if (!persisted) {
      throw new Error("OnMyAgent server unavailable. Connect to manage imported cloud providers.");
    }
    setStateField("importedCloudProviders", nextProviders);
  };

  const readProjectConfigFile = async () => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.selectedWorkspaceDisplay().workspaceType === "local";
    const onmyagentSnapshot = options.onmyagentServer.getSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentCapabilities = onmyagentSnapshot.onmyagentServerCapabilities;
    const canUseOnMyAgentServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentCapabilities?.config?.read &&
      typeof onmyagentClient.readOpencodeConfigFile === "function";

    if (canUseOnMyAgentServer) {
      return await onmyagentClient.readOpencodeConfigFile(onmyagentWorkspaceId, "project");
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      return await readOpencodeConfig("project", root);
    }

    return null;
  };

  const writeProjectConfigFile = async (content: string) => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.selectedWorkspaceDisplay().workspaceType === "local";
    const onmyagentSnapshot = options.onmyagentServer.getSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentCapabilities = onmyagentSnapshot.onmyagentServerCapabilities;
    const canUseOnMyAgentServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentCapabilities?.config?.write &&
      typeof onmyagentClient.writeOpencodeConfigFile === "function";

    if (canUseOnMyAgentServer) {
      const result = (await onmyagentClient.writeOpencodeConfigFile(
        onmyagentWorkspaceId,
        "project",
        content,
      )) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Failed to write opencode.jsonc");
      }
      return true;
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      const result = (await writeOpencodeConfig("project", root, content)) as {
        ok: boolean;
        stderr?: string;
        stdout?: string;
      };
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Failed to write opencode.jsonc");
      }
      return true;
    }

    return false;
  };

  const updateProjectConfigFile = async (
    updater: (raw: string) => string,
    fallbackUpdate?: (config: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const configFile = (await readProjectConfigFile()) as { content?: string } | null;
    if (configFile) {
      const raw = configFile.content?.trim()
        ? configFile.content
        : '{\n "$schema": "https://opencode.ai/config.json"\n}\n';
      await writeProjectConfigFile(updater(raw));
      return true;
    }

    if (!fallbackUpdate) {
      return false;
    }

    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }
    const config = unwrap(await c.config.get());
    const next = fallbackUpdate(config);
    await c.config.update({ config: next });
    return true;
  };

  const ensureProjectProviderDisabledState = async (providerId: string, disabled: boolean) => {
    const resolvedProviderId = providerId.trim();
    if (!resolvedProviderId) {
      throw new Error(t("providers.provider_id_required"));
    }

    const currentDisabled = normalizeDisabledProviders(options.disabledProviders());
    const nextDisabled = nextDisabledProvidersList(currentDisabled, resolvedProviderId, disabled);

    if (disabledProvidersListsEqual(currentDisabled, nextDisabled)) {
      return false;
    }

    const updatedConfig = await updateProjectConfigFile(
      (raw) => formatConfigWithProviderDisabledState(raw, resolvedProviderId, disabled),
      (config) => {
        const nextConfig = { ...config };
        if (nextDisabled.length) {
          nextConfig.disabled_providers = nextDisabled;
        } else {
          delete nextConfig.disabled_providers;
        }
        return nextConfig;
      },
    );

    if (!updatedConfig) {
      throw new Error("Could not update opencode.jsonc for this workspace.");
    }

    options.setDisabledProviders(nextDisabled);
    options.markOpencodeConfigReloadRequired();
    refreshSnapshot();
    emitChange();
    return true;
  };

  const assertProviderAllowedByDesktopPolicy = (providerId: string) => {
    if (
      isDesktopProviderBlocked({
        providerId,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      throw new Error(`${providerId} is blocked by your organization desktop policy.`);
    }
  };

  const formatConfigWithCloudProvider = (
    raw: string,
    provider: DenOrgLlmProviderConnection,
    localProviderId: string,
    previousProviderId?: string | null,
  ) =>
    formatConfigWithCloudProviderPure(
      raw,
      provider,
      localProviderId,
      previousProviderId,
      options.disabledProviders(),
    );

  const formatConfigWithoutCloudProvider = (raw: string, providerId: string) =>
    formatConfigWithoutCloudProviderPure(raw, providerId, options.disabledProviders());

  // Sweep all cloud-managed provider entries (keys matching /^lpr_/) from
  // opencode.jsonc regardless of importedCloudProviders state. Returns the
  // list of provider IDs that were removed so callers can also clear their
  // auth credentials.
  const sweepOrphanCloudProvidersFromConfig = async (): Promise<string[]> => {
    const configFile = (await readProjectConfigFile()) as { content?: string } | null;
    if (!configFile?.content?.trim()) return [];
    const parsed = parse(configFile.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const providerSection = (parsed as Record<string, unknown>).provider;
    if (!providerSection || typeof providerSection !== "object" || Array.isArray(providerSection)) {
      return [];
    }
    const orphanIds = Object.keys(providerSection as Record<string, unknown>).filter((key) =>
      /^lpr_/i.test(key),
    );
    if (orphanIds.length === 0) return [];

    await updateProjectConfigFile((raw) => {
      let next = raw;
      for (const id of orphanIds) {
        next = formatConfigWithoutCloudProvider(next, id);
      }
      return next;
    });
    return orphanIds;
  };

  const assertCloudProviderImportSafe = async (provider: DenOrgLlmProviderConnection) => {
    const localProviderId = getCloudManagedProviderId(provider);
    const existingImported = state.importedCloudProviders[provider.id] ?? null;
    if (
      existingImported &&
      existingImported.providerId !== localProviderId &&
      Object.values(state.importedCloudProviders).some(
        (entry) => entry.providerId === localProviderId && entry.cloudProviderId !== provider.id,
      )
    ) {
      throw new Error(
        `${localProviderId} is already imported from another cloud provider. Remove it before importing this one.`,
      );
    }

    if (!existingImported && options.providerConnectedIds().includes(localProviderId)) {
      throw new Error(
        `${localProviderId} is already connected in this workspace. Disconnect it before importing the cloud-managed version.`,
      );
    }

    const configFile = (await readProjectConfigFile()) as { content?: string } | null;
    if (!configFile?.content?.trim() || existingImported) {
      return;
    }

    const parsed = parse(configFile.content);
    const providerSection =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).provider
        : null;
    if (
      providerSection &&
      typeof providerSection === "object" &&
      !Array.isArray(providerSection) &&
      localProviderId in (providerSection as Record<string, unknown>)
    ) {
      throw new Error(
        `${localProviderId} already has a provider block in opencode.jsonc. Remove it before importing the cloud-managed version.`,
      );
    }
  };

  const getCloudOrgProvidersKey = () => {
    const settings = readDenSettings();
    return [
      settings.baseUrl,
      settings.apiBaseUrl ?? "",
      settings.activeOrgId?.trim() ?? "",
      settings.authToken?.trim() ?? "",
    ].join("::");
  };

  const refreshCloudOrgProviders = async (optionsArg?: { force?: boolean }) => {
    const settings = readDenSettings();
    const loadKey = getCloudOrgProvidersKey();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";

    if (!optionsArg?.force && cloudOrgProvidersLoadKey === loadKey) {
      return state.cloudOrgProviders;
    }

    if (cloudOrgProvidersInFlight && cloudOrgProvidersInFlightKey === loadKey) {
      return cloudOrgProvidersInFlight;
    }

    if (!token || !orgId) {
      setStateField("cloudOrgProviders", []);
      cloudOrgProvidersLoadKey = loadKey;
      return [];
    }

    const client = createDenClient({
      baseUrl: settings.baseUrl,
      apiBaseUrl: settings.apiBaseUrl,
      token,
    });
    const request = client
      .listOrgLlmProviders(orgId)
      .then((providers) => {
        setStateField("cloudOrgProviders", providers);
        cloudOrgProvidersLoadKey = loadKey;
        return providers;
      })
      .catch((error) => {
        setStateField("cloudOrgProviders", []);
        cloudOrgProvidersLoadKey = "";
        throw error;
      })
      .finally(() => {
        if (cloudOrgProvidersInFlightKey === loadKey) {
          cloudOrgProvidersInFlight = null;
          cloudOrgProvidersInFlightKey = "";
        }
      });

    cloudOrgProvidersInFlight = request;
    cloudOrgProvidersInFlightKey = loadKey;
    return request;
  };

  // Track whether the provider list has been loaded at least once.
  // The first load (app startup) populates the initial state — we don't
  // want to fire "new provider" events for providers that were already
  // there. After the first load, any new provider IS genuinely new.
  let providerListInitialized = false;

  const applyProviderListState = (
    value: ProviderListResponse,
    opts?: { suppressNewProviderEvent?: boolean },
  ) => {
    const prevConnected = new Set(options.providerConnectedIds());
    const nextConnected = value.connected ?? [];
    const nextAll = value.all ?? [];
    options.setProviders(nextAll);
    options.setProviderDefaults(value.default ?? {});
    options.setProviderConnectedIds(nextConnected);
    refreshSnapshot();
    emitChange();

    if (!providerListInitialized) {
      providerListInitialized = true;
      return;
    }

    // Detect newly connected providers and fire a global event so
    // the NewProvidersToast shows — regardless of which route is active.
    if (!opts?.suppressNewProviderEvent) {
      const newIds = nextConnected.filter((id) => !prevConnected.has(id));
      if (newIds.length > 0) {
        const infos = newIds.map((id) => {
          const provider = nextAll.find((p) => (p.id ?? "") === id);
          const models = provider?.models ?? {};
          const firstModelId = Object.keys(models)[0];
          return {
            id,
            name: provider?.name ?? id,
            providerId: id,
            firstModelId,
            firstModelName: firstModelId ? (models[firstModelId]?.name ?? firstModelId) : undefined,
          };
        });
        dispatchNewProviders({ providers: infos, source: "local_config" });
      }
    }
  };

  const removeProviderFromState = (providerId: string) => {
    const resolved = providerId.trim();
    if (!resolved) return;
    options.setProviders(options.providers().filter((provider) => provider.id !== resolved));
    options.setProviderConnectedIds(options.providerConnectedIds().filter((id) => id !== resolved));
    options.setProviderDefaults(
      Object.fromEntries(
        Object.entries(options.providerDefaults()).filter(([id]) => id !== resolved),
      ),
    );
    refreshSnapshot();
    emitChange();
  };

  const assertNoClientError = (result: unknown) => {
    const maybe = result as { error?: unknown } | null | undefined;
    if (!maybe || maybe.error === undefined) return;
    throw new Error(describeProviderError(maybe.error, t("providers.request_failed")));
  };

  const removeProviderAuthCredentials = async (providerId: string) => {
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }

    // Prefer the typed Auth API; fall back to raw transport DELETE for older
    // OpenCode clients that only expose credential removal via HTTP.
    if (typeof c.auth.remove === "function") {
      const result = await c.auth.remove({ providerID: providerId });
      assertNoClientError(result);
      return;
    }

    const transport = readOpencodeTransportClient(c);
    if (transport) {
      await transport.delete({ url: `/auth/${encodeURIComponent(providerId)}` });
      return;
    }

    if (typeof c.auth.set === "function") {
      const result = await c.auth.set({ providerID: providerId });
      assertNoClientError(result);
      return;
    }

    throw new Error(t("providers.removal_unsupported"));
  };

  const buildProviderAuthMethods = (
    methods: Record<string, ProviderAuthMethod[]>,
    availableProviders: ProviderAuthProvider[],
    workerType: "local" | "remote",
    cloudProviders: DenOrgLlmProvider[],
  ) => {
    const merged = Object.fromEntries(
      Object.entries(methods ?? {}).map(([id, providerMethods]) => [
        id,
        (providerMethods ?? []).map((method, methodIndex) => ({
          ...method,
          methodIndex,
        })),
      ]),
    ) as Record<string, ProviderAuthMethod[]>;

    for (const provider of availableProviders ?? []) {
      const id = provider.id?.trim();
      if (!id) continue;
      if (
        isDesktopProviderBlocked({
          providerId: id,
          checkRestriction: options.checkDesktopAppRestriction,
        })
      )
        continue;
      if (!Array.isArray(provider.env) || provider.env.length === 0) continue;
      const existing = merged[id] ?? [];
      if (existing.some((method) => method.type === "api")) continue;
      merged[id] = [...existing, { type: "api", label: t("providers.api_key_label") }];
    }

    const availableProvidersById = new Map(
      (availableProviders ?? []).map((provider) => [provider.id, provider]),
    );
    for (const [id, providerMethods] of Object.entries(merged)) {
      if (
        isDesktopProviderBlocked({
          providerId: id,
          checkRestriction: options.checkDesktopAppRestriction,
        })
      ) {
        delete merged[id];
        continue;
      }
      const provider = availableProvidersById.get(id);
      const normalizedId = id.trim().toLowerCase();
      const normalizedName = provider?.name?.trim().toLowerCase() ?? "";
      const isOpenAiProvider = normalizedId === "openai" || normalizedName === "openai";
      if (!isOpenAiProvider) continue;
      merged[id] = providerMethods.filter((method) => {
        if (method.type !== "oauth") return true;
        const label = method.label.toLowerCase();
        const isHeadless = /headless|device/.test(label);
        return workerType === "remote" ? isHeadless : !isHeadless;
      });
    }

    for (const provider of cloudProviders) {
      const id = provider.providerId.trim();
      if (!id) continue;
      if (
        isDesktopProviderBlocked({
          providerId: id,
          checkRestriction: options.checkDesktopAppRestriction,
        })
      )
        continue;
      const existing = merged[id] ?? [];
      if (
        existing.some((method) => method.type === "cloud" && method.cloudProviderId === provider.id)
      ) {
        continue;
      }
      merged[id] = [...existing, buildCloudProviderMethod(provider)];
    }

    return merged;
  };

  const loadProviderAuthMethods = async (workerType: "local" | "remote") => {
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }
    const methods = unwrap(await c.provider.auth());
    const cloudProviders = await refreshCloudOrgProviders().catch(() => [] as DenOrgLlmProvider[]);
    return buildProviderAuthMethods(
      methods as Record<string, ProviderAuthMethod[]>,
      getProviderAuthProviders(),
      workerType,
      cloudProviders,
    );
  };

  async function refreshProviders(optionsArg?: { dispose?: boolean }) {
    const c = options.client();
    if (!c) return null;

    if (optionsArg?.dispose) {
      try {
        unwrap(await c.instance.dispose());
      } catch {
        // ignore dispose failures and try reading current state anyway
      }

      try {
        await waitForHealthy(options.client() ?? c, { timeoutMs: 8000, pollMs: 250 });
      } catch {
        // ignore health wait failures and still attempt provider reads
      }
    }

    const activeClient = options.client() ?? c;
    let disabledProviders = options.disabledProviders() ?? [];
    try {
      const config = unwrap(await activeClient.config.get());
      disabledProviders = Array.isArray(config.disabled_providers) ? config.disabled_providers : [];
      options.setDisabledProviders(disabledProviders);
      refreshSnapshot();
      emitChange();
    } catch {
      // ignore config read failures and continue with current store state
    }

    try {
      const updated = filterProviderList(
        await ensureProviderListQuery(getReactQueryClient(), {
          client: activeClient,
          directory: options.selectedWorkspaceRoot(),
          force: Boolean(optionsArg?.dispose),
        }),
        disabledProviders,
      );
      applyProviderListState(updated);
      return updated;
    } catch {
      return null;
    }
  }

  const oauthActions = createProviderAuthOAuthActions({
    get options() {
      return options;
    },
    get state() {
      return state;
    },
    setStateField,
    getProviderAuthWorkerType,
    loadProviderAuthMethods,
    assertProviderAllowedByDesktopPolicy,
    refreshProviders,
    assertNoClientError,
  });
  const { startProviderAuth, completeProviderAuthOAuth, submitProviderApiKey } = oauthActions;

  const cloudActions = createProviderAuthCloudActions({
    get options() {
      return options;
    },
    get state() {
      return state;
    },
    setStateField,
    refreshSnapshot,
    emitChange,
    persistImportedCloudProviders,
    refreshImportedCloudProviders,
    refreshCloudOrgProviders,
    refreshProviders,
    assertProviderAllowedByDesktopPolicy,
    assertCloudProviderImportSafe,
    removeProviderAuthCredentials,
    updateProjectConfigFile,
    formatConfigWithCloudProvider,
    formatConfigWithoutCloudProvider,
  });
  const {
    connectCloudProvider,
    connectCloudProviderInternal,
    removeCloudProvider,
    removeCloudProviderInternal,
    runCloudProviderSync,
    hasCloudProviderSyncPrerequisites,
  } = cloudActions;

  async function disconnectProvider(providerId: string) {
    setStateField("providerAuthError", null);
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }

    const resolved = providerId.trim();
    if (!resolved) {
      throw new Error(t("providers.provider_id_required"));
    }

    const trackedImport = Object.values(state.importedCloudProviders).find(
      (entry) => entry.providerId === resolved,
    );
    if (trackedImport) {
      return await removeCloudProvider(trackedImport.cloudProviderId);
    }

    try {
      // Built-in free OpenCode Zen stays "connected" without credentials.
      // Disconnect for that provider means disable it in workspace config.
      const isBuiltinOpenCodeZen = isBuiltinOpenCodeZenProvider(resolved);
      if (!isBuiltinOpenCodeZen) {
        await removeProviderAuthCredentials(resolved);
      }
      const updated = await refreshProviders({ dispose: true });
      if (Array.isArray(updated?.connected) && updated.connected.includes(resolved)) {
        if (isBuiltinOpenCodeZen) {
          await ensureProjectProviderDisabledState(resolved, true);
          removeProviderFromState(resolved);
          return `${t("providers.disconnected_prefix")} ${resolved}`;
        }
        // Other providers still connected (e.g. via env var): remove stored
        // credentials only; do NOT add to disabled_providers.
        return `Removed stored credentials for ${resolved}${t("providers.still_connected_suffix")}`;
      }
      removeProviderFromState(resolved);
      return `${t("providers.disconnected_prefix")} ${resolved}`;
    } catch (error) {
      const message = describeProviderError(error, t("providers.disconnect_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function openProviderAuthModal(optionsArg?: {
    returnFocusTarget?: ProviderReturnFocusTarget;
    preferredProviderId?: string;
  }) {
    mutateState((current) => ({
      ...current,
      providerAuthReturnFocusTarget: optionsArg?.returnFocusTarget ?? "none",
      providerAuthPreferredProviderId: optionsArg?.preferredProviderId?.trim() || null,
      providerAuthBusy: true,
      providerAuthError: null,
    }));

    try {
      const methods = await loadProviderAuthMethods(getProviderAuthWorkerType());
      mutateState((current) => ({
        ...current,
        providerAuthMethods: methods,
        providerAuthModalOpen: true,
      }));
    } catch (error) {
      const message = describeProviderError(error, t("providers.load_failed"));
      mutateState((current) => ({
        ...current,
        providerAuthPreferredProviderId: null,
        providerAuthReturnFocusTarget: "none",
        providerAuthError: message,
      }));
      throw error;
    } finally {
      setStateField("providerAuthBusy", false);
    }
  }

  function closeProviderAuthModal(optionsArg?: { restorePromptFocus?: boolean }) {
    const shouldFocusPrompt =
      optionsArg?.restorePromptFocus ?? state.providerAuthReturnFocusTarget === "composer";
    mutateState((current) => ({
      ...current,
      providerAuthModalOpen: false,
      providerAuthError: null,
      providerAuthPreferredProviderId: null,
      providerAuthReturnFocusTarget: "none",
    }));
    if (shouldFocusPrompt) {
      options.focusPromptSoon?.();
    }
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const currentWorkspaceKey = () =>
    `${options.selectedWorkspaceRoot().trim()}::${options.runtimeWorkspaceId() ?? ""}`;

  const syncFromOptions = () => {
    const workspaceKey = currentWorkspaceKey();
    const workspaceChanged = workspaceKey !== lastWorkspaceKey;
    lastWorkspaceKey = workspaceKey;
    refreshSnapshot();
    emitChange();
    if (workspaceChanged) {
      // Refresh local import bookkeeping only — do not auto-reconcile Den →
      // opencode.jsonc (product no longer runs background cloud provider sync).
      void refreshImportedCloudProviders();
    }
  };

  const start = () => {
    if (started) return;
    // StrictMode double-mount re-arms after dispose.
    disposed = false;
    started = true;
    lastWorkspaceKey = currentWorkspaceKey();
    if (typeof window !== "undefined") {
      const handleDenSessionUpdate = (event: Event) => {
        cloudOrgProvidersLoadKey = "";
        cloudOrgProvidersInFlightKey = "";
        cloudOrgProvidersInFlight = null;
        const detail = (event as CustomEvent<DenSessionUpdatedDetail>).detail;

        if (detail?.status === "success") {
          // Sign-in: clear cached org provider list so the Settings cloud tab
          // can load fresh if opened. Do not auto-import into opencode.jsonc.
          mutateState((current) => ({
            ...current,
            cloudOrgProviders: [],
            providerAuthMethods: {},
          }));
        } else {
          // Sign-out or error: remove all cloud-imported providers from the workspace
          // Capture the full import records BEFORE clearing state
          const importedProviders = { ...state.importedCloudProviders };
          const importedIds = Object.keys(importedProviders);

          // Best-effort cleanup: remove each cloud provider from opencode.jsonc
          // BEFORE clearing state so removeCloudProviderInternal can find the records
          void (async () => {
            for (const cloudId of importedIds) {
              try {
                await removeCloudProviderInternal(cloudId, { silent: true });
              } catch {
                // Ignore individual removal failures during sign-out cleanup
              }
            }
            // Final sweep: remove any orphan `lpr_*` provider keys that remain
            // in opencode.jsonc but weren't tracked in importedCloudProviders
            // (e.g. from a previous failed cleanup or external edit).
            try {
              const orphans = await sweepOrphanCloudProvidersFromConfig();
              for (const providerId of orphans) {
                try {
                  await removeProviderAuthCredentials(providerId);
                } catch {
                  // Ignore auth removal failures for orphans
                }
              }
              if (orphans.length > 0) {
                options.markOpencodeConfigReloadRequired();
              }
            } catch {
              // Ignore sweep failures during sign-out cleanup
            }
            // Clear state AFTER cleanup so the records are available during removal
            mutateState((current) => ({
              ...current,
              cloudOrgProviders: [],
              providerAuthMethods: {},
              importedCloudProviders: {},
            }));
            refreshSnapshot();
            emitChange();
          })();
        }
      };
      window.addEventListener(denSessionUpdatedEvent, handleDenSessionUpdate as EventListener);
      denSessionCleanup = () => {
        window.removeEventListener(denSessionUpdatedEvent, handleDenSessionUpdate as EventListener);
      };
    }
    void refreshImportedCloudProviders().then((imported) => {
      // Startup cleanup: if no auth token, remove any cloud providers that
      // were left behind. Handles orphans from a previous sign-out that
      // didn't clean up (e.g. crash, force-quit, external edit).
      if (!hasCloudProviderSyncPrerequisites()) {
        void (async () => {
          // First: remove anything tracked in import state
          if (imported && Object.keys(imported).length > 0) {
            for (const cloudId of Object.keys(imported)) {
              try {
                await removeCloudProviderInternal(cloudId, { silent: true });
              } catch {}
            }
          }
          // Then: sweep any `lpr_*` keys that remain in opencode.jsonc
          try {
            const orphans = await sweepOrphanCloudProvidersFromConfig();
            for (const providerId of orphans) {
              try {
                await removeProviderAuthCredentials(providerId);
              } catch {}
            }
            if (orphans.length > 0) {
              options.markOpencodeConfigReloadRequired();
            }
          } catch {}
          mutateState((current) => ({
            ...current,
            importedCloudProviders: {},
          }));
          refreshSnapshot();
          emitChange();
        })();
      }
    });
    refreshSnapshot();
    emitChange();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    denSessionCleanup?.();
    denSessionCleanup = null;
    listeners.clear();
  };

  refreshSnapshot();

  return {
    subscribe,
    getSnapshot: () => snapshot,
    start,
    dispose,
    syncFromOptions,
    refreshCloudOrgProviders,
    runCloudProviderSync,
    startProviderAuth,
    refreshProviders,
    completeProviderAuthOAuth,
    submitProviderApiKey,
    connectCloudProvider,
    removeCloudProvider,
    disconnectProvider,
    ensureProjectProviderDisabledState,
    openProviderAuthModal,
    closeProviderAuthModal,
  };
}

export function useProviderAuthStoreSnapshot(store: ProviderAuthStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
