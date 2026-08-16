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
import {
  addOpencodeCacheHint,
  isDesktopRuntime,
  normalizeDirectoryPath,
} from "../../../../app/utils";
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
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import {
  readDenSettings,
  type DenOrgPluginResolved,
  type DenOrgSkillHub,
} from "../../../../app/lib/den";
import {
  type CloudImportedPlugin,
  type CloudImportedPluginFile,
  type CloudImportedSkill,
  type CloudImportedSkillHub,
} from "../../../../app/cloud/import-state";
import type { OnMyAgentServerStore } from "../../shared";
import {
  applyCloudPluginToWorkspace,
  applyCloudSkillHubToWorkspace,
} from "./extensions-store-cloud-import-applier";
import { createExtensionsWorkspaceConfigGateway } from "./extensions-store-workspace-config";
import { createExtensionsWorkspaceWriter } from "./extensions-store-workspace-writer";
import {
  applySetStateAction,
  buildCloudSkillImportRecord,
  buildExtensionsCloudOrgRefreshContext,
  buildExtensionsWorkspaceContextKey,
  resolveOnMyAgentGateway,
  formatSkillPath,
  hubRepoKey,
  mapSkillCard,
  mergeHubRepoList,
  normalizeHubRepo,
  shouldResetExtensionsLoadedForKey,
  shouldSkipExtensionsRefresh,
  toConfigPluginListEntries,
  toProjectPluginListEntries,
  type PluginListEntry,
} from "./extensions-store-model";
import { persistStoredHubRepos, readStoredHubRepos } from "./extensions-store-storage";
import {
  buildExtensionsStoreSnapshot,
  createInitialExtensionsMutableState,
  type ExtensionsStoreMutableState,
  type ExtensionsStoreSnapshot,
} from "./extensions-store-snapshot";
import { createExtensionsSkillActions } from "./extensions-store-skill-actions";
import { createExtensionsCloudOrgActions } from "./extensions-store-cloud-org";

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
  onmyagentServer: OnMyAgentServerStore;
  onmyagentServerConnection?: () => {
    onmyagentServerClient: OnMyAgentServerClient | null;
    onmyagentServerStatus: OnMyAgentServerStatus;
    onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
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
  let stopOnMyAgentSubscription: (() => void) | null = null;
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

  let state: MutableState = createInitialExtensionsMutableState({
    hubRepo: DEFAULT_HUB_REPO,
    hubRepos: [DEFAULT_HUB_REPO],
  });

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

  const findLoadedSkill = (name: string) => state.skills.find((skill) => skill.name === name);

  const getOnMyAgentServerSnapshot = () => {
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

  const applyStateAction = applySetStateAction;

  const workspaceConfigGateway = createExtensionsWorkspaceConfigGateway({
    onmyagentServerConnection: getOnMyAgentServerSnapshot,
    runtimeWorkspaceId: options.runtimeWorkspaceId,
    selectedWorkspaceRoot: options.selectedWorkspaceRoot,
    workspaceType: options.workspaceType,
  });
  const readWorkspaceOnMyAgentConfigRecord = workspaceConfigGateway.readRecord;
  const writeWorkspaceOnMyAgentConfigRecord = workspaceConfigGateway.writeRecord;
  const workspaceWriter = createExtensionsWorkspaceWriter({
    onmyagentServerConnection: getOnMyAgentServerSnapshot,
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

  const persistImportedCloudSkillHubs = async (
    nextSkillHubs: Record<string, CloudImportedSkillHub>,
  ) => {
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

  const findImportedCloudSkill = (cloudSkillId: string) =>
    snapshot.importedCloudSkills[cloudSkillId] ?? null;

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

  const applyCloudOrgSkillHubImport = async (
    hub: DenOrgSkillHub,
    imported?: CloudImportedSkillHub | null,
  ) => {
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
  ) =>
    applyCloudPluginToWorkspace({
      importedCloudPlugins: snapshot.importedCloudPlugins,
      marketplaceId,
      markReloadRequired: options.markReloadRequired,
      persistImportedCloudPlugins,
      resolved,
      writer: workspaceWriter,
    });

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

  const isPluginInstalledByName = (pluginName: string, aliases: string[] = []) =>
    isPluginInstalled(
      snapshot.pluginList.map((entry) => entry.name),
      pluginName,
      aliases,
    );

  const loadPluginsFromConfig = (config: OpencodeConfigFile | null) => {
    const nextPluginNames: string[] = [];
    let nextPluginStatus: string | null = null;
    loadPluginsFromConfigHelpers(
      config,
      (value) => {
        nextPluginNames.splice(
          0,
          nextPluginNames.length,
          ...applyStateAction(nextPluginNames, value),
        );
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
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.skills?.read,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (!root) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: t("skills.pick_workspace_first"),
      }));
      return;
    }

    if (canUseOnMyAgentServer && onmyagentClient && onmyagentWorkspaceId) {
      if (shouldResetExtensionsLoadedForKey(skillsRoot, root)) skillsLoaded = false;
      if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: skillsLoaded }))
        return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const response = await onmyagentGateway.client.listSkills(onmyagentWorkspaceId, {
          includeGlobal: isLocalWorkspace,
        });
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
      if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: skillsLoaded }))
        return;
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
    if (shouldSkipExtensionsRefresh({ force: optionsOverride?.force, loaded: skillsLoaded }))
      return;
    if (refreshSkillsInFlight) return;

    refreshSkillsInFlight = true;
    refreshSkillsAborted = false;
    try {
      setStateField("skillsStatus", null);
      const result = await client.app.skills();
      if (result.data === undefined) {
        const err = result.error;
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : t("skills.failed_to_load");
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
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.plugins?.read,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

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

    if (scope === "project" && canUseOnMyAgentServer) {
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: `opencode.json (${isRemoteWorkspace ? "remote" : "onmyagent"} server)`,
      }));

      try {
        mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
        if (refreshPluginsAborted) return;
        if (!onmyagentGateway.ok) return;
        const result = await onmyagentGateway.client.listPlugins(onmyagentGateway.workspaceId, {
          includeGlobal: false,
        });
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

    if (!isLocalWorkspace && !canUseOnMyAgentServer) {
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
      mutateState((current) => ({
        ...current,
        pluginConfig: config as OpencodeConfigFile | null,
        pluginConfigPath: config.path ?? null,
      }));

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
          nextPluginNames.splice(
            0,
            nextPluginNames.length,
            ...applyStateAction(nextPluginNames, value),
          );
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
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.plugins?.write,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (!pluginName) {
      if (isManualInput) setStateField("pluginStatus", t("skills.enter_plugin_name"));
      return;
    }

    if (snapshot.pluginScope !== "project" && !isLocalWorkspace) {
      setStateField("pluginStatus", "Global plugins are only available for local workers.");
      return;
    }

    if (snapshot.pluginScope === "project" && onmyagentGateway.ok) {
      try {
        setStateField("pluginStatus", null);
        await onmyagentGateway.client.addPlugin(onmyagentGateway.workspaceId, pluginName);
        options.markReloadRequired?.("plugins", {
          type: "plugin",
          name: triggerName,
          action: "added",
        });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins("project");
      } catch (error) {
        setStateField(
          "pluginStatus",
          error instanceof Error ? error.message : "Failed to add plugin.",
        );
      }
      return;
    }

    if (!isDesktopRuntime()) {
      setStateField("pluginStatus", t("skills.plugin_management_host_only"));
      return;
    }

    if (!isLocalWorkspace && !canUseOnMyAgentServer) {
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
        options.markReloadRequired?.("plugins", {
          type: "plugin",
          name: triggerName,
          action: "added",
        });
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
      const edits = modify(raw, ["plugin"], next, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      const updated = applyEdits(raw, edits);
      await writeOpencodeConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", {
        type: "plugin",
        name: triggerName,
        action: "added",
      });
      if (isManualInput) setStateField("pluginInput", "");
      await refreshPlugins(scope);
    } catch (error) {
      setStateField(
        "pluginStatus",
        error instanceof Error ? error.message : t("skills.failed_update_opencode"),
      );
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
    const onmyagentSnapshot = getOnMyAgentServerSnapshot();
    const onmyagentClient = onmyagentSnapshot.onmyagentServerClient;
    const onmyagentWorkspaceId = options.runtimeWorkspaceId();
    const onmyagentGateway = resolveOnMyAgentGateway({
      status: onmyagentSnapshot.onmyagentServerStatus,
      client: onmyagentClient,
      workspaceId: onmyagentWorkspaceId,
      capability: onmyagentSnapshot.onmyagentServerCapabilities?.plugins?.write,
    });
    const canUseOnMyAgentServer = onmyagentGateway.ok;

    if (snapshot.pluginScope !== "project" && !isLocalWorkspace) {
      setStateField("pluginStatus", "Global plugins are only available for local workers.");
      return;
    }

    if (snapshot.pluginScope === "project" && onmyagentGateway.ok) {
      try {
        setStateField("pluginStatus", null);
        await onmyagentGateway.client.removePlugin(onmyagentGateway.workspaceId, name);
        options.markReloadRequired?.("plugins", {
          type: "plugin",
          name: triggerName,
          action: "removed",
        });
        await refreshPlugins("project");
      } catch (error) {
        setStateField(
          "pluginStatus",
          error instanceof Error ? error.message : "Failed to remove plugin.",
        );
      }
      return;
    }

    if (!isDesktopRuntime()) {
      setStateField("pluginStatus", t("skills.plugin_management_host_only"));
      return;
    }

    if (!isLocalWorkspace && !canUseOnMyAgentServer) {
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

      const edits = modify(raw, ["plugin"], next, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      const updated = applyEdits(raw, edits);
      await writeOpencodeConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", {
        type: "plugin",
        name: triggerName,
        action: "removed",
      });
      await refreshPlugins(scope);
    } catch (error) {
      setStateField(
        "pluginStatus",
        error instanceof Error ? error.message : t("skills.failed_update_opencode"),
      );
    }
  }

  const cloudOrgLoad = {
    get refreshHubSkillsInFlight() {
      return refreshHubSkillsInFlight;
    },
    set refreshHubSkillsInFlight(value: boolean) {
      refreshHubSkillsInFlight = value;
    },
    get refreshHubSkillsAborted() {
      return refreshHubSkillsAborted;
    },
    set refreshHubSkillsAborted(value: boolean) {
      refreshHubSkillsAborted = value;
    },
    get hubSkillsLoaded() {
      return hubSkillsLoaded;
    },
    set hubSkillsLoaded(value: boolean) {
      hubSkillsLoaded = value;
    },
    get hubSkillsLoadKey() {
      return hubSkillsLoadKey;
    },
    set hubSkillsLoadKey(value: string) {
      hubSkillsLoadKey = value;
    },
    get refreshCloudOrgSkillsInFlight() {
      return refreshCloudOrgSkillsInFlight;
    },
    set refreshCloudOrgSkillsInFlight(value: boolean) {
      refreshCloudOrgSkillsInFlight = value;
    },
    get refreshCloudOrgSkillsInFlightKey() {
      return refreshCloudOrgSkillsInFlightKey;
    },
    set refreshCloudOrgSkillsInFlightKey(value: string) {
      refreshCloudOrgSkillsInFlightKey = value;
    },
    get refreshCloudOrgSkillsAborted() {
      return refreshCloudOrgSkillsAborted;
    },
    set refreshCloudOrgSkillsAborted(value: boolean) {
      refreshCloudOrgSkillsAborted = value;
    },
    get cloudOrgSkillsLoaded() {
      return cloudOrgSkillsLoaded;
    },
    set cloudOrgSkillsLoaded(value: boolean) {
      cloudOrgSkillsLoaded = value;
    },
    get cloudOrgSkillsLoadKey() {
      return cloudOrgSkillsLoadKey;
    },
    set cloudOrgSkillsLoadKey(value: string) {
      cloudOrgSkillsLoadKey = value;
    },
    get refreshCloudOrgSkillHubsInFlight() {
      return refreshCloudOrgSkillHubsInFlight;
    },
    set refreshCloudOrgSkillHubsInFlight(value: boolean) {
      refreshCloudOrgSkillHubsInFlight = value;
    },
    get refreshCloudOrgSkillHubsInFlightKey() {
      return refreshCloudOrgSkillHubsInFlightKey;
    },
    set refreshCloudOrgSkillHubsInFlightKey(value: string) {
      refreshCloudOrgSkillHubsInFlightKey = value;
    },
    get refreshCloudOrgSkillHubsAborted() {
      return refreshCloudOrgSkillHubsAborted;
    },
    set refreshCloudOrgSkillHubsAborted(value: boolean) {
      refreshCloudOrgSkillHubsAborted = value;
    },
    get cloudOrgSkillHubsLoaded() {
      return cloudOrgSkillHubsLoaded;
    },
    set cloudOrgSkillHubsLoaded(value: boolean) {
      cloudOrgSkillHubsLoaded = value;
    },
    get cloudOrgSkillHubsLoadKey() {
      return cloudOrgSkillHubsLoadKey;
    },
    set cloudOrgSkillHubsLoadKey(value: string) {
      cloudOrgSkillHubsLoadKey = value;
    },
    get refreshCloudOrgMarketplacesInFlight() {
      return refreshCloudOrgMarketplacesInFlight;
    },
    set refreshCloudOrgMarketplacesInFlight(value: boolean) {
      refreshCloudOrgMarketplacesInFlight = value;
    },
    get refreshCloudOrgMarketplacesInFlightKey() {
      return refreshCloudOrgMarketplacesInFlightKey;
    },
    set refreshCloudOrgMarketplacesInFlightKey(value: string) {
      refreshCloudOrgMarketplacesInFlightKey = value;
    },
    get refreshCloudOrgMarketplacesAborted() {
      return refreshCloudOrgMarketplacesAborted;
    },
    set refreshCloudOrgMarketplacesAborted(value: boolean) {
      refreshCloudOrgMarketplacesAborted = value;
    },
    get cloudOrgMarketplacesLoaded() {
      return cloudOrgMarketplacesLoaded;
    },
    set cloudOrgMarketplacesLoaded(value: boolean) {
      cloudOrgMarketplacesLoaded = value;
    },
    get cloudOrgMarketplacesLoadKey() {
      return cloudOrgMarketplacesLoadKey;
    },
    set cloudOrgMarketplacesLoadKey(value: string) {
      cloudOrgMarketplacesLoadKey = value;
    },
  };

  const cloudOrgActions = createExtensionsCloudOrgActions({
    get options() {
      return options;
    },
    get snapshot() {
      return snapshot;
    },
    mutateState,
    setStateField,
    getOnMyAgentServerSnapshot,
    getWorkspaceContextKey,
    getCurrentCloudOrgLoadKey,
    load: cloudOrgLoad,
    refreshImportedCloudSkills,
    refreshImportedCloudSkillHubs,
    refreshImportedCloudPlugins,
    persistImportedCloudSkillHubs,
    persistImportedCloudSkills,
    persistImportedCloudPlugins,
    applyCloudOrgSkillHubImport,
    applyCloudOrgPluginImport,
    persistImportedCloudSkillRecord,
    findImportedCloudSkill,
    workspaceWriter,
    refreshSkills,
  });
  const {
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
  } = cloudOrgActions;

  const skillActions = createExtensionsSkillActions({
    get options() {
      return options;
    },
    get snapshot() {
      return snapshot;
    },
    mutateState,
    setStateField,
    getOnMyAgentServerSnapshot,
    findLoadedSkill,
    workspaceWriter,
    get skillsRoot() {
      return skillsRoot;
    },
    set skillsRoot(value: string) {
      skillsRoot = value;
    },
    get skillsLoaded() {
      return skillsLoaded;
    },
    set skillsLoaded(value: boolean) {
      skillsLoaded = value;
    },
    refreshSkills,
    touch,
  });
  const {
    importLocalSkill,
    installSkillCreator,
    revealSkillsFolder,
    uninstallSkill,
    readSkill,
    saveSkill,
  } = skillActions;

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

  const setHubRepo = (
    repoInput: Partial<HubSkillRepo> | null,
    optionsOverride?: { remember?: boolean },
  ) => {
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
        hubSkillsStatus: nextRepos.length
          ? current.hubSkillsStatus
          : "No hub repo selected. Add a GitHub repo to browse skills.",
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
          hubRepo:
            storedHubRepos.selected && storedHubRepos.repos.length
              ? storedHubRepos.selected
              : (storedHubRepos.repos[0] ?? current.hubRepo),
        }));
      }

      const onDenSessionUpdated = () => {
        cloudOrgSkillsLoaded = false;
        cloudOrgSkillHubsLoaded = false;
        cloudOrgMarketplacesLoaded = false;
        mutateState((current) => ({ ...current, cloudOrgSkillsContextKey: "" }));
      };
      window.addEventListener("onmyagent-den-session-updated", onDenSessionUpdated);
      stopDenSessionListener = () =>
        window.removeEventListener("onmyagent-den-session-updated", onDenSessionUpdated);
    }

    stopOnMyAgentSubscription = options.onmyagentServer.subscribe(() => {
      syncFromOptions();
    });

    syncFromOptions();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    abortRefreshes();
    stopOnMyAgentSubscription?.();
    stopOnMyAgentSubscription = null;
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
