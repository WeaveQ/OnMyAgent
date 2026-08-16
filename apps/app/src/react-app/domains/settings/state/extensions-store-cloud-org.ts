/**
 * Cloud-org / hub refresh, import, remove, and install actions
 * extracted from createExtensionsStore for file-size hygiene.
 */
import type {
  Client,
  DenOrgSkillCard,
  HubSkillCard,
  ReloadReason,
  ReloadTrigger,
} from "../../../../app/types";
import { addOpencodeCacheHint } from "../../../../app/utils";
import { t } from "../../../../i18n";
import type {
  OnMyAgentHubRepo,
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import type { OnMyAgentServerStore, OnMyAgentServerStoreSnapshot } from "../../shared";
import {
  createDenClient,
  fetchDenOrgSkillsCatalog,
  readDenSettings,
  type DenOrgPlugin,
  type DenOrgPluginResolved,
  type DenOrgSkillHub,
} from "../../../../app/lib/den";
import type { CloudImportedPluginFile } from "../../../../app/cloud/import-state";
import {
  removeCloudPluginFromWorkspace,
  type ExtensionsWorkspaceWriter,
} from "./extensions-store-cloud-import-applier";
import {
  buildCloudSkillHubImportRecord,
  buildCloudSkillImportPlan,
  buildExtensionsCloudOrgRefreshContext,
  buildExtensionsHubSkillsLoadKey,
  hubSkillCardsFromDirectoryNames,
  isStaleExtensionsLoad,
  mapHubSkillListItems,
  parseGithubSkillDirectoryListing,
  resolveOnMyAgentGateway,
  shouldResetExtensionsLoadedForKey,
  shouldSkipExtensionsRefresh,
  sortHubSkillCardsByName,
} from "./extensions-store-model";
import type {
  ExtensionsStoreMutableState,
  ExtensionsStoreSnapshot,
} from "./extensions-store-snapshot";

type MutableState = ExtensionsStoreMutableState;

type OnMyAgentGatewaySnapshot = OnMyAgentServerStoreSnapshot & {
  onmyagentServerClient: OnMyAgentServerClient | null;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
};

type ExtensionsCloudOrgHostOptions = {
  selectedWorkspaceRoot: () => string;
  workspaceType: () => "local" | "remote";
  runtimeWorkspaceId: () => string | null;
  setBusy: (value: boolean) => void;
  setBusyLabel: (value: string | null) => void;
  setBusyStartedAt: (value: number | null) => void;
  setError: (value: string | null) => void;
  onmyagentServer: OnMyAgentServerStore;
  onmyagentServerConnection?: () => {
    onmyagentServerClient: OnMyAgentServerClient | null;
    onmyagentServerStatus: OnMyAgentServerStatus;
    onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
  };
  projectDir: () => string;
  client: () => Client | null;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
};

export type ExtensionsCloudOrgLoadState = {
  refreshHubSkillsInFlight: boolean;
  refreshHubSkillsAborted: boolean;
  hubSkillsLoaded: boolean;
  hubSkillsLoadKey: string;
  refreshCloudOrgSkillsInFlight: boolean;
  refreshCloudOrgSkillsInFlightKey: string;
  refreshCloudOrgSkillsAborted: boolean;
  cloudOrgSkillsLoaded: boolean;
  cloudOrgSkillsLoadKey: string;
  refreshCloudOrgSkillHubsInFlight: boolean;
  refreshCloudOrgSkillHubsInFlightKey: string;
  refreshCloudOrgSkillHubsAborted: boolean;
  cloudOrgSkillHubsLoaded: boolean;
  cloudOrgSkillHubsLoadKey: string;
  refreshCloudOrgMarketplacesInFlight: boolean;
  refreshCloudOrgMarketplacesInFlightKey: string;
  refreshCloudOrgMarketplacesAborted: boolean;
  cloudOrgMarketplacesLoaded: boolean;
  cloudOrgMarketplacesLoadKey: string;
};

export type ExtensionsCloudOrgActionsContext = {
  options: ExtensionsCloudOrgHostOptions;
  get snapshot(): ExtensionsStoreSnapshot;
  mutateState: (updater: (current: MutableState) => MutableState) => void;
  setStateField: <K extends keyof MutableState>(key: K, value: MutableState[K]) => void;
  getOnMyAgentServerSnapshot: () => OnMyAgentGatewaySnapshot;
  getWorkspaceContextKey: () => string;
  getCurrentCloudOrgLoadKey: () => string;
  load: ExtensionsCloudOrgLoadState;
  refreshImportedCloudSkills: () => Promise<unknown>;
  refreshImportedCloudSkillHubs: () => Promise<unknown>;
  refreshImportedCloudPlugins: () => Promise<unknown>;
  persistImportedCloudSkillHubs: (
    next: ExtensionsStoreSnapshot["importedCloudSkillHubs"],
  ) => Promise<void>;
  persistImportedCloudSkills: (
    next: ExtensionsStoreSnapshot["importedCloudSkills"],
  ) => Promise<void>;
  persistImportedCloudPlugins: (
    next: ExtensionsStoreSnapshot["importedCloudPlugins"],
  ) => Promise<void>;
  applyCloudOrgSkillHubImport: (
    hub: DenOrgSkillHub,
    imported?: ExtensionsStoreSnapshot["importedCloudSkillHubs"][string] | null,
  ) => Promise<{ nextSkillIds: string[]; nextSkillNames: string[] }>;
  applyCloudOrgPluginImport: (
    marketplaceId: string | null,
    resolved: DenOrgPluginResolved,
  ) => Promise<CloudImportedPluginFile[]>;
  persistImportedCloudSkillRecord: (
    skill: DenOrgSkillCard,
    installedName: string,
  ) => Promise<unknown>;
  findImportedCloudSkill: (
    cloudSkillId: string,
  ) => ExtensionsStoreSnapshot["importedCloudSkills"][string] | null;
  workspaceWriter: ExtensionsWorkspaceWriter;
  refreshSkills: (optionsOverride?: { force?: boolean }) => Promise<void>;
};

export function createExtensionsCloudOrgActions(ctx: ExtensionsCloudOrgActionsContext) {
  const options = ctx.options;
  const mutateState = ctx.mutateState;
  const setStateField = ctx.setStateField;
  const getOnMyAgentServerSnapshot = ctx.getOnMyAgentServerSnapshot;
  const getWorkspaceContextKey = ctx.getWorkspaceContextKey;
  const getCurrentCloudOrgLoadKey = ctx.getCurrentCloudOrgLoadKey;
  const load = ctx.load;
  const refreshImportedCloudSkills = ctx.refreshImportedCloudSkills;
  const refreshImportedCloudSkillHubs = ctx.refreshImportedCloudSkillHubs;
  const refreshImportedCloudPlugins = ctx.refreshImportedCloudPlugins;
  const persistImportedCloudSkillHubs = ctx.persistImportedCloudSkillHubs;
  const persistImportedCloudSkills = ctx.persistImportedCloudSkills;
  const persistImportedCloudPlugins = ctx.persistImportedCloudPlugins;
  const applyCloudOrgSkillHubImport = ctx.applyCloudOrgSkillHubImport;
  const applyCloudOrgPluginImport = ctx.applyCloudOrgPluginImport;
  const persistImportedCloudSkillRecord = ctx.persistImportedCloudSkillRecord;
  const findImportedCloudSkill = ctx.findImportedCloudSkill;
  const workspaceWriter = ctx.workspaceWriter;
  const upsertWorkspaceSkill = workspaceWriter.upsertSkill;
  const deleteWorkspaceSkill = workspaceWriter.deleteSkill;
  const refreshSkills = ctx.refreshSkills;

  const refreshCloudPluginImports = () =>
    Promise.all([refreshSkills({ force: true }), refreshCloudOrgMarketplaces({ force: true })]);

  const refreshCloudSkillHubImports = () =>
    Promise.all([
      refreshSkills({ force: true }),
      refreshCloudOrgSkills({ force: true }),
      refreshCloudOrgSkillHubs({ force: true }),
    ]);

  const refreshCloudSkillImports = () =>
    Promise.all([refreshSkills({ force: true }), refreshCloudOrgSkills({ force: true })]);

  const refreshHubSkillImports = () =>
    Promise.all([refreshSkills({ force: true }), refreshHubSkills({ force: true })]);

  async function refreshHubSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const repo = ctx.snapshot.hubRepo;
    const loadKey = buildExtensionsHubSkillsLoadKey({ repo, workspaceRoot: root });
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: options.runtimeWorkspaceId(),
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.hub?.skills?.read,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (shouldResetExtensionsLoadedForKey(load.hubSkillsLoadKey, loadKey)) {
      load.hubSkillsLoaded = false;
    }

    if (
      shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: load.hubSkillsLoaded })
    )
      return;
    if (load.refreshHubSkillsInFlight) return;

    load.refreshHubSkillsInFlight = true;
    load.refreshHubSkillsAborted = false;

    try {
      setStateField("hubSkillsStatus", null);

      if (!repo) {
        mutateState((current) => ({
          ...current,
          hubSkills: [],
          hubSkillsStatus: "No hub repo selected. Add a GitHub repo to browse skills.",
        }));
        load.hubSkillsLoaded = true;
        load.hubSkillsLoadKey = loadKey;
        return;
      }

      if (onmyagentGateway.ok) {
        const response = await onmyagentGateway.client.listHubSkills({
          repo: {
            owner: repo.owner,
            repo: repo.repo,
            ref: repo.ref,
          },
        });
        if (load.refreshHubSkillsAborted) return;
        const next = mapHubSkillListItems(response?.items) as HubSkillCard[];
        mutateState((current) => ({
          ...current,
          hubSkills: next,
          hubSkillsStatus: next.length ? null : "No hub skills found.",
          hubSkillsContextKey: getWorkspaceContextKey(),
        }));
        load.hubSkillsLoaded = true;
        load.hubSkillsLoadKey = loadKey;
        return;
      }

      const listingRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/skills?ref=${encodeURIComponent(repo.ref)}`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!listingRes.ok) {
        throw new Error(`Failed to fetch hub catalog (${listingRes.status})`);
      }
      const listing = (await listingRes.json()) as unknown;
      const dirs = parseGithubSkillDirectoryListing(listing);
      const next = hubSkillCardsFromDirectoryNames(dirs, repo) as HubSkillCard[];

      if (load.refreshHubSkillsAborted) return;
      const sorted = sortHubSkillCardsByName(next);
      mutateState((current) => ({
        ...current,
        hubSkills: sorted,
        hubSkillsStatus: sorted.length ? null : "No hub skills found.",
        hubSkillsContextKey: getWorkspaceContextKey(),
      }));
      load.hubSkillsLoaded = true;
      load.hubSkillsLoadKey = loadKey;
    } catch (error) {
      if (load.refreshHubSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        hubSkills: [],
        hubSkillsStatus: error instanceof Error ? error.message : "Failed to load hub skills.",
      }));
    } finally {
      load.refreshHubSkillsInFlight = false;
    }
  }

  async function refreshCloudOrgSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const settings = readDenSettings();
    const { loadKey, orgId, token } = buildExtensionsCloudOrgRefreshContext({
      activeOrgId: settings.activeOrgId,
      authToken: settings.authToken,
      workspaceContextKey: getWorkspaceContextKey(),
    });

    if (!root) {
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: [],
        cloudOrgSkillsStatus: null,
        cloudOrgSkillsContextKey: loadKey,
      }));
      load.cloudOrgSkillsLoaded = true;
      load.cloudOrgSkillsLoadKey = loadKey;
      return;
    }

    if (shouldResetExtensionsLoadedForKey(load.cloudOrgSkillsLoadKey, loadKey)) {
      load.cloudOrgSkillsLoaded = false;
    }

    if (
      shouldSkipExtensionsRefresh({
        force: optionsOverride?.force,
        loaded: load.cloudOrgSkillsLoaded,
      })
    ) {
      await refreshImportedCloudSkills();
      return;
    }
    if (load.refreshCloudOrgSkillsInFlight && load.refreshCloudOrgSkillsInFlightKey === loadKey)
      return;

    load.refreshCloudOrgSkillsInFlight = true;
    load.refreshCloudOrgSkillsInFlightKey = loadKey;
    load.refreshCloudOrgSkillsAborted = false;

    try {
      setStateField("cloudOrgSkillsStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgSkills: [],
          cloudOrgSkillsStatus: null,
          cloudOrgSkillsContextKey: loadKey,
        }));
        load.cloudOrgSkillsLoaded = true;
        load.cloudOrgSkillsLoadKey = loadKey;
        await refreshImportedCloudSkills();
        return;
      }

      const client = createDenClient({
        baseUrl: settings.baseUrl,
        apiBaseUrl: settings.apiBaseUrl,
        token,
      });
      const catalog = await fetchDenOrgSkillsCatalog(client, orgId);
      if (
        isStaleExtensionsLoad({
          aborted: load.refreshCloudOrgSkillsAborted,
          currentLoadKey: getCurrentCloudOrgLoadKey(),
          loadKey,
        })
      )
        return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: catalog,
        cloudOrgSkillsStatus: null,
        cloudOrgSkillsContextKey: loadKey,
      }));
      load.cloudOrgSkillsLoaded = true;
      load.cloudOrgSkillsLoadKey = loadKey;
      await refreshImportedCloudSkills();
    } catch (error) {
      if (
        isStaleExtensionsLoad({
          aborted: load.refreshCloudOrgSkillsAborted,
          currentLoadKey: getCurrentCloudOrgLoadKey(),
          loadKey,
        })
      )
        return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: [],
        cloudOrgSkillsStatus:
          error instanceof Error ? error.message : t("skills.cloud_org_load_failed"),
      }));
    } finally {
      if (load.refreshCloudOrgSkillsInFlightKey === loadKey) {
        load.refreshCloudOrgSkillsInFlight = false;
        load.refreshCloudOrgSkillsInFlightKey = "";
      }
    }
  }

  async function refreshCloudOrgSkillHubs(optionsOverride?: { force?: boolean }) {
    const settings = readDenSettings();
    const { loadKey, orgId, token } = buildExtensionsCloudOrgRefreshContext({
      activeOrgId: settings.activeOrgId,
      authToken: settings.authToken,
      workspaceContextKey: getWorkspaceContextKey(),
    });

    if (shouldResetExtensionsLoadedForKey(load.cloudOrgSkillHubsLoadKey, loadKey)) {
      load.cloudOrgSkillHubsLoaded = false;
    }

    if (
      shouldSkipExtensionsRefresh({
        force: optionsOverride?.force,
        loaded: load.cloudOrgSkillHubsLoaded,
      })
    ) {
      await refreshImportedCloudSkillHubs();
      return;
    }
    if (
      load.refreshCloudOrgSkillHubsInFlight &&
      load.refreshCloudOrgSkillHubsInFlightKey === loadKey
    )
      return;

    load.refreshCloudOrgSkillHubsInFlight = true;
    load.refreshCloudOrgSkillHubsInFlightKey = loadKey;
    load.refreshCloudOrgSkillHubsAborted = false;

    try {
      setStateField("cloudOrgSkillHubsStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgSkillHubs: [],
          cloudOrgSkillHubsStatus: null,
        }));
        load.cloudOrgSkillHubsLoaded = true;
        load.cloudOrgSkillHubsLoadKey = loadKey;
        await refreshImportedCloudSkillHubs();
        return;
      }

      const client = createDenClient({
        baseUrl: settings.baseUrl,
        apiBaseUrl: settings.apiBaseUrl,
        token,
      });
      const hubs = await client.listOrgSkillHubs(orgId);
      if (
        isStaleExtensionsLoad({
          aborted: load.refreshCloudOrgSkillHubsAborted,
          currentLoadKey: getCurrentCloudOrgLoadKey(),
          loadKey,
        })
      )
        return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkillHubs: hubs,
        cloudOrgSkillHubsStatus: null,
      }));
      load.cloudOrgSkillHubsLoaded = true;
      load.cloudOrgSkillHubsLoadKey = loadKey;
      await refreshImportedCloudSkillHubs();
    } catch (error) {
      if (
        isStaleExtensionsLoad({
          aborted: load.refreshCloudOrgSkillHubsAborted,
          currentLoadKey: getCurrentCloudOrgLoadKey(),
          loadKey,
        })
      )
        return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkillHubs: [],
        cloudOrgSkillHubsStatus:
          error instanceof Error ? error.message : "Failed to load organization skill hubs.",
      }));
    } finally {
      if (load.refreshCloudOrgSkillHubsInFlightKey === loadKey) {
        load.refreshCloudOrgSkillHubsInFlight = false;
        load.refreshCloudOrgSkillHubsInFlightKey = "";
      }
    }
  }

  async function refreshCloudOrgMarketplaces(optionsOverride?: { force?: boolean }) {
    const settings = readDenSettings();
    const { loadKey, orgId, token } = buildExtensionsCloudOrgRefreshContext({
      activeOrgId: settings.activeOrgId,
      authToken: settings.authToken,
      workspaceContextKey: getWorkspaceContextKey(),
    });

    if (shouldResetExtensionsLoadedForKey(load.cloudOrgMarketplacesLoadKey, loadKey)) {
      load.cloudOrgMarketplacesLoaded = false;
    }

    if (
      shouldSkipExtensionsRefresh({
        force: optionsOverride?.force,
        loaded: load.cloudOrgMarketplacesLoaded,
      })
    ) {
      await refreshImportedCloudPlugins();
      return;
    }
    if (
      load.refreshCloudOrgMarketplacesInFlight &&
      load.refreshCloudOrgMarketplacesInFlightKey === loadKey
    )
      return;

    load.refreshCloudOrgMarketplacesInFlight = true;
    load.refreshCloudOrgMarketplacesInFlightKey = loadKey;
    load.refreshCloudOrgMarketplacesAborted = false;

    try {
      setStateField("cloudOrgMarketplacesStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgMarketplaces: [],
          cloudOrgMarketplacesStatus: null,
        }));
        load.cloudOrgMarketplacesLoaded = true;
        load.cloudOrgMarketplacesLoadKey = loadKey;
        await refreshImportedCloudPlugins();
        return;
      }

      const client = createDenClient({
        baseUrl: settings.baseUrl,
        apiBaseUrl: settings.apiBaseUrl,
        token,
      });
      const marketplaces = await client.listOrgMarketplaces(orgId);
      const resolved = await Promise.all(
        marketplaces.map((marketplace) => client.getOrgMarketplaceResolved(orgId, marketplace.id)),
      );
      if (
        isStaleExtensionsLoad({
          aborted: load.refreshCloudOrgMarketplacesAborted,
          currentLoadKey: getCurrentCloudOrgLoadKey(),
          loadKey,
        })
      )
        return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: resolved,
        cloudOrgMarketplacesStatus: null,
      }));
      load.cloudOrgMarketplacesLoaded = true;
      load.cloudOrgMarketplacesLoadKey = loadKey;
      await refreshImportedCloudPlugins();
    } catch (error) {
      if (
        isStaleExtensionsLoad({
          aborted: load.refreshCloudOrgMarketplacesAborted,
          currentLoadKey: getCurrentCloudOrgLoadKey(),
          loadKey,
        })
      )
        return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: [],
        cloudOrgMarketplacesStatus:
          error instanceof Error ? error.message : "Failed to load organization marketplaces.",
      }));
    } finally {
      if (load.refreshCloudOrgMarketplacesInFlightKey === loadKey) {
        load.refreshCloudOrgMarketplacesInFlight = false;
        load.refreshCloudOrgMarketplacesInFlightKey = "";
      }
    }
  }

  async function importCloudOrgPlugin(
    marketplaceId: string | null,
    plugin: DenOrgPlugin,
  ): Promise<{ ok: boolean; message: string; files: CloudImportedPluginFile[] }> {
    options.setBusy(true);
    options.setError(null);
    setStateField("cloudOrgMarketplacesStatus", null);

    try {
      const settings = readDenSettings();
      const { orgId, token } = buildExtensionsCloudOrgRefreshContext({
        activeOrgId: settings.activeOrgId,
        authToken: settings.authToken,
        workspaceContextKey: getWorkspaceContextKey(),
      });
      if (!token || !orgId)
        throw new Error("Sign in to OnMyAgent Cloud and choose an organization first.");
      const client = createDenClient({
        baseUrl: settings.baseUrl,
        apiBaseUrl: settings.apiBaseUrl,
        token,
      });
      const resolved = await client.getOrgPluginResolved(orgId, plugin);
      const files = await applyCloudOrgPluginImport(marketplaceId, resolved);
      await refreshCloudPluginImports();
      return {
        ok: true,
        message: `Imported ${plugin.name} with ${files.length} file${files.length === 1 ? "" : "s"}.`,
        files,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, files: [] };
    } finally {
      options.setBusy(false);
    }
  }

  async function removeCloudOrgPlugin(pluginId: string): Promise<{ ok: boolean; message: string }> {
    options.setBusy(true);
    options.setError(null);
    setStateField("cloudOrgMarketplacesStatus", null);

    try {
      const removal = await removeCloudPluginFromWorkspace({
        importedCloudPlugins: ctx.snapshot.importedCloudPlugins,
        markReloadRequired: options.markReloadRequired,
        persistImportedCloudPlugins,
        pluginId,
        writer: workspaceWriter,
      });
      await refreshCloudPluginImports();

      const partial = removal.hasRemainingFiles
        ? " Non-skill and non-MCP files remain in the workspace and can be removed manually."
        : "";
      return { ok: true, message: `Removed ${removal.name}.${partial}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function importCloudOrgSkillHub(
    hub: DenOrgSkillHub,
  ): Promise<{ ok: boolean; message: string; importedNames: string[] }> {
    const importedNames: string[] = [];
    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const applied = await applyCloudOrgSkillHubImport(
        hub,
        ctx.snapshot.importedCloudSkillHubs[hub.id],
      );
      importedNames.push(...applied.nextSkillNames);
      const nextImports = {
        ...ctx.snapshot.importedCloudSkillHubs,
        [hub.id]: buildCloudSkillHubImportRecord({
          hub,
          importedAt: Date.now(),
          skillIds: applied.nextSkillIds,
          skillNames: applied.nextSkillNames,
        }),
      };
      await persistImportedCloudSkillHubs(nextImports);
      options.markReloadRequired?.("skills", { type: "skill", name: hub.name, action: "added" });
      await refreshCloudSkillHubImports();
      return {
        ok: true,
        message: `Imported ${hub.skills.length} skill${hub.skills.length === 1 ? "" : "s"} from ${hub.name}.`,
        importedNames,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, importedNames };
    } finally {
      options.setBusy(false);
    }
  }

  async function syncCloudOrgSkillHub(
    hub: DenOrgSkillHub,
  ): Promise<{ ok: boolean; message: string; importedNames: string[] }> {
    const imported = ctx.snapshot.importedCloudSkillHubs[hub.id];
    if (!imported) return importCloudOrgSkillHub(hub);

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const applied = await applyCloudOrgSkillHubImport(hub, imported);
      const nextImports = {
        ...ctx.snapshot.importedCloudSkillHubs,
        [hub.id]: buildCloudSkillHubImportRecord({
          hub,
          importedAt: imported.importedAt ?? Date.now(),
          skillIds: applied.nextSkillIds,
          skillNames: applied.nextSkillNames,
        }),
      };
      await persistImportedCloudSkillHubs(nextImports);
      options.markReloadRequired?.("skills", { type: "skill", name: hub.name, action: "added" });
      await refreshCloudSkillHubImports();
      return {
        ok: true,
        message: `Synced ${hub.name} from cloud.`,
        importedNames: applied.nextSkillNames,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, importedNames: [] };
    } finally {
      options.setBusy(false);
    }
  }

  async function removeCloudOrgSkillHub(
    hubId: string,
  ): Promise<{ ok: boolean; message: string; removedNames: string[] }> {
    const imported = ctx.snapshot.importedCloudSkillHubs[hubId];
    if (!imported) {
      return { ok: false, message: t("skills.hub_not_imported"), removedNames: [] };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      await Promise.all(imported.skillNames.map((name) => deleteWorkspaceSkill(name)));
      for (const name of imported.skillNames) {
        options.markReloadRequired?.("skills", { type: "skill", name, action: "removed" });
      }

      const nextImports = { ...ctx.snapshot.importedCloudSkillHubs };
      delete nextImports[hubId];
      await persistImportedCloudSkillHubs(nextImports);
      await refreshCloudSkillHubImports();
      return {
        ok: true,
        message: `Removed ${imported.skillNames.length} imported skill${imported.skillNames.length === 1 ? "" : "s"} from ${imported.name}.`,
        removedNames: imported.skillNames,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, removedNames: [] };
    } finally {
      options.setBusy(false);
    }
  }

  async function installHubSkill(name: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: t("skills.name_required") };
    const repo = ctx.snapshot.hubRepo;
    if (!repo) return { ok: false, message: t("skills.select_hub_repo_before_install") };

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.hub?.skills?.install,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (!canUseOnMyAgentServer) {
      if (isRemoteWorkspace)
        return { ok: false, message: t("skills.onmyagent_server_unavailable") };
      return { ok: false, message: t("skills.hub_install_requires_server") };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      if (!onmyagentGateway.ok)
        return { ok: false, message: t("skills.hub_install_requires_server") };
      const repoOverride: OnMyAgentHubRepo = { owner: repo.owner, repo: repo.repo, ref: repo.ref };
      const result = await onmyagentGateway.client.installHubSkill(
        onmyagentGateway.workspaceId,
        trimmed,
        { repo: repoOverride },
      );
      await refreshHubSkillImports();
      if (!result?.ok) return { ok: false, message: t("skills.install_failed") };
      return { ok: true, message: `Installed ${trimmed}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function installCloudOrgSkill(
    skill: DenOrgSkillCard,
  ): Promise<{ ok: boolean; message: string }> {
    const existingImport = findImportedCloudSkill(skill.id);
    const plan = buildCloudSkillImportPlan({
      skill,
      existingImport,
      existingSkillNames: ctx.snapshot.skills.map((entry) => entry.name),
    });

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      await upsertWorkspaceSkill(plan.installName, plan.content, plan.description, {
        overwrite: plan.overwrite,
      });
      await persistImportedCloudSkillRecord(skill, plan.installName);
      options.markReloadRequired?.("skills", {
        type: "skill",
        name: plan.installName,
        action: plan.action,
      });
      await refreshCloudSkillImports();
      return {
        ok: true,
        message: t(existingImport ? "skills.cloud_updated" : "skills.cloud_installed", {
          name: plan.installName,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function syncCloudOrgSkill(
    skill: DenOrgSkillCard,
  ): Promise<{ ok: boolean; message: string }> {
    return installCloudOrgSkill(skill);
  }

  async function removeCloudOrgSkill(
    cloudSkillId: string,
  ): Promise<{ ok: boolean; message: string; removedName: string | null }> {
    const imported = findImportedCloudSkill(cloudSkillId);
    if (!imported) {
      return { ok: false, message: t("skills.cloud_skill_not_installed"), removedName: null };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      if (ctx.snapshot.skills.some((skill) => skill.name === imported.installedName)) {
        await deleteWorkspaceSkill(imported.installedName);
      }
      const nextImports = { ...ctx.snapshot.importedCloudSkills };
      delete nextImports[cloudSkillId];
      await persistImportedCloudSkills(nextImports);
      options.markReloadRequired?.("skills", {
        type: "skill",
        name: imported.installedName,
        action: "removed",
      });
      await refreshCloudSkillImports();
      return {
        ok: true,
        message: t("skills.cloud_removed", { name: imported.installedName }),
        removedName: imported.installedName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, removedName: null };
    } finally {
      options.setBusy(false);
    }
  }

  return {
    refreshHubSkills,
    refreshCloudOrgSkills,
    refreshCloudOrgSkillHubs,
    refreshCloudOrgMarketplaces,
    importCloudOrgPlugin,
    removeCloudOrgPlugin,
    importCloudOrgSkillHub,
    syncCloudOrgSkillHub,
    removeCloudOrgSkillHub,
    installHubSkill,
    installCloudOrgSkill,
    syncCloudOrgSkill,
    removeCloudOrgSkill,
  };
}
