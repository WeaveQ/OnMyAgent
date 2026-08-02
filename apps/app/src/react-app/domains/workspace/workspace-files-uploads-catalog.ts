/**
 * Mine uploads catalog mapping (inbox migrate helpers + uploads/ rows).
 */
import {
  WORKSPACE_UPLOADS_DIR,
  resolveProductWriteRelativePath,
} from "./workspace-files-layout";
import { getFileCategory, type FileCategory } from "./workspace-files-categories";
import {
  compareWorkspaceFileNodes,
  shouldHideEntry,
  type WorkspaceFileSortDir,
  type WorkspaceFileSortKey,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";

/** Soft cap for listWorkspaceFiles on the Files rail (show notice when hit). */
export const WORKSPACE_FILES_CATALOG_LIMIT = 5000;

export function buildUserUploadRelativePath(fileName: string): string {
  const base = fileName.trim().replace(/\\/g, "/").split("/").pop() || "file";
  const safe = base.replace(/^\.+/, "") || "file";
  // Force product layout root (never bare workspace root).
  return resolveProductWriteRelativePath({
    source: "user_upload",
    fileName: safe,
  });
}

/**
 * On-disk inbox root under a workspace (matches server `resolveInboxDir`).
 * listInbox paths are relative to this directory.
 */
export const WORKSPACE_INBOX_DIR = ".opencode/onmyagent/inbox";

/** Workspace-relative path for read/delete APIs (from inbox-relative list path). */
export function workspaceRelativeInboxPath(inboxRelativePath: string): string {
  const rel = String(inboxRelativePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!rel) return WORKSPACE_INBOX_DIR;
  if (rel === WORKSPACE_INBOX_DIR || rel.startsWith(`${WORKSPACE_INBOX_DIR}/`)) {
    return rel;
  }
  return `${WORKSPACE_INBOX_DIR}/${rel}`;
}

/** Absolute filesystem path for Electron reveal / Office overlay. */
export function absoluteInboxFilePath(
  workspaceRoot: string,
  inboxRelativePath: string,
): string {
  const root = String(workspaceRoot ?? "").trim().replace(/[/\\]+$/, "");
  const rel = workspaceRelativeInboxPath(inboxRelativePath);
  if (!root) return rel;
  if (/^[A-Za-z]:[\\/]/.test(root) || root.includes("\\")) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }
  return `${root}/${rel}`;
}

export type InboxListItemLike = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  updatedAt?: number;
};

export type UserUploadRow = {
  id: string;
  name: string;
  path: string;
  size: number;
  updatedAt: number;
  /** Directory rows from product uploads/ layout (Mine create-folder). */
  kind?: "file" | "dir";
  /**
   * Where the path is rooted:
   * - inbox: path is relative to `.opencode/onmyagent/inbox/`
   * - workspace: path is workspace-relative (e.g. `uploads/…`)
   */
  source?: "inbox" | "workspace";
};

/**
 * Resolve a Mine row to a workspace-relative path for read/download/preview APIs.
 * Inbox rows are under `.opencode/onmyagent/inbox/…`; catalog rows stay `uploads/…`.
 */
export function workspaceRelativeForUploadRow(row: {
  path: string;
  kind?: "file" | "dir";
  source?: "inbox" | "workspace";
}): string {
  const p = String(row.path ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!p) return WORKSPACE_INBOX_DIR;
  if (row.kind === "dir" || row.source === "workspace") {
    if (
      p === WORKSPACE_UPLOADS_DIR
      || p.startsWith(`${WORKSPACE_UPLOADS_DIR}/`)
      || p.startsWith(`${WORKSPACE_INBOX_DIR}/`)
    ) {
      return p;
    }
    // Catalog may return bare names under current prefix — still treat as workspace.
    return p;
  }
  // Default / inbox: relative to inbox root.
  return workspaceRelativeInboxPath(p);
}

/** True when a Mine row is OS/system junk (not user content). */
export function isMineHiddenUploadPath(path: string, name?: string): boolean {
  const p = String(path ?? "").trim().replace(/\\/g, "/");
  if (p && shouldHideEntry(p)) return true;
  const base =
    String(name ?? "").trim()
    || p.split("/").pop()
    || "";
  if (base && shouldHideEntry(base)) return true;
  return false;
}

