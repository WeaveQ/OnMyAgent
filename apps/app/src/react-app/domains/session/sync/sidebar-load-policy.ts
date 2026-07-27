/**
 * Cold-start / sidebar load policy.
 *
 * Goal: keep first paint interactive by avoiding N× full session snapshots and
 * oversized listSessions calls while OpenCode is still warming its index.
 */

/** Sidebar list page size — enough for the rail; history popovers can use more. */
export const SIDEBAR_SESSION_LIST_LIMIT = 40;

/** Max assistant-directory follow-up listSessions on cold path. */
export const SIDEBAR_ASSISTANT_DIRECTORY_LIST_LIMIT = 3;

/**
 * Max non-selected sessions that may request a lightweight preview snapshot
 * after the deferred warm phase. Selected session already loads via surface.
 */
export const SIDEBAR_PREVIEW_SNAPSHOT_MAX = 5;

/** Message limit for sidebar preview snapshots (not full transcript). */
export const SIDEBAR_PREVIEW_SNAPSHOT_MESSAGE_LIMIT = 8;

/**
 * Delay before any non-critical sidebar preview snapshots are allowed.
 * Keep well after cold listSessions so first-install OpenCode is not flooded.
 */
export const SIDEBAR_PREVIEW_SNAPSHOT_DEFER_MS = 4_000;

/** Non-selected expert tab titles wait until after the cold-start warm phase. */
export const TAB_TITLE_SNAPSHOT_DEFER_MS = 6_000;

/** Cap lightweight expert-tab title snapshots, including the selected tab. */
export const TAB_TITLE_SNAPSHOT_MAX = 8;

/** Delay before automation list polling starts (not needed for first paint). */
export const SIDEBAR_AUTOMATION_LIST_DEFER_MS = 2_500;

export function isDraftSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId?.startsWith("draft:"));
}

/**
 * Sessions allowed to fetch preview snapshots.
 * - Before defer: none (selected session uses the main surface snapshot),
 *   unless `prioritizeSelected` is set (tab titles need the focused session).
 * - After defer: up to max recent non-draft sessions.
 * - By default the selected id is excluded (surface already owns its transcript).
 *   Pass `includeSelected` when the consumer cannot reuse the surface snapshot
 *   (expert session tab chips).
 */
export function selectSidebarPreviewSessionIds(input: {
  sessions: Array<{ id: string }>;
  selectedSessionId?: string | null;
  deferred: boolean;
  maxPreviews?: number;
  /** Include the focused session in the deferred set (default false). */
  includeSelected?: boolean;
  /**
   * Always allow the focused session even before defer fires.
   * Used by expert tab titles so the active chip can leave "New session"
   * as soon as messages exist, without waiting for the warm-up delay.
   */
  prioritizeSelected?: boolean;
}): Set<string> {
  const selected = input.selectedSessionId?.trim() || "";
  const ids = new Set<string>();

  if (input.prioritizeSelected && selected && !isDraftSessionId(selected)) {
    const inList = input.sessions.some(
      (session) => session.id?.trim() === selected,
    );
    if (inList) ids.add(selected);
  }

  if (!input.deferred) return ids;

  const max = input.maxPreviews ?? SIDEBAR_PREVIEW_SNAPSHOT_MAX;
  for (const session of input.sessions) {
    if (ids.size >= max) break;
    const id = session.id?.trim();
    if (!id || isDraftSessionId(id)) continue;
    if (!input.includeSelected && id === selected) continue;
    ids.add(id);
  }
  return ids;
}

/**
 * Background session loads on route refresh: only the selected workspace.
 * Other workspaces load when the user switches to them.
 */
export function orderBackgroundSessionWorkspacesSelectedOnly(input: {
  workspaces: Array<{ id: string }>;
  selectedWorkspaceId: string;
}): Array<{ id: string }> {
  const selectedId = input.selectedWorkspaceId.trim();
  if (!selectedId) return [];
  const selected = input.workspaces.find(
    (workspace) => workspace.id === selectedId,
  );
  return selected ? [selected] : [];
}
