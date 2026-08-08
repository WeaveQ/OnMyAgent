import { useSyncExternalStore } from "react";

const hydratedWorkspaceIds = new Set<string>();
const degradedWorkspaceIds = new Set<string>();
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

export function isSessionOriginHydrationDegraded(workspaceId: string): boolean {
  const id = normalizeWorkspaceId(workspaceId);
  return Boolean(id) && degradedWorkspaceIds.has(id);
}

/** Tracks completed origin recovery independently from the session-list paint. */
export function markSessionOriginHydrated(workspaceId: string): void {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) return;
  const changed = !hydratedWorkspaceIds.has(id) || degradedWorkspaceIds.has(id);
  hydratedWorkspaceIds.add(id);
  degradedWorkspaceIds.delete(id);
  if (changed) notify();
}

/**
 * Stop automatic retries without turning an unknown recovery into an empty
 * screen. The caller retains its last known sidebar state and a later refresh
 * may attempt a normal hydration again.
 */
export function markSessionOriginHydrationDegraded(workspaceId: string): void {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) return;
  const changed =
    !hydratedWorkspaceIds.has(id) || !degradedWorkspaceIds.has(id);
  hydratedWorkspaceIds.add(id);
  degradedWorkspaceIds.add(id);
  if (changed) notify();
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
    /** Bounded retries are exhausted; retain cached state but stop loading. */
    markOriginRecoveryDegraded: () =>
      markSessionOriginHydrationDegraded(workspaceId),
    /**
     * An unavailable primary list is not proof that there are no origin
     * sessions. Keep the state non-definitive until a later load completes.
     */
    markTerminalFailure: () =>
      markSessionOriginHydrationDegraded(workspaceId),
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

export function useSessionOriginHydrationDegraded(
  workspaceId: string,
): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => isSessionOriginHydrationDegraded(workspaceId),
    () => false,
  );
}

export function resetSessionOriginHydrationForTests(): void {
  hydratedWorkspaceIds.clear();
  degradedWorkspaceIds.clear();
  notify();
}
