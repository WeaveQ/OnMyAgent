import { getDisplaySessionTitle } from "../../app/lib/session-title";
import type { SidebarSessionItem } from "../../app/types";
import type { OpenworkServerClient } from "../../app/lib/onmyagent-server";
import type { ResolvedWorkspaceEndpoint } from "../../app/lib/workspace-endpoint";
import { t } from "../../i18n";
import { isExpertSession } from "../domains/shared/agent-session-state";
import type { RouteWorkspace } from "./session-route-model";
import { getSessionStatus, isActiveSessionStatus } from "./session-route-state";
import type { SessionOption as PaletteSessionOption } from "./command-palette";

export type PendingCreatedSessionMap = Record<string, Record<string, number>>;

export function toSidebarSessionItem(value: unknown): SidebarSessionItem | null {
  if (!value || typeof value !== "object") return null;
  const session = value as {
    id?: unknown;
    title?: unknown;
    slug?: unknown;
    status?: unknown;
    state?: unknown;
    runStatus?: unknown;
    parentID?: unknown;
    time?: unknown;
    directory?: unknown;
  };
  const id = typeof session.id === "string" ? session.id : "";
  if (!id) return null;
  const time = session.time && typeof session.time === "object"
    ? (session.time as SidebarSessionItem["time"])
    : undefined;
  return {
    id,
    title: typeof session.title === "string" ? session.title : "",
    slug: typeof session.slug === "string" ? session.slug : null,
    status: session.status,
    state: session.state,
    runStatus: session.runStatus,
    parentID: typeof session.parentID === "string" ? session.parentID : null,
    time,
    directory: typeof session.directory === "string" ? session.directory : null,
  };
}

export function toSidebarSessionItems(values: unknown[]): SidebarSessionItem[] {
  return values.flatMap((value) => {
    const item = toSidebarSessionItem(value);
    return item ? [item] : [];
  });
}

export function shouldKeepWorkspaceSessionItem(input: {
  sessionId: string;
  directory: string | null | undefined;
  assistantSessionIds: Set<string>;
  normalizedWorkspaceRoot: string;
  normalizeDirectoryPath: (path: string) => string;
}) {
  if (input.assistantSessionIds.has(input.sessionId)) return true;
  if (isExpertSession(input.sessionId)) return true;
  return (
    input.normalizeDirectoryPath(input.directory ?? "") ===
    input.normalizedWorkspaceRoot
  );
}

export async function collectWorkspaceSessionItems(input: {
  client: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteOpenworkWorkspace: boolean;
  assistantSessionRecords: Array<{ sessionId: string; directory: string }>;
  normalizeDirectoryPath: (path: string) => string;
}) {
  const response = await input.client.listSessions(input.workspaceId, { limit: 200 });
  const assistantSessionIds = new Set(
    input.assistantSessionRecords.map((item) => item.sessionId),
  );
  const assistantDirectories = Array.from(
    new Set(input.assistantSessionRecords.map((item) => item.directory.trim())),
  ).filter(Boolean);
  const assistantDirectoryResults = await Promise.allSettled(
    assistantDirectories.map(async (directory) => {
      const result = await input.client.listSessions(input.workspaceId, { limit: 200, directory });
      return result.items.filter((item) => assistantSessionIds.has(item.id));
    }),
  );
  const assistantDirectoryItems = assistantDirectoryResults.flatMap(
    (result) => (result.status === "fulfilled" ? result.value : []),
  );
  const fetchedItems = Array.from(
    [...(response.items ?? []), ...assistantDirectoryItems].reduce(
      (items, item) => items.set(item.id, item),
      new Map<string, (typeof response.items)[number]>(),
    ).values(),
  );
  const normalizedWorkspaceRoot = input.normalizeDirectoryPath(input.workspaceRoot);
  const items = normalizedWorkspaceRoot && !input.isRemoteOpenworkWorkspace
    ? fetchedItems.filter(
        (session) =>
          shouldKeepWorkspaceSessionItem({
            sessionId: session?.id ?? "",
            directory: session?.directory,
            assistantSessionIds,
            normalizedWorkspaceRoot,
            normalizeDirectoryPath: input.normalizeDirectoryPath,
          }),
      )
    : fetchedItems;
  return toSidebarSessionItems(items);
}

