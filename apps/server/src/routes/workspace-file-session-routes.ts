import { readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  ApprovalRequest,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import { ApiError } from "../core/errors.js";
import { FileSessionStore, type FileSessionRecord } from "../services/file-sessions.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { ensureDir, exists, shortId } from "../core/utils.js";

const FILE_SESSION_DEFAULT_TTL_MS = 15 * 60 * 1000;
const FILE_SESSION_MIN_TTL_MS = 30 * 1000;
const FILE_SESSION_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const FILE_SESSION_MAX_BATCH_ITEMS = 64;
const FILE_SESSION_MAX_FILE_BYTES = 5_000_000;
const FILE_SESSION_CATALOG_DEFAULT_LIMIT = 2000;
const FILE_SESSION_CATALOG_MAX_LIMIT = 10000;

type FileSessionCatalogEntry = {
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  revision: string;
};

export function registerWorkspaceFileSessionRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  fileSessions: FileSessionStore;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  normalizeWorkspaceRelativePath: (
    value: string,
    options: { allowSubdirs: boolean },
  ) => string;
  resolveSafeChildPath: (root: string, child: string) => string;
  contentKindForPath: (path: string) => "text" | "image" | "pdf" | "binary";
  scopeRank: (scope: TokenScope) => number;
}) {
  const {
    routes,
    config,
    fileSessions,
    ensureWritable,
    requireClientScope,
    requireApproval,
    resolveWorkspace,
    readJsonBody,
    normalizeWorkspaceRelativePath,
    resolveSafeChildPath,
    contentKindForPath,
    scopeRank,
  } = input;

  const serializeFileSession = (session: FileSessionRecord) => ({
    id: session.id,
    workspaceId: session.workspaceId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    ttlMs: Math.max(0, session.expiresAt - Date.now()),
    canWrite: session.canWrite,
  });

  const resolveFileSession = (ctx: RequestContext, sessionId: string) => {
    const session = fileSessions.get(sessionId);
    if (!session) {
      throw new ApiError(
        404,
        "file_session_not_found",
        "File session not found",
      );
    }
    if (
      !ctx.actor?.tokenHash ||
      session.actorTokenHash !== ctx.actor.tokenHash
    ) {
      throw new ApiError(
        403,
        "forbidden",
        "File session does not belong to this token",
      );
    }

    const workspace = config.workspaces.find(
      (item) => item.id === session.workspaceId,
    );
    if (!workspace) {
      throw new ApiError(
        404,
        "workspace_not_found",
        "Workspace not found for this file session",
      );
    }

    return { session, workspace };
  };

  const recordWorkspaceFileEvent = (
    workspaceId: string,
    input: {
      type: "write" | "delete" | "rename" | "mkdir";
      path: string;
      toPath?: string;
      revision?: string;
    },
  ) => {
    return fileSessions.recordWorkspaceEvent({ workspaceId, ...input });
  };

function fileRevision(info: { mtimeMs: number; size: number }): string {
  return `${Math.floor(info.mtimeMs)}:${info.size}`;
}

function parseFileSessionTtlMs(input: unknown): number {
  const raw =
    typeof input === "number" && Number.isFinite(input) ? input : Number.NaN;
  if (Number.isNaN(raw)) return FILE_SESSION_DEFAULT_TTL_MS;
  const ttlMs = Math.floor(raw * 1000);
  if (ttlMs < FILE_SESSION_MIN_TTL_MS) return FILE_SESSION_MIN_TTL_MS;
  if (ttlMs > FILE_SESSION_MAX_TTL_MS) return FILE_SESSION_MAX_TTL_MS;
  return ttlMs;
}

function parseCatalogLimit(input: string | null): number {
  if (!input) return FILE_SESSION_CATALOG_DEFAULT_LIMIT;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0)
    return FILE_SESSION_CATALOG_DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), FILE_SESSION_CATALOG_MAX_LIMIT);
}

function parseSessionCursor(input: string | null): number {
  if (!input) return 0;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function parseCatalogPathFilter(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return normalizeWorkspaceRelativePath(trimmed, { allowSubdirs: true });
}

async function resolveFileSessionRoot(input: {
  workspace: WorkspaceInfo;
  root: unknown;
  authorizedRoots: string[];
}): Promise<string> {
  const requested = typeof input.root === "string" ? input.root.trim() : "";
  const root = requested ? resolve(requested) : resolve(input.workspace.path);
  const authorized = input.authorizedRoots.some((candidate) => {
    const resolved = resolve(candidate);
    return root === resolved || root.startsWith(resolved + sep);
  });
  if (!authorized) {
    throw new ApiError(
      403,
      "forbidden_root",
      "Requested file session root is not authorized",
    );
  }
  if (!(await exists(root))) {
    throw new ApiError(404, "root_not_found", "Requested file session root was not found");
  }
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new ApiError(400, "invalid_root", "Requested file session root must be a directory");
  }
  return root;
}

