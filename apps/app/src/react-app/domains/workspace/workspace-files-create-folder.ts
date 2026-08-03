/**
 * Mine (uploads) create-folder path helpers.
 * Pure — unit-tested without React/Electron.
 */

import {
  WORKSPACE_UPLOADS_DIR,
  isUnderProductLayoutRoot,
  resolveProductWriteRelativePath,
} from "./workspace-files-layout";

const INVALID_FOLDER_CHARS = /[\\/<>:"|?*\u0000-\u001f]/g;

/**
 * Sanitize a user-typed folder name into a single path segment.
 * Returns null when empty / only dots after sanitize.
 */
export function sanitizeUploadFolderName(raw: string): string | null {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(INVALID_FOLDER_CHARS, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned;
}

/**
 * Resolve destination path when moving a Mine file into a folder via drag-drop.
 * Keeps basename; destination must stay under uploads/.
 */
export function resolveMineMoveDestination(input: {
  sourceWorkspaceRelativePath: string;
  targetFolderWorkspaceRelativePath: string;
}): { from: string; to: string } | null {
  const from = String(input.sourceWorkspaceRelativePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  let folder = String(input.targetFolderWorkspaceRelativePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (!from || !folder) return null;
  if (folder === WORKSPACE_UPLOADS_DIR || folder.startsWith(`${WORKSPACE_UPLOADS_DIR}/`)) {
    // ok
  } else {
    return null;
  }
  const base = from.split("/").pop() || "";
  if (!base || base === "." || base === "..") return null;
  // Don't move a path into itself or into its own descendant.
  if (from === folder || folder.startsWith(`${from}/`)) return null;
  const parentOfFrom = from.includes("/")
    ? from.slice(0, from.lastIndexOf("/"))
    : "";
  if (parentOfFrom === folder) return null; // already there
  const to = `${folder}/${base}`.replace(/\/+/g, "/");
  if (!isUnderProductLayoutRoot(to)) return null;
  if (to === from) return null;
  return { from, to };
}

/**
 * Resolve workspace-relative path for a new folder under Mine (uploads/).
 * Never returns a bare workspace-root path.
 */
export function resolveUploadFolderRelativePath(
  folderName: string,
  parentRelative?: string | null,
): string | null {
  const name = sanitizeUploadFolderName(folderName);
  if (!name) return null;

  const parent = String(parentRelative ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (parent) {
    // Only allow nesting under uploads/
    if (!parent.startsWith(`${WORKSPACE_UPLOADS_DIR}/`) && parent !== WORKSPACE_UPLOADS_DIR) {
      return null;
    }
    const path = `${parent}/${name}`.replace(/\/+/g, "/");
    return isUnderProductLayoutRoot(path) ? path : null;
  }

  // Place under uploads/ via product write helper (fileName is the folder segment).
  const asFile = resolveProductWriteRelativePath({
    source: "user_upload",
    fileName: name,
  });
  // resolveProductWrite returns uploads/{name} for a file — same path is the dir root.
  return asFile;
}
