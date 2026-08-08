import { useSyncExternalStore } from "react";

const hydratedWorkspaceIds = new Set<string>();
const listeners = new Set<() => void>();

export const SESSION_ORIGIN_RECOVERY_MAX_RETRIES = 3;

/** Returns a bounded retry delay, or null once automatic recovery is exhausted. */
export function getSessionOriginRecoveryRetryDelayMs(
  completedRetries: number,
): number | null {
  if (completedRetries >= SESSION_ORIGIN_RECOVERY_MAX_RETRIES) return null;
  return 500 * (completedRetries + 1);
}

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
    /** Failed or partial recovery intentionally remains non-definitive. */
    markOriginRecoveryFailed: () => undefined,
    /**
     * An unavailable primary list is not proof that there are no origin
     * sessions. Keep the state non-definitive until a later load completes.
     */
    markTerminalFailure: () => undefined,
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
