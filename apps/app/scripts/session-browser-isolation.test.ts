import { describe, expect, test } from "bun:test";

import { filterTabsForSession } from "../src/react-app/domains/session/browser/session-browser-tabs";
import type { BrowserTabInfo } from "../src/react-app/domains/session/browser/use-browser-state";

function tab(partial: Partial<BrowserTabInfo> & Pick<BrowserTabInfo, "tabId">): BrowserTabInfo {
  return {
    tabId: partial.tabId,
    url: partial.url ?? "https://example.com",
    title: partial.title ?? partial.tabId,
    isActive: partial.isActive ?? false,
    canGoBack: partial.canGoBack ?? false,
    canGoForward: partial.canGoForward ?? false,
    isLoading: partial.isLoading ?? false,
    owner: partial.owner ?? "user",
    sessionId: partial.sessionId,
  };
}

describe("session browser isolation", () => {
  test("filterTabsForSession returns empty without a session scope", () => {
    const tabs = [
      tab({ tabId: "a", sessionId: "ses_a", url: "https://xiaohongshu.com" }),
      tab({ tabId: "b", sessionId: "ses_b" }),
    ];
    expect(filterTabsForSession(tabs, null)).toEqual([]);
    expect(filterTabsForSession(tabs, undefined)).toEqual([]);
    expect(filterTabsForSession(tabs, "")).toEqual([]);
  });

  test("filterTabsForSession only returns tabs bound to that session", () => {
    const tabs = [
      tab({ tabId: "a", sessionId: "ses_a", url: "https://xiaohongshu.com" }),
      tab({ tabId: "b", sessionId: "ses_b" }),
      tab({ tabId: "orphan" }),
    ];
    expect(filterTabsForSession(tabs, "ses_a").map((item) => item.tabId)).toEqual(["a"]);
    expect(filterTabsForSession(tabs, "ses_b").map((item) => item.tabId)).toEqual(["b"]);
  });

  test("auto-open and draft new-task wiring never fall back to all tabs", async () => {
    const [autoOpen, browserPanel, tabsHelper, assistant] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/browser/use-auto-open-browser-panel.ts",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/browser/browser-panel.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/browser/session-browser-tabs.ts",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/pages/assistant.tsx",
        import.meta.url,
      )).text(),
    ]);

    expect(tabsHelper).toContain("if (!sessionId) return [];");
    expect(tabsHelper).not.toContain("if (!sessionId) return tabs;");
    expect(autoOpen).toContain("if (!sessionId) return false;");
    expect(autoOpen).toContain("if (!sessionId) return;");
    expect(browserPanel).toContain("const activeTab = sessionActiveTab;");
    expect(browserPanel).not.toContain("getActiveTab(state)");
    expect(browserPanel).toContain("hasSessionScopedTabs ? (");
    expect(browserPanel).not.toContain("hasSessionScopedTabs || !sessionId");
    expect(assistant).toContain("browserSessionScopeId");
    expect(assistant).toContain("setSidePanelState(draftKey, null)");
    expect(assistant).toContain("if (!props.selectedSessionId) return;");
  });
});
