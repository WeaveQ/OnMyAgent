import {
  readdir,
  stat,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { ApiError } from "../core/errors.js";
import { exists } from "../core/utils.js";

export function resolveInboxDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent", "inbox");
}

export function resolveOutboxDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent", "outbox");
}

export function normalizeWorkspaceRelativePath(
  input: string,
  options: { allowSubdirs: boolean },
): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (raw.includes("\u0000")) {
    throw new ApiError(400, "invalid_path", "Path contains null byte");
  }

  // A lot of user-facing surfaces (artifacts, tool logs) reference files as
  // `workspace/<path>` or `/workspace/<path>`. The server API expects
  // workspace-relative paths, so normalize those common prefixes here.
  let normalized = raw.replace(/\\/g, "/");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^workspaces\/[^/]+\//i, "");
  normalized = normalized.replace(
    /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i,
    "",
  );
  normalized = normalized.replace(/^workspace\//, "");
  normalized = normalized.replace(/^\/+/, "");

  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (!options.allowSubdirs && parts.length > 1) {
    throw new ApiError(400, "invalid_path", "Subdirectories are not allowed");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
    }
  }
  return parts.join("/");
}

export function isSupportedWorkspaceTextFilePath(
  relativePath: string,
): boolean {
  const lowered = relativePath.toLowerCase();
  return [
    ".md",
    ".mdx",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".html",
    ".htm",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".css",
    ".scss",
    ".less",
    ".py",
    ".rs",
    ".go",
    ".java",
    ".kt",
    ".swift",
    ".rb",
    ".php",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cs",
    ".sh",
    ".bash",
    ".zsh",
    ".sql",
    ".r",
    ".env",
    ".ini",
    ".cfg",
    ".conf",
    ".vue",
    ".svelte",
    ".graphql",
    ".gql",
    ".txt",
    ".log",
  ].some((ext) => lowered.endsWith(ext));
}

export function resolveSafeChildPath(root: string, child: string): string {
  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, child);
  if (candidate === rootResolved) {
    throw new ApiError(400, "invalid_path", "Path must point to a file");
  }
  if (!candidate.startsWith(rootResolved + sep)) {
    throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
  }
  return candidate;
}

export function encodeArtifactId(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

export function decodeArtifactId(id: string): string {
  const raw = (id ?? "").trim();
  if (!raw) {
    throw new ApiError(400, "invalid_artifact", "Artifact id is required");
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    return normalizeWorkspaceRelativePath(decoded, { allowSubdirs: true });
  } catch {
    throw new ApiError(400, "invalid_artifact", "Artifact id is invalid");
  }
}

export function contentTypeForPath(path: string): string {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".html") || lowered.endsWith(".htm"))
    return "text/html; charset=utf-8";
  if (lowered.endsWith(".svg")) return "image/svg+xml";
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg"))
    return "image/jpeg";
  if (lowered.endsWith(".gif")) return "image/gif";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".pdf")) return "application/pdf";
  if (lowered.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lowered.endsWith(".tsv"))
    return "text/tab-separated-values; charset=utf-8";
  if (lowered.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lowered.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lowered.endsWith(".ods"))
    return "application/vnd.oasis.opendocument.spreadsheet";
  if (isSupportedWorkspaceTextFilePath(path))
    return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function contentKindForPath(path: string): "text" | "image" | "pdf" | "binary" {
  const lowered = path.toLowerCase();
  if (isSupportedWorkspaceTextFilePath(path)) return "text";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lowered)) return "image";
  if (lowered.endsWith(".pdf")) return "pdf";
  return "binary";
}

export function fileRevision(info: { mtimeMs: number; size: number }): string {
  return `${Math.floor(info.mtimeMs)}:${info.size}`;
}

type ArtifactTargetInput = {
  kind?: unknown;
  value?: unknown;
  name?: unknown;
  preview?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

function artifactPreviewForPath(path: string): string {
  const lowered = path.toLowerCase();
  if (/\.(md|markdown|mdx)$/.test(lowered)) return "markdown";
  if (/\.(csv|tsv|xlsx|xls|ods)$/.test(lowered)) return "sheet";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lowered)) return "image";
  if (lowered.endsWith(".pdf")) return "pdf";
  if (/\.(html|htm)$/.test(lowered)) return "html";
  if (isSupportedWorkspaceTextFilePath(path)) return "text";
  return "external";
}