export function insertSidebarSession(input: {
  current: Record<string, SidebarSessionItem[]>;
  workspaceId: string;
  session: unknown;
}) {
  const existing = input.current[input.workspaceId] ?? [];
  const insertedSession = toSidebarSessionItem(input.session);
  if (!insertedSession || existing.some((session) => session.id === insertedSession.id)) {
    return input.current;
  }
  return {
    ...input.current,
    [input.workspaceId]: [insertedSession, ...existing],
  };
}

export function insertCreatedSessionForWorkspace(input: {
  current: Record<string, SidebarSessionItem[]>;
  createdSession: unknown;
  workspaceId: string;
}) {
  return insertSidebarSession({
    current: input.current,
    workspaceId: input.workspaceId,
    session: input.createdSession,
  });
}

export function getActiveReloadBlockingSessions(
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>,
) {
  return Object.values(sessionsByWorkspaceId)
    .flat()
    .flatMap((session) => {
      if (!isActiveSessionStatus(getSessionStatus(session))) return [];
      const id = session.id.trim();
      if (!id) return [];
      return [
        {
          id,
          title: (session.title || session.slug || session.id).trim() || t("session.untitled"),
        },
      ];
    });
}

export function getActiveSessionIds(sessions: SidebarSessionItem[]) {
  return sessions.flatMap((session) => {
    if (!isActiveSessionStatus(getSessionStatus(session))) return [];
    const id = session.id.trim();
    return id ? [id] : [];
  });
}

export function mergeFetchedSessionsWithPending(input: {
  workspaceId: string;
  fetched: SidebarSessionItem[];
  current: SidebarSessionItem[];
  pendingByWorkspaceId: PendingCreatedSessionMap;
  explicitAssistantSessionIds: Set<string>;
  now: number;
}) {
  const pending = input.pendingByWorkspaceId[input.workspaceId];
  const pendingIds = Object.keys(pending ?? {});
  if (pendingIds.length === 0) return input.fetched;

  const fetchedIds = new Set(
    input.fetched.flatMap((session) => (session.id ? [session.id] : [])),
  );

  for (const id of pendingIds) {
    if (fetchedIds.has(id)) {
      delete pending?.[id];
    }
  }

  const preserved = input.current.filter((session) => {
    const id = session.id;
    if (!id || fetchedIds.has(id)) return false;
    if (input.explicitAssistantSessionIds.has(id)) return true;
    const createdAt = pending?.[id];
    if (typeof createdAt !== "number") return false;
    if (input.now - createdAt > 30_000) {
      delete pending?.[id];
      return false;
    }
    return true;
  });

  if (pending && Object.keys(pending).length === 0) {
    delete input.pendingByWorkspaceId[input.workspaceId];
  }

  return preserved.length > 0 ? [...preserved, ...input.fetched] : input.fetched;
}

export function mergeWorkspaceFetchedSessions(input: {
  current: Record<string, SidebarSessionItem[]>;
  workspaceId: string;
  fetched: SidebarSessionItem[];
  merge: (fetched: SidebarSessionItem[], current: SidebarSessionItem[]) => SidebarSessionItem[];
}) {
  const nextItems = input.merge(input.fetched, input.current[input.workspaceId] ?? []);
  return { ...input.current, [input.workspaceId]: nextItems };
}

export function sessionListOwnsSession(input: {
  sessions: SidebarSessionItem[];
  sessionId: string | null;
}) {
  if (!input.sessionId) return false;
  return input.sessions.some((session) => session.id === input.sessionId);
}

export function findWorkspaceIdOwningSession(input: {
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  sessionId: string | null;
  excludeWorkspaceId?: string;
}) {
  if (!input.sessionId) return null;
  for (const [workspaceId, sessions] of Object.entries(input.sessionsByWorkspaceId)) {
    if (workspaceId === input.excludeWorkspaceId) continue;
    if (sessionListOwnsSession({ sessions, sessionId: input.sessionId })) {
      return workspaceId;
    }
  }
  return null;
}

