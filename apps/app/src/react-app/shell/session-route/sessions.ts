import { getDisplaySessionTitle } from "../../../app/lib/session-title";
import type { SidebarSessionItem } from "../../../app/types";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { OnMyAgentServerError } from "../../../app/lib/onmyagent-server/client-shared";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type { SessionOriginRecord } from "@onmyagent/types/server";
import { t } from "../../../i18n";
import {
  addAssistantSession,
  isExpertCreationEphemeralSession,
  isExpertSession,
} from "../../domains/agents";
import {
  SIDEBAR_ASSISTANT_DIRECTORY_LIST_LIMIT,
  SIDEBAR_SESSION_LIST_LIMIT,
  filterPendingDeletedSessions,
  filterRecentlyDeletedSessions,
  sessionSnapshotFetchOptions,
  sessionSnapshotQueryKey,
} from "../../domains/session";
import type { RouteWorkspace } from "./model";
import { getSessionStatus, isActiveSessionStatus } from "./state";
import type { SessionOption as PaletteSessionOption } from "../command-palette";

export type PendingCreatedSessionMap = Record<string, Record<string, number>>;

/**
 * Origin-directory recovery is deliberately a second phase of cold start.
 * Keep it small: primary list paint must not wait for arbitrary expert and
 * assistant directories, and a large origin file must not fan out requests.
 */
export const SESSION_ORIGIN_DIRECTORY_RECOVERY_CONCURRENCY = 2;
/**
 * A workspace can contain many isolated expert directories. Bound one recovery
 * pass so a stale or unusually large origin index cannot turn cold start into
 * an unbounded request fan-out.
 */
export const SESSION_ORIGIN_DIRECTORY_RECOVERY_MAX_TARGETS = 40;

type SessionDirectoryListClient = {
  listSessions: (
    workspaceId: string,
    options?: { limit?: number; directory?: string },
  ) => Promise<{ items: unknown[] }>;
  getSession?: (
    workspaceId: string,
    sessionId: string,
    options?: { directory?: string },
  ) => Promise<{ item: unknown }>;
};

export type OriginDirectorySessionRecovery = {
  items: SidebarSessionItem[];
  /** False means a durable origin is still unknown; callers must not show an empty state. */
  complete: boolean;
  /** A non-null value asks the caller to run the next bounded exact page. */
  nextOffset: number | null;
  /** Exact reads that conclusively prove an old origin no longer exists. */
  missingSessionIds: string[];
};

type OriginDirectoryRecoveryInput = {
  client: SessionDirectoryListClient;
  workspaceId: string;
  originWorkspaceId: string;
  primaryItems: SidebarSessionItem[];
  /** Sessions already verified by earlier exact pages in this recovery cycle. */
  verifiedItems?: SidebarSessionItem[];
  /** Exact 404/410 results already accepted as stale in earlier pages. */
  verifiedMissingSessionIds?: ReadonlySet<string>;
  origins: SessionOriginRecord[];
  limit: number;
};

/**
 * Recover the exact sessions recorded in durable origin metadata. Normal
 * workspaces use one bounded list per directory; large directory sets switch
 * to exact gets in pages so a single cold-start pass never creates thousands
 * of simultaneous requests.
 */