/** Map inbox API items into stable upload rows (import-by-copy list). */
export function mapInboxItemsToUploadRows(
  items: readonly InboxListItemLike[],
): UserUploadRow[] {
  const rows: UserUploadRow[] = [];
  for (const item of items) {
    const id = item.id?.trim();
    if (!id) continue;
    const path = (item.path ?? item.name ?? id).trim();
    if (!path) continue;
    const name =
      (item.name ?? path.replace(/\\/g, "/").split("/").pop() ?? path).trim() ||
      path;
    // Hide .DS_Store / Thumbs.db / dotfiles — Mine must not surface Finder junk.
    if (isMineHiddenUploadPath(path, name)) continue;
    rows.push({
      id,
      name,
      path,
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      updatedAt:
        typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : 0,
      kind: "file",
      source: "inbox",
    });
  }
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name));
  return rows;
}

export type UploadsCatalogEntryLike = {
  path?: string;
  name?: string;
  kind?: string;
  size?: number;
  mtimeMs?: number;
  updatedAt?: number;
};

/** True when `path` is a direct child of `parentPrefix` (one segment under). */
export function isDirectChildOfPrefix(
  path: string,
  parentPrefix: string,
): boolean {
  const parent = String(parentPrefix || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const rel = String(path || "")
    .trim()
    .replace(/\\/g, "/");
  if (!parent || !rel.startsWith(`${parent}/`)) return false;
  const rest = rel.slice(parent.length + 1);
  return Boolean(rest) && !rest.includes("/");
}

/**
 * Map workspace catalog entries under uploads/ into Mine rows (files + dirs).
 * Scoped to `parentPrefix` only (never rewrites sibling paths into the current
 * folder). When `shallow` is true (default), only direct children of the parent
 * are kept; when false, all descendants under the parent are kept.
 *
 * Prefer loading deep once and filtering with `isDirectChildOfPrefix` for
 * one-level browse so expand/collapse does not re-fetch.
 */
export function mapUploadsCatalogToRows(
  items: readonly UploadsCatalogEntryLike[],
  options?: { parentPrefix?: string; shallow?: boolean },
): UserUploadRow[] {
  const parent = String(options?.parentPrefix ?? WORKSPACE_UPLOADS_DIR)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || WORKSPACE_UPLOADS_DIR;
  const shallow = options?.shallow !== false;
  const rows: UserUploadRow[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const rawPath = String(item.path ?? "").trim().replace(/\\/g, "/");
    if (!rawPath) continue;
    // Strictly under the current folder — never fall back to uploads/ root
    // siblings (that used to reappear inside every nested folder).
    if (rawPath === parent) continue;
    if (!rawPath.startsWith(`${parent}/`)) continue;

    const rest = rawPath.slice(parent.length + 1);
    if (!rest) continue;
    if (shallow && rest.includes("/")) continue;

    const rel = rawPath;
    if (seen.has(rel)) continue;
    const kind: "file" | "dir" =
      item.kind === "dir" || item.kind === "directory" ? "dir" : "file";
    const name =
      (item.name ?? rel.split("/").pop() ?? rel).trim() || rel;
    if (isMineHiddenUploadPath(rel, name)) continue;
    seen.add(rel);
    const updatedAt =
      typeof item.mtimeMs === "number" && Number.isFinite(item.mtimeMs)
        ? item.mtimeMs
        : typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : 0;
    rows.push({
      id: `uploads:${rel}`,
      name,
      path: rel,
      size:
        kind === "dir"
          ? 0
          : typeof item.size === "number" && Number.isFinite(item.size)
            ? item.size
            : 0,
      updatedAt,
      kind,
      source: "workspace",
    });
  }

  // Dirs first, then mtime desc.
  rows.sort((a, b) => {
    const ka = a.kind === "dir" ? 0 : 1;
    const kb = b.kind === "dir" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name);
  });
  return rows;
}

/**
 * Build a nested tree from flat Mine catalog rows under `parentPrefix`.
 * Used for hierarchical expand/collapse (same depth outline as Tasks).
 * Optional sort matches Tasks/Experts column headers (default: updated desc).
 */
