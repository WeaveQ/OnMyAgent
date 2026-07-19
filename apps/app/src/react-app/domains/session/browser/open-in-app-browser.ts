import { isElectronRuntime } from "@/app/utils";

import { filterTabsForSession } from "./session-browser-tabs";
import type { BrowserTabInfo } from "./use-browser-state";

/** Default home only for explicit user "open empty browser" / new-tab actions. */
export const BROWSER_HOME_URL = "https://www.baidu.com";

/**
 * Same sequence as clicking a localhost link in the transcript:
 * 1) expand the right side panel to "browser"
 * 2) create/select a page tab when needed (session-scoped)
 *
 * Rules:
 * - `url` set → open that URL (automation / link / agent target). Never force Baidu.
 * - `seedHomeWhenEmpty: true` (user clicked browser rail) → if this session already
 *   has any page tab, just select it; only seed Baidu when there is no tab yet.
 * - neither → only open the panel (and reselect existing session tab if any).
 *
 * Agent automation must reach the same UI effect (via panel-opened / state),
 * not only create a WebContentsView in the main process.
 */
export async function openInAppBrowser(input: {
  openSidePanel: () => void;
  url?: string | null;
  sessionId?: string | null;
  /** User rail click: seed Baidu only when the session has zero page tabs. */
  seedHomeWhenEmpty?: boolean;
}): Promise<{ tabId?: string }> {
  if (!isElectronRuntime()) {
    input.openSidePanel();
    if (input.url) {
      window.open(input.url, "_blank", "noopener,noreferrer");
    }
    return {};
  }

  const browser = window.__ONMYAGENT_ELECTRON__?.browser;
  if (!browser) {
    // Still open the shell so the user sees the panel even if the bridge is down.
    input.openSidePanel();
    throw new Error("Browser bridge is unavailable.");
  }

  const createTab = browser.createTab;
  if (!createTab) {
    input.openSidePanel();
    throw new Error("Browser createTab is unavailable.");
  }

  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId.trim()
      : undefined;
  const sessionOpts = sessionId ? { sessionId } : undefined;
  const url = typeof input.url === "string" ? input.url.trim() : "";

  // Prefer creating/selecting the page tab *before* opening the side panel so
  // BrowserPanel's first paint already has session tabs (viewport active=true).
  let tabId: string | undefined;

  if (url) {
    const created = await createTab(url, sessionOpts);
    tabId = created?.tabId;
  } else {
    const state = await browser.getState?.().catch(() => null);
    const tabs = Array.isArray(state?.tabs)
      ? (state.tabs as BrowserTabInfo[])
      : [];
    const scoped = filterTabsForSession(tabs, sessionId ?? null);

    if (scoped.length > 0) {
      const active =
        scoped.find((tab) => tab.isActive || tab.tabId === state?.activeTabId) ??
        scoped[0];
      if (active?.tabId && browser.selectTab) {
        await browser.selectTab(active.tabId).catch(() => undefined);
      }
      tabId = active?.tabId;
    } else if (input.seedHomeWhenEmpty) {
      // Empty session + user open: seed Baidu. Agent paths omit seedHomeWhenEmpty.
      const created = await createTab(BROWSER_HOME_URL, sessionOpts);
      tabId = created?.tabId;
      await browser.getState?.().catch(() => null);
    }
  }

  input.openSidePanel();
  return { tabId };
}
