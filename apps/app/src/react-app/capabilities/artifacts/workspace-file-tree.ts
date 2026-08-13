/**
 * Canonical workspace file-tree construction and hide-path rules.
 * Session side panel and workspace files page both consume this module so
 * tree shape / hidden-path policy cannot drift between UIs.
 */
import { t } from "../../../i18n";
import type { OnMyAgentWorkspaceFileCatalogEntry } from "../../../app/lib/onmyagent-server";
import {
  getFileCategory,
  type FileCategory,
} from "../../domains/workspace/workspace-files-categories";

export type WorkspaceFileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  children: WorkspaceFileTreeNode[];
};

function addWorkspaceFileTreeEntry(
  root: WorkspaceFileTreeNode,
  entry: OnMyAgentWorkspaceFileCatalogEntry,
) {
  const parts = entry.path.split("/").filter(Boolean);
  let parent = root;
  let currentPath = "";

  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index];
    const isLeaf = index === parts.length - 1;
    currentPath = currentPath ? `${currentPath}/${name}` : name;
    let child = parent.children.find((item) => item.path === currentPath);
    if (!child) {
      child = {
        name,
        path: currentPath,
        kind: isLeaf ? entry.kind : "dir",
        size: isLeaf ? entry.size : 0,
        mtimeMs: isLeaf ? entry.mtimeMs : 0,
        children: [],
      };
      parent.children.push(child);
    }
    if (isLeaf) {
      child.kind = entry.kind;
      child.size = entry.size;
      child.mtimeMs = entry.mtimeMs;
    }
    parent = child;
  }
}

/** Directory size/mtime: sum of descendants + max child mtime (catalog dir leaves often have 0). */
function rollupWorkspaceFileTreeStats(node: WorkspaceFileTreeNode): void {
  for (const child of node.children) {
    rollupWorkspaceFileTreeStats(child);
  }
  if (node.kind !== "dir") return;
  let size = 0;
  let mtimeMs = node.mtimeMs || 0;
  for (const child of node.children) {
    size += Math.max(0, child.size || 0);
    if ((child.mtimeMs || 0) > mtimeMs) mtimeMs = child.mtimeMs;
  }
  if (node.children.length > 0) {
    node.size = size;
  }
  if (mtimeMs > 0) {
    node.mtimeMs = mtimeMs;
  }
}

export type WorkspaceFileSortKey = "name" | "type" | "updated" | "size";
export type WorkspaceFileSortDir = "asc" | "desc";

/** Stable category order for type column (matches product filter chips, sans "all"). */
const FILE_TYPE_SORT_ORDER: readonly FileCategory[] = [
  "document",
  "spreadsheet",
  "presentation",
  "pdf",
  "image",
  "video",
  "audio",
  "website",
  "markdown",
  "code",
  "other",
];

function fileTypeSortRank(name: string): number {
  const category = getFileCategory(name);
  const index = FILE_TYPE_SORT_ORDER.indexOf(category);
  return index >= 0 ? index : FILE_TYPE_SORT_ORDER.length;
}

export function compareWorkspaceFileNodes(
  a: WorkspaceFileTreeNode,
  b: WorkspaceFileTreeNode,
  key: WorkspaceFileSortKey,
  dir: WorkspaceFileSortDir,
): number {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "updated") {
    const byTime = (a.mtimeMs || 0) - (b.mtimeMs || 0);
    if (byTime !== 0) return sign * byTime;
    return a.name.localeCompare(b.name);
  }
  if (key === "size") {
    const bySize = (a.size || 0) - (b.size || 0);
    if (bySize !== 0) return sign * bySize;
    return a.name.localeCompare(b.name);
  }
  if (key === "type") {
    // Folders always first for type sort (product default).
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    if (a.kind === "dir") {
      return sign * a.name.localeCompare(b.name);
    }
    const byType = fileTypeSortRank(a.name) - fileTypeSortRank(b.name);
    if (byType !== 0) return sign * byType;
    return a.name.localeCompare(b.name);
  }
  // Name: folders first, then locale name order.
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return sign * a.name.localeCompare(b.name);
}

/**
 * Task tab top-level rank: user spaces (projects/) first, other folders next,
 * automation runs last — then apply the normal sort key.
 * Automation prefix is the product disk name for scheduled runs (see layout helper).
 */
export function taskSourceBucketRank(
  node: WorkspaceFileTreeNode,
  isAutomationFolder: (name: string) => boolean,
): number {
  const path = node.path.replace(/\\/g, "/").replace(/^\/+/, "");
  const name = node.name.trim();
  if (path === "projects" || path.startsWith("projects/")) return 0;
  if (isAutomationFolder(name)) return 2;
  // Nested path segments may still be automation run folders.
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => isAutomationFolder(segment))) return 2;
  return 1;
}

export function compareTaskSourceNodes(
  a: WorkspaceFileTreeNode,
  b: WorkspaceFileTreeNode,
  key: WorkspaceFileSortKey,
  dir: WorkspaceFileSortDir,
  isAutomationFolder: (name: string) => boolean,
): number {
  const byBucket =
    taskSourceBucketRank(a, isAutomationFolder) -
    taskSourceBucketRank(b, isAutomationFolder);
  if (byBucket !== 0) return byBucket;
  return compareWorkspaceFileNodes(a, b, key, dir);
}

