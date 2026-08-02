/**
 * Open-source-session eligibility for Files rows (Tasks / Experts).
 * Pure — unit-tested without React/Electron.
 */

import {
  WORKSPACE_TASKS_DIR,
  extractSessionIdFromProductPath,
  isAutomationTaskFolderName,
  isLikelySessionId,
} from "./workspace-files-layout";

export type SourceSessionStatus = "active" | "archived" | "missing" | "none";

export type OpenSourceSessionAction = {
  sessionId: string | null;
  status: SourceSessionStatus;
  /** Whether the UI should allow navigation into the conversation. */
  canOpen: boolean;
  /**
   * True when this path is a conversation/session folder (show session icon),
   * false for ordinary folders (folder icon) even if open is unavailable.
   */
  isSessionFolder: boolean;
};

function normalizeRel(path: string): string {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
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
  return new Set(list.map((id) => String(id ?? "").trim()).filter(Boolean));
}

function lookupSessionIdByPathKey(
  relativePath: string,
  map: ReadonlyMap<string, string> | Record<string, string>,
): string | null {
  const rel = normalizeRel(relativePath);
  if (!rel) return null;
  const base = rel.split("/").filter(Boolean).at(-1) ?? "";
  const keys = [
    rel,
    base,
    base ? `${WORKSPACE_TASKS_DIR}/${base}` : "",
  ].filter(Boolean);

  const get = (key: string): string | undefined => {
    if (map instanceof Map) return map.get(key)?.trim() || undefined;
    return String((map as Record<string, string>)[key] ?? "").trim() || undefined;
  };

  for (const key of keys) {
    const hit = get(key);
    if (hit && isLikelySessionId(hit)) return hit;
  }
  return null;
}

/**
 * Resolve whether a workspace-relative path can jump to its producing session.
 *
 * - active: session is in the live list → open
 * - archived: soft-archived (settings archive) → still openable (session id known)
 * - missing: path encodes a session id but it is neither live nor archived
 *   (permanent delete / unknown) → disable with orphan hint
 * - none: path has no session attribution (e.g. uploads, plain folders) → folder UI
 */
export function resolveOpenSourceSessionAction(input: {
  relativePath: string;
  activeSessionIds?: ReadonlySet<string> | readonly string[] | null;
  archivedSessionIds?: ReadonlySet<string> | readonly string[] | null;
  /**
   * Extra path/folder keys → real session id (automation groupName, tasks/…).
   * Used when the folder name is not itself a session id.
   */
  sessionIdByPathKey?: ReadonlyMap<string, string> | Record<string, string> | null;
}): OpenSourceSessionAction {
  const fromPath = extractSessionIdFromProductPath(input.relativePath);
  const fromAlias = input.sessionIdByPathKey
    ? lookupSessionIdByPathKey(input.relativePath, input.sessionIdByPathKey)
    : null;
  const sessionId = fromPath || fromAlias;

  if (!sessionId) {
    return {
      sessionId: null,
      status: "none",
      canOpen: false,
      isSessionFolder: false,
    };
  }

  const active = toIdSet(input.activeSessionIds);
  const archived = toIdSet(input.archivedSessionIds);

  if (active.has(sessionId)) {
    return {
      sessionId,
      status: "active",
      canOpen: true,
      isSessionFolder: true,
    };
  }
  if (archived.has(sessionId)) {
    return {
      sessionId,
      status: "archived",
      canOpen: true,
      isSessionFolder: true,
    };
  }
  // Path encodes / maps a session but we cannot resolve it → orphan.
  // Still mark as session folder so the UI can offer cleanup (not a plain folder).
  return {
    sessionId,
    status: "missing",
    canOpen: false,
    isSessionFolder: true,
  };
}

/** Build a session-id → title map from live sessions + archive rows. */
export function buildSessionTitleByKey(input: {
  liveSessions?: ReadonlyArray<{ id?: string | null; title?: string | null }>;
  archivedTasks?: ReadonlyArray<{
    sessionId?: string | null;
    title?: string | null;
  }>;
  /**
   * Extra aliases (automation groupName, folder basename) → display title.
   */
  pathTitleAliases?: ReadonlyArray<{
    key?: string | null;
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
  for (const alias of input.pathTitleAliases ?? []) {
    const key = String(alias.key ?? "").trim();
    const title = String(alias.title ?? "").trim();
    if (key && title && !out[key]) out[key] = title;
  }
  return out;
}

/**
 * Map automation run folders (groupName under tasks/) → real session id
 * so Files → Tasks can open the producing conversation.
 */
export function buildSessionIdByPathKeyFromAutomationRecords(
  records: ReadonlyArray<{
    sessionId?: string | null;
    groupName?: string | null;
    outputDirectory?: string | null;
    title?: string | null;
  }>,
): {
  sessionIdByPathKey: Record<string, string>;
  pathTitleAliases: Array<{ key: string; title: string }>;
} {
  const sessionIdByPathKey: Record<string, string> = {};
  const pathTitleAliases: Array<{ key: string; title: string }> = [];

  for (const record of records) {
    const sessionId = String(record.sessionId ?? "").trim();
    if (!sessionId || !isLikelySessionId(sessionId)) continue;
    const title = String(record.title ?? "").trim();
    const groupName = String(record.groupName ?? "").trim();
    const outDir = String(record.outputDirectory ?? "")
      .trim()
      .replace(/\\/g, "/");
    const outBase = outDir.split("/").filter(Boolean).at(-1) ?? "";

    const keys = new Set<string>();
    if (groupName) {
      keys.add(groupName);
      keys.add(`${WORKSPACE_TASKS_DIR}/${groupName}`);
    }
    if (outBase) {
      keys.add(outBase);
      keys.add(`${WORKSPACE_TASKS_DIR}/${outBase}`);
    }
    // Peel product-layout relative tail from absolute output dirs.
    const tasksIdx = outDir.toLowerCase().lastIndexOf(`/${WORKSPACE_TASKS_DIR}/`);
    if (tasksIdx >= 0) {
      const rel = outDir.slice(tasksIdx + 1).replace(/^\/+/, "");
      if (rel) keys.add(rel);
    }

    for (const key of keys) {
      if (!sessionIdByPathKey[key]) sessionIdByPathKey[key] = sessionId;
      if (title) pathTitleAliases.push({ key, title });
    }
    if (title) pathTitleAliases.push({ key: sessionId, title });
  }

  return { sessionIdByPathKey, pathTitleAliases };
}

/** True when a Tasks outline folder looks like historical automation output. */
export function isHistoricalAutomationTaskFolder(relativePath: string): boolean {
  const base =
    normalizeRel(relativePath).split("/").filter(Boolean).at(-1) ?? "";
  return isAutomationTaskFolderName(base);
}