function matchesCatalogFilter(path: string, filter: string | null): boolean {
  if (!filter) return true;
  return path === filter || path.startsWith(`${filter}/`);
}

function normalizeResolvedRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
    }
  }
  return parts.join("/");
}

async function listWorkspaceCatalogEntries(
  workspaceRoot: string,
): Promise<FileSessionCatalogEntry[]> {
  const rootResolved = resolve(workspaceRoot);
  const items: FileSessionCatalogEntry[] = [];

  const walk = async (dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absPath = join(dirPath, entry.name);
      const relRaw = relative(rootResolved, absPath).replace(/\\/g, "/");
      const rel = normalizeResolvedRelativePath(relRaw);

      if (entry.isDirectory()) {
        const info = await stat(absPath);
        items.push({
          path: rel,
          kind: "dir",
          size: 0,
          mtimeMs: info.mtimeMs,
          revision: fileRevision({ mtimeMs: info.mtimeMs, size: 0 }),
        });
        await walk(absPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const info = await stat(absPath);
      items.push({
        path: rel,
        kind: "file",
        size: info.size,
        mtimeMs: info.mtimeMs,
        revision: fileRevision(info),
      });
    }
  };

  if (await exists(rootResolved)) {
    await walk(rootResolved);
  }

  items.sort((a, b) => a.path.localeCompare(b.path));
  return items;
}

function parseBatchPathList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new ApiError(400, "invalid_payload", "paths must be an array");
  }
  if (!input.length) {
    throw new ApiError(400, "invalid_payload", "paths must not be empty");
  }
  if (input.length > FILE_SESSION_MAX_BATCH_ITEMS) {
    throw new ApiError(
      400,
      "invalid_payload",
      `paths must include <= ${FILE_SESSION_MAX_BATCH_ITEMS} items`,
    );
  }
  return input.map((raw) =>
    normalizeWorkspaceRelativePath(String(raw ?? ""), { allowSubdirs: true }),
  );
}

