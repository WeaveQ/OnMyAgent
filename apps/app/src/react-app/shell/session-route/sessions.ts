import { getDisplaySessionTitle } from "../../../app/lib/session-title";
import type { SidebarSessionItem } from "../../../app/types";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import { t } from "../../../i18n";
import {
  addAssistantSession,
  isExpertCreationEphemeralSession,
  writeAssistantSessionCategory,
} from "../../domains/agents";
import {
  filterPendingDeletedSessions,
  filterRecentlyDeletedSessions,
  SIDEBAR_SESSION_LIST_LIMIT,
  sessionSnapshotFetchOptions,
  sessionSnapshotQueryKey,
} from "../../domains/session";
import type { RouteWorkspace } from "./model";
import { getSessionStatus, isActiveSessionStatus } from "./state";
import type { SessionOption as PaletteSessionOption } from "../command-palette";
import {
  tryRecordColdListSessions,
} from "./cold-path-budget";

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
  // Coach / try-preview sessions from expert creation are disposable.
  if (isExpertCreationEphemeralSession(input.sessionId)) return false;
  if (input.assistantSessionIds.has(input.sessionId)) return true;
  return (
    input.normalizeDirectoryPath(input.directory ?? "") ===
    input.normalizedWorkspaceRoot
  );
}

export async function collectWorkspaceSessionItems(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteOnMyAgentWorkspace: boolean;
  assistantSessionRecords: Array<{ sessionId: string; directory: string }>;
  normalizeDirectoryPath: (path: string) => string;
  /** Override list page size (defaults to sidebar cold-start limit). */
  limit?: number;
}) {
  return (await collectWorkspaceSessionItemsWithStatus(input)).items;
}

export type WorkspaceSessionCollectionResult = {
  items: SidebarSessionItem[];
  complete: boolean;
  failures: readonly unknown[];
  skippedByColdPathBudget?: boolean;
};

export async function collectWorkspaceSessionItemsWithStatus(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteOnMyAgentWorkspace: boolean;
  assistantSessionRecords: Array<{ sessionId: string; directory: string }>;
  normalizeDirectoryPath: (path: string) => string;
  limit?: number;
}): Promise<WorkspaceSessionCollectionResult> {
  const limit = input.limit ?? SIDEBAR_SESSION_LIST_LIMIT;
  // The workspace aggregate is the only canonical session read for a refresh.
  // It already scans authorized expert runtime markers server-side; renderer
  // code must not fan out over origins or assistant directories.
  if (!tryRecordColdListSessions()) {
    return {
      items: [],
      complete: false,
      failures: [],
      skippedByColdPathBudget: true,
    };
  }
  const response = await input.client.listSessions(input.workspaceId, {
    scope: "workspace",
    limit,
  });
  const assistantSessionIds = new Set(
    input.assistantSessionRecords.map((item) => item.sessionId),
  );
  const fetchedItems = Array.from(
    (response.items ?? []).reduce(
      (items, item) => {
        if (item && typeof item === "object" && "id" in item) {
          const id = (item as { id?: unknown }).id;
          if (typeof id === "string" && id.trim()) items.set(id, item);
        }
        return items;
      },
      new Map<string, (typeof response.items)[number]>(),
    ).values(),
  );
  const normalizedWorkspaceRoot = input.normalizeDirectoryPath(input.workspaceRoot);
  if (normalizedWorkspaceRoot && !input.isRemoteOnMyAgentWorkspace) {
    // Auto-register sessions whose directory matches the workspace root so they
    // pass the downstream `isAssistantSession` filter in the sidebar. This
    // covers sessions created from the main process (e.g. IM AssistantBridge),
    // which are not registered through addAssistantSession at creation time.
    for (const session of fetchedItems) {
      const id = session?.id;
      const dir = session?.directory;
      if (!id || !dir) continue;
      if (isExpertCreationEphemeralSession(id)) continue;
      if (input.normalizeDirectoryPath(dir) === normalizedWorkspaceRoot && !assistantSessionIds.has(id)) {
        addAssistantSession(id);
        assistantSessionIds.add(id);
      }
    }
  }
  // A workspace-scoped response is already authorized by the server's marker
  // inventory. Keep every non-ephemeral item, including isolated Expert
  // directories; root filtering would hide them again in the renderer.
  const items = fetchedItems.filter((session) =>
    !isExpertCreationEphemeralSession(session?.id ?? ""),
  );
  const filteredItems = filterPendingDeletedSessions({
    workspaceId: input.workspaceId,
    items: toSidebarSessionItems(items),
  });
  const complete =
    typeof response === "object" && response !== null &&
    "complete" in response && typeof response.complete === "boolean"
      ? response.complete
      : true;
  const failures =
    typeof response === "object" && response !== null &&
    "failures" in response && Array.isArray(response.failures)
      ? response.failures
      : [];
  return { items: filteredItems, complete, failures };
}

