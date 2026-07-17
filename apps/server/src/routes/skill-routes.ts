import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApprovalRequest,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import { ApiError } from "../core/errors.js";
import { installHubSkill, listHubSkills } from "../services/skill-hub.js";
import { deleteSkill, listSkills, upsertSkill } from "../services/skills.js";
import {
  artifactPluginEnablementPath,
  readArtifactPluginEnablement,
  resolveEffectiveArtifactSkills,
} from "../services/artifact-plugin-enablement.js";
import { scanArtifactPlugins } from "../services/artifact-plugin-registry.js";
import { bundledArtifactPluginsDir } from "../workspace/workspace-files.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { shortId } from "../core/utils.js";

export function registerSkillRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  emitReloadEvent: (
    reloadEvents: RequestContext["reloadEvents"],
    workspace: WorkspaceInfo,
    reason: "skills",
    trigger?: ReloadTrigger,
  ) => void;
  globalSkillsDir: () => string;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    globalSkillsDir,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/hub/skills", "client", async (ctx) => {
    const owner = ctx.url.searchParams.get("owner")?.trim();
    const repo = ctx.url.searchParams.get("repo")?.trim();
    const ref = ctx.url.searchParams.get("ref")?.trim();
    const items = await listHubSkills({
      owner: owner || "WeaveQ",
      repo: repo || "onmyagent-hub",
      ref: ref || "main",
    });
    return systemJsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/skills", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const includeGlobal = ctx.url.searchParams.get("includeGlobal") === "true";
    const items = await listSkills(
      workspace.path,
      includeGlobal,
      await loadArtifactSkillOptions(config),
    );
    return systemJsonResponse({ items });
  });

  addRoute(
    routes,
    "POST",
    "/workspace/:id/skills/hub/:name",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = String(ctx.params.name ?? "").trim();
      if (!name) {
        throw new ApiError(400, "invalid_skill_name", "Skill name is required");
      }
      const body = await readJsonBody(ctx.request);
      const overwrite = body.overwrite === true;
      const repoPayload = parseHubRepoPayload(body.repo);

      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "skills.install_hub",
        summary: `Install hub skill ${name}`,
        paths: [join(globalSkillsDir(), name)],
      });

      const result = await installHubSkill(workspace.path, {
        name,
        overwrite,
        repo: repoPayload,
      });
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "skills.install_hub",
        target: result.path,
        summary: `Installed hub skill ${name}`,
        timestamp: Date.now(),
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
        type: "skill",
        name,
        action: result.action,
        path: result.path,
      });

      return systemJsonResponse({ ok: true, ...result });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/skills/:name",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const includeGlobal =
        ctx.url.searchParams.get("includeGlobal") === "true";
      const name = String(ctx.params.name ?? "").trim();
      if (!name) {
        throw new ApiError(400, "invalid_skill_name", "Skill name is required");
      }
      const items = await listSkills(
        workspace.path,
        includeGlobal,
        await loadArtifactSkillOptions(config),
      );
      const item = items.find((skill) => skill.name === name);
      if (!item) {
        throw new ApiError(404, "skill_not_found", `Skill not found: ${name}`);
      }
      const content = await readFile(item.path, "utf8");
      return systemJsonResponse({ item, content });
    },
  );

  addRoute(routes, "POST", "/workspace/:id/skills", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = String(body.name ?? "");
    const content = String(body.content ?? "");
    const description = body.description ? String(body.description) : undefined;
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "skills.upsert",
      summary: `Upsert skill ${name}`,
      paths: [join(globalSkillsDir(), name, "SKILL.md")],
    });
    const result = await upsertSkill(workspace.path, {
      name,
      content,
      description,
    });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "skills.upsert",
      target: result.path,
      summary: `Upserted skill ${name}`,
      timestamp: Date.now(),
    });
    emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
      type: "skill",
      name,
      action: result.action,
      path: result.path,
    });
    return systemJsonResponse({
      name,
      path: result.path,
      description: description ?? "",
      scope: "project",
    });
  });

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/skills/:name",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = String(ctx.params.name ?? "").trim();
      if (!name) {
        throw new ApiError(400, "invalid_skill_name", "Skill name is required");
      }
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "skills.delete",
        summary: `Delete skill ${name}`,
        paths: [join(globalSkillsDir(), name)],
      });
      const result = await deleteSkill(workspace.path, name);
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "skills.delete",
        target: result.path,
        summary: `Deleted skill ${name}`,
        timestamp: Date.now(),
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
        type: "skill",
        name,
        action: "removed",
        path: result.path,
      });
      return systemJsonResponse({ ok: true, name, path: result.path });
    },
  );
}

async function loadArtifactSkillOptions(config: ServerConfig) {
  const root = bundledArtifactPluginsDir();
  if (!root) {
    return {
      artifactSkillIds: new Set<string>(),
      effectiveArtifactSkillIds: new Set<string>(),
    };
  }
  const catalog = await scanArtifactPlugins(root);
  const enablement = await readArtifactPluginEnablement(
    artifactPluginEnablementPath(config.configPath),
  );
  return {
    artifactSkillIds: new Set(
      catalog.items.flatMap((plugin) =>
        plugin.runtime.skills.map((skill) => skill.id),
      ),
    ),
    effectiveArtifactSkillIds: resolveEffectiveArtifactSkills(
      catalog,
      enablement,
    ),
  };
}

function parseHubRepoPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return {
    owner: "owner" in value && typeof value.owner === "string" ? value.owner : undefined,
    repo: "repo" in value && typeof value.repo === "string" ? value.repo : undefined,
    ref: "ref" in value && typeof value.ref === "string" ? value.ref : undefined,
  };
}