/** Like sortWorkspaceFileTreeCopy but keeps projects/spaces above automation runs. */
export function sortTaskSourceTreeCopy(
  node: WorkspaceFileTreeNode,
  key: WorkspaceFileSortKey,
  dir: WorkspaceFileSortDir,
  isAutomationFolder: (name: string) => boolean,
): WorkspaceFileTreeNode {
  return {
    ...node,
    children: node.children
      .map((child) => sortTaskSourceTreeCopy(child, key, dir, isAutomationFolder))
      .sort((a, b) => compareTaskSourceNodes(a, b, key, dir, isAutomationFolder)),
  };
}

function sortWorkspaceFileTree(
  node: WorkspaceFileTreeNode,
  key: WorkspaceFileSortKey = "name",
  dir: WorkspaceFileSortDir = "asc",
) {
  node.children.sort((a, b) => compareWorkspaceFileNodes(a, b, key, dir));
  for (const child of node.children) sortWorkspaceFileTree(child, key, dir);
}

/** Immutable recursive sort for UI (does not mutate the source tree). */
export function sortWorkspaceFileTreeCopy(
  node: WorkspaceFileTreeNode,
  key: WorkspaceFileSortKey,
  dir: WorkspaceFileSortDir,
): WorkspaceFileTreeNode {
  return {
    ...node,
    children: node.children
      .map((child) => sortWorkspaceFileTreeCopy(child, key, dir))
      .sort((a, b) => compareWorkspaceFileNodes(a, b, key, dir)),
  };
}

export function buildWorkspaceFileTree(
  entries: OnMyAgentWorkspaceFileCatalogEntry[],
): WorkspaceFileTreeNode {
  const root: WorkspaceFileTreeNode = {
    name: t("files.workspace"),
    path: "",
    kind: "dir",
    size: 0,
    mtimeMs: 0,
    children: [],
  };
  for (const entry of entries) addWorkspaceFileTreeEntry(root, entry);
  rollupWorkspaceFileTreeStats(root);
  sortWorkspaceFileTree(root);
  return root;
}

/** OS / IDE junk basenames (case-insensitive) never shown as user content. */
const HIDDEN_BASENAME_EXACT = new Set([
  "thumbs.db",
  "desktop.ini",
  "onmyagent-session.json",
  "opencode.json",
  "opencode.jsonc",
]);

export function shouldHideEntry(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  for (const part of parts) {
    if (part.startsWith(".")) return true;
    if (HIDDEN_BASENAME_EXACT.has(part.toLowerCase())) return true;
  }
  if (path === "opencode.jsonc" || path.endsWith("/opencode.jsonc")) {
    return true;
  }
  return false;
}

function shouldHideNode(node: WorkspaceFileTreeNode): boolean {
  return shouldHideEntry(node.path || node.name);
}

export function filterHiddenFromTree(
  node: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode {
  const filteredChildren = node.children
    .filter((child) => !shouldHideNode(child))
    .map((child) => filterHiddenFromTree(child));
  const next: WorkspaceFileTreeNode = { ...node, children: filteredChildren };
  if (next.kind === "dir") {
    let size = 0;
    let mtimeMs = next.mtimeMs || 0;
    for (const child of filteredChildren) {
      size += Math.max(0, child.size || 0);
      if ((child.mtimeMs || 0) > mtimeMs) mtimeMs = child.mtimeMs;
    }
    if (filteredChildren.length > 0) next.size = size;
    if (mtimeMs > 0) next.mtimeMs = mtimeMs;
  }
  return next;
}

/**
 * Drop directories that have no remaining visible children.
 * Hides empty expert session folders (marker-only) and empty intermediate paths.
 * Workspace root (path "") is always kept so the page can show an empty state.
 */
export function pruneEmptyDirectoriesFromTree(
  node: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode {
  if (node.kind === "file") return node;

  const children = node.children
    .map((child) => pruneEmptyDirectoriesFromTree(child))
    .filter((child) => {
      if (child.kind === "file") return true;
      return child.children.length > 0;
    });

  const next: WorkspaceFileTreeNode = { ...node, children };
  if (next.kind === "dir" && children.length > 0) {
    let size = 0;
    let mtimeMs = next.mtimeMs || 0;
    for (const child of children) {
      size += Math.max(0, child.size || 0);
      if ((child.mtimeMs || 0) > mtimeMs) mtimeMs = child.mtimeMs;
    }
    next.size = size;
    if (mtimeMs > 0) next.mtimeMs = mtimeMs;
  }
  return next;
}

export function findWorkspaceFileNode(
  node: WorkspaceFileTreeNode,
  path: string,
): WorkspaceFileTreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const match = findWorkspaceFileNode(child, path);
    if (match) return match;
  }
  return null;
}

export function workspaceFileBreadcrumbs(path: string): Array<{
  name: string;
  path: string;
}> {
  const parts = path.split("/").filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

export function workspaceNameFromRoot(root: string) {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || t("files.current_workspace");
}

export function formatWorkspaceFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatWorkspaceFileTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return t("common.unknown");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.unknown");
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
