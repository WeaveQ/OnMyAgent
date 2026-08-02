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
