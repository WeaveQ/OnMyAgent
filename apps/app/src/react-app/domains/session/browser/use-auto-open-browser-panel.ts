import { useEffect, useRef } from "react";

import { isElectronRuntime } from "@/app/utils";

import type { BrowserStatePayload } from "./use-browser-state";

/**
 * When the agent creates/navigates an in-app browser tab, expand the browser
 * side panel even if the user never clicked the rail. Covers:
 * - main process `panel-opened` IPC
 * - browser state updates (fallback if IPC is missed or arrives before mount)
 */
export function useAutoOpenBrowserPanel(openBrowserPanel: () => void) {
  const openRef = useRef(openBrowserPanel);
  openRef.current = openBrowserPanel;
  const seenAgentTabsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const browser = window.__ONMYAGENT_ELECTRON__?.browser;
    if (!browser) return;

    const openFromAgent = () => {
      openRef.current();
    };

    const unsubOpen = browser.onPanelOpened?.(openFromAgent);
    const unsubClose = browser.onPanelClosed?.(() => {
      // Keep seen set so a later new agent tab still re-opens.
    });

    const considerState = (state: BrowserStatePayload) => {
      const tabs = state.tabs ?? [];
      let shouldOpen = false;
      for (const tab of tabs) {
        const owner = tab.owner ?? "user";
        const url = String(tab.url ?? "").trim();
        const isAgentSurface =
          (owner === "agent" || owner === "claimed") &&
          url.length > 0 &&
          url !== "about:blank";
        if (!isAgentSurface) continue;
        if (!seenAgentTabsRef.current.has(tab.tabId)) {
          seenAgentTabsRef.current.add(tab.tabId);
          shouldOpen = true;
        }
        // Always re-open when the active tab is agent-owned with a real URL,
        // so a closed rail comes back on the next agent navigation.
        if (tab.tabId === state.activeTabId || tab.isActive) {
          shouldOpen = true;
        }
      }
      if (shouldOpen) openFromAgent();
    };

    const unsubState = browser.onStateChange?.((state: BrowserStatePayload) => {
      considerState(state);
    });

    // Catch tabs that already exist when the page mounts (event fired earlier).
    void browser.getState?.().then((state) => {
      if (state) considerState(state);
    }).catch(() => undefined);

    return () => {
      unsubOpen?.();
      unsubClose?.();
      unsubState?.();
    };
  }, []);
}
