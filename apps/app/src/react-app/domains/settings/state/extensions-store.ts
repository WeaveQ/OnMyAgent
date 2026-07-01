import * as React from "react";

import { applyEdits, modify } from "jsonc-parser";

import { t } from "../../../../i18n";
import type {
  Client,
  DenOrgSkillCard,
  HubSkillCard,
  HubSkillRepo,
  PluginScope,
  ReloadReason,
  ReloadTrigger,
  SkillCard,
} from "../../../../app/types";
import { addOpencodeCacheHint, isDesktopRuntime, normalizeDirectoryPath } from "../../../../app/utils";
import skillCreatorTemplate from "../../../../app/data/skill-creator.md?raw";
import {
  isPluginInstalled,
  loadPluginsFromConfig as loadPluginsFromConfigHelpers,
  parsePluginListFromContent,
  stripPluginVersion,
} from "../../../../app/utils/plugins";
import {
  importSkill,
  installSkillTemplate,
  joinDesktopPath,
  listLocalSkills,
  openDesktopPath,
  pickDirectory,
  readLocalSkill,
  readOpencodeConfig,
  revealDesktopItemInDir,
  onmyagentSkillsRoot,
  writeLocalSkill,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "../../../../app/lib/desktop";
import type {
  OpenworkHubRepo,
  OpenworkServerCapabilities,
  OpenworkServerClient,
  OpenworkServerStatus,
} from "../../../../app/lib/onmyagent-server";
import {
  createDenClient,
  fetchDenOrgSkillsCatalog,
  readDenSettings,
  type DenOrgMarketplaceResolved,
  type DenOrgPlugin,
  type DenOrgPluginResolved,
  type DenOrgSkillHub,
} from "../../../../app/lib/den";
import {
  type CloudImportedPlugin,
  type CloudImportedPluginFile,
  type CloudImportedSkill,
  type CloudImportedSkillHub,
} from "../../../../app/cloud/import-state";
import type { OpenworkServerStore } from "../../shared/onmyagent-server-store";
import {
  applyCloudPluginToWorkspace,
  applyCloudSkillHubToWorkspace,
  removeCloudPluginFromWorkspace,
} from "./extensions-store-cloud-import-applier";
import { createExtensionsWorkspaceConfigGateway } from "./extensions-store-workspace-config";
import { createExtensionsWorkspaceWriter } from "./extensions-store-workspace-writer";
import {
  buildCloudSkillImportPlan,
  buildCloudSkillImportRecord,
  buildCloudSkillHubImportRecord,
  buildExtensionsCloudOrgRefreshContext,
  buildExtensionsHubSkillsLoadKey,
  buildExtensionsWorkspaceContextKey,
  hubRepoKey,
  isRecord,
  mapSkillCard,
  mergeHubRepoList,
  normalizeHubRepo,
  OPENCODE_MCP_IMPORT_PATH_PREFIX,
  OPENCODE_MCP_NAME_RE,
  parseJsonRecord,
  readNonEmptyString,
  readStringArray,
  readStringRecord,
  isStaleExtensionsLoad,
  shouldResetExtensionsLoadedForKey,
  shouldSkipExtensionsRefresh,
  toConfigPluginListEntries,
  toProjectPluginListEntries,
  type PluginListEntry,
} from "./extensions-store-model";
import { persistStoredHubRepos, readStoredHubRepos } from "./extensions-store-storage";
import {
  buildExtensionsStoreSnapshot,
  type ExtensionsStoreMutableState,
  type ExtensionsStoreSnapshot,
} from "./extensions-store-snapshot";

const DEFAULT_HUB_REPO: HubSkillRepo = {
  owner: "WeaveQ",
  repo: "onmyagent-hub",
  ref: "main",
};

type SetStateAction<T> = T | ((current: T) => T);

type MutableState = ExtensionsStoreMutableState;

export type ExtensionsStore = ReturnType<typeof createExtensionsStore>;


export function createExtensionsStore(options: {
  client: () => Client | null;
  projectDir: () => string;
  selectedWorkspaceId: () => string;
  selectedWorkspaceRoot: () => string;
  workspaceType: () => "local" | "remote";
  onmyagentServer: OpenworkServerStore;
  onmyagentServerConnection?: () => {
    onmyagentServerClient: OpenworkServerClient | null;
    onmyagentServerStatus: OpenworkServerStatus;
    onmyagentServerCapabilities: OpenworkServerCapabilities | null;
  };
  runtimeWorkspaceId: () => string | null;
  setBusy: (value: boolean) => void;
  setBusyLabel: (value: string | null) => void;
  setBusyStartedAt: (value: number | null) => void;
  setError: (value: string | null) => void;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
}) {
  const listeners = new Set<() => void>();

  let disposed = false;
  let started = false;
  let stopOpenworkSubscription: (() => void) | null = null;
  let stopDenSessionListener: (() => void) | null = null;
  let lastWorkspaceContextKey = "";
  let snapshot: ExtensionsStoreSnapshot;

  let refreshSkillsInFlight = false;
  let refreshPluginsInFlight = false;
  let refreshHubSkillsInFlight = false;
  let refreshCloudOrgSkillsInFlight = false;
  let refreshCloudOrgSkillHubsInFlight = false;
  let refreshCloudOrgMarketplacesInFlight = false;
  let refreshCloudOrgSkillsInFlightKey = "";
  let refreshCloudOrgSkillHubsInFlightKey = "";
  let refreshCloudOrgMarketplacesInFlightKey = "";
  let refreshSkillsAborted = false;
  let refreshPluginsAborted = false;
  let refreshHubSkillsAborted = false;
  let refreshCloudOrgSkillsAborted = false;
  let refreshCloudOrgSkillHubsAborted = false;
  let refreshCloudOrgMarketplacesAborted = false;
  let skillsLoaded = false;
  let hubSkillsLoaded = false;
  let cloudOrgSkillsLoaded = false;
  let cloudOrgSkillHubsLoaded = false;
  let cloudOrgMarketplacesLoaded = false;
  let skillsRoot = "";
  let hubSkillsLoadKey = "";
  let cloudOrgSkillsLoadKey = "";
  let cloudOrgSkillHubsLoadKey = "";
  let cloudOrgMarketplacesLoadKey = "";

  let state: MutableState = {
    skillsContextKey: "",
    pluginsContextKey: "",
    hubSkillsContextKey: "",
    cloudOrgSkillsContextKey: "",
    skills: [],
    skillsStatus: null,
    hubSkills: [],
    hubSkillsStatus: null,
    cloudOrgSkills: [],
    cloudOrgSkillsStatus: null,
    importedCloudSkills: {},
    cloudOrgSkillHubs: [],
    cloudOrgSkillHubsStatus: null,
    importedCloudSkillHubs: {},
    cloudOrgMarketplaces: [],
    cloudOrgMarketplacesStatus: null,
    importedCloudPlugins: {},
    hubRepo: DEFAULT_HUB_REPO,
    hubRepos: [DEFAULT_HUB_REPO],
    pluginScope: "project",
    pluginConfig: null,
    pluginConfigPath: null,
    pluginList: [],
    pluginInput: "",
    pluginStatus: null,
    activePluginGuide: null,
    sidebarPluginList: [],
    sidebarPluginStatus: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getWorkspaceContextKey = () => {
    const workspaceId = options.selectedWorkspaceId().trim();
    const root = normalizeDirectoryPath(options.selectedWorkspaceRoot().trim());
    const runtimeWorkspaceId = (options.runtimeWorkspaceId() ?? "").trim();
    const workspaceType = options.workspaceType();
    return buildExtensionsWorkspaceContextKey({
      workspaceId,
      workspaceRoot: root,
      runtimeWorkspaceId,
      workspaceType,
    });
  };

  const findLoadedSkill = (name: string) =>
    state.skills.find((skill) => skill.name === name);

  const getOpenworkServerSnapshot = () => {
    const snapshot = options.onmyagentServer.getSnapshot();
    const connection = options.onmyagentServerConnection?.();
    if (!connection?.onmyagentServerClient) return snapshot;
    return {
      ...snapshot,
      onmyagentServerClient: connection.onmyagentServerClient,
      onmyagentServerStatus: connection.onmyagentServerStatus,
      onmyagentServerCapabilities: connection.onmyagentServerCapabilities,
    };
  };

  const refreshSnapshot = () => {
    const workspaceContextKey = getWorkspaceContextKey();
    const settings = readDenSettings();
    const { orgId } = buildExtensionsCloudOrgRefreshContext({
      activeOrgId: settings.activeOrgId,
      workspaceContextKey,
    });
    snapshot = buildExtensionsStoreSnapshot({ state, workspaceContextKey, orgId });
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

  const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
    typeof next === "function" ? (next as (value: T) => T)(current) : next;

  const formatSkillPath = (location: string) => location.replace(/[/\\]SKILL\.md$/i, "");

  const workspaceConfigGateway = createExtensionsWorkspaceConfigGateway({
    onmyagentServerConnection: getOpenworkServerSnapshot,
    runtimeWorkspaceId: options.runtimeWorkspaceId,
    selectedWorkspaceRoot: options.selectedWorkspaceRoot,
    workspaceType: options.workspaceType,
  });
  const readWorkspaceOpenworkConfigRecord = workspaceConfigGateway.readRecord;
  const writeWorkspaceOpenworkConfigRecord = workspaceConfigGateway.writeRecord;
  const workspaceWriter = createExtensionsWorkspaceWriter({
    onmyagentServerConnection: getOpenworkServerSnapshot,
    runtimeWorkspaceId: options.runtimeWorkspaceId,
    selectedWorkspaceRoot: options.selectedWorkspaceRoot,
    workspaceType: options.workspaceType,
  });

  const refreshImportedCloudSkillHubs = async () => {
    try {
      const skillHubs = await workspaceConfigGateway.readCloudImports("skillHubs");
      setStateField("importedCloudSkillHubs", skillHubs);
      return skillHubs;
    } catch {
      setStateField("importedCloudSkillHubs", {});
      return {};
    }
  };

  const refreshImportedCloudSkills = async () => {
    try {
      const skills = await workspaceConfigGateway.readCloudImports("skills");
      setStateField("importedCloudSkills", skills);
      return skills;
    } catch {
      setStateField("importedCloudSkills", {});
      return {};
    }
  };

  const refreshImportedCloudPlugins = async () => {
    try {
      const plugins = await workspaceConfigGateway.readCloudImports("plugins");
      setStateField("importedCloudPlugins", plugins);
      return plugins;
    } catch {
      setStateField("importedCloudPlugins", {});
      return {};
    }
  };

  const persistImportedCloudSkillHubs = async (nextSkillHubs: Record<string, CloudImportedSkillHub>) => {
    await workspaceConfigGateway.writeCloudImports("skillHubs", nextSkillHubs);
    setStateField("importedCloudSkillHubs", nextSkillHubs);
  };

  const persistImportedCloudSkills = async (nextSkills: Record<string, CloudImportedSkill>) => {
    await workspaceConfigGateway.writeCloudImports("skills", nextSkills);
    setStateField("importedCloudSkills", nextSkills);
  };

  const persistImportedCloudPlugins = async (nextPlugins: Record<string, CloudImportedPlugin>) => {
    await workspaceConfigGateway.writeCloudImports("plugins", nextPlugins);
    setStateField("importedCloudPlugins", nextPlugins);
  };

  const upsertWorkspaceSkill = workspaceWriter.upsertSkill;

  const findImportedCloudSkill = (cloudSkillId: string) => snapshot.importedCloudSkills[cloudSkillId] ?? null;

  const persistImportedCloudSkillRecord = async (skill: DenOrgSkillCard, installedName: string) => {
    const imported = findImportedCloudSkill(skill.id);
    const nextSkills = {
      ...snapshot.importedCloudSkills,
      [skill.id]: buildCloudSkillImportRecord({
        skill,
        installedName,
        importedAt: imported?.importedAt ?? Date.now(),
      }),
    } satisfies Record<string, CloudImportedSkill>;
    await persistImportedCloudSkills(nextSkills);
    return nextSkills[skill.id];
  };

  const deleteWorkspaceSkill = workspaceWriter.deleteSkill;

  const applyCloudOrgSkillHubImport = async (hub: DenOrgSkillHub, imported?: CloudImportedSkillHub | null) => {
    return applyCloudSkillHubToWorkspace({
      existingSkills: snapshot.skills,
      hub,
      imported,
      writer: workspaceWriter,
    });
  };

  const applyCloudOrgPluginImport = async (
    marketplaceId: string | null,
    resolved: DenOrgPluginResolved,
  ) => applyCloudPluginToWorkspace({
    importedCloudPlugins: snapshot.importedCloudPlugins,
    marketplaceId,
    markReloadRequired: options.markReloadRequired,
    persistImportedCloudPlugins,
    resolved,
    writer: workspaceWriter,
  });

  const refreshCloudPluginImports = () => Promise.all([
    refreshSkills({ force: true }),
    refreshCloudOrgMarketplaces({ force: true }),
  ]);

  const refreshCloudSkillHubImports = () => Promise.all([
    refreshSkills({ force: true }),
    refreshCloudOrgSkills({ force: true }),
    refreshCloudOrgSkillHubs({ force: true }),
  ]);

  const refreshCloudSkillImports = () => Promise.all([
    refreshSkills({ force: true }),
    refreshCloudOrgSkills({ force: true }),
  ]);

  const refreshHubSkillImports = () => Promise.all([
    refreshSkills({ force: true }),
    refreshHubSkills({ force: true }),
  ]);

  const persistHubRepos = () => {
    persistStoredHubRepos({ selected: state.hubRepo, repos: state.hubRepos });
  };

  const invalidateWorkspaceCaches = () => {
    skillsLoaded = false;
    hubSkillsLoaded = false;
    cloudOrgSkillsLoaded = false;
    cloudOrgSkillHubsLoaded = false;
    cloudOrgMarketplacesLoaded = false;
    skillsRoot = "";
    hubSkillsLoadKey = "";
    cloudOrgSkillsLoadKey = "";
    cloudOrgSkillHubsLoadKey = "";
    cloudOrgMarketplacesLoadKey = "";
  };

  const getCurrentCloudOrgLoadKey = () => {
    const settings = readDenSettings();
    return buildExtensionsCloudOrgRefreshContext({
      activeOrgId: settings.activeOrgId,
      workspaceContextKey: getWorkspaceContextKey(),
    }).loadKey;
  };

  const touch = () => {
    refreshSnapshot();
    emitChange();
  };

  async function refreshHubSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const repo = snapshot.hubRepo;
    const loadKey = buildExtensionsHubSkillsLoadKey({ repo, workspaceRoot: root });
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentSnapshot.onmyagentServerCapabilities?.hub?.skills?.read;

    if (shouldResetExtensionsLoadedForKey(hubSkillsLoadKey, loadKey)) {
      hubSkillsLoaded = false;
    }

    if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: hubSkillsLoaded })) return;
    if (refreshHubSkillsInFlight) return;

    refreshHubSkillsInFlight = true;
    refreshHubSkillsAborted = false;

    try {
      setStateField("hubSkillsStatus", null);

      if (!repo) {
        mutateState((current) => ({
          ...current,
          hubSkills: [],
          hubSkillsStatus: "No hub repo selected. Add a GitHub repo to browse skills.",
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
        return;
      }

      if (canUseOpenworkServer) {
        const response = await onmyagentClient.listHubSkills({
          repo: {
            owner: repo.owner,
            repo: repo.repo,
            ref: repo.ref,
          },
        });
        if (refreshHubSkillsAborted) return;
        const next: HubSkillCard[] = Array.isArray(response?.items)
          ? response.items.map((entry) => ({
              name: String(entry.name ?? ""),
              description: typeof entry.description === "string" ? entry.description : undefined,
              trigger: typeof entry.trigger === "string" ? entry.trigger : undefined,
              source: entry.source,
            }))
          : [];
        mutateState((current) => ({
          ...current,
          hubSkills: next,
          hubSkillsStatus: next.length ? null : "No hub skills found.",
          hubSkillsContextKey: getWorkspaceContextKey(),
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
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
      const dirs: string[] = Array.isArray(listing)
        ? listing.flatMap((entry) => {
            if (!entry || typeof entry !== "object" || (entry as { type?: string }).type !== "dir") return [];
            const name = String((entry as { name?: string }).name ?? "");
            return name ? [name] : [];
          })
        : [];

      const next: HubSkillCard[] = dirs.map((dirName) => ({
        name: dirName,
        source: { owner: repo.owner, repo: repo.repo, ref: repo.ref, path: `skills/${dirName}` },
      }));

      if (refreshHubSkillsAborted) return;
      const sorted = next.toSorted((a, b) => a.name.localeCompare(b.name));
      mutateState((current) => ({
        ...current,
        hubSkills: sorted,
        hubSkillsStatus: sorted.length ? null : "No hub skills found.",
        hubSkillsContextKey: getWorkspaceContextKey(),
      }));
      hubSkillsLoaded = true;
      hubSkillsLoadKey = loadKey;
    } catch (error) {
      if (refreshHubSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        hubSkills: [],
        hubSkillsStatus: error instanceof Error ? error.message : "Failed to load hub skills.",
      }));
    } finally {
      refreshHubSkillsInFlight = false;
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
      cloudOrgSkillsLoaded = true;
      cloudOrgSkillsLoadKey = loadKey;
      return;
    }

    if (shouldResetExtensionsLoadedForKey(cloudOrgSkillsLoadKey, loadKey)) {
      cloudOrgSkillsLoaded = false;
    }

    if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: cloudOrgSkillsLoaded })) {
      await refreshImportedCloudSkills();
      return;
    }
    if (refreshCloudOrgSkillsInFlight && refreshCloudOrgSkillsInFlightKey === loadKey) return;

    refreshCloudOrgSkillsInFlight = true;
    refreshCloudOrgSkillsInFlightKey = loadKey;
    refreshCloudOrgSkillsAborted = false;

    try {
      setStateField("cloudOrgSkillsStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgSkills: [],
          cloudOrgSkillsStatus: null,
          cloudOrgSkillsContextKey: loadKey,
        }));
        cloudOrgSkillsLoaded = true;
        cloudOrgSkillsLoadKey = loadKey;
        await refreshImportedCloudSkills();
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, apiBaseUrl: settings.apiBaseUrl, token });
      const catalog = await fetchDenOrgSkillsCatalog(client, orgId);
      if (isStaleExtensionsLoad({
        aborted: refreshCloudOrgSkillsAborted,
        currentLoadKey: getCurrentCloudOrgLoadKey(),
        loadKey,
      })) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: catalog,
        cloudOrgSkillsStatus: null,
        cloudOrgSkillsContextKey: loadKey,
      }));
      cloudOrgSkillsLoaded = true;
      cloudOrgSkillsLoadKey = loadKey;
      await refreshImportedCloudSkills();
    } catch (error) {
      if (isStaleExtensionsLoad({
        aborted: refreshCloudOrgSkillsAborted,
        currentLoadKey: getCurrentCloudOrgLoadKey(),
        loadKey,
      })) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: [],
        cloudOrgSkillsStatus:
          error instanceof Error ? error.message : t("skills.cloud_org_load_failed"),
      }));
    } finally {
      if (refreshCloudOrgSkillsInFlightKey === loadKey) {
        refreshCloudOrgSkillsInFlight = false;
        refreshCloudOrgSkillsInFlightKey = "";
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

    if (shouldResetExtensionsLoadedForKey(cloudOrgSkillHubsLoadKey, loadKey)) {
      cloudOrgSkillHubsLoaded = false;
    }

    if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: cloudOrgSkillHubsLoaded })) {
      await refreshImportedCloudSkillHubs();
      return;
    }
    if (refreshCloudOrgSkillHubsInFlight && refreshCloudOrgSkillHubsInFlightKey === loadKey) return;

    refreshCloudOrgSkillHubsInFlight = true;
    refreshCloudOrgSkillHubsInFlightKey = loadKey;
    refreshCloudOrgSkillHubsAborted = false;

    try {
      setStateField("cloudOrgSkillHubsStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgSkillHubs: [],
          cloudOrgSkillHubsStatus: null,
        }));
        cloudOrgSkillHubsLoaded = true;
        cloudOrgSkillHubsLoadKey = loadKey;
        await refreshImportedCloudSkillHubs();
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, apiBaseUrl: settings.apiBaseUrl, token });
      const hubs = await client.listOrgSkillHubs(orgId);
      if (isStaleExtensionsLoad({
        aborted: refreshCloudOrgSkillHubsAborted,
        currentLoadKey: getCurrentCloudOrgLoadKey(),
        loadKey,
      })) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkillHubs: hubs,
        cloudOrgSkillHubsStatus: null,
      }));
      cloudOrgSkillHubsLoaded = true;
      cloudOrgSkillHubsLoadKey = loadKey;
      await refreshImportedCloudSkillHubs();
    } catch (error) {
      if (isStaleExtensionsLoad({
        aborted: refreshCloudOrgSkillHubsAborted,
        currentLoadKey: getCurrentCloudOrgLoadKey(),
        loadKey,
      })) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkillHubs: [],
        cloudOrgSkillHubsStatus:
          error instanceof Error ? error.message : "Failed to load organization skill hubs.",
      }));
    } finally {
      if (refreshCloudOrgSkillHubsInFlightKey === loadKey) {
        refreshCloudOrgSkillHubsInFlight = false;
        refreshCloudOrgSkillHubsInFlightKey = "";
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

    if (shouldResetExtensionsLoadedForKey(cloudOrgMarketplacesLoadKey, loadKey)) {
      cloudOrgMarketplacesLoaded = false;
    }

    if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: cloudOrgMarketplacesLoaded })) {
      await refreshImportedCloudPlugins();
      return;
    }
    if (refreshCloudOrgMarketplacesInFlight && refreshCloudOrgMarketplacesInFlightKey === loadKey) return;

    refreshCloudOrgMarketplacesInFlight = true;
    refreshCloudOrgMarketplacesInFlightKey = loadKey;
    refreshCloudOrgMarketplacesAborted = false;

    try {
      setStateField("cloudOrgMarketplacesStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgMarketplaces: [],
          cloudOrgMarketplacesStatus: null,
        }));
        cloudOrgMarketplacesLoaded = true;
        cloudOrgMarketplacesLoadKey = loadKey;
        await refreshImportedCloudPlugins();
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, apiBaseUrl: settings.apiBaseUrl, token });
      const marketplaces = await client.listOrgMarketplaces(orgId);
      const resolved = await Promise.all(
        marketplaces.map((marketplace) => client.getOrgMarketplaceResolved(orgId, marketplace.id)),
      );
      if (isStaleExtensionsLoad({
        aborted: refreshCloudOrgMarketplacesAborted,
        currentLoadKey: getCurrentCloudOrgLoadKey(),
        loadKey,
      })) return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: resolved,
        cloudOrgMarketplacesStatus: null,
      }));
      cloudOrgMarketplacesLoaded = true;
      cloudOrgMarketplacesLoadKey = loadKey;
      await refreshImportedCloudPlugins();
    } catch (error) {
      if (isStaleExtensionsLoad({
        aborted: refreshCloudOrgMarketplacesAborted,
        currentLoadKey: getCurrentCloudOrgLoadKey(),
        loadKey,
      })) return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: [],
        cloudOrgMarketplacesStatus:
          error instanceof Error ? error.message : "Failed to load organization marketplaces.",
      }));
    } finally {
      if (refreshCloudOrgMarketplacesInFlightKey === loadKey) {
        refreshCloudOrgMarketplacesInFlight = false;
        refreshCloudOrgMarketplacesInFlightKey = "";
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
      if (!token || !orgId) throw new Error("Sign in to OnMyAgent Cloud and choose an organization first.");
      const client = createDenClient({ baseUrl: settings.baseUrl, apiBaseUrl: settings.apiBaseUrl, token });
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
        importedCloudPlugins: snapshot.importedCloudPlugins,
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

  async function importCloudOrgSkillHub(hub: DenOrgSkillHub): Promise<{ ok: boolean; message: string; importedNames: string[] }> {
    const importedNames: string[] = [];
    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const applied = await applyCloudOrgSkillHubImport(hub, snapshot.importedCloudSkillHubs[hub.id]);
      importedNames.push(...applied.nextSkillNames);
      const nextImports = {
        ...snapshot.importedCloudSkillHubs,
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

  async function syncCloudOrgSkillHub(hub: DenOrgSkillHub): Promise<{ ok: boolean; message: string; importedNames: string[] }> {
    const imported = snapshot.importedCloudSkillHubs[hub.id];
    if (!imported) return importCloudOrgSkillHub(hub);

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const applied = await applyCloudOrgSkillHubImport(hub, imported);
      const nextImports = {
        ...snapshot.importedCloudSkillHubs,
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
      return { ok: true, message: `Synced ${hub.name} from cloud.`, importedNames: applied.nextSkillNames };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, importedNames: [] };
    } finally {
      options.setBusy(false);
    }
  }

  async function removeCloudOrgSkillHub(hubId: string): Promise<{ ok: boolean; message: string; removedNames: string[] }> {
    const imported = snapshot.importedCloudSkillHubs[hubId];
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

      const nextImports = { ...snapshot.importedCloudSkillHubs };
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
    const repo = snapshot.hubRepo;
    if (!repo) return { ok: false, message: t("skills.select_hub_repo_before_install") };

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.hub?.skills?.install;

    if (!canUseOpenworkServer) {
      if (isRemoteWorkspace) return { ok: false, message: t("skills.onmyagent_server_unavailable") };
      return { ok: false, message: t("skills.hub_install_requires_server") };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const repoOverride: OpenworkHubRepo = { owner: repo.owner, repo: repo.repo, ref: repo.ref };
      const result = await onmyagentClient.installHubSkill(onmyagentWorkspaceId, trimmed, { repo: repoOverride });
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

  async function installCloudOrgSkill(skill: DenOrgSkillCard): Promise<{ ok: boolean; message: string }> {
    const existingImport = findImportedCloudSkill(skill.id);
    const plan = buildCloudSkillImportPlan({
      skill,
      existingImport,
      existingSkillNames: snapshot.skills.map((entry) => entry.name),
    });

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      await upsertWorkspaceSkill(plan.installName, plan.content, plan.description, { overwrite: plan.overwrite });
      await persistImportedCloudSkillRecord(skill, plan.installName);
      options.markReloadRequired?.("skills", { type: "skill", name: plan.installName, action: plan.action });
      await refreshCloudSkillImports();
      return {
        ok: true,
        message: t(existingImport ? "skills.cloud_updated" : "skills.cloud_installed", { name: plan.installName }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function syncCloudOrgSkill(skill: DenOrgSkillCard): Promise<{ ok: boolean; message: string }> {
    return installCloudOrgSkill(skill);
  }

  async function removeCloudOrgSkill(cloudSkillId: string): Promise<{ ok: boolean; message: string; removedName: string | null }> {
    const imported = findImportedCloudSkill(cloudSkillId);
    if (!imported) {
      return { ok: false, message: t("skills.cloud_skill_not_installed"), removedName: null };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      if (snapshot.skills.some((skill) => skill.name === imported.installedName)) {
        await deleteWorkspaceSkill(imported.installedName);
      }
      const nextImports = { ...snapshot.importedCloudSkills };
      delete nextImports[cloudSkillId];
      await persistImportedCloudSkills(nextImports);
      options.markReloadRequired?.("skills", { type: "skill", name: imported.installedName, action: "removed" });
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

  const isPluginInstalledByName = (pluginName: string, aliases: string[] = []) =>
    isPluginInstalled(snapshot.pluginList.map((entry) => entry.name), pluginName, aliases);

  const loadPluginsFromConfig = (config: OpencodeConfigFile | null) => {
    const nextPluginNames: string[] = [];
    let nextPluginStatus: string | null = null;
    loadPluginsFromConfigHelpers(
      config,
      (value) => {
        nextPluginNames.splice(0, nextPluginNames.length, ...applyStateAction(nextPluginNames, value));
      },
      (message) => {
        nextPluginStatus = message;
      },
    );
    mutateState((current) => ({
      ...current,
      pluginList: toConfigPluginListEntries(nextPluginNames),
      pluginStatus: nextPluginStatus,
    }));
  };

  async function refreshSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.skills?.read;

    if (!root) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: t("skills.pick_workspace_first"),
      }));
      return;
    }

    if (canUseOpenworkServer) {
      if (shouldResetExtensionsLoadedForKey(skillsRoot, root)) skillsLoaded = false;
      if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: skillsLoaded })) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const response = await onmyagentClient.listSkills(onmyagentWorkspaceId, { includeGlobal: isLocalWorkspace });
        if (refreshSkillsAborted) return;
        const next: SkillCard[] = Array.isArray(response.items)
          ? response.items.map((entry) => mapSkillCard(entry, root))
          : [];
        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = root;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    if (isLocalWorkspace && isDesktopRuntime()) {
      if (shouldResetExtensionsLoadedForKey(skillsRoot, root)) skillsLoaded = false;
      if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: skillsLoaded })) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const local = await listLocalSkills(root);
        if (refreshSkillsAborted) return;
        const next: SkillCard[] = Array.isArray(local)
          ? local.map((entry) => mapSkillCard(entry, root))
          : [];
        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = root;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    const client = options.client();
    if (!client) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: "OnMyAgent server unavailable. Connect to load skills.",
      }));
      return;
    }

    if (shouldResetExtensionsLoadedForKey(skillsRoot, root)) skillsLoaded = false;
    if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: skillsLoaded })) return;
    if (refreshSkillsInFlight) return;

    refreshSkillsInFlight = true;
    refreshSkillsAborted = false;
    try {
      setStateField("skillsStatus", null);
      const rawClient = client as unknown as { _client?: { get: (input: { url: string }) => Promise<unknown> } };
      if (!rawClient._client) throw new Error("OpenCode client unavailable.");
      const result = await rawClient._client.get({ url: "/skill" }) as {
        data?: Array<{ name: string; description: string; location: string }>;
        error?: unknown;
      };
      if (result?.data === undefined) {
        const err = result?.error;
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : t("skills.failed_to_load");
        throw new Error(message);
      }
      if (refreshSkillsAborted) return;
      const next: SkillCard[] = Array.isArray(result.data)
        ? result.data.map((entry) =>
            mapSkillCard(
              {
                name: entry.name,
                description: entry.description,
                path: formatSkillPath(entry.location),
                scope: "local",
              },
              root,
            ),
          )
        : [];
      mutateState((current) => ({
        ...current,
        skills: next,
        skillsStatus: next.length ? null : t("skills.no_skills_found"),
        skillsContextKey: getWorkspaceContextKey(),
      }));
      skillsLoaded = true;
      skillsRoot = root;
    } catch (error) {
      if (refreshSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
      }));
    } finally {
      refreshSkillsInFlight = false;
    }
  }

  async function refreshPlugins(scopeOverride?: PluginScope) {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.plugins?.read;

    if (refreshPluginsInFlight) return;
    refreshPluginsInFlight = true;
    refreshPluginsAborted = false;

    const scope = scopeOverride ?? snapshot.pluginScope;
    const targetDir = options.projectDir().trim();

    if (scope !== "project" && !isLocalWorkspace) {
      mutateState((current) => ({
        ...current,
        pluginStatus: "Global plugins are only available for local workers.",
        pluginList: [],
        sidebarPluginStatus: "Global plugins require a local worker.",
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (scope === "project" && canUseOpenworkServer) {
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: `opencode.json (${isRemoteWorkspace ? "remote" : "onmyagent"} server)`,
      }));

      try {
        mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
        if (refreshPluginsAborted) return;
        const result = await onmyagentClient.listPlugins(onmyagentWorkspaceId, { includeGlobal: false });
        if (refreshPluginsAborted) return;
        const projectItems = result.items.filter((item) => item.scope === "project");
        const list = toProjectPluginListEntries(projectItems);
        mutateState((current) => ({
          ...current,
          pluginList: list,
          sidebarPluginList: list.map((entry) => entry.name),
          pluginStatus: list.length ? null : "No plugins configured yet.",
          sidebarPluginStatus: null,
          pluginsContextKey: getWorkspaceContextKey(),
        }));
      } catch (error) {
        if (refreshPluginsAborted) return;
        mutateState((current) => ({
          ...current,
          pluginList: [],
          sidebarPluginList: [],
          sidebarPluginStatus: "Failed to load plugins.",
          pluginStatus: error instanceof Error ? error.message : "Failed to load plugins.",
        }));
      } finally {
        refreshPluginsInFlight = false;
      }
      return;
    }

    if (!isDesktopRuntime()) {
      mutateState((current) => ({
        ...current,
        pluginStatus: t("skills.plugin_management_host_only"),
        pluginList: [],
        sidebarPluginStatus: t("skills.plugins_host_only"),
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (!isLocalWorkspace && !canUseOpenworkServer) {
      mutateState((current) => ({
        ...current,
        pluginStatus: "OnMyAgent server unavailable. Connect to manage plugins.",
        pluginList: [],
        sidebarPluginStatus: "Connect an OnMyAgent server to load plugins.",
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (scope === "project" && !targetDir) {
      mutateState((current) => ({
        ...current,
        pluginStatus: t("skills.pick_project_for_plugins"),
        pluginList: [],
        sidebarPluginStatus: t("skills.pick_project_for_active"),
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    try {
      mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
      if (refreshPluginsAborted) return;
      const config = (await readOpencodeConfig(scope, targetDir)) as OpencodeConfigFile;
      if (refreshPluginsAborted) return;
      mutateState((current) => ({ ...current, pluginConfig: (config as OpencodeConfigFile | null), pluginConfigPath: config.path ?? null }));

      if (!config.exists) {
        mutateState((current) => ({
          ...current,
          pluginList: [],
          pluginStatus: t("skills.no_opencode_found"),
          sidebarPluginList: [],
          sidebarPluginStatus: t("skills.no_opencode_workspace"),
        }));
        return;
      }

      let nextSidebarPluginList: string[] = [];
      let nextSidebarPluginStatus: string | null = null;
      try {
        nextSidebarPluginList = parsePluginListFromContent(config.content ?? "");
      } catch {
        nextSidebarPluginList = [];
        nextSidebarPluginStatus = t("skills.failed_parse_opencode");
      }

      const nextPluginNames: string[] = [];
      let nextPluginStatus: string | null = null;
      loadPluginsFromConfigHelpers(
        config,
        (value) => {
          nextPluginNames.splice(0, nextPluginNames.length, ...applyStateAction(nextPluginNames, value));
        },
        (message) => {
          nextPluginStatus = message;
        },
      );

      mutateState((current) => ({
        ...current,
        pluginList: toConfigPluginListEntries(nextPluginNames),
        pluginStatus: nextPluginStatus,
        sidebarPluginList: nextSidebarPluginList,
        sidebarPluginStatus: nextSidebarPluginStatus,
        pluginsContextKey: getWorkspaceContextKey(),
      }));
    } catch (error) {
      if (refreshPluginsAborted) return;
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: null,
        pluginList: [],
        pluginStatus: error instanceof Error ? error.message : t("skills.failed_load_opencode"),
        sidebarPluginStatus: t("skills.failed_load_active"),
        sidebarPluginList: [],
      }));
    } finally {
      refreshPluginsInFlight = false;
    }
  }

  async function addPlugin(pluginNameOverride?: string) {
    const pluginName = (pluginNameOverride ?? snapshot.pluginInput).trim();
    const isManualInput = pluginNameOverride == null;
    const triggerName = stripPluginVersion(pluginName);

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.plugins?.write;

    if (!pluginName) {
      if (isManualInput) setStateField("pluginStatus", t("skills.enter_plugin_name"));
      return;
    }

    if (snapshot.pluginScope !== "project" && !isLocalWorkspace) {
      setStateField("pluginStatus", "Global plugins are only available for local workers.");
      return;
    }

    if (snapshot.pluginScope === "project" && canUseOpenworkServer) {
      try {
        setStateField("pluginStatus", null);
        await onmyagentClient.addPlugin(onmyagentWorkspaceId, pluginName);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins("project");
      } catch (error) {
        setStateField("pluginStatus", error instanceof Error ? error.message : "Failed to add plugin.");
      }
      return;
    }

    if (!isDesktopRuntime()) {
      setStateField("pluginStatus", t("skills.plugin_management_host_only"));
      return;
    }

    if (!isLocalWorkspace && !canUseOpenworkServer) {
      setStateField("pluginStatus", "OnMyAgent server unavailable. Connect to manage plugins.");
      return;
    }

    const scope = snapshot.pluginScope;
    const targetDir = options.projectDir().trim();

    if (scope === "project" && !targetDir) {
      setStateField("pluginStatus", t("skills.pick_project_for_plugins"));
      return;
    }

    try {
      setStateField("pluginStatus", null);
      const config = (await readOpencodeConfig(scope, targetDir)) as OpencodeConfigFile;
      const raw = config.content ?? "";

      if (!raw.trim()) {
        const payload = { $schema: "https://opencode.ai/config.json", plugin: [pluginName] };
        await writeOpencodeConfig(scope, targetDir, `${JSON.stringify(payload, null, 2)}\n`);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins(scope);
        return;
      }

      const plugins = parsePluginListFromContent(raw);
      const desired = stripPluginVersion(pluginName).toLowerCase();
      if (plugins.some((entry) => stripPluginVersion(entry).toLowerCase() === desired)) {
        setStateField("pluginStatus", t("skills.plugin_already_listed"));
        return;
      }

      const next = [...plugins, pluginName];
      const edits = modify(raw, ["plugin"], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = applyEdits(raw, edits);
      await writeOpencodeConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
      if (isManualInput) setStateField("pluginInput", "");
      await refreshPlugins(scope);
    } catch (error) {
      setStateField("pluginStatus", error instanceof Error ? error.message : t("skills.failed_update_opencode"));
    }
  }

  async function removePlugin(pluginName: string) {
    const name = pluginName.trim();
    if (!name) return;
    const triggerName = stripPluginVersion(name);
    const existingPlugin = snapshot.pluginList.find((entry) => entry.name === name);
    if (existingPlugin && !existingPlugin.removable) {
      setStateField("pluginStatus", "Directory-discovered plugins are read-only.");
      return;
    }

    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.plugins?.write;

    if (snapshot.pluginScope !== "project" && !isLocalWorkspace) {
      setStateField("pluginStatus", "Global plugins are only available for local workers.");
      return;
    }

    if (snapshot.pluginScope === "project" && canUseOpenworkServer) {
      try {
        setStateField("pluginStatus", null);
        await onmyagentClient.removePlugin(onmyagentWorkspaceId, name);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "removed" });
        await refreshPlugins("project");
      } catch (error) {
        setStateField("pluginStatus", error instanceof Error ? error.message : "Failed to remove plugin.");
      }
      return;
    }

    if (!isDesktopRuntime()) {
      setStateField("pluginStatus", t("skills.plugin_management_host_only"));
      return;
    }

    if (!isLocalWorkspace && !canUseOpenworkServer) {
      setStateField("pluginStatus", "OnMyAgent server unavailable. Connect to manage plugins.");
      return;
    }

    const scope = snapshot.pluginScope;
    const targetDir = options.projectDir().trim();
    if (scope === "project" && !targetDir) {
      setStateField("pluginStatus", t("skills.pick_project_for_plugins"));
      return;
    }

    try {
      setStateField("pluginStatus", null);
      const config = (await readOpencodeConfig(scope, targetDir)) as OpencodeConfigFile;
      const raw = config.content ?? "";
      if (!raw.trim()) {
        setStateField("pluginStatus", "No plugins configured yet.");
        return;
      }

      const plugins = parsePluginListFromContent(raw);
      const desired = stripPluginVersion(name).toLowerCase();
      const next = plugins.filter((entry) => stripPluginVersion(entry).toLowerCase() !== desired);
      if (next.length === plugins.length) {
        setStateField("pluginStatus", "Plugin not found.");
        return;
      }

      const edits = modify(raw, ["plugin"], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = applyEdits(raw, edits);
      await writeOpencodeConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "removed" });
      await refreshPlugins(scope);
    } catch (error) {
      setStateField("pluginStatus", error instanceof Error ? error.message : t("skills.failed_update_opencode"));
    }
  }

  async function importLocalSkill() {
    const isLocalWorkspace = options.workspaceType() === "local";
    if (!isDesktopRuntime()) {
      options.setError(t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      options.setError("Local workers are required to import skills.");
      return;
    }
    const targetDir = options.projectDir().trim();
    if (!targetDir) {
      options.setError(t("skills.pick_project_first"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const selection = await pickDirectory({ title: t("skills.select_skill_folder") });
      const sourceDir = typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!sourceDir) return;
      const inferredName = sourceDir.split(/[\\/]/).filter(Boolean).pop();
      const result = (await importSkill(targetDir, sourceDir, { overwrite: false })) as { ok: boolean; stderr?: string; stdout?: string; status?: number };
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.import_failed").replace("{status}", String(result.status)));
      } else {
        setStateField("skillsStatus", result.stdout || t("skills.imported"));
        options.markReloadRequired?.("skills", { type: "skill", name: inferredName, action: "added" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function installSkillCreator(): Promise<{ ok: boolean; message: string }> {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.skills?.write;

    if (canUseOpenworkServer) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", t("skills.installing_skill_creator"));
      try {
        await onmyagentClient.upsertSkill(onmyagentWorkspaceId, { name: "skill-creator", content: skillCreatorTemplate });
        const message = t("skills.skill_creator_installed");
        setStateField("skillsStatus", message);
        options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
        await refreshSkills({ force: true });
        return { ok: true, message };
      } catch (error) {
        const raw = error instanceof Error ? error.message : t("skills.unknown_error");
        const message = addOpencodeCacheHint(raw);
        setStateField("skillsStatus", message);
        options.setError(message);
        return { ok: false, message };
      } finally {
        options.setBusy(false);
      }
    }

    if (isRemoteWorkspace) {
      const message = "OnMyAgent server unavailable. Connect to install skills.";
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isDesktopRuntime()) {
      const message = t("skills.desktop_required");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isLocalWorkspace) {
      const message = "Local workers are required to install skills.";
      options.setError(message);
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    const targetDir = options.selectedWorkspaceRoot().trim();
    if (!targetDir) {
      const message = t("skills.pick_workspace_first");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", t("skills.installing_skill_creator"));
    try {
      const result = (await installSkillTemplate(targetDir, "skill-creator", skillCreatorTemplate, { overwrite: false })) as { ok: boolean; stderr: string; stdout: string };
      if (!result.ok && /already exists/i.test(result.stderr)) {
        const message = t("skills.skill_creator_already_installed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: true, message };
      }
      if (!result.ok) {
        const message = result.stderr || result.stdout || t("skills.install_failed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: false, message };
      }
      const message = result.stdout || t("skills.skill_creator_installed");
      setStateField("skillsStatus", message);
      options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
      await refreshSkills({ force: true });
      return { ok: true, message };
    } catch (error) {
      const raw = error instanceof Error ? error.message : t("skills.unknown_error");
      const message = addOpencodeCacheHint(raw);
      setStateField("skillsStatus", message);
      options.setError(message);
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function revealSkillsFolder() {
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    try {
      const skillsDir = (await onmyagentSkillsRoot()) as string;
      const tryOpen = async (target: string) => {
        try {
          await openDesktopPath(target);
          return true;
        } catch {
          return false;
        }
      };
      if (await tryOpen(skillsDir)) return;
      await revealDesktopItemInDir(skillsDir);
    } catch (error) {
      setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.reveal_failed"));
    }
  }

  async function uninstallSkill(name: string) {
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    if (findLoadedSkill(trimmed)?.readonly) {
      setStateField("skillsStatus", t("skills.builtin_readonly_uninstall"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      await deleteWorkspaceSkill(trimmed);
      setStateField("skillsStatus", t("skills.uninstalled"));
      options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "removed" });
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      setStateField("skillsStatus", message);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function readSkill(name: string): Promise<{ name: string; path: string; content: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return null;
    }

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.skills?.read;

    if (canUseOpenworkServer) {
      try {
        setStateField("skillsStatus", null);
        const result = await onmyagentClient.getSkill(onmyagentWorkspaceId, trimmed, { includeGlobal: isLocalWorkspace });
        return { name: result.item.name, path: result.item.path, content: result.content };
      } catch (error) {
        setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.failed_to_load"));
        return null;
      }
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "OnMyAgent server unavailable. Connect to view skills.");
      return null;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return null;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "Local workers are required to view skills.");
      return null;
    }

    try {
      setStateField("skillsStatus", null);
      const result = (await readLocalSkill(root, trimmed)) as { path: string; content: string };
      return { name: trimmed, path: result.path, content: result.content };
    } catch (error) {
      setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.failed_to_load"));
      return null;
    }
  }

  async function saveSkill(input: { name: string; content: string; description?: string }) {
    const trimmed = input.name.trim();
    if (!trimmed) return;
    if (findLoadedSkill(trimmed)?.readonly) {
      setStateField("skillsStatus", t("skills.builtin_readonly_edit"));
      return;
    }
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const onmyagentSnapshot = getOpenworkServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const canUseOpenworkServer =
      onmyagentSnapshot.onmyagentServerStatus === "connected" &&
      onmyagentClient &&
      onmyagentWorkspaceId &&
      onmyagentSnapshot.onmyagentServerCapabilities?.skills?.write;

    if (canUseOpenworkServer) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", null);
      try {
        await onmyagentClient.upsertSkill(onmyagentWorkspaceId, {
          name: trimmed,
          content: input.content,
          description: input.description,
        });
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
        await refreshSkills({ force: true });
        setStateField("skillsStatus", "Saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : t("skills.unknown_error");
        options.setError(addOpencodeCacheHint(message));
      } finally {
        options.setBusy(false);
      }
      return;
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "OnMyAgent server unavailable. Connect to edit skills.");
      return;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "Local workers are required to edit skills.");
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const result = (await writeLocalSkill(root, trimmed, input.content)) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.unknown_error"));
      } else {
        setStateField("skillsStatus", result.stdout || "Saved.");
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  function abortRefreshes() {
    refreshSkillsAborted = true;
    refreshPluginsAborted = true;
    refreshHubSkillsAborted = true;
    refreshCloudOrgSkillsAborted = true;
    refreshCloudOrgSkillHubsAborted = true;
    refreshCloudOrgMarketplacesAborted = true;
  }

  function ensureSkillsFresh() {
    if (!snapshot.skillsStale) return;
    void refreshSkills({ force: true });
  }

  function ensurePluginsFresh(scopeOverride?: PluginScope) {
    if (!snapshot.pluginsStale) return;
    void refreshPlugins(scopeOverride);
  }

  function ensureHubSkillsFresh() {
    if (!snapshot.hubSkillsStale) return;
    void refreshHubSkills({ force: true });
  }

  function ensureCloudOrgSkillsFresh() {
    if (!snapshot.cloudOrgSkillsStale) return;
    void refreshCloudOrgSkills({ force: true });
  }

  const setHubRepo = (repoInput: Partial<HubSkillRepo> | null, optionsOverride?: { remember?: boolean }) => {
    const next = normalizeHubRepo(repoInput);
    mutateState((current) => ({ ...current, hubRepo: next }));
    hubSkillsLoaded = false;
    if (optionsOverride?.remember === false || !next) {
      persistHubRepos();
      return;
    }
    mutateState((current) => ({ ...current, hubRepos: mergeHubRepoList(next, current.hubRepos) }));
    persistHubRepos();
  };

  const addHubRepo = (repoInput: Partial<HubSkillRepo>) => {
    const next = normalizeHubRepo(repoInput);
    if (!next) return;
    setHubRepo(next);
  };

  const removeHubRepo = (repoInput: Partial<HubSkillRepo>) => {
    const target = normalizeHubRepo(repoInput);
    if (!target) return;
    const targetKey = hubRepoKey(target);
    const nextRepos = snapshot.hubRepos.filter((item) => hubRepoKey(item) !== targetKey);
    mutateState((current) => ({ ...current, hubRepos: nextRepos }));
    const activeRepo = snapshot.hubRepo;
    if (activeRepo && hubRepoKey(activeRepo) === targetKey) {
      mutateState((current) => ({
        ...current,
        hubRepo: nextRepos[0] ?? null,
        hubSkills: nextRepos.length ? current.hubSkills : [],
        hubSkillsStatus: nextRepos.length ? current.hubSkillsStatus : "No hub repo selected. Add a GitHub repo to browse skills.",
      }));
      hubSkillsLoaded = false;
      if (!nextRepos.length) {
        hubSkillsLoadKey = "";
      }
    }
    persistHubRepos();
  };

  const start = () => {
    if (started) return;
    // StrictMode double-mount re-arms after dispose.
    disposed = false;
    started = true;

    if (typeof window !== "undefined") {
      const storedHubRepos = readStoredHubRepos();
      if (storedHubRepos) {
        mutateState((current) => ({
          ...current,
          hubRepos: storedHubRepos.repos.length ? storedHubRepos.repos : current.hubRepos,
          hubRepo: storedHubRepos.selected && storedHubRepos.repos.length
            ? storedHubRepos.selected
            : storedHubRepos.repos[0] ?? current.hubRepo,
        }));
      }

      const onDenSessionUpdated = () => {
        cloudOrgSkillsLoaded = false;
        cloudOrgSkillHubsLoaded = false;
        cloudOrgMarketplacesLoaded = false;
        mutateState((current) => ({ ...current, cloudOrgSkillsContextKey: "" }));
      };
      window.addEventListener("onmyagent-den-session-updated", onDenSessionUpdated);
      stopDenSessionListener = () => window.removeEventListener("onmyagent-den-session-updated", onDenSessionUpdated);
    }

    stopOpenworkSubscription = options.onmyagentServer.subscribe(() => {
      syncFromOptions();
    });

    syncFromOptions();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    abortRefreshes();
    stopOpenworkSubscription?.();
    stopOpenworkSubscription = null;
    stopDenSessionListener?.();
    stopDenSessionListener = null;
    listeners.clear();
  };

  const syncFromOptions = () => {
    if (disposed) return;
    const key = getWorkspaceContextKey();
    if (key === lastWorkspaceContextKey) return;
    lastWorkspaceContextKey = key;
    invalidateWorkspaceCaches();
    touch();
    if (!key || key === "::::") return;
    void refreshSkills({ force: true });
    void refreshPlugins();
    void refreshImportedCloudSkills();
    void refreshImportedCloudSkillHubs();
    void refreshImportedCloudPlugins();
  };

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    skills: () => snapshot.skills,
    skillsStatus: () => snapshot.skillsStatus,
    hubSkills: () => snapshot.hubSkills,
    hubSkillsStatus: () => snapshot.hubSkillsStatus,
    cloudOrgSkills: () => snapshot.cloudOrgSkills,
    cloudOrgSkillsStatus: () => snapshot.cloudOrgSkillsStatus,
    importedCloudSkills: () => snapshot.importedCloudSkills,
    cloudOrgSkillHubs: () => snapshot.cloudOrgSkillHubs,
    cloudOrgSkillHubsStatus: () => snapshot.cloudOrgSkillHubsStatus,
    importedCloudSkillHubs: () => snapshot.importedCloudSkillHubs,
    cloudOrgMarketplaces: () => snapshot.cloudOrgMarketplaces,
    cloudOrgMarketplacesStatus: () => snapshot.cloudOrgMarketplacesStatus,
    importedCloudPlugins: () => snapshot.importedCloudPlugins,
    hubRepo: () => snapshot.hubRepo,
    hubRepos: () => snapshot.hubRepos,
    get pluginScope() {
      return snapshot.pluginScope;
    },
    setPluginScope(value: SetStateAction<PluginScope>) {
      const resolved = applyStateAction(state.pluginScope, value);
      setStateField("pluginScope", resolved);
    },
    pluginConfig: () => snapshot.pluginConfig,
    pluginConfigPath: () => snapshot.pluginConfigPath,
    pluginList: () => snapshot.pluginList,
    pluginInput: () => snapshot.pluginInput,
    setPluginInput(value: SetStateAction<string>) {
      const resolved = applyStateAction(state.pluginInput, value);
      setStateField("pluginInput", resolved);
    },
    pluginStatus: () => snapshot.pluginStatus,
    activePluginGuide: () => snapshot.activePluginGuide,
    setActivePluginGuide(value: SetStateAction<string | null>) {
      const resolved = applyStateAction(state.activePluginGuide, value);
      setStateField("activePluginGuide", resolved);
    },
    sidebarPluginList: () => snapshot.sidebarPluginList,
    sidebarPluginStatus: () => snapshot.sidebarPluginStatus,
    workspaceContextKey: () => snapshot.workspaceContextKey,
    skillsStale: () => snapshot.skillsStale,
    pluginsStale: () => snapshot.pluginsStale,
    hubSkillsStale: () => snapshot.hubSkillsStale,
    cloudOrgSkillsStale: () => snapshot.cloudOrgSkillsStale,
    isPluginInstalledByName,
    refreshSkills,
    refreshHubSkills,
    refreshCloudOrgSkills,
    refreshCloudOrgSkillHubs,
    refreshCloudOrgMarketplaces,
    setHubRepo,
    addHubRepo,
    removeHubRepo,
    refreshPlugins,
    addPlugin,
    removePlugin,
    importLocalSkill,
    installSkillCreator,
    installHubSkill,
    installCloudOrgSkill,
    syncCloudOrgSkill,
    removeCloudOrgSkill,
    importCloudOrgSkillHub,
    syncCloudOrgSkillHub,
    removeCloudOrgSkillHub,
    importCloudOrgPlugin,
    removeCloudOrgPlugin,
    revealSkillsFolder,
    uninstallSkill,
    readSkill,
    saveSkill,
    abortRefreshes,
    ensureSkillsFresh,
    ensurePluginsFresh,
    ensureHubSkillsFresh,
    ensureCloudOrgSkillsFresh,
  };
}

export function useExtensionsStoreSnapshot(store: ExtensionsStore) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
