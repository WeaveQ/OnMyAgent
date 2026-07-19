import { useEffect, useRef } from "react";

import { isElectronRuntime } from "@/app/utils";

import type { BrowserStatePayload } from "./use-browser-state";
import { filterTabsForSession } from "./session-browser-tabs";

function shouldRevealBrowserPanel(
  state: BrowserStatePayload,
  sessionId?: string | null,
): boolean {
  // Draft / 新建任务 has no chat session id — never auto-open from foreign tabs.
  if (!sessionId) return false;
  const tabs = filterTabsForSession(state.tabs ?? [], sessionId);
  if (tabs.length === 0) return false;

  for (const tab of tabs) {
    const owner = tab.owner ?? "user";
    const url = String(tab.url ?? "").trim();
    const hasRealUrl = url.length > 0 && url !== "about:blank";
    if ((owner === "agent" || owner === "claimed") && hasRealUrl) {
      return true;
    }
  }

  const active =
    tabs.find((tab) => tab.tabId === state.activeTabId || tab.isActive) ?? null;
  if (!active) return false;
  const activeUrl = String(active.url ?? state.url ?? "").trim();
  return activeUrl.length > 0 && activeUrl !== "about:blank" && active.owner !== "user";
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
    // No session → draft home / 新建任务: do not bind panel-open to global browser.
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
