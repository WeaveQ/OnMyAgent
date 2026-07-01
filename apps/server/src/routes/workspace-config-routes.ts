import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  ApprovalRequest,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { readLastAudit, recordAudit } from "../services/audit.js";
import { ApiError } from "../core/errors.js";
import { updateJsoncPath, updateJsoncTopLevel } from "../core/jsonc.js";
import { computeReloadFingerprint } from "../reload-fingerprint.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { ensureDir, shortId } from "../core/utils.js";
import { onmyagentConfigPath, opencodeConfigPath } from "../workspace/workspace-files.js";
import { readRawOpencodeConfig } from "../workspace/workspace-init.js";

export function registerWorkspaceConfigRoutes(input: {
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
    reason: "config",
    trigger?: ReloadTrigger,
  ) => void;
  readOpencodeConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>;
  readOpenworkConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>;
  writeOpenworkConfig: (
    workspaceRoot: string,
    payload: Record<string, unknown>,
    merge: boolean,
  ) => Promise<void>;
  buildConfigTrigger: (path: string) => ReloadTrigger;
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
    readOpencodeConfig,
    readOpenworkConfig,
    writeOpenworkConfig,
    buildConfigTrigger,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/config", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const opencode = await readOpencodeConfig(workspace.path);
    const onmyagent = await readOpenworkConfig(workspace.path);
    const lastAudit = await readLastAudit(workspace.path, workspace.id);
    return systemJsonResponse({
      opencode,
      onmyagent,
      updatedAt: lastAudit?.timestamp ?? null,
    });
  });

  addRoute(
    routes,
    "GET",
    "/workspace/:id/opencode-config",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const scope = normalizeOpencodeScope(ctx.url.searchParams.get("scope"));
      const configPath = resolveOpencodeConfigFilePath(scope, workspace.path);
      const result = await readRawOpencodeConfig(configPath);
      return systemJsonResponse({
        path: configPath,
        exists: result.exists,
        content: result.content,
      });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/opencode-config",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const scope = normalizeOpencodeScope(
        typeof body.scope === "string" ? body.scope : null,
      );
      const content = typeof body.content === "string" ? body.content : null;
      if (content === null) {
        throw new ApiError(400, "invalid_payload", "content must be a string");
      }

      const configPath = resolveOpencodeConfigFilePath(scope, workspace.path);
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: scope === "global" ? "config.global.write" : "config.write",
        summary: `Write ${scope} OpenCode config`,
        paths: [configPath],
      });

      const nextContent = content.endsWith("\n") ? content : `${content}\n`;
      const current = await readRawOpencodeConfig(configPath);
      const changed = !current.exists || current.content !== nextContent;
      if (changed) {
        await ensureDir(dirname(configPath));
        await writeFile(configPath, nextContent, "utf8");
      }

      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: scope === "global" ? "config.global.write" : "config.write",
        target: configPath,
        summary: `Updated ${scope} OpenCode config`,
        timestamp: Date.now(),
      });

      if (scope === "project" && changed) {
        emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(configPath));
      }

      return systemJsonResponse({
        ok: true,
        status: 0,
        stdout: `Wrote ${configPath}`,
        stderr: "",
      });
    },
  );

  addRoute(routes, "PATCH", "/workspace/:id/config", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const opencode = readOptionalRecord(body.opencode);
    const onmyagent = readOptionalRecord(body.onmyagent);

    if (!opencode && !onmyagent) {
      throw new ApiError(
        400,
        "invalid_payload",
        "opencode or onmyagent updates required",
      );
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "config.patch",
      summary: "Patch workspace config",
      paths: [
        opencode ? opencodeConfigPath(workspace.path) : null,
        onmyagent ? onmyagentConfigPath(workspace.path) : null,
      ].filter((path): path is string => Boolean(path)),
    });

    const configFingerprintBefore = opencode
      ? await computeReloadFingerprint(workspace.path, "config")
      : null;

    if (opencode) {
      await patchOpencodeConfig(workspace.path, opencode, readOpencodeConfig);
    }
    if (onmyagent) {
      await writeOpenworkConfig(workspace.path, onmyagent, true);
    }

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "config.patch",
      target: "opencode.json",
      summary: "Patched workspace config",
      timestamp: Date.now(),
    });

    if (
      opencode &&
      configFingerprintBefore !==
        (await computeReloadFingerprint(workspace.path, "config"))
    ) {
      emitReloadEvent(
        ctx.reloadEvents,
        workspace,
        "config",
        buildConfigTrigger(opencodeConfigPath(workspace.path)),
      );
    }

    return systemJsonResponse({ updatedAt: Date.now() });
  });
}

async function patchOpencodeConfig(
  workspacePath: string,
  opencode: Record<string, unknown>,
  readOpencodeConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>,
) {
  const configPath = opencodeConfigPath(workspacePath);
  const { permission, provider, ...topLevelUpdates } = opencode;

  if (Object.keys(topLevelUpdates).length) {
    await updateJsoncTopLevel(configPath, topLevelUpdates);
  }

  const providerUpdate = ensurePlainObject(provider);
  for (const [providerId, providerConfig] of Object.entries(providerUpdate)) {
    await updateJsoncPath(configPath, ["provider", providerId], providerConfig);
  }

  const permissionUpdate = ensurePlainObject(permission);
  if (
    Object.prototype.hasOwnProperty.call(
      permissionUpdate,
      "external_directory",
    )
  ) {
    const existingOpencode = await readOpencodeConfig(workspacePath);
    const existingPermission = ensurePlainObject(existingOpencode.permission);
    const nextExternalDirectory = permissionUpdate.external_directory;
    const existingPermissionKeys = Object.keys(existingPermission);
    const removePermissionParent =
      typeof nextExternalDirectory === "undefined" &&
      (existingPermissionKeys.length === 0 ||
        (existingPermissionKeys.length === 1 &&
          Object.prototype.hasOwnProperty.call(
            existingPermission,
            "external_directory",
          )));

    if (removePermissionParent) {
      await updateJsoncPath(configPath, ["permission"], undefined);
    } else {
      await updateJsoncPath(
        configPath,
        ["permission", "external_directory"],
        nextExternalDirectory,
      );
    }
  }
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function normalizeOpencodeScope(value: string | null): "project" | "global" {
  return value === "global" ? "global" : "project";
}

function resolveOpencodeConfigFilePath(
  scope: "project" | "global",
  workspaceRoot: string,
): string {
  if (scope === "global") {
    const base = join(homedir(), ".config", "opencode");
    const jsoncPath = join(base, "opencode.jsonc");
    const jsonPath = join(base, "opencode.json");
    if (existsSync(jsoncPath)) return jsoncPath;
    if (existsSync(jsonPath)) return jsonPath;
    return jsoncPath;
  }
  return opencodeConfigPath(workspaceRoot);
}
