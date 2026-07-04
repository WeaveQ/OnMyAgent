import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
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
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { ensureDir, exists, shortId } from "../core/utils.js";

export function registerWorkspaceFileRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  maxFileBytes: number;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  normalizeWorkspaceRelativePath: (
    value: string,
    options: { allowSubdirs: boolean },
  ) => string;
  resolveSafeChildPath: (root: string, child: string) => string;
  isSupportedWorkspaceTextFilePath: (relativePath: string) => boolean;
  contentTypeForPath: (relativePath: string) => string;
  fileRevision: (info: { mtimeMs: number; size: number }) => string;
  recordWorkspaceFileEvent: (
    workspaceId: string,
    input: {
      type: "write" | "delete" | "rename" | "mkdir";
      path: string;
      toPath?: string;
      revision?: string;
    },
  ) => unknown;
}) {
  const {
    routes,
    config,
    maxFileBytes,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    readJsonBody,
    normalizeWorkspaceRelativePath,
    resolveSafeChildPath,
    isSupportedWorkspaceTextFilePath,
    contentTypeForPath,
    fileRevision,
    recordWorkspaceFileEvent,
  } = input;

  addRoute(
    routes,
    "GET",
    "/workspace/:id/files/content",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const requested = (ctx.url.searchParams.get("path") ?? "").trim();
      const relativePath = normalizeWorkspaceRelativePath(requested, {
        allowSubdirs: true,
      });
      if (!isSupportedWorkspaceTextFilePath(relativePath)) {
        throw new ApiError(
          400,
          "invalid_path",
          "Only supported text artifact files can be read inline",
        );
      }

      const absPath = resolveSafeChildPath(workspace.path, relativePath);
      if (!(await exists(absPath))) {
        throw new ApiError(404, "file_not_found", "File not found");
      }
      const info = await stat(absPath);
      if (!info.isFile()) {
        throw new ApiError(404, "file_not_found", "File not found");
      }

      if (info.size > maxFileBytes) {
        throw new ApiError(413, "file_too_large", "File exceeds size limit", {
          maxBytes: maxFileBytes,
          size: info.size,
        });
      }

      const content = await readFile(absPath, "utf8");
      return systemJsonResponse({
        path: relativePath,
        content,
        bytes: info.size,
        updatedAt: info.mtimeMs,
      });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/files/stat",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const requested = (ctx.url.searchParams.get("path") ?? "").trim();
      const relativePath = normalizeWorkspaceRelativePath(requested, {
        allowSubdirs: true,
      });
      const absPath = resolveSafeChildPath(workspace.path, relativePath);
      if (!(await exists(absPath))) {
        return systemJsonResponse({ ok: true, path: relativePath, exists: false });
      }
      const info = await stat(absPath);
      return systemJsonResponse({
        ok: true,
        path: relativePath,
        exists: true,
        kind: info.isFile() ? "file" : info.isDirectory() ? "dir" : "other",
        size: info.size,
        updatedAt: info.mtimeMs,
      });
    },
  );

  addRoute(routes, "GET", "/workspace/:id/files/raw", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const requested = (ctx.url.searchParams.get("path") ?? "").trim();
    const relativePath = normalizeWorkspaceRelativePath(requested, {
      allowSubdirs: true,
    });
    const absPath = resolveSafeChildPath(workspace.path, relativePath);
    if (!(await exists(absPath))) {
      throw new ApiError(404, "file_not_found", "File not found");
    }
    const info = await stat(absPath);
    if (!info.isFile()) {
      throw new ApiError(404, "file_not_found", "File not found");
    }

    const headers = new Headers();
    headers.set("Content-Type", contentTypeForPath(relativePath));
    headers.set("Content-Length", String(info.size));
    headers.set(
      "Content-Disposition",
      `inline; filename="${basename(relativePath)}"`,
    );
    const stream = nodeReadableToWebStream(createReadStream(absPath));
    return new Response(stream, { status: 200, headers });
  });

  addRoute(
    routes,
    "POST",
    "/workspace/:id/files/raw",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const requestedPath = String(body.path ?? "");
      const relativePath = normalizeWorkspaceRelativePath(requestedPath, {
        allowSubdirs: true,
      });
      if (typeof body.dataBase64 !== "string") {
        throw new ApiError(
          400,
          "invalid_payload",
          "dataBase64 must be a string",
        );
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(body.dataBase64, "base64");
      } catch {
        throw new ApiError(400, "invalid_payload", "dataBase64 is invalid");
      }
      if (bytes.byteLength > maxFileBytes) {
        throw new ApiError(413, "file_too_large", "File exceeds size limit", {
          maxBytes: maxFileBytes,
          size: bytes.byteLength,
        });
      }

      const baseUpdatedAt = parseBaseUpdatedAt(body.baseUpdatedAt);
      const force = body.force === true;
      const absPath = resolveSafeChildPath(workspace.path, relativePath);
      const before = (await exists(absPath)) ? await stat(absPath) : null;
      if (before && !before.isFile()) {
        throw new ApiError(400, "invalid_path", "Path must point to a file");
      }
      const beforeUpdatedAt = before ? before.mtimeMs : null;
      assertNoConflict(force, baseUpdatedAt, beforeUpdatedAt);

      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "workspace.file.write",
        summary: `Write ${relativePath}`,
        paths: [absPath],
      });

      await ensureDir(dirname(absPath));
      const tmp = `${absPath}.tmp-${shortId()}`;
      await writeFile(tmp, bytes);
      await rename(tmp, absPath);
      const after = await stat(absPath);
      const revision = fileRevision(after);
      recordWorkspaceFileEvent(workspace.id, {
        type: "write",
        path: relativePath,
        revision,
      });
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "workspace.file.write",
        target: absPath,
        summary: `Wrote ${relativePath}`,
        timestamp: Date.now(),
      });
      return systemJsonResponse({
        ok: true,
        path: relativePath,
        bytes: bytes.byteLength,
        updatedAt: after.mtimeMs,
        revision,
      });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/files/content",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);

      const requestedPath = String(body.path ?? "");
      const relativePath = normalizeWorkspaceRelativePath(requestedPath, {
        allowSubdirs: true,
      });
      if (!isSupportedWorkspaceTextFilePath(relativePath)) {
        throw new ApiError(
          400,
          "invalid_path",
          "Only supported text artifact files can be edited inline",
        );
      }

      if (typeof body.content !== "string") {
        throw new ApiError(400, "invalid_payload", "content must be a string");
      }
      const content = body.content;
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > maxFileBytes) {
        throw new ApiError(413, "file_too_large", "File exceeds size limit", {
          maxBytes: maxFileBytes,
          size: bytes,
        });
      }

      const baseUpdatedAt = parseBaseUpdatedAt(body.baseUpdatedAt);
      const force = body.force === true;
      const absPath = resolveSafeChildPath(workspace.path, relativePath);

      const before = (await exists(absPath)) ? await stat(absPath) : null;
      if (before && !before.isFile()) {
        throw new ApiError(400, "invalid_path", "Path must point to a file");
      }
      const beforeUpdatedAt = before ? before.mtimeMs : null;
      assertNoConflict(force, baseUpdatedAt, beforeUpdatedAt);

      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "workspace.file.write",
        summary: `Write ${relativePath}`,
        paths: [absPath],
      });

      await ensureDir(dirname(absPath));
      const tmp = `${absPath}.tmp-${shortId()}`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, absPath);
      const after = await stat(absPath);
      const revision = fileRevision(after);

      recordWorkspaceFileEvent(workspace.id, {
        type: "write",
        path: relativePath,
        revision,
      });

      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "workspace.file.write",
        target: absPath,
        summary: `Wrote ${relativePath}`,
        timestamp: Date.now(),
      });

      return systemJsonResponse({
        ok: true,
        path: relativePath,
        bytes,
        updatedAt: after.mtimeMs,
        revision,
      });
    },
  );
}

function parseBaseUpdatedAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assertNoConflict(
  force: boolean,
  baseUpdatedAt: number | null,
  beforeUpdatedAt: number | null,
) {
  if (force || beforeUpdatedAt === null || baseUpdatedAt === null) return;
  if (beforeUpdatedAt === baseUpdatedAt) return;
  throw new ApiError(
    409,
    "conflict",
    "File changed since it was loaded",
    { baseUpdatedAt, currentUpdatedAt: beforeUpdatedAt },
  );
}
