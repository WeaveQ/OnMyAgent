/**
 * Open-source-session eligibility for Files rows (Tasks / Experts).
 * Pure — unit-tested without React/Electron.
 */

import { extractSessionIdFromProductPath } from "./workspace-files-layout";

export type SourceSessionStatus = "active" | "archived" | "missing" | "none";

export type OpenSourceSessionAction = {
  sessionId: string | null;
  status: SourceSessionStatus;
  /** Whether the UI should allow navigation into the conversation. */
  canOpen: boolean;
};

/**
 * Resolve whether a workspace-relative path can jump to its producing session.
 *
 * - active: session is in the live list → open
 * - archived: soft-archived (settings archive) → still openable (session id known)
 * - missing: path encodes a session id but it is neither live nor archived
 *   (permanent delete / unknown) → disable with orphan hint
 * - none: path has no session attribution (e.g. uploads) → hide menu item
 */
export function resolveOpenSourceSessionAction(input: {
  relativePath: string;
  activeSessionIds?: ReadonlySet<string> | readonly string[] | null;
  archivedSessionIds?: ReadonlySet<string> | readonly string[] | null;
}): OpenSourceSessionAction {
  const sessionId = extractSessionIdFromProductPath(input.relativePath);
  if (!sessionId) {
    return { sessionId: null, status: "none", canOpen: false };
  }

  const active = toIdSet(input.activeSessionIds);
  const archived = toIdSet(input.archivedSessionIds);

  if (active.has(sessionId)) {
    return { sessionId, status: "active", canOpen: true };
  }
  if (archived.has(sessionId)) {
    return { sessionId, status: "archived", canOpen: true };
  }
  // Path encodes a session but we cannot resolve it → orphan / deleted.
  return { sessionId, status: "missing", canOpen: false };
}

function toIdSet(
  value: ReadonlySet<string> | readonly string[] | null | undefined,
): Set<string> {
  if (!value) return new Set();
  if (value instanceof Set) {
    return new Set(
      Array.from(value)
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    );
  }
  const list = value as readonly string[];
  return new Set(
    list.map((id) => String(id ?? "").trim()).filter(Boolean),
  );
}

/** Build a session-id → title map from live sessions + archive rows. */
export function buildSessionTitleByKey(input: {
  liveSessions?: ReadonlyArray<{ id?: string | null; title?: string | null }>;
  archivedTasks?: ReadonlyArray<{
    sessionId?: string | null;
    title?: string | null;
  }>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const session of input.liveSessions ?? []) {
    const id = String(session.id ?? "").trim();
    const title = String(session.title ?? "").trim();
    if (id && title) out[id] = title;
  }
  for (const task of input.archivedTasks ?? []) {
    const id = String(task.sessionId ?? "").trim();
    const title = String(task.title ?? "").trim();
    if (id && title && !out[id]) out[id] = title;
  }
  return out;
}
