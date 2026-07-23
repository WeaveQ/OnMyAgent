/**
 * Canonical workspace file-tree construction and hide-path rules.
 * Session side panel and workspace files page both consume this module so
 * tree shape / hidden-path policy cannot drift between UIs.
 */
import { t } from "../../../i18n";
import type { OnMyAgentWorkspaceFileCatalogEntry } from "../../../app/lib/onmyagent-server";

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

function sortWorkspaceFileTree(node: WorkspaceFileTreeNode) {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortWorkspaceFileTree(child);
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
  sortWorkspaceFileTree(root);
  return root;
}

export function shouldHideEntry(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (const part of parts) {
    if (part.startsWith(".")) return true;
    if (part === "onmyagent-session.json") return true;
  }
  if (path === "opencode.jsonc" || path.endsWith("/opencode.jsonc")) {
    return true;
  }
  return false;
}

function shouldHideNode(node: WorkspaceFileTreeNode): boolean {
  if (node.name.startsWith(".")) return true;
  if (node.name === "opencode.jsonc") return true;
  if (node.name === "onmyagent-session.json") return true;
  return false;
}

export function filterHiddenFromTree(
  node: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode {
  const filteredChildren = node.children
    .filter((child) => !shouldHideNode(child))
    .map((child) => filterHiddenFromTree(child));
  return { ...node, children: filteredChildren };
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