export async function recoverOriginDirectorySessionItemsWithStatus(
  input: OriginDirectoryRecoveryInput,
): Promise<OriginDirectorySessionRecovery> {
  const knownIds = new Set([
    ...input.primaryItems.map((item) => item.id),
    ...(input.verifiedItems ?? []).map((item) => item.id),
  ]);
  const expectedIdsByDirectory = new Map<string, Set<string>>();
  const expectedOrigins: Array<{ sessionId: string; directory: string }> = [];
  const expectedOriginIds = new Set<string>();
  let hasUnrecoverableOrigin = false;

  for (const origin of input.origins) {
    const directory = origin.directory?.trim();
    if (input.verifiedMissingSessionIds?.has(origin.sessionId)) continue;
    if (
      origin.workspaceId === input.originWorkspaceId &&
      origin.sessionId &&
      !knownIds.has(origin.sessionId) &&
      !directory
    ) {
      hasUnrecoverableOrigin = true;
      continue;
    }
    if (
      origin.workspaceId !== input.originWorkspaceId ||
      !directory ||
      !origin.sessionId ||
      knownIds.has(origin.sessionId)
    ) {
      continue;
    }
    const expectedIds = expectedIdsByDirectory.get(directory) ?? new Set<string>();
    expectedIds.add(origin.sessionId);
    expectedIdsByDirectory.set(directory, expectedIds);
    if (!expectedOriginIds.has(origin.sessionId)) {
      expectedOriginIds.add(origin.sessionId);
      expectedOrigins.push({ sessionId: origin.sessionId, directory });
    }
  }

  const directoryEntries = Array.from(expectedIdsByDirectory.entries());
  const recovered: SidebarSessionItem[] = [];
  const useExactPages =
    directoryEntries.length > SESSION_ORIGIN_DIRECTORY_RECOVERY_MAX_TARGETS;
  let directoryReadsComplete = true;

  if (!useExactPages) {
    for (
      let start = 0;
      start < directoryEntries.length;
      start += SESSION_ORIGIN_DIRECTORY_RECOVERY_CONCURRENCY
    ) {
      const batch = directoryEntries.slice(
        start,
        start + SESSION_ORIGIN_DIRECTORY_RECOVERY_CONCURRENCY,
      );
      const results = await Promise.allSettled(
        batch.map(async ([directory, expectedIds]) => {
          const response = await input.client.listSessions(input.workspaceId, {
            limit: input.limit,
            directory,
          });
          return toSidebarSessionItems(response.items).filter((item) =>
            expectedIds.has(item.id),
          );
        }),
      );
      for (const result of results) {
        if (result.status !== "fulfilled") {
          directoryReadsComplete = false;
          continue;
        }
        for (const item of result.value) {
          if (knownIds.has(item.id)) continue;
          knownIds.add(item.id);
          recovered.push(item);
        }
      }
    }
  }

  // A directory list is still a bounded page. Any known origin id it did not
  // return is recovered by its exact id, including the important case where a
  // single expert directory contains more sessions than `limit`.
  const exactCandidates = expectedOrigins.filter(
    (origin) => !knownIds.has(origin.sessionId),
  );
  if (!directoryReadsComplete) {
    return {
      items: recovered,
      complete: false,
      nextOffset: null,
      missingSessionIds: [],
    };
  }
  if (hasUnrecoverableOrigin) {
    return {
      items: recovered,
      complete: false,
      nextOffset: null,
      missingSessionIds: [],
    };
  }
  if (exactCandidates.length === 0) {
    return {
      items: recovered,
      complete: true,
      nextOffset: null,
      missingSessionIds: [],
    };
  }
  const getSession = input.client.getSession;
  if (!getSession) {
    return {
      items: recovered,
      complete: false,
      nextOffset: null,
      missingSessionIds: [],
    };
  }
  const page = exactCandidates.slice(
    0,
    SESSION_ORIGIN_DIRECTORY_RECOVERY_MAX_TARGETS,
  );
  let exactReadsComplete = true;
  const missingSessionIds: string[] = [];
  for (
    let start = 0;
    start < page.length;
    start += SESSION_ORIGIN_DIRECTORY_RECOVERY_CONCURRENCY
  ) {
    const batch = page.slice(
      start,
      start + SESSION_ORIGIN_DIRECTORY_RECOVERY_CONCURRENCY,
    );
    const results = await Promise.allSettled(
      batch.map(async (origin) => {
        try {
          const response = await getSession(input.workspaceId, origin.sessionId, {
            directory: origin.directory,
          });
          return {
            expectedId: origin.sessionId,
            item: toSidebarSessionItem(response.item),
            missing: false,
          };
        } catch (error) {
          return {
            expectedId: origin.sessionId,
            item: null,
            missing: isAuthoritativeSessionMissing(error),
          };
        }
      }),
    );
    for (const result of results) {
      if (result.status !== "fulfilled") {
        exactReadsComplete = false;
        continue;
      }
      const { expectedId, item, missing } = result.value;
      if (missing) {
        missingSessionIds.push(expectedId);
        continue;
      }
      if (!item || item.id !== expectedId) {
        exactReadsComplete = false;
        continue;
      }
      if (knownIds.has(item.id)) continue;
      knownIds.add(item.id);
      recovered.push(item);
    }
  }
  const hasNextPage = exactCandidates.length > page.length;
  return {
    items: recovered,
    complete:
      exactReadsComplete && !hasNextPage,
    nextOffset:
      exactReadsComplete && hasNextPage
        ? 0
        : exactReadsComplete
          ? null
          : 0,
    missingSessionIds,
  };
}

