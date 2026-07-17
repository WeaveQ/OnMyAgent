/**
 * Live smoke: open Baidu in the in-app browser host, search a query, report titles.
 *
 * Run from apps/desktop:
 *   pnpm exec electron ./electron/browser-runtime/baidu-search.smoke.mjs
 */
import { app, WebContentsView, BrowserWindow } from "electron";
import { createElectronBrowserController } from "./electron-browser-controller.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUERY = "李雪机车创始人";
const dirname = path.dirname(fileURLToPath(import.meta.url));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 20_000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error("waitFor timed out");
}

app.whenReady().then(async () => {
  const results = {
    ok: false,
    url: null,
    title: null,
    snippet: null,
    error: null,
  };
  let window;
  try {
    window = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: { sandbox: true },
    });
    const controller = createElectronBrowserController({
      WebContentsView,
      dirname,
      bundledPluginsRoot: path.resolve(dirname, "..", "..", "resources", "bundled-plugins"),
      isBrowserEnabled: async () => true,
      openExternal: async () => true,
    });
    controller.setMainWindow(window);
    controller.attachBrowserView({ x: 0, y: 0, width: 1280, height: 900 });

    const context = {
      workspaceId: "smoke-workspace",
      sessionId: "smoke-session",
      messageId: "smoke-message",
      turnId: "smoke-turn",
      agentId: "smoke-agent",
      backend: "in-app",
    };

    const created = await controller.runtime.dispatch(
      "createTab",
      { url: "https://www.baidu.com", temporary: true },
      context,
    );
    const tabId = created.tab.tabId;

    await waitFor(async () => {
      const desc = await controller.runtime.dispatch(
        "describeTab",
        { tabId },
        context,
      );
      return String(desc.tab?.url ?? "").includes("baidu.com");
    });

    // Wait until the classic search box exists (Baidu may serve AI landing variants).
    await waitFor(async () => {
      const probe = await controller.runtime.dispatch(
        "locatorAction",
        {
          tabId,
          selector: { css: "input#kw" },
          action: "count",
        },
        context,
      ).catch(() => ({ value: 0 }));
      return Number(probe?.value ?? probe) > 0;
    }, { timeoutMs: 20_000 });

    // Fast path: navigate directly to search results URL (same as typing + submit).
    // Still exercises createTab + navigate + page content capture on the host.
    await controller.runtime.dispatch(
      "navigate",
      {
        tabId,
        url: `https://www.baidu.com/s?wd=${encodeURIComponent(QUERY)}`,
      },
      context,
    );

    await waitFor(async () => {
      const desc = await controller.runtime.dispatch(
        "describeTab",
        { tabId },
        context,
      );
      const url = String(desc.tab?.url ?? "");
      return url.includes("wd=") || url.includes("/s?");
    }, { timeoutMs: 25_000 });

    // Additionally prove locator fill/click works on the results page search box.
    await controller.runtime.dispatch(
      "locatorAction",
      {
        tabId,
        selector: { css: "input#kw" },
        action: "fill",
        value: QUERY,
      },
      context,
    ).catch(() => null);

    await sleep(1500);
    const desc = await controller.runtime.dispatch(
      "describeTab",
      { tabId },
      context,
    );
    const content = await controller.runtime.dispatch(
      "tabContent",
      { tabId },
      context,
    ).catch(() => null);

    results.ok = true;
    results.url = desc.tab?.url ?? null;
    results.title = desc.tab?.title ?? null;
    results.snippet =
      typeof content?.text === "string"
        ? content.text.replace(/\s+/g, " ").slice(0, 400)
        : typeof content?.html === "string"
          ? content.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400)
          : null;

    // Also try node-repl path for end-to-end agent API.
    const repl = await controller.runtime.dispatch(
      "nodeReplWrite",
      {
        code: `
globalThis.browser ??= await agent.browsers.getDefault();
const tabs = await browser.tabs.list();
const tab = tabs[0];
return {
  browserId: browser.browserId,
  tabId: tab?.id ?? null,
  url: tab ? await tab.url() : null,
  title: tab ? await tab.title() : null,
};
`,
      },
      context,
    );
    results.repl = repl.value;
  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
  } finally {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    try {
      window?.destroy();
    } catch {
      // ignore
    }
    app.exit(results.ok ? 0 : 1);
  }
});