function normalizeUrlTarget(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function resolveWorkspaceArtifactTargets(
  workspaceRoot: string,
  input: unknown,
): Promise<Array<Record<string, unknown>>> {
  const targets = Array.isArray(input) ? input.slice(0, 80) : [];
  const results = new Map<string, Record<string, unknown>>();
  const workspaceResolved = resolve(workspaceRoot);

  for (const item of targets) {
    if (!item || typeof item !== "object") continue;
    const target = item as ArtifactTargetInput;
    const kind = target.kind === "url" ? "url" : "file";
    const rawValue =
      typeof target.value === "string" ? target.value.trim() : "";
    if (!rawValue) continue;
    const confidence =
      typeof target.confidence === "number" &&
      Number.isFinite(target.confidence)
        ? target.confidence
        : 0;
    const reason = typeof target.reason === "string" ? target.reason : "server";

    if (kind === "url") {
      const url = normalizeUrlTarget(rawValue);
      if (!url) continue;
      const key = `url:${url}`;
      const next = {
        id: key,
        kind: "url",
        value: url,
        name:
          typeof target.name === "string" && target.name.trim()
            ? target.name.trim()
            : url,
        preview: "browser",
        confidence,
        reason,
        exists: true,
      };
      const previous = results.get(key);
      if (!previous || confidence >= Number(previous.confidence ?? 0))
        results.set(key, next);
      continue;
    }

    let relativePath: string;
    try {
      if (isAbsolute(rawValue)) {
        const absolutePath = resolve(rawValue);
        const pathFromWorkspace = relative(workspaceResolved, absolutePath);
        if (
          !pathFromWorkspace ||
          pathFromWorkspace === ".." ||
          pathFromWorkspace.startsWith(`..${sep}`) ||
          isAbsolute(pathFromWorkspace)
        ) {
          continue;
        }
        relativePath = normalizeWorkspaceRelativePath(pathFromWorkspace, {
          allowSubdirs: true,
        });
      } else {
        relativePath = normalizeWorkspaceRelativePath(rawValue, {
          allowSubdirs: true,
        });
      }
    } catch {
      continue;
    }
    const key = `file:${relativePath.toLowerCase()}`;
    const absPath = resolveSafeChildPath(workspaceRoot, relativePath);
    let existsFile = false;
    let size: number | undefined;
    let updatedAt: number | undefined;
    let kindValue: "file" | "dir" | "other" | undefined;
    if (await exists(absPath)) {
      const info = await stat(absPath);
      kindValue = info.isFile() ? "file" : info.isDirectory() ? "dir" : "other";
      existsFile = info.isFile();
      size = info.size;
      updatedAt = info.mtimeMs;
    }
    const next = {
      id: key,
      kind: "file",
      value: relativePath,
      name: basename(relativePath),
      preview: artifactPreviewForPath(relativePath),
      confidence,
      reason,
      exists: existsFile,
      fileKind: kindValue,
      size,
      updatedAt,
      contentType: contentTypeForPath(relativePath),
    };
    const previous = results.get(key);
    if (!previous || confidence >= Number(previous.confidence ?? 0))
      results.set(key, next);
  }

  return Array.from(results.values());
}

export function encodeInboxId(path: string): string {
  return encodeArtifactId(path);
}

export function decodeInboxId(id: string): string {
  try {
    return decodeArtifactId(id);
  } catch {
    throw new ApiError(400, "invalid_inbox_item", "Inbox item id is invalid");
  }
}

export async function listArtifacts(
  outboxRoot: string,
): Promise<
  Array<{ id: string; path: string; size: number; updatedAt: number }>
> {
  const rootResolved = resolve(outboxRoot);
  if (!(await exists(rootResolved))) return [];

  const items: Array<{
    id: string;
    path: string;
    size: number;
    updatedAt: number;
  }> = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normalizeWorkspaceRelativePath(relative(rootResolved, abs), {
        allowSubdirs: true,
      });
      const info = await stat(abs);
      items.push({
        id: encodeArtifactId(rel),
        path: rel,
        size: info.size,
        updatedAt: info.mtimeMs,
      });
    }
  };

  try {
    await walk(rootResolved);
  } catch {
    return [];
  }

  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export async function listInbox(inboxRoot: string): Promise<
  Array<{
    id: string;
    path: string;
    size: number;
    updatedAt: number;
    name: string;
  }>
> {
  const items = await listArtifacts(inboxRoot);
  return items.map((item) => ({
    ...item,
    id: encodeInboxId(item.path),
    name: basename(item.path),
  }));
}
