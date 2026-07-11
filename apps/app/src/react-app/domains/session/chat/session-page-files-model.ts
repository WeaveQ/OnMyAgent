import { t } from "../../../../i18n";
import type { OnMyAgentWorkspaceFileCatalogEntry } from "../../../../app/lib/onmyagent-server";

export type WorkspaceFileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  children: WorkspaceFileTreeNode[];
};

export type FileNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
};

export type TaskGroup = {
  agentName: string;
  taskName: string;
  files: FileNode[];
};

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

export function filterWorkspaceFileTree(
  node: WorkspaceFileTreeNode,
  query: string,
): WorkspaceFileTreeNode | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return node;
  const filteredChildren = node.children
    .map((child) => filterWorkspaceFileTree(child, normalizedQuery))
    .filter((child): child is WorkspaceFileTreeNode => child !== null);
  const matches =
    node.name.toLowerCase().includes(normalizedQuery) ||
    node.path.toLowerCase().includes(normalizedQuery);
  if (!matches && filteredChildren.length === 0) return null;
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

export function shouldHideEntry(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (const part of parts) {
    if (part.startsWith(".")) return true;
  }
  if (path === "opencode.jsonc" || path.endsWith("/opencode.jsonc")) {
    return true;
  }
  return false;
}

function shouldHideNode(node: WorkspaceFileTreeNode): boolean {
  if (node.name.startsWith(".")) return true;
  if (node.name === "opencode.jsonc") return true;
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

export function buildFileHierarchy(
  entries: OnMyAgentWorkspaceFileCatalogEntry[],
): TaskGroup[] {
  const filtered = entries.filter((entry) => !shouldHideEntry(entry.path));
  const rawTree = buildWorkspaceFileTree(filtered);
  const tree = filterHiddenFromTree(rawTree);
  const groups: TaskGroup[] = [];

  for (const topLevel of tree.children) {
    if (topLevel.kind === "dir") {
      const agentFiles = topLevel.children.filter((child) => child.kind === "file");
      const taskDirs = topLevel.children.filter((child) => child.kind === "dir");

      if (agentFiles.length > 0) {
        groups.push({
          agentName: topLevel.name,
          taskName: "未分组",
          files: agentFiles.map((file) => ({
            name: file.name,
            path: file.path,
            kind: file.kind,
            size: file.size,
            mtimeMs: file.mtimeMs,
          })),
        });
      }

      for (const taskDir of taskDirs) {
        const taskFiles = flattenDirFiles(taskDir);
        if (taskFiles.length > 0) {
          groups.push({
            agentName: topLevel.name,
            taskName: taskDir.name,
            files: taskFiles,
          });
        }
      }
    } else {
      groups.push({
        agentName: "工作区根目录",
        taskName: "未分组",
        files: [
          {
            name: topLevel.name,
            path: topLevel.path,
            kind: topLevel.kind,
            size: topLevel.size,
            mtimeMs: topLevel.mtimeMs,
          },
        ],
      });
    }
  }

  return groups;
}

function flattenDirFiles(node: WorkspaceFileTreeNode): FileNode[] {
  const result: FileNode[] = [];
  for (const child of node.children) {
    if (child.kind === "file") {
      result.push({
        name: child.name,
        path: child.path,
        kind: child.kind,
        size: child.size,
        mtimeMs: child.mtimeMs,
      });
    } else {
      result.push(...flattenDirFiles(child));
    }
  }
  return result;
}