function isAuthoritativeSessionMissing(error: unknown): boolean {
  return (
    error instanceof OnMyAgentServerError &&
    (error.status === 404 || error.status === 410)
  );
}

export async function recoverOriginDirectorySessionItems(
  input: OriginDirectoryRecoveryInput,
): Promise<SidebarSessionItem[]> {
  const result = await recoverOriginDirectorySessionItemsWithStatus(input);
  return result.items;
}

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
  if (isExpertSession(input.sessionId)) return true;
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
  /** When false, skip per-directory follow-up lists (faster cold path). */
  includeAssistantDirectories?: boolean;
}) {
  const limit = input.limit ?? SIDEBAR_SESSION_LIST_LIMIT;
  const response = await input.client.listSessions(input.workspaceId, {
    limit,
  });
  const assistantSessionIds = new Set(
    input.assistantSessionRecords.map((item) => item.sessionId),
  );
  const includeAssistantDirectories = input.includeAssistantDirectories !== false;
  const assistantDirectories = includeAssistantDirectories
    ? Array.from(
        new Set(
          input.assistantSessionRecords.map((item) => item.directory.trim()),
        ),
      )
        .filter(Boolean)
        .slice(0, SIDEBAR_ASSISTANT_DIRECTORY_LIST_LIMIT)
    : [];
  const primaryIds = new Set(
    (response.items ?? []).map((item) => item.id).filter(Boolean),
  );
  // Only directory-list for assistant sessions missing from the primary page.
  const missingAssistant = input.assistantSessionRecords.some(
    (record) =>
      record.sessionId &&
      !primaryIds.has(record.sessionId) &&
      record.directory?.trim(),
  );
  const assistantDirectoryResults =
    missingAssistant && assistantDirectories.length > 0
      ? await Promise.allSettled(
          assistantDirectories.map(async (directory) => {
            const result = await input.client.listSessions(input.workspaceId, {
              limit,
              directory,
            });
            return result.items.filter((item) =>
              assistantSessionIds.has(item.id),
            );
          }),
        )
      : [];
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
  const items = normalizedWorkspaceRoot && !input.isRemoteOnMyAgentWorkspace
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
  return filterPendingDeletedSessions({
    workspaceId: input.workspaceId,
    items: toSidebarSessionItems(items),
  });
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
  if (isExpertCreationEphemeralSession(insertedSession.id)) {
    return input.current;
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
  /** Preserve cached isolated experts only while durable origin recovery runs. */
  preserveExpertSessions?: boolean;
  now: number;
}) {
  const pending = input.pendingByWorkspaceId[input.workspaceId];
  const pendingIds = Object.keys(pending ?? {});
  if (pendingIds.length === 0 && !input.preserveExpertSessions) {
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
    // A primary workspace-root list cannot observe isolated expert directories.
    // Keep the cached expert row until durable origin recovery proves its
    // current state; explicit delete removes this local expert identity first.
    if (input.preserveExpertSessions && isExpertSession(id)) return true;
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

/** Keep recovery idempotent when origin hydration retries overlap a fresh list. */
export function mergeRecoveredSessionsWithCurrent(
  recovered: SidebarSessionItem[],
  current: SidebarSessionItem[],
): SidebarSessionItem[] {
  const byId = new Map<string, SidebarSessionItem>();
  for (const item of [...recovered, ...current]) {
    if (item.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values());
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
