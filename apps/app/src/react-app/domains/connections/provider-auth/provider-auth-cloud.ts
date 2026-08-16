/**
 * Cloud provider connect / remove / sync actions extracted from
 * createProviderAuthStore for file-size hygiene.
 */
import { t } from "../../../../i18n";
import {
  createDenClient,
  readDenSettings,
  type DenOrgLlmProvider,
  type DenOrgLlmProviderConnection,
} from "../../../../app/lib/den";
import type { CloudImportedProvider } from "../../../../app/cloud/import-state";
import { dispatchNewProviders } from "../../../../app/lib/provider-events";
import {
  describeProviderError,
  getCloudManagedProviderId,
  getCloudProviderEnv,
  getProviderModelIds,
  sameStringList,
  sortStrings,
} from "./provider-auth-config";

export type CloudProviderSyncReason =
  | "sign_in"
  | "app_launch"
  | "interval"
  | "settings_cloud_opened";

export type ProviderAuthCloudActionsContext = {
  options: {
    client: () => {
      auth: {
        set: (input: {
          providerID: string;
          auth: { type: "api"; key: string };
        }) => Promise<unknown>;
      };
    } | null;
    selectedWorkspaceRoot: () => string;
    runtimeWorkspaceId: () => string | null;
    disabledProviders: () => string[];
    setDisabledProviders: (value: string[]) => void;
    markOpencodeConfigReloadRequired: () => void;
  };
  get state(): { importedCloudProviders: Record<string, CloudImportedProvider> };
  setStateField: (key: "providerAuthError", value: string | null) => void;
  refreshSnapshot: () => void;
  emitChange: () => void;
  persistImportedCloudProviders: (next: Record<string, CloudImportedProvider>) => Promise<void>;
  refreshImportedCloudProviders: () => Promise<Record<string, CloudImportedProvider>>;
  refreshCloudOrgProviders: (optionsArg?: { force?: boolean }) => Promise<DenOrgLlmProvider[]>;
  refreshProviders: (optionsArg?: {
    dispose?: boolean;
  }) => Promise<{ connected?: string[] } | null>;
  assertProviderAllowedByDesktopPolicy: (providerId: string) => void;
  assertCloudProviderImportSafe: (provider: DenOrgLlmProviderConnection) => Promise<void>;
  removeProviderAuthCredentials: (providerId: string) => Promise<void>;
  updateProjectConfigFile: (updater: (raw: string) => string) => Promise<boolean>;
  formatConfigWithCloudProvider: (
    raw: string,
    provider: DenOrgLlmProviderConnection,
    localProviderId: string,
    previousProviderId?: string | null,
  ) => string;
  formatConfigWithoutCloudProvider: (raw: string, providerId: string) => string;
};

