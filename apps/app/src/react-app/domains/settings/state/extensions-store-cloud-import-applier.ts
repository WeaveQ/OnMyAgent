import type { ReloadReason, ReloadTrigger, SkillCard } from "../../../../app/types";
import type { DenOrgPluginResolved, DenOrgSkillHub } from "../../../../app/lib/den";
import type {
  CloudImportedPlugin,
  CloudImportedPluginFile,
  CloudImportedSkillHub,
} from "../../../../app/cloud/import-state";
import {
  buildCloudSkillHubImportPlan,
  buildPluginObjectWorkspaceFilePlan,
  cloudPluginRemovalPlan,
  cloudPluginRemovedMcpNames,
  pluginMcpConfigsFromPayload,
  pluginNamespace,
  pluginReloadReason,
} from "./extensions-store-model";

export type ExtensionsWorkspaceWriter = {
  deleteMcpConfig: (name: string) => Promise<void>;
  deleteSkill: (name: string) => Promise<void>;
  upsertMcpConfig: (name: string, config: Record<string, unknown>) => Promise<void>;
  upsertSkill: (
    name: string,
    content: string,
    description: string,
    optionsOverride?: { overwrite?: boolean },
  ) => Promise<void>;
  writeWorkspaceFile: (path: string, content: string) => Promise<void>;
};

export type CloudSkillHubApplyResult = {
  nextSkillIds: string[];
  nextSkillNames: string[];
  removedSkillNames: string[];
};

export type CloudPluginApplyOptions = {
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  marketplaceId: string | null;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  persistImportedCloudPlugins: (nextPlugins: Record<string, CloudImportedPlugin>) => Promise<void>;
  resolved: DenOrgPluginResolved;
  writer: ExtensionsWorkspaceWriter;
};

export type CloudPluginRemoveOptions = {
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  persistImportedCloudPlugins: (nextPlugins: Record<string, CloudImportedPlugin>) => Promise<void>;
  pluginId: string;
  writer: ExtensionsWorkspaceWriter;
};

export type CloudPluginRemoveResult = {
  hasRemainingFiles: boolean;
  name: string;
};

export async function applyCloudSkillHubToWorkspace(input: {
  existingSkills: SkillCard[];
  hub: DenOrgSkillHub;
  imported?: CloudImportedSkillHub | null;
  writer: ExtensionsWorkspaceWriter;
}): Promise<CloudSkillHubApplyResult> {
  const plan = buildCloudSkillHubImportPlan({
    hub: input.hub,
    imported: input.imported,
    existingSkillNames: input.existingSkills.map((skill) => skill.name),
  });

  await Promise.all(
    plan.skillWrites.map(({ installName, content, description, overwrite }) =>
      input.writer.upsertSkill(installName, content, description, { overwrite }),
    ),
  );

  await Promise.all(plan.removedSkillNames.map((name) => input.writer.deleteSkill(name)));

  return {
    nextSkillNames: plan.nextSkillNames,
    nextSkillIds: plan.nextSkillIds,
    removedSkillNames: plan.removedSkillNames,
  };
}

export async function applyCloudPluginToWorkspace(options: CloudPluginApplyOptions): Promise<CloudImportedPluginFile[]> {
  const files: CloudImportedPluginFile[] = [];
  const existing = options.importedCloudPlugins[options.resolved.plugin.id];
  const namespace = pluginNamespace(options.resolved.plugin.name, options.resolved.plugin.id);

  for (const membership of options.resolved.memberships) {
    const object = membership.configObject;
    const version = object?.latestVersion ?? null;
    if (!object || object.status !== "active") continue;

    if (object.objectType === "mcp") {
      const configs = pluginMcpConfigsFromPayload(object, namespace);
      for (const config of configs) {
        await options.writer.upsertMcpConfig(config.name, config.config);
        files.push({
          configObjectId: object.id,
          versionId: version?.id ?? null,
          objectType: object.objectType,
          title: object.title,
          path: config.path,
          updatedAt: object.updatedAt,
        });
        options.markReloadRequired?.("mcp", {
          type: "mcp",
          name: config.name,
          action: existing ? "updated" : "added",
        });
      }
      continue;
    }

    if (version?.rawSourceText == null) continue;

    const { path, content } = buildPluginObjectWorkspaceFilePlan(object, namespace, version.rawSourceText);
    await options.writer.writeWorkspaceFile(path, content);

    files.push({
      configObjectId: object.id,
      versionId: version.id,
      objectType: object.objectType,
      title: object.title,
      path,
      updatedAt: object.updatedAt,
    });
    options.markReloadRequired?.(pluginReloadReason(object.objectType), {
      type:
        object.objectType === "skill" || object.objectType === "agent" || object.objectType === "command"
          ? object.objectType
          : "config",
      name: object.title,
      action: existing ? "updated" : "added",
    });
  }

  const removedMcpNames = cloudPluginRemovedMcpNames({
    existingFiles: existing?.files ?? [],
    nextFiles: files,
  });
  await Promise.all(removedMcpNames.map((name) => options.writer.deleteMcpConfig(name)));

  const nextPlugins = {
    ...options.importedCloudPlugins,
    [options.resolved.plugin.id]: {
      pluginId: options.resolved.plugin.id,
      marketplaceId: options.marketplaceId,
      name: options.resolved.plugin.name,
      description: options.resolved.plugin.description,
      updatedAt: options.resolved.plugin.updatedAt,
      files,
      importedAt: existing?.importedAt ?? Date.now(),
    },
  } satisfies Record<string, CloudImportedPlugin>;
  await options.persistImportedCloudPlugins(nextPlugins);
  return files;
}

export async function removeCloudPluginFromWorkspace(options: CloudPluginRemoveOptions): Promise<CloudPluginRemoveResult> {
  const imported = options.importedCloudPlugins[options.pluginId];
  if (!imported) throw new Error("Marketplace package is not installed in this workspace.");

  const removalPlan = cloudPluginRemovalPlan(imported.files);
  const { removedSkillNames, removedMcpNames } = removalPlan;
  await Promise.all(removedSkillNames.map((name) => options.writer.deleteSkill(name).catch(() => undefined)));
  await Promise.all(removedMcpNames.map((name) => options.writer.deleteMcpConfig(name)));

  const nextPlugins = { ...options.importedCloudPlugins };
  delete nextPlugins[options.pluginId];
  await options.persistImportedCloudPlugins(nextPlugins);

  if (removedMcpNames.length > 0) {
    options.markReloadRequired?.("mcp", { type: "mcp", name: imported.name, action: "removed" });
  }
  if (removalPlan.hasRemainingFiles) {
    options.markReloadRequired?.("config", { type: "config", name: imported.name, action: "removed" });
  }

  return {
    hasRemainingFiles: removalPlan.hasRemainingFiles,
    name: imported.name,
  };
}