/**
 * Register newly created Assistant sessions in the legacy Assistant-only
 * sidebar membership. Expert membership is derived from the server Directory;
 * its create paths optimistically upsert that derived identity instead of
 * restoring a second renderer-owned truth source.
 */
export function registerSidebarSessionPageMode(
  sessionId: string,
  pageMode?: "assistant" | "expert" | null,
): void {
  const id = sessionId.trim();
  if (!id) return;
  if (pageMode === "expert") return;
  // Default to assistant: office home + quick-capture + first-send.
  if (pageMode === "assistant" || pageMode == null) {
    addAssistantSession(id);
    writeAssistantSessionCategory(id, "office");
  }
}

export function insertSidebarSession(input: {
  current: Record<string, SidebarSessionItem[]>;
  workspaceId: string;
  session: unknown;
  /**
   * When set (or omitted for assistant default), register Assistant session
   * membership. Expert callers already upsert Directory-derived identity.
   */
  pageMode?: "assistant" | "expert" | null;
  /** Set false only when caller already registered via registerCreatedSessionStartIntent. */
  registerPageMode?: boolean;
}) {
  const existing = input.current[input.workspaceId] ?? [];
  const insertedSession = toSidebarSessionItem(input.session);
  if (!insertedSession) {
    return input.current;
  }
  if (existing.some((session) => session.id === insertedSession.id)) {
    // Session already listed but may lack isAssistantSession membership.
    // Register + clone the array so React re-renders and the filter re-runs.
    if (input.registerPageMode !== false) {
      registerSidebarSessionPageMode(insertedSession.id, input.pageMode);
      return {
        ...input.current,
        [input.workspaceId]: [...existing],
      };
    }
    return input.current;
  }
  if (isExpertCreationEphemeralSession(insertedSession.id)) {
    return input.current;
  }
  if (input.registerPageMode !== false) {
    registerSidebarSessionPageMode(insertedSession.id, input.pageMode);
  }
  return {
    ...input.current,
    [input.workspaceId]: [insertedSession, ...existing],
  };
}

export function filterExpertCreationEphemeralSessionsByWorkspace(
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>,
): Record<string, SidebarSessionItem[]> {
  return Object.fromEntries(
    Object.entries(sessionsByWorkspaceId).map(([workspaceId, sessions]) => [
      workspaceId,
      sessions.filter(
        (session) => !isExpertCreationEphemeralSession(session.id),
      ),
    ]),
  );
}

export function insertCreatedSessionForWorkspace(input: {
  current: Record<string, SidebarSessionItem[]>;
  createdSession: unknown;
  workspaceId: string;
  pageMode?: "assistant" | "expert" | null;
  /** Default true; first-send may pass false after registerCreatedSessionStartIntent. */
  registerPageMode?: boolean;
}) {
  return insertSidebarSession({
    current: input.current,
    workspaceId: input.workspaceId,
    session: input.createdSession,
    pageMode: input.pageMode,
    registerPageMode: input.registerPageMode,
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
  if (pendingIds.length === 0) {
    return input.fetched;
  }

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
  const currentItems = input.current[input.workspaceId] ?? [];
  // A successful empty list is not proof that the workspace has no sessions:
  // OpenCode can report an empty index while it is warming up. Keep an
  // already-rendered list in that case, while still applying delete tombstones
  // so an explicit user delete remains authoritative.
  if (input.fetched.length === 0 && currentItems.length > 0) {
    const retainedItems = filterPendingDeletedSessions({
      workspaceId: input.workspaceId,
      items: filterRecentlyDeletedSessions(currentItems),
    });
    return { ...input.current, [input.workspaceId]: retainedItems };
  }
  // Drop ids the user just deleted so a racing listSessions cannot resurrect
  // ghost/dirty rows while remote delete is still in flight or failed soft.
  const nextItems = filterPendingDeletedSessions({
    workspaceId: input.workspaceId,
    items: filterRecentlyDeletedSessions(
      input.merge(input.fetched, currentItems),
    ),
  });
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
  // Post-create snapshot: not cold-enter title thrash (empty selected chip ban).
  // Thrash ban is enforced on sidebar prefetch via tryRecordColdTitleSnapshot.
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
          sessionSnapshotFetchOptions(input.directory),
        )
      ).item;
      input.setQueryData(
        sessionSnapshotQueryKey(input.endpoint.workspaceId, input.sessionId),
        snapshot,
      );
      input.seedSessionState(input.endpoint.workspaceId, snapshot);
      // A newly created session can briefly expose metadata/system parts
      // before the first user turn is persisted. Stopping on any message
      // leaves the new session rendered without the prompt until a later
      // page switch refetches it.
      if (snapshot.messages.some((message) => message.info.role === "user"))
        return;
    } catch {
      continue;
    }
  }
}
