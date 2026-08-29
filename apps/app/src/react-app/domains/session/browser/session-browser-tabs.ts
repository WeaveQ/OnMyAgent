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

/**
 * Local Agent keeps the right-rail shell at workspace scope while every MCP
 * Browser tab is isolated to one conversation. Resolve that aggregate shell
 * scope to the active conversation only; never merge tabs from sibling Local
 * Agent conversations into one panel.
 */
export function resolveBrowserSessionForPanel(
  tabs: BrowserTabInfo[],
  activeTabId: string | null | undefined,
  panelScopeId: string | null | undefined,
): string | null {
  if (!panelScopeId) return null;
  const segments = panelScopeId.split(":");
  if (segments.length !== 2 || segments[0] !== "localAgent") {
    return panelScopeId;
  }

  const conversationPrefix = `${panelScopeId}:`;
  const conversationTabs = tabs.filter((tab) =>
    String(tab.sessionId ?? "").startsWith(conversationPrefix),
  );
  const activeConversationTab = conversationTabs.find(
    (tab) => tab.tabId === activeTabId || tab.isActive,
  );
  if (activeConversationTab?.deliverable || activeConversationTab?.handoff) {
    return activeConversationTab.sessionId ?? panelScopeId;
  }
  if (tabs.some((tab) => tab.sessionId === panelScopeId)) return panelScopeId;
  return activeConversationTab?.sessionId ?? conversationTabs[0]?.sessionId ?? panelScopeId;
}
