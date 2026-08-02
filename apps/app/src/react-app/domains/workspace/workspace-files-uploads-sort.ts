/**
 * Mine uploads list filter + column sort (shared compare with Tasks/Experts).
 */
import {
  compareWorkspaceFileNodes,
  type WorkspaceFileSortDir,
  type WorkspaceFileSortKey,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import { getFileCategory, type FileCategory } from "./workspace-files-categories";
import type { UserUploadRow } from "./workspace-files-uploads-catalog";

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
 * (name / type / updated / size; type keeps folders first).
 */
export function sortUploadRows(
  rows: readonly UserUploadRow[],
  key: WorkspaceFileSortKey = "type",
  dir: WorkspaceFileSortDir = "asc",
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
