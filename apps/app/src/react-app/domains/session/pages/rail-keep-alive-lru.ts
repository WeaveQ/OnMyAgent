/**
 * Pure LRU policy for secondary rail keep-alive panes.
 *
 * Primary conversation rails (assistant/chat) and non-pane views stay in the
 * visited set without counting against the secondary budget. Secondary panes
 * are capped so we do not keep every store/files/billing mount forever.
 *
 * Keys live here (not session-page-shell) so keep-alive-pane can import the
 * pure helper without a cycle through the shell component module.
 */

export type SessionRailPaneKey =
  | "agents"
  | "store"
  | "company"
  | "localAgent"
  | "agentManagement"
  | "files"
  | "projects"
  | "knowledgeBase"
  | "devices"
  | "channels"
  | "billing";

/** Secondary rail panes that use visited-set keep-alive. */
export const SESSION_RAIL_KEEP_ALIVE_PANE_KEYS = [
  "agents",
  "store",
  "company",
  "localAgent",
  "agentManagement",
  "files",
  "projects",
  "knowledgeBase",
  "devices",
  "channels",
  "billing",
] as const satisfies readonly SessionRailPaneKey[];

/** Default max secondary keep-alive panes (store, files, localAgent, …). */
export const DEFAULT_SECONDARY_RAIL_KEEP_ALIVE_MAX = 3;

const SECONDARY_PANE_KEY_SET = new Set<string>(SESSION_RAIL_KEEP_ALIVE_PANE_KEYS);

export function isSecondaryRailKeepAliveKey(
  key: string,
): key is SessionRailPaneKey {
  return SECONDARY_PANE_KEY_SET.has(key);
}

/**
 * Return the next visited-rail ordered set after opening `key`.
 *
 * - Order is LRU: oldest first, most recently visited last.
 * - Re-visiting a key moves it to the end.
 * - Non-secondary keys are never evicted by the secondary budget.
 * - Secondary keys are trimmed to the last `max` entries.
 */
export function nextVisitedRailViews(
  prev: Iterable<string>,
  key: string,
  max: number = DEFAULT_SECONDARY_RAIL_KEEP_ALIVE_MAX,
): Set<string> {
  const ordered = [...prev].filter((entry) => entry !== key);
  ordered.push(key);

  if (!Number.isFinite(max) || max < 0) {
    return new Set(ordered);
  }

  const nonSecondary: string[] = [];
  const secondary: string[] = [];
  for (const entry of ordered) {
    if (isSecondaryRailKeepAliveKey(entry)) {
      secondary.push(entry);
    } else {
      nonSecondary.push(entry);
    }
  }

  const keptSecondary =
    max === 0 ? [] : secondary.length <= max ? secondary : secondary.slice(-max);

  return new Set([...nonSecondary, ...keptSecondary]);
}