export function buildTreeNodesFromUploadRows(
  rows: readonly UserUploadRow[],
  parentPrefix: string,
  options?: {
    sortKey?: WorkspaceFileSortKey;
    sortDir?: WorkspaceFileSortDir;
  },
): WorkspaceFileTreeNode[] {
  const parent = String(parentPrefix || WORKSPACE_UPLOADS_DIR)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || WORKSPACE_UPLOADS_DIR;
  const sortKey = options?.sortKey ?? "updated";
  const sortDir = options?.sortDir ?? "desc";

  type Mutable = WorkspaceFileTreeNode & { children: Mutable[] };
  const nodes = new Map<string, Mutable>();

  for (const row of rows) {
    const path = String(row.path ?? "")
      .trim()
      .replace(/\\/g, "/");
    if (!path || path === parent) continue;
    if (!path.startsWith(`${parent}/`)) continue;
    nodes.set(path, {
      name: row.name || path.split("/").pop() || path,
      path,
      kind: row.kind === "dir" ? "dir" : "file",
      size: row.size || 0,
      mtimeMs: row.updatedAt || 0,
      children: [],
    });
  }

  const roots: Mutable[] = [];
  for (const node of nodes.values()) {
    const slash = node.path.lastIndexOf("/");
    const parentPath = slash >= 0 ? node.path.slice(0, slash) : "";
    if (parentPath === parent) {
      roots.push(node);
      continue;
    }
    const parentNode = nodes.get(parentPath);
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      // Missing intermediate dir in catalog — still surface as root under view.
      roots.push(node);
    }
  }

  const sortNodes = (list: Mutable[]) => {
    list.sort((a, b) => compareWorkspaceFileNodes(a, b, sortKey, sortDir));
    for (const n of list) sortNodes(n.children as Mutable[]);
  };
  sortNodes(roots);
  return roots;
}

/** Merge inbox files with product uploads/ catalog; prefer catalog for same path. */
export function mergeMineUploadRows(
  inboxRows: readonly UserUploadRow[],
  catalogRows: readonly UserUploadRow[],
): UserUploadRow[] {
  const byPath = new Map<string, UserUploadRow>();
  for (const row of inboxRows) {
    if (isMineHiddenUploadPath(row.path, row.name)) continue;
    const key = row.path.replace(/\\/g, "/");
    byPath.set(key, {
      ...row,
      kind: row.kind ?? "file",
      source: row.source ?? "inbox",
    });
  }
  for (const row of catalogRows) {
    if (isMineHiddenUploadPath(row.path, row.name)) continue;
    const key = row.path.replace(/\\/g, "/");
    // Prefer workspace catalog when both list the same relative name.
    byPath.set(key, { ...row, source: row.source ?? "workspace" });
  }
  return Array.from(byPath.values()).sort((a, b) => {
    const ka = a.kind === "dir" ? 0 : 1;
    const kb = b.kind === "dir" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name);
  });
}

export function filterUploadRows(
  rows: readonly UserUploadRow[],
  query: string,
  typeFilter: FileCategory = "all",
): UserUploadRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.kind === "dir") {
      // Folders ignore type chips other than "all".
      if (typeFilter !== "all") return false;
    } else if (typeFilter !== "all" && getFileCategory(row.name) !== typeFilter) {
      return false;
    }
    if (!q) return true;
    return (
      row.name.toLowerCase().includes(q) || row.path.toLowerCase().includes(q)
    );
  });
}

/** Map Mine rows into the shared file-tree compare shape (no children). */
function uploadRowAsTreeNode(row: UserUploadRow): WorkspaceFileTreeNode {
  return {
    name: row.name,
    path: row.path,
    kind: row.kind === "dir" ? "dir" : "file",
    size: row.size || 0,
    mtimeMs: row.updatedAt || 0,
    children: [],
  };
}

/**
 * Sort Mine list rows the same way Tasks/Experts sort columns
 * (name / updated / size + asc|desc; name keeps folders first).
 */
export function sortUploadRows(
  rows: readonly UserUploadRow[],
  key: WorkspaceFileSortKey = "updated",
  dir: WorkspaceFileSortDir = "desc",
): UserUploadRow[] {
  return [...rows].sort((a, b) =>
    compareWorkspaceFileNodes(
      uploadRowAsTreeNode(a),
      uploadRowAsTreeNode(b),
      key,
      dir,
    ),
  );
}
