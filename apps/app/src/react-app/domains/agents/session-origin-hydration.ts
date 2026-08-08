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

/**
 * Origin recovery may finish before the primary session list. Do not expose a
 * definitive expert state until both observations have completed.
 */
export function createSessionOriginHydrationGate(workspaceId: string) {
  let primaryListSettled = false;
  let originRecoverySettled = false;

  const completeWhenReady = () => {
    if (!primaryListSettled || !originRecoverySettled) return;
    markSessionOriginHydrated(workspaceId);
  };

  return {
    markPrimaryListSettled: () => {
      primaryListSettled = true;
      completeWhenReady();
    },
    markOriginRecoverySettled: () => {
      originRecoverySettled = true;
      completeWhenReady();
    },
    /** A terminal primary-list failure must not leave the UI loading forever. */
    markTerminalFailure: () => markSessionOriginHydrated(workspaceId),
  };
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
