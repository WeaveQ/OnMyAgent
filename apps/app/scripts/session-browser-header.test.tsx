import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BROWSER_HOME_URL, openInAppBrowser } from "../src/react-app/domains/session/browser/open-in-app-browser";
import { CodeWorkspaceSidePanel } from "../src/react-app/domains/session/surface/code-workspace-side-panel";

const browserSource = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/session/browser/browser-panel.tsx"),
  "utf8",
);
const workspaceSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
  ),
  "utf8",
);

describe("workspace and browser tab headers", () => {
  test("keeps Browser in the workspace tool row", () => {
    const html = renderToStaticMarkup(
      createElement(CodeWorkspaceSidePanel, {
        workspacePath: null,
        workspaceCatalogRoot: "",
        workspaceId: "workspace-a",
        sessionId: "session-a",
        client: null,
        initialKind: "browser",
        onClose: () => undefined,
      }),
    );

    expect(html.match(/data-panel-titlebar-row=/g)).toHaveLength(1);
    expect(html).toContain('data-panel-titlebar-row="workspace-tools"');
    expect(html.match(/data-workspace-tool-chooser="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Add workspace tool"');
    expect(html.match(/data-code-side-panel-close="true"/g)).toHaveLength(1);
    expect(html).toContain("Browser is available in the desktop app.");
    expect(html).toContain("browser-singleton");
  });

  test("explicit Browser choice creates one session-scoped home page", async () => {
    const originalWindow = globalThis.window;
    const created: Array<{ url?: string; sessionId?: string }> = [];
    let panelOpenCount = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __ONMYAGENT_ELECTRON__: {
          browser: {
            createTab: async (url?: string, options?: { sessionId?: string }) => {
              created.push({ url, sessionId: options?.sessionId });
              return { tabId: "page-new", sessionId: options?.sessionId };
            },
          },
        },
      },
    });

    try {
      const result = await openInAppBrowser({
        openSidePanel: () => { panelOpenCount += 1; },
        url: BROWSER_HOME_URL,
        sessionId: "session-a",
      });
      expect(created).toEqual([{ url: BROWSER_HOME_URL, sessionId: "session-a" }]);
      expect(result.tabId).toBe("page-new");
      expect(panelOpenCount).toBe(1);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  test("uses direct workspace ownership without exported orchestration seams", () => {
    for (const removed of [
      "createWorkspaceToolAddHandler",
      "WorkspaceToolHeaderBoundary",
      "createSessionBrowserPageTab",
    ]) {
      expect(browserSource).not.toContain(removed);
      expect(workspaceSource).not.toContain(removed);
    }
    expect(browserSource).not.toContain("export function WorkspaceHeader");
    expect(workspaceSource).not.toContain('activeTab?.kind !== "browser"');
    expect(workspaceSource).not.toContain("renderToolMenu");
    expect(workspaceSource).toContain('data-panel-titlebar-row="workspace-tools"');
    expect(workspaceSource).toContain('selectedKind === "browser"');
    expect(workspaceSource).toContain("url: BROWSER_HOME_URL");
  });

  test("hides the inner page-tab row until the Browser has multiple pages", () => {
    expect(browserSource).toContain(
      "const showPageTabHeader = sessionTabs.length > 1;",
    );
    expect(browserSource).toContain("{showPageTabHeader ? (");
  });
});
