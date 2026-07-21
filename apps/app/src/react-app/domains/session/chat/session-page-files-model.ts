import { t } from "../../../../i18n";
import type { OnMyAgentWorkspaceFileCatalogEntry } from "../../../../app/lib/onmyagent-server";
import {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  findWorkspaceFileNode,
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  shouldHideEntry,
  workspaceFileBreadcrumbs,
  workspaceNameFromRoot,
  type WorkspaceFileTreeNode,
} from "../../../capabilities/artifacts/workspace-file-tree";

export type { WorkspaceFileTreeNode };
export {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  findWorkspaceFileNode,
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  shouldHideEntry,
  workspaceFileBreadcrumbs,
  workspaceNameFromRoot,
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
          taskName: t("files.ungrouped"),
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
        agentName: t("files.workspace_root"),
        taskName: t("files.ungrouped"),
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
