import type { BrowserTabInfo } from "./use-browser-state";

/**
 * One logical browser per chat session: only page tabs bound to that session
 * are visible in its side panel. Agent tabs already carry sessionId from the
 * node-repl context; user tabs created from the panel pass sessionId explicitly.
 *
 * When sessionId is missing (draft home / new task with no chat id yet), return
 * an empty list — never fall back to every workspace tab, or another session's
 * browser bleeds into new-task draft home.
 */
export function filterTabsForSession(
  tabs: BrowserTabInfo[],
  sessionId: string | null | undefined,
): BrowserTabInfo[] {
  if (!sessionId) return [];
  return tabs.filter((tab) => tab.sessionId === sessionId);
}
