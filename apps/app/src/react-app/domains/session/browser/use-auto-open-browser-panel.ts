import { useEffect, useRef } from "react";

import { isElectronRuntime } from "@/app/utils";

import type { BrowserStatePayload } from "./use-browser-state";
import {
  filterTabsForSession,
  resolveBrowserSessionForPanel,
} from "./session-browser-tabs";

export function shouldRevealBrowserPanel(
  state: BrowserStatePayload,
  sessionId?: string | null,
): boolean {
  // Draft / new-task has no chat session id — never auto-open from foreign tabs.
  if (!sessionId) return false;
  const browserSessionId = resolveBrowserSessionForPanel(
    state.tabs ?? [],
    state.activeTabId,
    sessionId,
  );
  const tabs = filterTabsForSession(state.tabs ?? [], browserSessionId);
  if (tabs.length === 0) return false;
  const isLocalAgentWorkspaceScope = sessionId.split(":").length === 2
    && sessionId.startsWith("localAgent:");

  for (const tab of tabs) {
    const owner = tab.owner ?? "user";
    const url = String(tab.url ?? "").trim();
    const hasRealUrl = url.length > 0 && url !== "about:blank";
    const canRevealLocalAgentTab = !isLocalAgentWorkspaceScope
      || tab.deliverable === true
      || tab.handoff === true;
    if ((owner === "agent" || owner === "claimed") && hasRealUrl && canRevealLocalAgentTab) {
      return true;
    }
  }

  const active =
    tabs.find((tab) => tab.tabId === state.activeTabId || tab.isActive) ?? null;
  if (!active) return false;
  const activeUrl = String(active.url ?? state.url ?? "").trim();
  const canRevealActive = !isLocalAgentWorkspaceScope
    || active.deliverable === true
    || active.handoff === true;
  return activeUrl.length > 0
    && activeUrl !== "about:blank"
    && active.owner !== "user"
    && canRevealActive;
}

/**
 * Keep the right browser rail in sync with agent-driven in-app browser work
 * for the *current* chat session only.
 */
export function useAutoOpenBrowserPanel(
  openBrowserPanel: () => void,
  sessionId?: string | null,
) {
  const openRef = useRef(openBrowserPanel);
  openRef.current = openBrowserPanel;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!isElectronRuntime()) return;
    // No session → draft home / new-task: do not bind panel-open to global browser.
    if (!sessionId) return;
    const browser = window.__ONMYAGENT_ELECTRON__?.browser;
    if (!browser) return;

    const reveal = () => {
      if (!sessionIdRef.current) return;
      openRef.current();
    };

    const unsubOpen = browser.onPanelOpened?.(reveal);

    const unsubState = browser.onStateChange?.((state: BrowserStatePayload) => {
      if (shouldRevealBrowserPanel(state, sessionIdRef.current)) reveal();
    });

    void browser
      .getState?.()
      .then((state) => {
        if (state && shouldRevealBrowserPanel(state, sessionIdRef.current)) reveal();
      })
      .catch(() => undefined);

    return () => {
      unsubOpen?.();
      unsubState?.();
    };
  }, [sessionId]);
}