export function sessionBelongsToAnotherWorkspace(input: {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
}) {
  return Boolean(
    findWorkspaceIdOwningSession({
      sessionsByWorkspaceId: input.sessionsByWorkspaceId,
      sessionId: input.selectedSessionId,
      excludeWorkspaceId: input.selectedWorkspaceId,
    }),
  );
}

export function findFirstSessionIdMatching(
  sessions: SidebarSessionItem[],
  predicate: (sessionId: string) => boolean,
) {
  return sessions.find((session) => session.id && predicate(session.id))?.id ?? null;
}

export function maxSequence(items: unknown[]) {
  return Math.max(
    0,
    ...items.map((item) => {
      if (!item || typeof item !== "object") return 0;
      const seq = (item as { seq?: unknown }).seq;
      return Number(seq) || 0;
    }),
  );
}

export function toInspectorSessionEntries(
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>,
) {
  return Object.fromEntries(
    Object.entries(sessionsByWorkspaceId).map(([workspaceId, sessions]) => [
      workspaceId,
      sessions.map((session) => ({
        id: session.id ?? null,
        title: session.title ?? null,
        directory: session.directory ?? null,
      })),
    ]),
  );
}

export function toControlSessionEntries(
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>,
) {
  return Object.fromEntries(
    Object.entries(sessionsByWorkspaceId).map(([workspaceId, sessions]) => [
      workspaceId,
      sessions.map((session) => ({
        id: session.id,
        title: session.title,
        time: session.time
          ? {
              updated:
                typeof session.time.updated === "number"
                  ? session.time.updated
                  : undefined,
              created:
                typeof session.time.created === "number"
                  ? session.time.created
                  : undefined,
            }
          : undefined,
      })),
    ]),
  );
}

export function toPaletteSessionOptions(input: {
  workspaces: RouteWorkspace[];
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  selectedWorkspaceId: string;
}): PaletteSessionOption[] {
  const out: PaletteSessionOption[] = [];
  for (const workspace of input.workspaces) {
    const workspaceTitle =
      workspace.displayName?.trim() ||
      workspace.name?.trim() ||
      workspace.path?.trim() ||
      t("session.workspace_fallback");
    const list = input.sessionsByWorkspaceId[workspace.id] ?? [];
    for (const session of list) {
      const sessionId = session.id?.trim() ?? "";
      if (!sessionId) continue;
      const title = getDisplaySessionTitle(session.title ?? "");
      const updatedAt = session.time?.updated ?? session.time?.created ?? 0;
      out.push({
        workspaceId: workspace.id,
        sessionId,
        title,
        workspaceTitle,
        updatedAt,
        searchText: `${title} ${workspaceTitle}`.toLowerCase(),
        isActive: workspace.id === input.selectedWorkspaceId,
      });
    }
  }
  out.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return out;
}

type CreatedSessionSnapshot = Awaited<
  ReturnType<ResolvedWorkspaceEndpoint["client"]["getSessionSnapshot"]>
>["item"];

export async function refreshCreatedSessionSnapshotWithRetries(input: {
  directory: string;
  endpoint: ResolvedWorkspaceEndpoint;
  sessionId: string;
  setQueryData: (queryKey: readonly unknown[], value: unknown) => void;
  seedSessionState: (workspaceId: string, snapshot: CreatedSessionSnapshot) => void;
}) {
  const delays = [0, 120, 360, 900];
  for (const delay of delays) {
    if (delay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    try {
      const snapshot = (
        await input.endpoint.client.getSessionSnapshot(
          input.endpoint.workspaceId,
          input.sessionId,
          { limit: 140, directory: input.directory },
        )
      ).item;
      input.setQueryData(
        ["react-session-snapshot", input.endpoint.workspaceId, input.sessionId],
        snapshot,
      );
      input.seedSessionState(input.endpoint.workspaceId, snapshot);
      if (snapshot.messages.length > 0) return;
    } catch {
      continue;
    }
  }
}
