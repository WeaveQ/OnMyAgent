import { describe, expect, test } from "bun:test";

import {
  filterTabsForSession,
  resolveBrowserSessionForPanel,
} from "../src/react-app/domains/session/browser/session-browser-tabs";
import type { BrowserTabInfo } from "../src/react-app/domains/session/browser/use-browser-state";
import { shouldRevealBrowserPanel } from "../src/react-app/domains/session/browser/use-auto-open-browser-panel";

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
    temporary: partial.temporary,
    deliverable: partial.deliverable,
    handoff: partial.handoff,
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

  test("Local Agent workspace panel resolves only the active conversation session", () => {
    const tabs = [
      tab({ tabId: "conv-a", sessionId: "localAgent:ws_123:conversation-a" }),
      tab({ tabId: "conv-b", sessionId: "localAgent:ws_123:conversation-b", isActive: true }),
      tab({ tabId: "other", sessionId: "localAgent:ws_999:conversation-c" }),
    ];

    const resolved = resolveBrowserSessionForPanel(
      tabs,
      "conv-b",
      "localAgent:ws_123",
    );

    expect(resolved).toBe("localAgent:ws_123:conversation-b");
    expect(filterTabsForSession(tabs, resolved).map((item) => item.tabId)).toEqual(["conv-b"]);
  });

  test("ordinary Expert and Assistant session scopes remain exact", () => {
    const tabs = [
      tab({ tabId: "expert", sessionId: "ses_expert" }),
      tab({ tabId: "local", sessionId: "localAgent:ws_123:conversation-a", isActive: true }),
    ];

    expect(resolveBrowserSessionForPanel(tabs, "local", "ses_expert")).toBe("ses_expert");
    expect(filterTabsForSession(tabs, "ses_expert").map((item) => item.tabId)).toEqual(["expert"]);
  });

  test("temporary Local Agent Browser work stays background-only", () => {
    const tabs = [
      tab({
        tabId: "background",
        sessionId: "localAgent:ws_123:conversation-a",
        owner: "agent",
        temporary: true,
        isActive: true,
      }),
    ];

    expect(shouldRevealBrowserPanel({
      url: tabs[0].url,
      title: tabs[0].title,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      activeTabId: "background",
      tabs,
    }, "localAgent:ws_123")).toBe(false);
  });

  test("explicit Local Agent deliverable overrides a manual workspace tab", () => {
    const tabs = [
      tab({ tabId: "manual", sessionId: "localAgent:ws_123", owner: "user" }),
      tab({
        tabId: "handoff",
        sessionId: "localAgent:ws_123:conversation-a",
        owner: "agent",
        deliverable: true,
        isActive: true,
      }),
    ];
    const state = {
      url: tabs[1].url,
      title: tabs[1].title,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      activeTabId: "handoff",
      tabs,
    };

    expect(resolveBrowserSessionForPanel(tabs, "handoff", "localAgent:ws_123"))
      .toBe("localAgent:ws_123:conversation-a");
    expect(shouldRevealBrowserPanel(state, "localAgent:ws_123")).toBe(true);
  });

  test("auto-open and draft new-task wiring never fall back to all tabs", async () => {
    const [autoOpen, browserPanel, tabsHelper, assistant, sessionPage, hostState, expertLayout, expertSidePanel] = await Promise.all([
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
      Bun.file(new URL(
        "../src/react-app/domains/session/chat/session-page.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/pages/use-session-page-host-state.ts",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/pages/expert-page-layout.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/pages/expert-page-side-panel.tsx",
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
    expect(sessionPage).toContain("<BrowserPanel sessionId={sidePanelScopeId}");
    expect(hostState).toContain('activeSidebarView === "localAgent"');
    expect(hostState).toContain("useAutoOpenBrowserPanel(openBrowserPanelFromAgent, browserSessionScopeId)");
    expect(assistant).toContain('activeSidebarView === "localAgent"');
    expect(expertLayout).toContain('activeSidebarView === "localAgent"');
    expect(expertSidePanel).toContain("isLocalAgentView ? (browserSessionScopeId ?? null) : selectedSessionId");
    expect(assistant).toContain("setSidePanelState(draftKey, null)");
    expect(hostState).toContain("if (!browserSessionScopeId) return;");
  });
});
