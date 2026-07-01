import type {
  DenOrgSkillCard,
  HubSkillCard,
  HubSkillRepo,
  PluginScope,
  SkillCard,
} from "../../../../app/types";
import type { CloudImportedPlugin, CloudImportedSkill, CloudImportedSkillHub } from "../../../../app/cloud/import-state";
import type { OpencodeConfigFile } from "../../../../app/lib/desktop";
import type { DenOrgMarketplaceResolved, DenOrgSkillHub } from "../../../../app/lib/den";
import { buildExtensionsCloudOrgLoadKey, type PluginListEntry } from "./extensions-store-model";

export type ExtensionsStoreSnapshot = {
  workspaceContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  cloudOrgSkills: DenOrgSkillCard[];
  cloudOrgSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  cloudOrgSkillHubs: DenOrgSkillHub[];
  cloudOrgSkillHubsStatus: string | null;
  importedCloudSkillHubs: Record<string, CloudImportedSkillHub>;
  cloudOrgMarketplaces: DenOrgMarketplaceResolved[];
  cloudOrgMarketplacesStatus: string | null;
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  hubRepo: HubSkillRepo | null;
  hubRepos: HubSkillRepo[];
  pluginScope: PluginScope;
  pluginConfig: OpencodeConfigFile | null;
  pluginConfigPath: string | null;
  pluginList: PluginListEntry[];
  pluginInput: string;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  sidebarPluginList: string[];
  sidebarPluginStatus: string | null;
  skillsStale: boolean;
  pluginsStale: boolean;
  hubSkillsStale: boolean;
  cloudOrgSkillsStale: boolean;
};

export type ExtensionsStoreMutableState = Omit<
  ExtensionsStoreSnapshot,
  "workspaceContextKey" | "skillsStale" | "pluginsStale" | "hubSkillsStale" | "cloudOrgSkillsStale"
> & {
  skillsContextKey: string;
  pluginsContextKey: string;
  hubSkillsContextKey: string;
  cloudOrgSkillsContextKey: string;
};

export function buildExtensionsStoreSnapshot(input: {
  orgId: string;
  state: ExtensionsStoreMutableState;
  workspaceContextKey: string;
}): ExtensionsStoreSnapshot {
  return {
    workspaceContextKey: input.workspaceContextKey,
    skills: input.state.skills,
    skillsStatus: input.state.skillsStatus,
    hubSkills: input.state.hubSkills,
    hubSkillsStatus: input.state.hubSkillsStatus,
    cloudOrgSkills: input.state.cloudOrgSkills,
    cloudOrgSkillsStatus: input.state.cloudOrgSkillsStatus,
    importedCloudSkills: input.state.importedCloudSkills,
    cloudOrgSkillHubs: input.state.cloudOrgSkillHubs,
    cloudOrgSkillHubsStatus: input.state.cloudOrgSkillHubsStatus,
    importedCloudSkillHubs: input.state.importedCloudSkillHubs,
    cloudOrgMarketplaces: input.state.cloudOrgMarketplaces,
    cloudOrgMarketplacesStatus: input.state.cloudOrgMarketplacesStatus,
    importedCloudPlugins: input.state.importedCloudPlugins,
    hubRepo: input.state.hubRepo,
    hubRepos: input.state.hubRepos,
    pluginScope: input.state.pluginScope,
    pluginConfig: input.state.pluginConfig,
    pluginConfigPath: input.state.pluginConfigPath,
    pluginList: input.state.pluginList,
    pluginInput: input.state.pluginInput,
    pluginStatus: input.state.pluginStatus,
    activePluginGuide: input.state.activePluginGuide,
    sidebarPluginList: input.state.sidebarPluginList,
    sidebarPluginStatus: input.state.sidebarPluginStatus,
    skillsStale: input.state.skillsContextKey !== input.workspaceContextKey,
    pluginsStale: input.state.pluginsContextKey !== input.workspaceContextKey,
    hubSkillsStale: input.state.hubSkillsContextKey !== input.workspaceContextKey,
    cloudOrgSkillsStale: input.state.cloudOrgSkillsContextKey !== buildExtensionsCloudOrgLoadKey({
      workspaceContextKey: input.workspaceContextKey,
      orgId: input.orgId,
    }),
  };
}
