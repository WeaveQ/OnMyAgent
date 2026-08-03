/**
 * Converge Mine files to product layout: `{ws}/uploads/…`.
 * Pure helpers — unit-tested without React/Electron.
 */

import {
  WORKSPACE_UPLOADS_DIR,
  isUnderProductLayoutRoot,
} from "./workspace-files-layout";
import {
  WORKSPACE_INBOX_DIR,
  isMineHiddenUploadPath,
} from "./workspace-files-model";

function normalizeRel(path: string): string {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

/**
 * Map an inbox-relative path (as returned by listInbox) to the product
 * uploads/ destination (workspace-relative).
 *
 * Examples:
 * - `uploads/a.xlsx` → `uploads/a.xlsx`
 * - `a.xlsx` → `uploads/a.xlsx`
 * - `session-uploads/foo.png` → `uploads/foo.png`
 */
export function mapInboxRelativeToUploadsPath(
  inboxRelativePath: string,
): string | null {
  let rel = normalizeRel(inboxRelativePath);
  if (!rel || isMineHiddenUploadPath(rel)) return null;

  // Already under uploads/ naming inside inbox → keep under workspace uploads/
  if (rel === WORKSPACE_UPLOADS_DIR) return null;
  if (rel.startsWith(`${WORKSPACE_UPLOADS_DIR}/`)) {
    return isUnderProductLayoutRoot(rel) ? rel : null;
  }

  // Legacy session attachment dumps
  if (rel.startsWith("session-uploads/")) {
    rel = rel.slice("session-uploads/".length);
  }
  if (!rel || rel.includes("..")) return null;

  const to = `${WORKSPACE_UPLOADS_DIR}/${rel}`.replace(/\/+/g, "/");
  return isUnderProductLayoutRoot(to) ? to : null;
}

export type InboxMigratePlanItem = {
  /** Full workspace-relative source (under .opencode/onmyagent/inbox/…). */
  from: string;
  /** Full workspace-relative destination under uploads/. */
  to: string;
  /** Basename for logs / UI. */
  name: string;
};

/**
 * Build a dry-run migration plan from inbox list paths (relative to inbox root).
 * Skips hidden junk and items that would no-op (from === to is impossible here).
 */
export function planInboxToUploadsMigration(
  inboxRelativePaths: readonly string[],
): InboxMigratePlanItem[] {
  const out: InboxMigratePlanItem[] = [];
  const seenTo = new Set<string>();
  for (const raw of inboxRelativePaths) {
    const inboxRel = normalizeRel(raw);
    if (!inboxRel || isMineHiddenUploadPath(inboxRel)) continue;
    const to = mapInboxRelativeToUploadsPath(inboxRel);
    if (!to) continue;
    const from = `${WORKSPACE_INBOX_DIR}/${inboxRel}`.replace(/\/+/g, "/");
    if (from === to) continue;
    if (seenTo.has(to)) continue;
    seenTo.add(to);
    const name = to.split("/").pop() || to;
    out.push({ from, to, name });
  }
  return out;
}

/**
 * Format a workspace-relative Mine path for UI (never show .opencode/inbox).
 * Returns segments under uploads/ for breadcrumbs, or display string.
 */
export function displayMinePathUnderUploads(
  workspaceRelativePath: string,
): string {
  const rel = normalizeRel(workspaceRelativePath);
  if (!rel) return WORKSPACE_UPLOADS_DIR;
  if (rel.startsWith(`${WORKSPACE_INBOX_DIR}/`)) {
    const rest = rel.slice(WORKSPACE_INBOX_DIR.length + 1);
    const mapped = mapInboxRelativeToUploadsPath(rest);
    return mapped || `${WORKSPACE_UPLOADS_DIR}/${rest.split("/").pop() || "file"}`;
  }
  if (rel.startsWith(`${WORKSPACE_UPLOADS_DIR}/`) || rel === WORKSPACE_UPLOADS_DIR) {
    return rel;
  }
  return `${WORKSPACE_UPLOADS_DIR}/${rel.split("/").pop() || rel}`;
}
