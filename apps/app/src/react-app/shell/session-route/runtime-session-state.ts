/**
 * Pure sidebar session map merges for SSE/runtime updates.
 * Kept out of render.tsx for file-size and unit testing.
 */
import type { SidebarSessionItem } from "../../../app/types";

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
  const nextSession = {
    ...list[index],
    ...update.info,
    id: update.sessionId,
  } as SidebarSessionItem;
  if (JSON.stringify(nextSession) === JSON.stringify(list[index])) {
    return current;
  }
  const nextList = [...list];
  nextList[index] = nextSession;
  return { ...current, [workspaceId]: nextList };
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
