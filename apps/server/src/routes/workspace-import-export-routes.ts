import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type {
  ApprovalRequest,
  ReloadReason,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import { listCommands, upsertCommand } from "../services/commands.js";
import { ApiError } from "../core/errors.js";
import { readJsoncFile, updateJsoncTopLevel, writeJsoncFile } from "../core/jsonc.js";
import { sanitizePortableOpencodeConfig } from "../workspace/portable-opencode.js";
import { listPortableFiles } from "../workspace/portable-files.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { listSkills, upsertSkill } from "../services/skills.js";
import { ensureDir, shortId } from "../core/utils.js";
import {
  buildWorkspaceImportPreview,
  normalizeWorkspaceImportPayload,
  publicWorkspaceImportPreview,
  summarizeWorkspaceImportApplied,
  summarizeWorkspaceImportPreview,
  type WorkspaceImportPlan,
  workspaceImportPreviewApprovalPaths,
} from "../workspace/workspace-import-preview.js";
import {
  collectWorkspaceExportWarnings,
  stripSensitiveWorkspaceExportData,
  type WorkspaceExportSensitiveMode,
} from "../workspace/workspace-export-safety.js";
import {
  globalSkillsDir,
  opencodeConfigPath,
  onmyagentConfigPath,
  projectCommandsDir,
} from "../workspace/workspace-files.js";
import { sanitizeOnMyAgentTemplateConfig } from "../workspace/blueprint-sessions.js";
import { computeReloadFingerprint } from "../reload-fingerprint.js";
import type { ReloadEventStore } from "../services/events.js";

export function registerWorkspaceImportExportRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  readOnMyAgentConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>;
  writeOnMyAgentConfig: (
    workspaceRoot: string,
    next: Record<string, unknown>,
    merge: boolean,
  ) => Promise<void>;
  emitReloadEvent: (
    store: ReloadEventStore,
    workspace: WorkspaceInfo,
    reason: ReloadReason,
    trigger?: ReloadTrigger,
  ) => void;
  buildConfigTrigger: (path: string) => ReloadTrigger;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    readJsonBody,
    readOnMyAgentConfig,
    writeOnMyAgentConfig,
    emitReloadEvent,
    buildConfigTrigger,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/export", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sensitiveMode = parseWorkspaceExportSensitiveMode(
      ctx.url.searchParams.get("sensitive"),
    );
    const exportPayload = await exportWorkspace(workspace, {
      sensitiveMode,
      readOnMyAgentConfig,
    });
    return systemJsonResponse(exportPayload);
  });

  addRoute(
    routes,
    "POST",
    "/workspace/:id/import/preview",
    "client",
    async (ctx) => {
      requireClientScope(ctx, "viewer");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const preview = await buildWorkspaceImportPreview(workspace.path, body);
      return systemJsonResponse(publicWorkspaceImportPreview(preview));
    },
  );

  addRoute(routes, "POST", "/workspace/:id/import", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const expectedFingerprint = parseWorkspaceImportPreviewFingerprint(body);
    const preview = await buildWorkspaceImportPreview(workspace.path, body);
    if (expectedFingerprint && expectedFingerprint !== preview.fingerprint) {
      return systemJsonResponse(
        {
          ok: false,
          code: "workspace_import_preview_stale",
          message:
            "Workspace changed after this import was previewed. Review the latest preview before importing.",
          preview: publicWorkspaceImportPreview(preview),
        },
        409,
      );
    }
    const approvalPaths = workspaceImportPreviewApprovalPaths(preview);
    if (approvalPaths.length === 0) {
      return systemJsonResponse({
        ok: true,
        preview: publicWorkspaceImportPreview(preview),
      });
    }
    if (!expectedFingerprint) {
      return systemJsonResponse(
        {
          ok: false,
          code: "workspace_import_preview_required",
          message:
            "Review this import preview before applying workspace changes.",
          preview: publicWorkspaceImportPreview(preview),
        },
        409,
      );
    }
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "config.import",
      summary: summarizeWorkspaceImportPreview(preview),
      paths: approvalPaths,
    });
    const latestPreview = await buildWorkspaceImportPreview(
      workspace.path,
      body,
    );
    if (latestPreview.fingerprint !== expectedFingerprint) {
      return systemJsonResponse(
        {
          ok: false,
          code: "workspace_import_preview_stale",
          message:
            "Workspace changed after this import was previewed. Review the latest preview before importing.",
          preview: publicWorkspaceImportPreview(latestPreview),
        },
        409,
      );
    }
    const configFingerprintBefore = await computeReloadFingerprint(
      workspace.path,
      "config",
    );
    await importWorkspace(workspace, body, latestPreview, { writeOnMyAgentConfig });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "config.import",
      target: "workspace",
      summary: summarizeWorkspaceImportApplied(latestPreview),
      timestamp: Date.now(),
    });
    if (
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
    return systemJsonResponse({
      ok: true,
      preview: publicWorkspaceImportPreview(latestPreview),
    });
  });
}

