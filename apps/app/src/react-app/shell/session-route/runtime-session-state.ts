/**
 * Pure sidebar session map merges for SSE/runtime updates.
 * Kept out of render.tsx for file-size and unit testing.
 */
import type { SidebarSessionItem } from "../../../app/types";

export type SidebarRuntimeUpdate =
  | {
      kind: "info";
      workspaceId: string;
      update: { sessionId: string; info: Record<string, unknown> };
    }
  | {
      kind: "status";
      workspaceId: string;
      update: { sessionId: string; status: unknown };
    };

/** Apply ordered runtime updates without crossing workspace boundaries. */
export function applyRuntimeSidebarUpdates(
  current: Record<string, SidebarSessionItem[]>,
  updates: readonly SidebarRuntimeUpdate[],
): Record<string, SidebarSessionItem[]> {
  let next = current;
  for (const event of updates) {
    next =
      event.kind === "info"
        ? applyRuntimeSessionInfoUpdate(next, event.workspaceId, event.update)
        : applyRuntimeSessionStatusUpdate(next, event.workspaceId, event.update);
  }
  return next;
}

/**
 * Merge runtime session metadata into the workspace list.
 * Returns the same `current` reference when nothing changed.
 */
export function applyRuntimeSessionInfoUpdate(
  current: Record<string, SidebarSessionItem[]>,
  workspaceId: string,
  update: { sessionId: string; info: Record<string, unknown> },
): Record<string, SidebarSessionItem[]> {
  const list = current[workspaceId] ?? [];
  const index = list.findIndex((session) => session.id === update.sessionId);
  if (index < 0) return current;
  const previous = list[index];
  const nextSession = mergeSidebarSessionMetadata(previous, update);
  if (nextSession === previous) {
    return current;
  }
  const nextList = [...list];
  nextList[index] = nextSession;
  return { ...current, [workspaceId]: nextList };
}

/**
 * Keep the sidebar's compact metadata contract small. OpenCode's
 * `session.updated` payload can carry fields irrelevant to the rail; copying
 * and JSON-stringifying those payloads on every event made busy workspaces
 * repeatedly block the renderer.
 */
function mergeSidebarSessionMetadata(
  previous: SidebarSessionItem,
  update: { sessionId: string; info: Record<string, unknown> },
): SidebarSessionItem {
  const info = update.info;
  const title = typeof info.title === "string" ? info.title : previous.title;
  const slug = readNullableString(info.slug, previous.slug);
  const parentID = readNullableString(info.parentID, previous.parentID);
  const directory = readNullableString(info.directory, previous.directory);
  const status = Object.hasOwn(info, "status") ? info.status : previous.status;
  const state = Object.hasOwn(info, "state") ? info.state : previous.state;
  const runStatus = Object.hasOwn(info, "runStatus")
    ? info.runStatus
    : previous.runStatus;
  const time = readSidebarTime(info.time, previous.time);

  if (
    previous.id === update.sessionId &&
    previous.title === title &&
    previous.slug === slug &&
    previous.parentID === parentID &&
    previous.directory === directory &&
    previous.status === status &&
    previous.state === state &&
    previous.runStatus === runStatus &&
    sameSidebarTime(previous.time, time)
  ) {
    return previous;
  }

  return {
    ...previous,
    id: update.sessionId,
    title,
    slug,
    parentID,
    directory,
    status,
    state,
    runStatus,
    time,
  };
}

function readNullableString(
  value: unknown,
  fallback: string | null | undefined,
): string | null | undefined {
  if (typeof value === "string" || value === null) return value;
  return fallback;
}

function readSidebarTime(
  value: unknown,
  fallback: SidebarSessionItem["time"],
): SidebarSessionItem["time"] {
  if (!value || typeof value !== "object") return fallback;
  const updated = "updated" in value ? value.updated : fallback?.updated;
  const created = "created" in value ? value.created : fallback?.created;
  if (
    (updated !== null && typeof updated !== "number") ||
    (created !== null && typeof created !== "number")
  ) {
    return fallback;
  }
  return { updated, created };
}

function sameSidebarTime(
  left: SidebarSessionItem["time"],
  right: SidebarSessionItem["time"],
): boolean {
  return left?.updated === right?.updated && left?.created === right?.created;
}

/**
 * Keep list-row `status` in sync with SSE so seed + activeSessionIds don't lag.
 * Returns the same `current` reference when nothing changed.
 */
export function applyRuntimeSessionStatusUpdate(
  current: Record<string, SidebarSessionItem[]>,
  workspaceId: string,
  update: { sessionId: string; status: unknown },
): Record<string, SidebarSessionItem[]> {
  const sessionId = update.sessionId?.trim() ?? "";
  if (!sessionId) return current;
  const list = current[workspaceId] ?? [];
  const index = list.findIndex((session) => session.id === sessionId);
  if (index < 0) return current;
  const prev = list[index];
  if (prev.status === update.status) return current;
  const nextList = [...list];
  nextList[index] = { ...prev, status: update.status };
  return { ...current, [workspaceId]: nextList };
}

export function resolveSessionModelAvailabilityBlocksTask(input: {
  runtimeKind: "opencode" | "grok-build" | null;
  unavailable: boolean;
}): boolean {
  // Grok uses a runtime-scoped catalog, not the OpenCode provider list.
  if (input.runtimeKind === "grok-build") return false;
  return input.unavailable;
}

/** Whether the composer may create a new task in the selected workspace. */
export function resolveSessionRouteCanCreateTask(input: {
  hasOpencodeClient: boolean;
  selectedWorkspaceId: string;
  loading: boolean;
  selectedWorkspaceError: string | null | undefined;
  modelAvailabilityBlocksTask: boolean;
}): boolean {
  return Boolean(
    input.hasOpencodeClient &&
      input.selectedWorkspaceId &&
      !input.loading &&
      !input.selectedWorkspaceError &&
      !input.modelAvailabilityBlocksTask,
  );
}

/** Preparing chrome while route data or model/workspace readiness is still settling. */
export function resolveSessionRouteShowPreparingStatus(input: {
  effectiveLoading: boolean;
  canCreateTask: boolean;
  routeError: string | null | undefined;
  selectedWorkspaceError: string | null | undefined;
}): boolean {
  return (
    input.effectiveLoading ||
    (!input.canCreateTask && !input.routeError && !input.selectedWorkspaceError)
  );
}
