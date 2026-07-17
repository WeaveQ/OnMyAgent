import type { BrowserTabInfo } from "./use-browser-state";

/**
 * One logical browser per chat session: only page tabs bound to that session
 * are visible in its side panel. Agent tabs already carry sessionId from the
 * node-repl context; user tabs created from the panel pass sessionId explicitly.
 */
export function filterTabsForSession(
  tabs: BrowserTabInfo[],
  sessionId: string | null | undefined,
): BrowserTabInfo[] {
  if (!sessionId) return tabs;
  return tabs.filter((tab) => tab.sessionId === sessionId);
}
