import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import { isSandboxWorkspace } from "../../../../app/utils";
import { t } from "../../../../i18n";

export const MAX_SESSIONS_PREVIEW = 6;

export type SessionListItem = WorkspaceSessionGroup["sessions"][number];
export type FlattenedSessionRow = { session: SessionListItem; depth: number };
export type SessionTreeState = {
  childrenByParent: Map<string, SessionListItem[]>;
  ancestorIdsBySessionId: Map<string, string[]>;
  descendantCountBySessionId: Map<string, number>;
  activeIds: Set<string>;
  streamingIds: Set<string>;
};

/**
 * True when the sidebar should show busy chrome (dots / activity label).
 * Accepts both raw server run types (`busy`/`retry`) and session-activity
 * store statuses (`thinking`/`responding`/`retrying`/`compacting`/…).
 * Missing `retrying` previously hid 重试中 on expert list rows while the
 * main surface already showed it.
 */
export const isStreamingSessionStatus = (status: string | undefined) =>
  status === "running" ||
  status === "busy" ||
  status === "retry" ||
  status === "retrying" ||
  status === "streaming" ||
  status === "thinking" ||
  status === "responding" ||
  status === "waiting" ||
  status === "compacting";

/**
 * Priority for multi-session aggregate (higher wins).
 * Expert list / chips need one status when several sessions under one expert are busy.
 */
const SESSION_ACTIVITY_PRIORITY: Record<string, number> = {
  responding: 50,
  streaming: 50,
  thinking: 40,
  busy: 40,
  running: 40,
  compacting: 35,
  retry: 30,
  retrying: 30,
  waiting: 20,
};

/** Short label for expert list / session-tab busy slot (WeChat-style). */
export function expertActivityLabel(status: string | undefined): string | null {
  if (!status || !isStreamingSessionStatus(status)) return null;
  if (status === "responding" || status === "streaming") {
    return t("session.expert_status_responding");
  }
  if (status === "retry" || status === "retrying") {
    return t("session.expert_status_retrying");
  }
  if (status === "waiting") {
    return t("session.expert_status_waiting");
  }
  if (status === "compacting") {
    return t("session.assistant_compacting");
  }
  return t("session.expert_status_thinking");
}

/**
 * Pick the busiest status among sessions (e.g. expert group with multi-session).
 * Returns undefined when none are streaming.
 */
export function pickAggregateSessionStatus(
  sessionIds: Iterable<string>,
  sessionStatusById: Record<string, string> | undefined,
): string | undefined {
  if (!sessionStatusById) return undefined;
  let best: string | undefined;
  let bestScore = -1;
  for (const id of sessionIds) {
    const status = sessionStatusById[id];
    if (!status || !isStreamingSessionStatus(status)) continue;
    const score = SESSION_ACTIVITY_PRIORITY[status] ?? 10;
    if (score > bestScore) {
      bestScore = score;
      best = status;
    }
  }
  return best;
}

const normalizeSessionParentID = (session: SessionListItem) => {
  const parentID = session.parentID?.trim();
  return parentID || "";
};

export const getRootSessions = (sessions: WorkspaceSessionGroup["sessions"]) => {
  const byID = new Set(sessions.map((session) => session.id));
  return sessions.filter((session) => {
    const parentID = normalizeSessionParentID(session);
    return !parentID || !byID.has(parentID);
  });
};

export const buildSessionTreeState = (
  sessions: WorkspaceSessionGroup["sessions"],
  sessionStatusById: Record<string, string> | undefined,
): SessionTreeState => {
  const childrenByParent = new Map<string, SessionListItem[]>();
  const ancestorIdsBySessionId = new Map<string, string[]>();
  const descendantCountBySessionId = new Map<string, number>();
  const activeIds = new Set<string>();
  const streamingIds = new Set<string>();
  const sessionIds = new Set(sessions.map((session) => session.id));

  sessions.forEach((session) => {
    const parentID = normalizeSessionParentID(session);
    if (!parentID || !sessionIds.has(parentID)) return;
    const siblings = childrenByParent.get(parentID) ?? [];
    siblings.push(session);
    childrenByParent.set(parentID, siblings);
  });

  const walk = (session: SessionListItem, ancestors: string[]) => {
    ancestorIdsBySessionId.set(session.id, ancestors);
    const children = childrenByParent.get(session.id) ?? [];
    let descendantCount = 0;
    const ownStatus = sessionStatusById?.[session.id] ?? "idle";
    let subtreeActive = ownStatus !== "idle";
    let subtreeStreaming = isStreamingSessionStatus(ownStatus);

    children.forEach((child) => {
      const childState = walk(child, [...ancestors, session.id]);
      descendantCount += 1 + childState.descendantCount;
      subtreeActive = subtreeActive || childState.subtreeActive;
      subtreeStreaming = subtreeStreaming || childState.subtreeStreaming;
    });

    descendantCountBySessionId.set(session.id, descendantCount);
    if (subtreeActive) activeIds.add(session.id);
    if (subtreeStreaming) streamingIds.add(session.id);
    return { descendantCount, subtreeActive, subtreeStreaming };
  };

  getRootSessions(sessions).forEach((session) => {
    walk(session, []);
  });

  return {
    childrenByParent,
    ancestorIdsBySessionId,
    descendantCountBySessionId,
    activeIds,
    streamingIds,
  };
};

export const flattenSessionRows = (
  sessions: WorkspaceSessionGroup["sessions"],
  rootLimit: number,
  tree: SessionTreeState,
  expandedSessionIds: Set<string>,
  forcedExpandedSessionIds: Set<string>,
) => {
  const roots = getRootSessions(sessions).slice(0, rootLimit);
  const rows: FlattenedSessionRow[] = [];
  const visited = new Set<string>();

  const walk = (session: SessionListItem, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    rows.push({ session, depth });
    const children = tree.childrenByParent.get(session.id) ?? [];
    if (!children.length) return;
    const expanded = expandedSessionIds.has(session.id) || forcedExpandedSessionIds.has(session.id);
    if (!expanded) return;
    children.forEach((child) => walk(child, depth + 1));
  };

  roots.forEach((root) => walk(root, 0));
  return rows;
};

export const workspaceLabel = (workspace: WorkspaceInfo) =>
  workspace.displayName?.trim() ||
  workspace.onmyagentWorkspaceName?.trim() ||
  workspace.name?.trim() ||
  workspace.path?.trim() ||
  t("workspace_list.workspace_fallback");

export const workspaceKindLabel = (workspace: WorkspaceInfo) =>
  workspace.workspaceType === "remote"
    ? isSandboxWorkspace(workspace)
      ? t("workspace.sandbox_badge")
      : t("workspace.remote_badge")
    : t("workspace.local_badge");

const WORKSPACE_SWATCHES = ["#2563eb", "#5a67d8", "#f97316", "#10b981"];

export const workspaceSwatchColor = (seed: string) => {
  const value = seed.trim() || "workspace";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return WORKSPACE_SWATCHES[Math.abs(hash) % WORKSPACE_SWATCHES.length];
};
