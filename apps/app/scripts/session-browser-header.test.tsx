import { describe, expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Globe } from "lucide-react";

import {
  BrowserPanel,
  BrowserPageTabHeader,
  createWorkspaceToolAddHandler,
  WorkspaceHeaderCloseButton,
  WorkspaceHeaderToolChooser,
  WorkspaceToolHeaderBoundary,
} from "../src/react-app/domains/session/browser/browser-panel";
import type { BrowserStatePayload, BrowserTabInfo } from "../src/react-app/domains/session/browser/use-browser-state";
import {
  CodeWorkspaceSidePanel,
} from "../src/react-app/domains/session/surface/code-workspace-side-panel";

function browserTab(
  tabId: string,
  title: string,
  isActive = false,
): BrowserTabInfo {
  return {
    tabId,
    owner: "user",
    sessionId: "session-a",
    url: `https://example.com/${tabId}`,
    title,
    favicon: null,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isActive,
  };
}

describe("single browser page-tab header", () => {
  test("CodeWorkspaceSidePanel delegates its active Browser title row and controls", () => {
    const html = renderToStaticMarkup(
      createElement(CodeWorkspaceSidePanel, {
        workspacePath: null,
        workspaceCatalogRoot: "",
        workspaceId: "workspace-a",
        sessionId: "session-integrated",
        client: null,
        initialKind: "browser",
        onClose: () => undefined,
      }),
    );

    expect(html.match(/data-panel-titlebar-row=/g)).toHaveLength(1);
    expect(html).toContain('data-panel-titlebar-row="browser-pages"');
    expect(html.match(/data-workspace-tool-chooser="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Add workspace tool"');
    expect(html.match(/data-code-side-panel-close="true"/g)).toHaveLength(1);
    expect(html).toContain("Browser is available in the desktop app.");
    expect(html).not.toContain("browser-singleton");
  });

  test("keeps delegated workspace controls in the desktop-only Browser fallback", () => {
    const html = renderToStaticMarkup(
      createElement(BrowserPanel, {
        onClose: () => undefined,
        sessionId: "session-a",
        renderToolMenu: () => createElement(WorkspaceHeaderToolChooser, {
          items: [{
            kind: "browser",
            labelKey: "session.code_side_panel_browser",
            icon: Globe,
          }],
          busyKind: null,
          onAdd: () => undefined,
        }),
        renderPanelClose: () => createElement(WorkspaceHeaderCloseButton, {
          onClose: () => undefined,
        }),
      }),
    );

    expect(html.match(/data-panel-titlebar-row=/g)).toHaveLength(1);
    expect(html.match(/data-workspace-tool-chooser="true"/g)).toHaveLength(1);
    expect(html.match(/data-code-side-panel-close="true"/g)).toHaveLength(1);
    expect(html).toContain("Browser is available in the desktop app.");
  });

  test("renders page tabs and the tool chooser as the only workspace title row", () => {
    const tabs = [
      browserTab("page-alpha", "Alpha", true),
      browserTab("page-beta", "Beta"),
    ];

    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(
          WorkspaceToolHeaderBoundary,
          { activeKind: "browser" },
          createElement(
            "header",
            {
              "data-panel-titlebar-row": "workspace-tools",
              "data-tool-tab-id": "browser-singleton",
            },
            "Browser",
          ),
        ),
        createElement(BrowserPageTabHeader, {
          tabs,
          onReorder: () => undefined,
          renderToolMenu: () => createElement(WorkspaceHeaderToolChooser, {
            items: [{
              kind: "browser",
              labelKey: "session.code_side_panel_browser",
              icon: Globe,
            }],
            busyKind: null,
            onAdd: () => undefined,
          }),
        }),
      ),
    );

    expect(html.match(/data-panel-titlebar-row=/g)).toHaveLength(1);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html.match(/data-workspace-tool-chooser="true"/g)).toHaveLength(1);
    expect(html).not.toContain("browser-singleton");
    expect(html).not.toContain(">Browser<");
  });

  test("production workspace add handler routes active Browser pages and preserves singleton paths", async () => {
    const originalWindow = globalThis.window;
    const tabs = [browserTab("page-alpha", "Alpha", true)];
    let activeTabId = "page-alpha";

    const state = (): BrowserStatePayload => ({
      url: tabs.find((tab) => tab.tabId === activeTabId)?.url ?? "",
      title: tabs.find((tab) => tab.tabId === activeTabId)?.title ?? "",
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      activeTabId,
      tabs: tabs.map((tab) => ({ ...tab, isActive: tab.tabId === activeTabId })),
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __ONMYAGENT_ELECTRON__: {
          browser: {
            createTab: async (url?: string, options?: { sessionId?: string }) => {
              const created = browserTab("page-beta", "Beta");
              created.url = url ?? "about:blank";
              created.sessionId = options?.sessionId;
              tabs.push(created);
              return { tabId: created.tabId, sessionId: created.sessionId };
            },
            selectTab: async (tabId: string) => {
              activeTabId = tabId;
              return tabId;
            },
            getState: async () => state(),
          },
        },
      },
    });

    try {
      let browserOpenCount = 0;
      let selectedKind: "browser" | "files" = "files";
      const continued: Array<{
        kind: "browser" | "files";
        options?: { seedHomeWhenEmpty?: boolean; ensureToolOnly?: boolean };
      }> = [];
      const addTab = createWorkspaceToolAddHandler({
        getSelectedKind: () => selectedKind,
        sessionId: "session-a",
        onBrowserOpen: () => {
          browserOpenCount += 1;
        },
        continueAdd: async (kind, options) => {
          continued.push({ kind, options });
        },
      });

      await addTab("browser", { seedHomeWhenEmpty: true });
      selectedKind = "browser";
      await addTab("files");
      await addTab("browser", { seedHomeWhenEmpty: true, ensureToolOnly: true });
      await addTab("browser", { seedHomeWhenEmpty: true });
      const next = state();

      expect(continued).toEqual([
        { kind: "browser", options: { seedHomeWhenEmpty: true } },
        { kind: "files", options: undefined },
        {
          kind: "browser",
          options: { seedHomeWhenEmpty: true, ensureToolOnly: true },
        },
      ]);
      expect(browserOpenCount).toBe(1);
      expect(next?.tabs?.map((tab) => tab.tabId)).toEqual([
        "page-alpha",
        "page-beta",
      ]);
      expect(next?.activeTabId).toBe("page-beta");
      expect(next?.tabs?.find((tab) => tab.tabId === "page-beta")?.sessionId).toBe(
        "session-a",
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  test("CodeWorkspaceSidePanel installs the tested handler factory as addTab", async () => {
    const source = await Bun.file(new URL(
      "../src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
      import.meta.url,
    )).text();

    expect(source).toMatch(
      /const addTab = useCallback\(\s*createWorkspaceToolAddHandler\(\{/,
    );
  });
});
