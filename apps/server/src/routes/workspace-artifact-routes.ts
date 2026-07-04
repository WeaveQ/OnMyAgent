import { createReadStream } from "node:fs";
import { writeFile, rename, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Readable } from "node:stream";
import { nodeReadableToWebStream } from "../core/node-web-stream.js";
import type {
  ApprovalRequest,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import {
  resolveInboxEnabled,
  resolveInboxMaxBytes,
  resolveOutboxEnabled,
} from "../core/capabilities.js";
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { ensureDir, exists, shortId } from "../core/utils.js";

export function registerWorkspaceArtifactRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  resolveInboxDir: (workspaceRoot: string) => string;
  resolveOutboxDir: (workspaceRoot: string) => string;
  listInbox: (inboxRoot: string) => Promise<unknown[]>;
  listArtifacts: (outboxRoot: string) => Promise<unknown[]>;
  decodeInboxId: (id: string) => string;
  decodeArtifactId: (id: string) => string;
  resolveSafeChildPath: (root: string, child: string) => string;
  normalizeWorkspaceRelativePath: (
    value: string,
    options: { allowSubdirs: boolean },
  ) => string;
  resolveWorkspaceArtifactTargets: (
    workspaceRoot: string,
    targets: unknown,
  ) => Promise<unknown[]>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    resolveInboxDir,
    resolveOutboxDir,
    listInbox,
    listArtifacts,
    decodeInboxId,
    decodeArtifactId,
    resolveSafeChildPath,
    normalizeWorkspaceRelativePath,
    resolveWorkspaceArtifactTargets,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/inbox", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    if (!resolveInboxEnabled()) {
      return systemJsonResponse({ items: [] });
    }
    const inboxRoot = resolveInboxDir(workspace.path);
    const items = await listInbox(inboxRoot);
    return systemJsonResponse({ items });
  });

  addRoute(
    routes,
    "GET",
    "/workspace/:id/inbox/:inboxId",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      if (!resolveInboxEnabled()) {
        throw new ApiError(404, "inbox_disabled", "Workspace inbox is disabled");
      }
      const inboxRoot = resolveInboxDir(workspace.path);
      const relativePath = decodeInboxId(ctx.params.inboxId);
      const absPath = resolveSafeChildPath(inboxRoot, relativePath);
      if (!(await exists(absPath))) {
        throw new ApiError(404, "inbox_item_not_found", "Inbox item not found");
      }
      const info = await stat(absPath);
      if (!info.isFile()) {
        throw new ApiError(404, "inbox_item_not_found", "Inbox item not found");
      }

      return fileDownloadResponse(absPath, relativePath, info.size);
    },
  );

  addRoute(routes, "POST", "/workspace/:id/inbox", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    if (!resolveInboxEnabled()) {
      throw new ApiError(404, "inbox_disabled", "Workspace inbox is disabled");
    }
    const workspace = await resolveWorkspace(config, ctx.params.id);

    const contentType = ctx.request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new ApiError(
        400,
        "invalid_payload",
        "Expected multipart/form-data",
      );
    }
    const form = await ctx.request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "file_required", "Form field 'file' is required");
    }

    const queryPath = (ctx.url.searchParams.get("path") ?? "").trim();
    const formPath =
      typeof form.get("path") === "string"
        ? String(form.get("path") || "").trim()
        : "";
    const requestedPath = queryPath || formPath || file.name;

    const relativePath = normalizeWorkspaceRelativePath(requestedPath, {
      allowSubdirs: true,
    });
    const inboxRoot = resolveInboxDir(workspace.path);
    const dest = resolveSafeChildPath(inboxRoot, relativePath);
    const maxBytes = resolveInboxMaxBytes();
    if (file.size > maxBytes) {
      throw new ApiError(413, "file_too_large", "File exceeds upload limit", {
        maxBytes,
        size: file.size,
      });
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "workspace.inbox.upload",
      summary: `Upload ${relativePath} to inbox`,
      paths: [dest],
    });

    await ensureDir(dirname(dest));
    const bytes = Buffer.from(await file.arrayBuffer());
    const tmp = `${dest}.tmp-${shortId()}`;
    await writeFile(tmp, bytes);
    await rename(tmp, dest);

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "workspace.inbox.upload",
      target: dest,
      summary: `Uploaded ${relativePath} to inbox`,
      timestamp: Date.now(),
    });

    return systemJsonResponse({ ok: true, path: relativePath, bytes: file.size });
  });

  addRoute(routes, "GET", "/workspace/:id/artifacts", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    if (!resolveOutboxEnabled()) {
      return systemJsonResponse({ items: [] });
    }
    const outboxRoot = resolveOutboxDir(workspace.path);
    const items = await listArtifacts(outboxRoot);
    return systemJsonResponse({ items });
  });

  addRoute(
    routes,
    "GET",
    "/workspace/:id/artifacts/:artifactId",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      if (!resolveOutboxEnabled()) {
        throw new ApiError(404, "outbox_disabled", "Workspace outbox is disabled");
      }
      const outboxRoot = resolveOutboxDir(workspace.path);
      const relativePath = decodeArtifactId(ctx.params.artifactId);
      const absPath = resolveSafeChildPath(outboxRoot, relativePath);
      if (!(await exists(absPath))) {
        throw new ApiError(404, "artifact_not_found", "Artifact not found");
      }
      const info = await stat(absPath);
      if (!info.isFile()) {
        throw new ApiError(404, "artifact_not_found", "Artifact not found");
      }

      return fileDownloadResponse(absPath, relativePath, info.size);
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/artifacts/resolve",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const items = await resolveWorkspaceArtifactTargets(
        workspace.path,
        body.targets,
      );
      return systemJsonResponse({ items });
    },
  );
}

function fileDownloadResponse(
  absPath: string,
  relativePath: string,
  size: number,
): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Length", String(size));
  headers.set(
    "Content-Disposition",
    `attachment; filename="${basename(relativePath)}"`,
  );
  const stream = nodeReadableToWebStream(createReadStream(absPath));
  return new Response(stream, { status: 200, headers });
}