async function exportWorkspace(
  workspace: WorkspaceInfo,
  options: {
    sensitiveMode?: WorkspaceExportSensitiveMode;
    readOnMyAgentConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>;
  },
) {
  const sensitiveMode = options.sensitiveMode ?? "auto";
  const { data: rawOpencode } = await readJsoncFile<Record<string, unknown>>(
    opencodeConfigPath(workspace.path),
    {},
  );
  let opencode = sanitizePortableOpencodeConfig(rawOpencode);
  const onmyagent = sanitizeOnMyAgentTemplateConfig(
    await options.readOnMyAgentConfig(workspace.path),
  );
  const skills = await listSkills(workspace.path, false);
  const commands = await listCommands(workspace.path, "workspace");
  let files = await listPortableFiles(workspace.path);
  const warnings = collectWorkspaceExportWarnings({
    opencode: rawOpencode,
    files,
  });
  if (warnings.length && sensitiveMode === "auto") {
    throw new ApiError(
      409,
      "workspace_export_requires_decision",
      "This workspace includes sensitive config. Choose whether to exclude it or include it before exporting.",
      { warnings },
    );
  }
  if (sensitiveMode === "exclude") {
    const sanitized = stripSensitiveWorkspaceExportData({ opencode, files });
    opencode = sanitized.opencode;
    files = sanitized.files;
  }
  const skillContents = await Promise.all(
    skills.map(async (skill) => ({
      name: skill.name,
      description: skill.description,
      content: await readFile(skill.path, "utf8"),
    })),
  );
  const commandContents = await Promise.all(
    commands.map(async (command) => ({
      name: command.name,
      description: command.description,
      template: command.template,
    })),
  );

  return {
    workspaceId: workspace.id,
    exportedAt: Date.now(),
    opencode,
    onmyagent,
    skills: skillContents,
    commands: commandContents,
    ...(files.length ? { files } : {}),
  };
}

function parseWorkspaceExportSensitiveMode(
  input: string | null,
): WorkspaceExportSensitiveMode {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "auto";
  if (trimmed === "auto" || trimmed === "include" || trimmed === "exclude") {
    return trimmed;
  }
  throw new ApiError(
    400,
    "invalid_workspace_export_sensitive_mode",
    `Invalid workspace export sensitive mode: ${trimmed}`,
  );
}

function parseWorkspaceImportPreviewFingerprint(
  payload: Record<string, unknown>,
): string | null {
  const value = payload.previewFingerprint;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(
      400,
      "invalid_workspace_import_preview_fingerprint",
      "Workspace import preview fingerprint must be a string",
    );
  }
  return value;
}

function workspaceImportRelativePath(
  workspace: WorkspaceInfo,
  path: string,
): string {
  return relative(workspace.path, path).replaceAll("\\", "/");
}

async function importWorkspace(
  workspace: WorkspaceInfo,
  payload: Record<string, unknown>,
  preview: WorkspaceImportPlan,
  helpers: {
    writeOnMyAgentConfig: (
      workspaceRoot: string,
      next: Record<string, unknown>,
      merge: boolean,
    ) => Promise<void>;
  },
): Promise<void> {
  const input = normalizeWorkspaceImportPayload(workspace.path, payload);
  const changed = new Set(
    preview.changes
      .filter((change) => change.action !== "unchanged")
      .map((change) => `${change.kind}:${change.path}`),
  );
  const changedPath = (kind: string, path: string) =>
    changed.has(`${kind}:${path}`);

  if (
    input.opencode !== undefined &&
    changedPath(
      "opencode",
      workspaceImportRelativePath(
        workspace,
        opencodeConfigPath(workspace.path),
      ),
    )
  ) {
    if (input.modes.opencode === "replace") {
      await writeJsoncFile(opencodeConfigPath(workspace.path), input.opencode);
    } else {
      await updateJsoncTopLevel(
        opencodeConfigPath(workspace.path),
        input.opencode,
      );
    }
  }

  if (
    input.onmyagent !== undefined &&
    changedPath(
      "onmyagent",
      workspaceImportRelativePath(
        workspace,
        onmyagentConfigPath(workspace.path),
      ),
    )
  ) {
    if (input.modes.onmyagent === "replace") {
      await helpers.writeOnMyAgentConfig(workspace.path, input.onmyagent, false);
    } else {
      await helpers.writeOnMyAgentConfig(workspace.path, input.onmyagent, true);
    }
  }

  if (input.sections.skills) {
    for (const skill of input.skills) {
      const path = workspaceImportRelativePath(
        workspace,
        join(globalSkillsDir(), skill.name, "SKILL.md"),
      );
      if (!changedPath("skill", path)) continue;
      await upsertSkill(workspace.path, skill);
    }
    if (input.modes.skills === "replace") {
      for (const change of preview.changes) {
        if (change.kind === "skill" && change.action === "delete") {
          await rm(change.absolutePath, { recursive: true, force: true });
        }
      }
    }
  }

  if (input.sections.commands) {
    for (const command of input.commands) {
      const path = workspaceImportRelativePath(
        workspace,
        join(projectCommandsDir(workspace.path), `${command.name}.md`),
      );
      if (!changedPath("command", path)) continue;
      await upsertCommand(workspace.path, command);
    }
    if (input.modes.commands === "replace") {
      for (const change of preview.changes) {
        if (change.kind === "command" && change.action === "delete") {
          await rm(change.absolutePath, { force: true });
        }
      }
    }
  }

  if (input.sections.files) {
    for (const file of input.files) {
      if (!changedPath("file", file.path)) continue;
      const path = join(workspace.path, file.path);
      await ensureDir(dirname(path));
      await writeFile(path, file.content, "utf8");
    }
    if (input.modes.files === "replace") {
      for (const change of preview.changes) {
        if (change.kind === "file" && change.action === "delete") {
          await rm(change.absolutePath, { force: true });
        }
      }
    }
  }
}