function parseBatchWriteList(input: unknown): Array<{
  path: string;
  contentBase64: string;
  ifMatchRevision?: string;
  force?: boolean;
}> {
  if (!Array.isArray(input)) {
    throw new ApiError(400, "invalid_payload", "writes must be an array");
  }
  if (!input.length) {
    throw new ApiError(400, "invalid_payload", "writes must not be empty");
  }
  if (input.length > FILE_SESSION_MAX_BATCH_ITEMS) {
    throw new ApiError(
      400,
      "invalid_payload",
      `writes must include <= ${FILE_SESSION_MAX_BATCH_ITEMS} items`,
    );
  }

  return input.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new ApiError(
        400,
        "invalid_payload",
        "write entries must be objects",
      );
    }
    const record = raw as Record<string, unknown>;
    const contentBase64 =
      typeof record.contentBase64 === "string"
        ? record.contentBase64.trim()
        : "";
    if (!contentBase64) {
      throw new ApiError(400, "invalid_payload", "contentBase64 is required");
    }
    const ifMatchRevision =
      typeof record.ifMatchRevision === "string" &&
      record.ifMatchRevision.trim().length
        ? record.ifMatchRevision.trim()
        : undefined;
    return {
      path: normalizeWorkspaceRelativePath(String(record.path ?? ""), {
        allowSubdirs: true,
      }),
      contentBase64,
      ...(ifMatchRevision ? { ifMatchRevision } : {}),
      ...(record.force === true ? { force: true } : {}),
    };
  });
}

  addRoute(
    routes,
    "POST",
    "/workspace/:id/files/sessions",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const ttlMs = parseFileSessionTtlMs(
        (body as Record<string, unknown>).ttlSeconds,
      );
      const requestWrite = (body as Record<string, unknown>).write !== false;
      const workspaceRoot = await resolveFileSessionRoot({
        workspace,
        root: (body as Record<string, unknown>).root,
        authorizedRoots: config.authorizedRoots,
      });
      const canWrite =
        requestWrite &&
        workspaceRoot === resolve(workspace.path) &&
        !config.readOnly &&
        scopeRank(ctx.actor?.scope ?? "viewer") >= scopeRank("collaborator");

      const session = fileSessions.create({
        workspaceId: workspace.id,
        workspaceRoot,
        actorTokenHash: ctx.actor?.tokenHash ?? "",
        actorScope: ctx.actor?.scope ?? "viewer",
        canWrite,
        ttlMs,
      });

      return systemJsonResponse({ session: serializeFileSession(session) });
    },
  );

  addRoute(
    routes,
    "POST",
    "/files/sessions/:sessionId/renew",
    "client",
    async (ctx) => {
      const body = await readJsonBody(ctx.request);
      const ttlMs = parseFileSessionTtlMs(
        (body as Record<string, unknown>).ttlSeconds,
      );
      const { session } = resolveFileSession(ctx, ctx.params.sessionId);
      const renewed = fileSessions.renew(session.id, ttlMs);
      if (!renewed) {
        throw new ApiError(
          404,
          "file_session_not_found",
          "File session not found",
        );
      }
      return systemJsonResponse({ session: serializeFileSession(renewed) });
    },
  );

  addRoute(
    routes,
    "DELETE",
    "/files/sessions/:sessionId",
    "client",
    async (ctx) => {
      const { session } = resolveFileSession(ctx, ctx.params.sessionId);
      fileSessions.close(session.id);
      return systemJsonResponse({ ok: true });
    },
  );

  addRoute(
    routes,
    "GET",
    "/files/sessions/:sessionId/catalog/snapshot",
    "client",
    async (ctx) => {
      const { session, workspace } = resolveFileSession(ctx, ctx.params.sessionId);
      const prefix = parseCatalogPathFilter(ctx.url.searchParams.get("prefix"));
      const after = parseCatalogPathFilter(ctx.url.searchParams.get("after"));
      const includeDirs = ctx.url.searchParams.get("includeDirs") !== "false";
      const limit = parseCatalogLimit(ctx.url.searchParams.get("limit"));

      const entries = await listWorkspaceCatalogEntries(session.workspaceRoot);
      const filtered = entries.filter((entry) => {
        if (!includeDirs && entry.kind === "dir") return false;
        if (!matchesCatalogFilter(entry.path, prefix)) return false;
        if (after && entry.path <= after) return false;
        return true;
      });

      const items = filtered.slice(0, limit);
      const truncated = filtered.length > items.length;
      const nextAfter = truncated ? items[items.length - 1]?.path : undefined;
      const events = fileSessions.listWorkspaceEvents(
        workspace.id,
        Number.MAX_SAFE_INTEGER,
      );

      return systemJsonResponse({
        sessionId: ctx.params.sessionId,
        workspaceId: workspace.id,
        generatedAt: Date.now(),
        cursor: events.cursor,
        total: filtered.length,
        truncated,
        nextAfter,
        items,
      });
    },
  );

  addRoute(
    routes,
    "GET",
    "/files/sessions/:sessionId/catalog/events",
    "client",
    async (ctx) => {
      const { workspace } = resolveFileSession(ctx, ctx.params.sessionId);
      const since = parseSessionCursor(ctx.url.searchParams.get("since"));
      const events = fileSessions.listWorkspaceEvents(workspace.id, since);
      return systemJsonResponse(events);
    },
  );

  addRoute(
    routes,
    "POST",
    "/files/sessions/:sessionId/read-batch",
    "client",
    async (ctx) => {
      const { workspace } = resolveFileSession(ctx, ctx.params.sessionId);
      const body = await readJsonBody(ctx.request);
      const paths = parseBatchPathList((body as Record<string, unknown>).paths);
      const items: Array<Record<string, unknown>> = [];

      for (const relativePath of paths) {
        try {
          const absPath = resolveSafeChildPath(workspace.path, relativePath);
          if (!(await exists(absPath))) {
            items.push({
              ok: false,
              path: relativePath,
              code: "file_not_found",
              message: "File not found",
            });
            continue;
          }
          const info = await stat(absPath);
          if (!info.isFile()) {
            items.push({
              ok: false,
              path: relativePath,
              code: "file_not_found",
              message: "File not found",
            });
            continue;
          }
          if (info.size > FILE_SESSION_MAX_FILE_BYTES) {
            items.push({
              ok: false,
              path: relativePath,
              code: "file_too_large",
              message: "File exceeds size limit",
              maxBytes: FILE_SESSION_MAX_FILE_BYTES,
              size: info.size,
            });
            continue;
          }

          const content = await readFile(absPath);
          items.push({
            ok: true,
            path: relativePath,
            kind: "file",
            bytes: info.size,
            updatedAt: info.mtimeMs,
            revision: fileRevision(info),
            contentBase64: content.toString("base64"),
          });
        } catch (error) {
          const message =
            error instanceof ApiError ? error.message : "Unable to read file";
          const code = error instanceof ApiError ? error.code : "read_failed";
          items.push({ ok: false, path: relativePath, code, message });
        }
      }

      return systemJsonResponse({ items });
    },
  );

  addRoute(
    routes,
    "POST",
    "/files/sessions/:sessionId/write-batch",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const { session, workspace } = resolveFileSession(
        ctx,
        ctx.params.sessionId,
      );
      if (!session.canWrite) {
        throw new ApiError(403, "forbidden", "File session is read-only");
      }

      const body = await readJsonBody(ctx.request);
      const writes = parseBatchWriteList(
        (body as Record<string, unknown>).writes,
      );
      const items: Array<Record<string, unknown>> = [];

      const plan: Array<{
        path: string;
        absPath: string;
        bytes: Buffer;
        ifMatchRevision?: string;
        force?: boolean;
        beforeRevision: string | null;
      }> = [];

      for (const write of writes) {
        try {
          const absPath = resolveSafeChildPath(workspace.path, write.path);
          const bytes = Buffer.from(write.contentBase64, "base64");
          if (bytes.byteLength > FILE_SESSION_MAX_FILE_BYTES) {
            items.push({
              ok: false,
              path: write.path,
              code: "file_too_large",
              message: "File exceeds size limit",
              maxBytes: FILE_SESSION_MAX_FILE_BYTES,
              size: bytes.byteLength,
            });
            continue;
          }

          const before = (await exists(absPath)) ? await stat(absPath) : null;
          if (before && !before.isFile()) {
            items.push({
              ok: false,
              path: write.path,
              code: "invalid_path",
              message: "Path must point to a file",
            });
            continue;
          }
          const beforeRevision = before ? fileRevision(before) : null;
          if (
            !write.force &&
            write.ifMatchRevision &&
            write.ifMatchRevision !== beforeRevision
          ) {
            items.push({
              ok: false,
              path: write.path,
              code: "conflict",
              message: "File changed since it was loaded",
              expectedRevision: write.ifMatchRevision,
              currentRevision: beforeRevision,
            });
            continue;
          }

          plan.push({
            path: write.path,
            absPath,
            bytes,
            beforeRevision,
            ...(write.ifMatchRevision
              ? { ifMatchRevision: write.ifMatchRevision }
              : {}),
            ...(write.force ? { force: true } : {}),
          });
        } catch (error) {
          const message =
            error instanceof ApiError ? error.message : "Invalid write request";
          const code =
            error instanceof ApiError ? error.code : "invalid_payload";
          items.push({ ok: false, path: write.path, code, message });
        }
      }

      if (plan.length) {
        await requireApproval(ctx, {
          workspaceId: workspace.id,
          action: "workspace.files.session.write",
          summary: `Write ${plan.length} file(s) via file session`,
          paths: plan.map((item) => item.absPath),
        });
      }

      for (const entry of plan) {
        try {
          const before = (await exists(entry.absPath))
            ? await stat(entry.absPath)
            : null;
          const currentRevision = before ? fileRevision(before) : null;
          if (
            !entry.force &&
            entry.ifMatchRevision &&
            currentRevision !== entry.ifMatchRevision
          ) {
            items.push({
              ok: false,
              path: entry.path,
              code: "conflict",
              message: "File changed before write could be applied",
              expectedRevision: entry.ifMatchRevision,
              currentRevision,
            });
            continue;
          }

          await ensureDir(dirname(entry.absPath));
          const tmp = `${entry.absPath}.tmp-${shortId()}`;
          await writeFile(tmp, entry.bytes);
          await rename(tmp, entry.absPath);
          const after = await stat(entry.absPath);
          const revision = fileRevision(after);

          recordWorkspaceFileEvent(workspace.id, {
            type: "write",
            path: entry.path,
            revision,
          });

          await recordAudit(workspace.path, {
            id: shortId(),
            workspaceId: workspace.id,
            actor: ctx.actor ?? { type: "remote" },
            action: "workspace.files.session.write",
            target: entry.absPath,
            summary: `Wrote ${entry.path} via file session`,
            timestamp: Date.now(),
          });

          items.push({
            ok: true,
            path: entry.path,
            bytes: entry.bytes.byteLength,
            updatedAt: after.mtimeMs,
            revision,
            previousRevision: entry.beforeRevision,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to write file";
          items.push({
            ok: false,
            path: entry.path,
            code: "write_failed",
            message,
          });
        }
      }

      const events = fileSessions.listWorkspaceEvents(
        workspace.id,
        Number.MAX_SAFE_INTEGER,
      );
      return systemJsonResponse({ items, cursor: events.cursor });
    },
  );

  addRoute(
    routes,
    "POST",
    "/files/sessions/:sessionId/ops",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const { session, workspace } = resolveFileSession(
        ctx,
        ctx.params.sessionId,
      );
      if (!session.canWrite) {
        throw new ApiError(403, "forbidden", "File session is read-only");
      }

      const body = await readJsonBody(ctx.request);
      const operations = Array.isArray(
        (body as Record<string, unknown>).operations,
      )
        ? ((body as Record<string, unknown>).operations as Array<
            Record<string, unknown>
          >)
        : null;
      if (!operations || !operations.length) {
        throw new ApiError(
          400,
          "invalid_payload",
          "operations must be a non-empty array",
        );
      }
      if (operations.length > FILE_SESSION_MAX_BATCH_ITEMS) {
        throw new ApiError(
          400,
          "invalid_payload",
          `operations must include <= ${FILE_SESSION_MAX_BATCH_ITEMS} items`,
        );
      }

      const items: Array<Record<string, unknown>> = [];
      const approvalPaths: string[] = [];
      for (const op of operations) {
        if (typeof op?.path === "string" && op.path.trim()) {
          approvalPaths.push(
            resolveSafeChildPath(
              workspace.path,
              normalizeWorkspaceRelativePath(op.path, { allowSubdirs: true }),
            ),
          );
        }
        if (typeof op?.from === "string" && op.from.trim()) {
          approvalPaths.push(
            resolveSafeChildPath(
              workspace.path,
              normalizeWorkspaceRelativePath(op.from, { allowSubdirs: true }),
            ),
          );
        }
        if (typeof op?.to === "string" && op.to.trim()) {
          approvalPaths.push(
            resolveSafeChildPath(
              workspace.path,
              normalizeWorkspaceRelativePath(op.to, { allowSubdirs: true }),
            ),
          );
        }
      }

      if (approvalPaths.length) {
        await requireApproval(ctx, {
          workspaceId: workspace.id,
          action: "workspace.files.session.ops",
          summary: `Apply ${operations.length} file operation(s) via file session`,
          paths: approvalPaths,
        });
      }

      for (const op of operations) {
        const type = String(op.type ?? "").trim();
        try {
          if (type === "mkdir") {
            const path = normalizeWorkspaceRelativePath(String(op.path ?? ""), {
              allowSubdirs: true,
            });
            const absPath = resolveSafeChildPath(workspace.path, path);
            await ensureDir(absPath);
            recordWorkspaceFileEvent(workspace.id, { type: "mkdir", path });
            items.push({ ok: true, type, path });
            continue;
          }

          if (type === "delete") {
            const path = normalizeWorkspaceRelativePath(String(op.path ?? ""), {
              allowSubdirs: true,
            });
            const absPath = resolveSafeChildPath(workspace.path, path);
            if (!(await exists(absPath))) {
              items.push({
                ok: false,
                type,
                path,
                code: "file_not_found",
                message: "Path not found",
              });
              continue;
            }
            await rm(absPath, {
              recursive: op.recursive === true,
              force: false,
            });
            recordWorkspaceFileEvent(workspace.id, { type: "delete", path });
            items.push({ ok: true, type, path });
            continue;
          }

          if (type === "rename") {
            const from = normalizeWorkspaceRelativePath(String(op.from ?? ""), {
              allowSubdirs: true,
            });
            const to = normalizeWorkspaceRelativePath(String(op.to ?? ""), {
              allowSubdirs: true,
            });
            const fromAbs = resolveSafeChildPath(workspace.path, from);
            const toAbs = resolveSafeChildPath(workspace.path, to);
            if (!(await exists(fromAbs))) {
              items.push({
                ok: false,
                type,
                from,
                to,
                code: "file_not_found",
                message: "Source path not found",
              });
              continue;
            }
            await ensureDir(dirname(toAbs));
            await rename(fromAbs, toAbs);
            recordWorkspaceFileEvent(workspace.id, {
              type: "rename",
              path: from,
              toPath: to,
            });
            items.push({ ok: true, type, from, to });
            continue;
          }

          items.push({
            ok: false,
            type,
            code: "invalid_operation",
            message: `Unsupported operation type: ${type}`,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Operation failed";
          items.push({ ok: false, type, code: "operation_failed", message });
        }
      }

      const events = fileSessions.listWorkspaceEvents(
        workspace.id,
        Number.MAX_SAFE_INTEGER,
      );
      return systemJsonResponse({ items, cursor: events.cursor });
    },
  );

}
