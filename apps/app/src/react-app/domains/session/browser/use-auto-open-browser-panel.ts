import { useEffect, useRef } from "react";

import { isElectronRuntime } from "@/app/utils";

import type { BrowserStatePayload } from "./use-browser-state";

function shouldRevealBrowserPanel(state: BrowserStatePayload): boolean {
  const tabs = state.tabs ?? [];
  if (tabs.length === 0) return false;

  for (const tab of tabs) {
    const owner = tab.owner ?? "user";
    const url = String(tab.url ?? "").trim();
    const hasRealUrl = url.length > 0 && url !== "about:blank";
    // Agent / claimed automation surface — same UX expectation as openTarget().
    if ((owner === "agent" || owner === "claimed") && hasRealUrl) {
      return true;
    }
  }

  // Active non-blank tab while panel was closed (covers race where owner is missing).
  const active =
    tabs.find((tab) => tab.tabId === state.activeTabId || tab.isActive) ?? null;
  if (!active) return false;
  const activeUrl = String(active.url ?? state.url ?? "").trim();
  return activeUrl.length > 0 && activeUrl !== "about:blank" && active.owner !== "user";
}

/**
 * Keep the right browser rail in sync with agent-driven in-app browser work.
 *
 * Localhost link clicks already call setCurrentSidePanel("browser") in openTarget.
 * Agent tools only create tabs in the main process — this hook applies the same
 * UI step when:
 * - main sends panel-opened
 * - browser state shows an agent (or claimed) tab with a real URL
 * - getState() on mount finds such a tab already open
 */
export function useAutoOpenBrowserPanel(openBrowserPanel: () => void) {
  const openRef = useRef(openBrowserPanel);
  openRef.current = openBrowserPanel;

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const browser = window.__ONMYAGENT_ELECTRON__?.browser;
    if (!browser) return;

    const reveal = () => {
      openRef.current();
    };

    const unsubOpen = browser.onPanelOpened?.(reveal);

    const unsubState = browser.onStateChange?.((state: BrowserStatePayload) => {
      if (shouldRevealBrowserPanel(state)) reveal();
    });

    void browser
      .getState?.()
      .then((state) => {
        if (state && shouldRevealBrowserPanel(state)) reveal();
      })
      .catch(() => undefined);

    return () => {
      unsubOpen?.();
      unsubState?.();
    };
  }, []);
}
