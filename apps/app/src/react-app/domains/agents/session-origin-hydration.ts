import { useSyncExternalStore } from "react";

const hydratedWorkspaceIds = new Set<string>();
const listeners = new Set<() => void>();

function normalizeWorkspaceId(workspaceId: string): string {
  return workspaceId.trim();
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function isSessionOriginHydrated(workspaceId: string): boolean {
  const id = normalizeWorkspaceId(workspaceId);
  return Boolean(id) && hydratedWorkspaceIds.has(id);
}

/** Tracks completed origin recovery independently from the session-list paint. */
export function markSessionOriginHydrated(workspaceId: string): void {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id || hydratedWorkspaceIds.has(id)) return;
  hydratedWorkspaceIds.add(id);
  notify();
}

export function useSessionOriginHydrated(workspaceId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => isSessionOriginHydrated(workspaceId),
    () => false,
  );
}

export function resetSessionOriginHydrationForTests(): void {
  hydratedWorkspaceIds.clear();
  notify();
}
