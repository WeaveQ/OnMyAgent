/**
 * Soft-archive for assistant tasks (workspace-scoped localStorage).
 * Pure list helpers stay free of window for unit tests.
 */

export const ASSISTANT_ARCHIVED_TASKS_STORAGE_KEY =
  "onmyagent.assistantArchivedTasks.v1";

export const assistantArchivedTasksChangedEvent =
  "onmyagent:assistant-archived-tasks-changed";

export type AssistantArchivedTask = {
  sessionId: string;
  title: string;
  directory?: string | null;
  archivedAt: number;
  category?: string | null;
};

export function resolveOpenFolderPath(
  directory: string | null | undefined,
): string | null {
  const path = directory?.trim();
  return path ? path : null;
}

export function isArchivedSessionId(
  archivedIds: ReadonlySet<string> | ReadonlyArray<string>,
  sessionId: string,
): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  if (archivedIds instanceof Set) return archivedIds.has(id);
  return (archivedIds as ReadonlyArray<string>).includes(id);
}

export function filterGroupsExcludingArchived<
  T extends { latestSession: { id: string } },
>(groups: ReadonlyArray<T>, archivedIds: ReadonlySet<string>): T[] {
  return groups.filter(
    (group) => !isArchivedSessionId(archivedIds, group.latestSession.id),
  );
}

export function archiveTaskInList(
  tasks: ReadonlyArray<AssistantArchivedTask>,
  entry: AssistantArchivedTask,
): AssistantArchivedTask[] {
  const sessionId = entry.sessionId.trim();
  if (!sessionId) return [...tasks];
  const next = tasks.filter((item) => item.sessionId !== sessionId);
  next.unshift({
    sessionId,
    title: entry.title.trim() || sessionId,
    directory: entry.directory?.trim() || null,
    archivedAt: entry.archivedAt > 0 ? entry.archivedAt : Date.now(),
    category: entry.category?.trim() || null,
  });
  return next;
}

export function restoreTaskFromList(
  tasks: ReadonlyArray<AssistantArchivedTask>,
  sessionId: string,
): AssistantArchivedTask[] {
  const id = sessionId.trim();
  if (!id) return [...tasks];
  return tasks.filter((item) => item.sessionId !== id);
}

export function permanentlyRemoveFromList(
  tasks: ReadonlyArray<AssistantArchivedTask>,
  sessionId: string,
): AssistantArchivedTask[] {
  return restoreTaskFromList(tasks, sessionId);
}

export function archivedSessionIdSet(
  tasks: ReadonlyArray<AssistantArchivedTask>,
): Set<string> {
  return new Set(tasks.map((item) => item.sessionId).filter(Boolean));
}

function readAllRecord(): Record<string, AssistantArchivedTask[]> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(ASSISTANT_ARCHIVED_TASKS_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, AssistantArchivedTask[]> = {};
    for (const [workspaceId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!Array.isArray(value)) continue;
      out[workspaceId] = value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const sessionId =
          typeof row.sessionId === "string" ? row.sessionId.trim() : "";
        if (!sessionId) return [];
        const title =
          typeof row.title === "string" && row.title.trim()
            ? row.title.trim()
            : sessionId;
        const directory =
          typeof row.directory === "string" && row.directory.trim()
            ? row.directory.trim()
            : null;
        const archivedAt =
          typeof row.archivedAt === "number" && Number.isFinite(row.archivedAt)
            ? row.archivedAt
            : Date.now();
        const category =
          typeof row.category === "string" && row.category.trim()
            ? row.category.trim()
            : null;
        return [{ sessionId, title, directory, archivedAt, category }];
      });
    }
    return out;
  } catch {
    return {};
  }
}

function writeAllRecord(record: Record<string, AssistantArchivedTask[]>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ASSISTANT_ARCHIVED_TASKS_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function readAssistantArchivedTasks(
  workspaceId: string,
): AssistantArchivedTask[] {
  const id = workspaceId.trim();
  if (!id) return [];
  return readAllRecord()[id] ?? [];
}

export function writeAssistantArchivedTasks(
  workspaceId: string,
  tasks: ReadonlyArray<AssistantArchivedTask>,
) {
  const id = workspaceId.trim();
  if (!id) return;
  const record = readAllRecord();
  if (tasks.length === 0) delete record[id];
  else record[id] = [...tasks];
  writeAllRecord(record);
}

export function dispatchAssistantArchivedTasksChanged(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(assistantArchivedTasksChangedEvent, {
      detail: { workspaceId: workspaceId.trim() },
    }),
  );
}

export function archiveAssistantTask(
  workspaceId: string,
  entry: AssistantArchivedTask,
) {
  const next = archiveTaskInList(
    readAssistantArchivedTasks(workspaceId),
    entry,
  );
  writeAssistantArchivedTasks(workspaceId, next);
  dispatchAssistantArchivedTasksChanged(workspaceId);
  return next;
}

export function restoreAssistantArchivedTask(
  workspaceId: string,
  sessionId: string,
) {
  const next = restoreTaskFromList(
    readAssistantArchivedTasks(workspaceId),
    sessionId,
  );
  writeAssistantArchivedTasks(workspaceId, next);
  dispatchAssistantArchivedTasksChanged(workspaceId);
  return next;
}

export function permanentlyRemoveAssistantArchivedTask(
  workspaceId: string,
  sessionId: string,
) {
  const next = permanentlyRemoveFromList(
    readAssistantArchivedTasks(workspaceId),
    sessionId,
  );
  writeAssistantArchivedTasks(workspaceId, next);
  dispatchAssistantArchivedTasksChanged(workspaceId);
  return next;
}
