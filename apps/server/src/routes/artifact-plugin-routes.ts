import type {
  ArtifactPluginCatalogItem,
  ArtifactPluginSkillItem,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import type { ArtifactPluginEnablement } from "@onmyagent/types/artifact-plugin";

import { ApiError } from "../core/errors.js";
import { shortId } from "../core/utils.js";
import { recordAudit } from "../services/audit.js";
import {
  artifactPluginEnablementPath,
  readArtifactPluginEnablement,
  updatePluginEnablement,
  updateSkillEnablement,
} from "../services/artifact-plugin-enablement.js";
import {
  getArtifactPlugin,
  scanArtifactPlugins,
  type ArtifactPluginCatalog,
  type ArtifactPluginPackage,
} from "../services/artifact-plugin-registry.js";
import { bundledArtifactPluginsDir } from "../workspace/workspace-files.js";
import {
  addRoute,
  systemJsonResponse,
  type RequestContext,
  type Route,
} from "./route-core.js";

export function registerArtifactPluginRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  emitReloadEvent: (
    reloadEvents: RequestContext["reloadEvents"],
    workspace: WorkspaceInfo,
    reason: "skills",
    trigger?: ReloadTrigger,
  ) => void;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    emitReloadEvent,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/artifact-plugins", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    const { catalog, enablement } = await readCatalogState(config);
    return systemJsonResponse({
      items: catalog.items.map((plugin) => projectPlugin(plugin, enablement)),
      diagnostics: catalog.diagnostics,
    });
  });

  addRoute(routes, "GET", "/workspace/:id/artifact-plugins/:pluginId", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    const { catalog, enablement } = await readCatalogState(config);
    const plugin = requirePlugin(catalog, ctx.params.pluginId);
    return systemJsonResponse({
      item: projectPlugin(plugin, enablement),
      diagnostics: catalog.diagnostics,
    });
  });

  addRoute(routes, "PUT", "/workspace/:id/artifact-plugins/:pluginId/enabled", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const { catalog } = await readCatalogState(config);
    const plugin = requirePlugin(catalog, ctx.params.pluginId);
    const enabled = requireEnabled(await readJsonBody(ctx.request));
    const path = artifactPluginEnablementPath(config.configPath);
    const enablement = await updatePluginEnablement(path, plugin.manifest.name, enabled);
    await recordEnablementAudit(workspace, ctx, {
      action: "artifact_plugins.enablement.update",
      target: path,
      summary: `${enabled ? "Enabled" : "Disabled"} Artifact plugin ${plugin.manifest.name}`,
    });
    emitSkillsReload(emitReloadEvent, ctx, workspace, plugin.manifest.name, path);
    return systemJsonResponse({ item: projectPlugin(plugin, enablement) });
  });

  addRoute(routes, "PUT", "/workspace/:id/artifact-plugins/:pluginId/skills/:skillId/enabled", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const { catalog } = await readCatalogState(config);
    const plugin = requirePlugin(catalog, ctx.params.pluginId);
    const skill = requireSkill(plugin, ctx.params.skillId);
    const enabled = requireEnabled(await readJsonBody(ctx.request));
    const path = artifactPluginEnablementPath(config.configPath);
    const enablement = await updateSkillEnablement(
      path,
      plugin.manifest.name,
      skill.id,
      enabled,
    );
    await recordEnablementAudit(workspace, ctx, {
      action: "artifact_plugins.skill_enablement.update",
      target: path,
      summary: `${enabled ? "Enabled" : "Disabled"} Artifact skill ${skill.id}`,
    });
    emitSkillsReload(emitReloadEvent, ctx, workspace, skill.id, path);
    return systemJsonResponse({ item: projectSkill(plugin, skill, enablement) });
  });

  addRoute(routes, "GET", "/workspace/:id/artifact-plugins/:pluginId/connection", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    const { catalog } = await readCatalogState(config);
    requirePlugin(catalog, ctx.params.pluginId);
    return systemJsonResponse({
      status: "unavailable",
      reason: "No live provider is registered",
    });
  });
}

async function readCatalogState(config: ServerConfig) {
  const root = bundledArtifactPluginsDir();
  const catalog: ArtifactPluginCatalog = root
    ? await scanArtifactPlugins(root)
    : { items: [], diagnostics: [] };
  const enablement = await readArtifactPluginEnablement(
    artifactPluginEnablementPath(config.configPath),
  );
  return { catalog, enablement };
}

function requirePlugin(catalog: ArtifactPluginCatalog, pluginId: string) {
  const plugin = getArtifactPlugin(catalog, pluginId);
  if (!plugin) {
    throw new ApiError(404, "artifact_plugin_not_found", `Artifact plugin not found: ${pluginId}`);
  }
  return plugin;
}

function requireSkill(plugin: ArtifactPluginPackage, skillId: string) {
  const skill = plugin.runtime.skills.find((candidate) => candidate.id === skillId);
  if (!skill) {
    throw new ApiError(404, "artifact_plugin_skill_not_found", `Artifact plugin skill not found: ${skillId}`);
  }
  return skill;
}

function requireEnabled(body: Record<string, unknown>): boolean {
  if (typeof body.enabled !== "boolean") {
    throw new ApiError(400, "invalid_artifact_plugin_enablement", "enabled must be a boolean");
  }
  return body.enabled;
}

function projectPlugin(
  plugin: ArtifactPluginPackage,
  enablement: ArtifactPluginEnablement,
): ArtifactPluginCatalogItem {
  const state = enablement.plugins[plugin.manifest.name];
  const enabled = state?.enabled ?? true;
  return {
    id: plugin.manifest.name,
    manifest: plugin.manifest,
    runtime: plugin.runtime,
    enabled,
    skills: plugin.runtime.skills.map((skill) => projectSkill(plugin, skill, enablement)),
  };
}

function projectSkill(
  plugin: ArtifactPluginPackage,
  skill: ArtifactPluginPackage["runtime"]["skills"][number],
  enablement: ArtifactPluginEnablement,
): ArtifactPluginSkillItem {
  const pluginState = enablement.plugins[plugin.manifest.name];
  return {
    id: skill.id,
    enabled: (pluginState?.enabled ?? true) &&
      (pluginState?.skills[skill.id] ?? skill.defaultEnabled),
    defaultEnabled: skill.defaultEnabled,
  };
}

async function recordEnablementAudit(
  workspace: WorkspaceInfo,
  ctx: RequestContext,
  entry: { action: string; target: string; summary: string },
) {
  await recordAudit(workspace.path, {
    id: shortId(),
    workspaceId: workspace.id,
    actor: ctx.actor ?? { type: "remote" },
    ...entry,
    timestamp: Date.now(),
  });
}

function emitSkillsReload(
  emitReloadEvent: (
    reloadEvents: RequestContext["reloadEvents"],
    workspace: WorkspaceInfo,
    reason: "skills",
    trigger?: ReloadTrigger,
  ) => void,
  ctx: RequestContext,
  workspace: WorkspaceInfo,
  name: string,
  path: string,
) {
  emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
    type: "skill",
    name,
    action: "updated",
    path,
  });
}