export function createProviderAuthCloudActions(ctx: ProviderAuthCloudActionsContext) {
  const options = ctx.options;
  const setStateField = ctx.setStateField;
  const refreshSnapshot = ctx.refreshSnapshot;
  const emitChange = ctx.emitChange;
  const persistImportedCloudProviders = ctx.persistImportedCloudProviders;
  const refreshImportedCloudProviders = ctx.refreshImportedCloudProviders;
  const refreshCloudOrgProviders = ctx.refreshCloudOrgProviders;
  const refreshProviders = ctx.refreshProviders;
  const assertProviderAllowedByDesktopPolicy = ctx.assertProviderAllowedByDesktopPolicy;
  const assertCloudProviderImportSafe = ctx.assertCloudProviderImportSafe;
  const removeProviderAuthCredentials = ctx.removeProviderAuthCredentials;
  const updateProjectConfigFile = ctx.updateProjectConfigFile;
  const formatConfigWithCloudProvider = ctx.formatConfigWithCloudProvider;
  const formatConfigWithoutCloudProvider = ctx.formatConfigWithoutCloudProvider;

  let cloudProviderSyncInFlight: Promise<void> | null = null;
  let cloudProviderSyncQueuedReason: CloudProviderSyncReason | null = null;

  async function connectCloudProviderInternal(
    cloudProviderId: string,
    optionsArg?: { silent?: boolean },
  ) {
    if (!optionsArg?.silent) {
      setStateField("providerAuthError", null);
    }
    const c = options.client();
    if (!c) {
      throw new Error(t("providers.not_connected"));
    }

    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    if (!token || !orgId) {
      throw new Error("Sign in to OnMyAgent Cloud and choose an organization first.");
    }

    try {
      const den = createDenClient({
        baseUrl: settings.baseUrl,
        apiBaseUrl: settings.apiBaseUrl,
        token,
      });
      const provider = await den.getOrgLlmProviderConnection(orgId, cloudProviderId);
      assertProviderAllowedByDesktopPolicy(provider.providerId);
      const existingImported = ctx.state.importedCloudProviders[cloudProviderId] ?? null;
      const localProviderId = getCloudManagedProviderId(provider);
      const apiKey = provider.apiKey?.trim() ?? "";
      const env = getCloudProviderEnv(provider.providerConfig);
      if (!apiKey && env.length > 0) {
        throw new Error(`${provider.name} does not have a stored organization credential yet.`);
      }

      await assertCloudProviderImportSafe(provider);

      if (apiKey) {
        await c.auth.set({
          providerID: localProviderId,
          auth: { type: "api", key: apiKey },
        });
      }
      if (existingImported?.providerId && existingImported.providerId !== localProviderId) {
        try {
          await removeProviderAuthCredentials(existingImported.providerId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? "");
          if (!/not found|unknown auth|404/i.test(message.toLowerCase())) {
            throw error;
          }
        }
      }
      const updatedConfig = await updateProjectConfigFile((raw) =>
        formatConfigWithCloudProvider(
          raw,
          provider,
          localProviderId,
          existingImported?.providerId ?? null,
        ),
      );
      if (!updatedConfig) {
        throw new Error("Could not update opencode.jsonc for this workspace.");
      }

      const nextImportedProviders = {
        ...ctx.state.importedCloudProviders,
        [provider.id]: {
          cloudProviderId: provider.id,
          providerId: localProviderId,
          // Track the provider id as shipped by the server at import time
          // so we can detect local/remote drift later (see dev #1510 "key
          // cloud providers by cloud id"). On first import both match.
          sourceProviderId: provider.providerId,
          name: provider.name,
          source: provider.source,
          updatedAt: provider.updatedAt ?? null,
          modelIds: getProviderModelIds(provider),
          importedAt: Date.now(),
        },
      };
      await persistImportedCloudProviders(nextImportedProviders);

      const nextDisabledProviders = options
        .disabledProviders()
        .filter((id) => id !== localProviderId && id !== existingImported?.providerId);
      options.setDisabledProviders(nextDisabledProviders);
      options.markOpencodeConfigReloadRequired();
      refreshSnapshot();
      emitChange();
      return `${t("status.connected")} ${provider.name}`;
    } catch (error) {
      const message = describeProviderError(error, "Failed to connect organization provider.");
      if (!optionsArg?.silent) {
        setStateField("providerAuthError", message);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function connectCloudProvider(cloudProviderId: string) {
    return await connectCloudProviderInternal(cloudProviderId);
  }

  async function removeCloudProviderInternal(
    cloudProviderId: string,
    optionsArg?: { silent?: boolean },
  ) {
    if (!optionsArg?.silent) {
      setStateField("providerAuthError", null);
    }
    const imported = ctx.state.importedCloudProviders[cloudProviderId];
    if (!imported) {
      throw new Error("This cloud provider has not been imported into the workspace.");
    }

    try {
      try {
        await removeProviderAuthCredentials(imported.providerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (!/not found|unknown auth|404/i.test(message.toLowerCase())) {
          throw error;
        }
      }
      const updatedConfig = await updateProjectConfigFile((raw) =>
        formatConfigWithoutCloudProvider(raw, imported.providerId),
      );
      if (!updatedConfig) {
        throw new Error("Could not update opencode.jsonc for this workspace.");
      }

      const nextImportedProviders = { ...ctx.state.importedCloudProviders };
      delete nextImportedProviders[cloudProviderId];
      await persistImportedCloudProviders(nextImportedProviders);

      options.setDisabledProviders(
        options.disabledProviders().filter((id) => id !== imported.providerId),
      );
      options.markOpencodeConfigReloadRequired();
      refreshSnapshot();
      emitChange();
      return `${t("providers.disconnected_prefix")} ${imported.name}`;
    } catch (error) {
      const message = describeProviderError(error, t("providers.disconnect_failed"));
      if (!optionsArg?.silent) {
        setStateField("providerAuthError", message);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function removeCloudProvider(cloudProviderId: string) {
    return await removeCloudProviderInternal(cloudProviderId);
  }

  const logCloudProviderSyncError = (reason: CloudProviderSyncReason, error: unknown) => {
    const message = describeProviderError(error, "Cloud provider sync failed.");
    console.warn(`[cloud-provider-sync:${reason}] ${message}`);
    return message;
  };

  const hasCloudProviderSyncPrerequisites = () => {
    const settings = readDenSettings();
    const workspaceTarget =
      options.selectedWorkspaceRoot().trim() || options.runtimeWorkspaceId() || "";
    return Boolean(
      options.client() &&
        settings.authToken?.trim() &&
        settings.activeOrgId?.trim() &&
        workspaceTarget,
    );
  };

  const isCloudProviderOutOfSync = (
    provider: DenOrgLlmProvider,
    importedProvider: CloudImportedProvider,
  ) =>
    importedProvider.providerId !== getCloudManagedProviderId(provider) ||
    importedProvider.sourceProviderId !== provider.providerId ||
    (importedProvider.source ?? null) !== provider.source ||
    (importedProvider.updatedAt ?? null) !== (provider.updatedAt ?? null) ||
    !sameStringList(
      importedProvider.modelIds,
      sortStrings(provider.models.map((model) => model.id)),
    );

  async function performCloudProviderSync(reason: CloudProviderSyncReason) {
    if (!hasCloudProviderSyncPrerequisites()) {
      return;
    }

    const [importedProviders, liveProviders] = await Promise.all([
      refreshImportedCloudProviders(),
      refreshCloudOrgProviders({ force: true }),
    ]);
    const liveProviderMap = new Map(liveProviders.map((provider) => [provider.id, provider]));
    const failures: string[] = [];
    const processedLiveProviderIds = new Set<string>();
    let configChanged = false;

    for (const importedProvider of Object.values(importedProviders)) {
      const liveProvider = liveProviderMap.get(importedProvider.cloudProviderId);
      if (!liveProvider) {
        try {
          await removeCloudProviderInternal(importedProvider.cloudProviderId, { silent: true });
          configChanged = true;
        } catch (error) {
          failures.push(logCloudProviderSyncError(reason, error));
        }
        continue;
      }

      processedLiveProviderIds.add(liveProvider.id);

      if (!isCloudProviderOutOfSync(liveProvider, importedProvider)) {
        continue;
      }

      try {
        await removeCloudProviderInternal(importedProvider.cloudProviderId, { silent: true });
        await connectCloudProviderInternal(liveProvider.id, { silent: true });
        configChanged = true;
      } catch (error) {
        failures.push(logCloudProviderSyncError(reason, error));
      }
    }

    const nextImportedProviders = ctx.state.importedCloudProviders;
    const newlyImported: Array<{
      id: string;
      name: string;
      providerId: string;
      firstModelId?: string;
      firstModelName?: string;
    }> = [];
    for (const liveProvider of liveProviders) {
      if (processedLiveProviderIds.has(liveProvider.id)) {
        continue;
      }
      if (nextImportedProviders[liveProvider.id]) {
        continue;
      }

      try {
        await connectCloudProviderInternal(liveProvider.id, { silent: true });
        configChanged = true;
        const firstModel = liveProvider.models[0] ?? null;
        newlyImported.push({
          id: liveProvider.id,
          name: liveProvider.name,
          providerId: liveProvider.providerId,
          firstModelId: firstModel?.id,
          firstModelName: firstModel?.name ?? firstModel?.id,
        });
      } catch (error) {
        failures.push(logCloudProviderSyncError(reason, error));
      }
    }

    if (configChanged) {
      await refreshProviders({ dispose: true }).catch(() => null);
    }

    // Notify the UI about newly imported providers so the global toast
    // can be shown regardless of which route is active.
    if (newlyImported.length > 0) {
      dispatchNewProviders({
        providers: newlyImported,
        source: reason === "sign_in" ? "sign_in" : "cloud_sync",
      });
    }

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }
  }

  async function runCloudProviderSync(reason: CloudProviderSyncReason) {
    if (cloudProviderSyncInFlight) {
      cloudProviderSyncQueuedReason = reason;
      return cloudProviderSyncInFlight;
    }

    const request = performCloudProviderSync(reason)
      .catch((error) => {
        const message = logCloudProviderSyncError(reason, error);
        if (reason === "settings_cloud_opened") {
          setStateField("providerAuthError", message);
        }
      })
      .finally(() => {
        cloudProviderSyncInFlight = null;
        const queuedReason = cloudProviderSyncQueuedReason;
        cloudProviderSyncQueuedReason = null;
        if (queuedReason) {
          void runCloudProviderSync(queuedReason);
        }
      });

    cloudProviderSyncInFlight = request;
    return request;
  }

  return {
    connectCloudProvider,
    connectCloudProviderInternal,
    removeCloudProvider,
    removeCloudProviderInternal,
    runCloudProviderSync,
    hasCloudProviderSyncPrerequisites,
  };
}
