import assert from "node:assert/strict";
import test from "node:test";

import { setupBrowserRuntime } from "./browser-client.mjs";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  messageId: "message-1",
  turnId: "turn-1",
  agentId: "agent-1",
  backend: "in-app",
};

test("browser client binds all requests to its hidden execution context", async () => {
  const calls = [];
  const agent = setupBrowserRuntime({
    context,
    request: async (method, params, requestContext) => {
      calls.push({ method, params, requestContext });
      if (method === "listTabs") return { tabs: [] };
      if (method === "createTab") return { tab: { tabId: "tab-1", url: "about:blank", title: "" } };
      return {};
    },
  });

  const browser = await agent.browsers.getDefault();
  const tab = await browser.tabs.new({ url: "https://example.com" });
  await tab.goto("https://example.org");

  assert.deepEqual(calls.map((call) => call.method), ["getInfo", "createTab", "navigate"]);
  assert.equal(calls.every((call) => call.requestContext === context), true);
});

test("browser client exposes tab lifecycle and interaction namespaces", async () => {
  const calls = [];
  const agent = setupBrowserRuntime({
    context,
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "getInfo") return { backend: "in-app", browserId: "in-app", capabilities: ["tabs"] };
      if (method === "listTabs") return { tabs: [{ tabId: "tab-1", url: "https://example.com", title: "Example" }] };
      if (method === "screenshot") {
        return {
          image: "data:image/jpeg;base64,AA==",
          width: 960,
          height: 540,
          bytes: 2,
          format: "jpeg",
        };
      }
      if (method === "describeTab") return { tab: { tabId: "tab-1", url: "https://example.com", title: "Example" } };
      return {};
    },
  });
  const browser = await agent.browsers.getDefault();
  assert.equal(browser.browserId, "in-app");
  assert.ok(await agent.browsers.get("iab"));
  const [tab] = await browser.tabs.list();

  assert.equal(tab.id, "tab-1");
  assert.equal(await tab.url(), "https://example.com");
  assert.equal((await tab.screenshot()).image.startsWith("data:image/jpeg"), true);
  await tab.cua.click({ x: 12, y: 18 });
  await tab.dom_cua.observe();
  await tab.playwright.getByRole("button", { name: "Submit" }).click();
  await browser.tabs.finalize([tab]);

  assert.deepEqual(calls.map((call) => call.method), [
    "getInfo",
    "getInfo",
    "listTabs",
    "describeTab",
    "screenshot",
    "coordinateAction",
    "domObserve",
    "locatorAction",
    "finalizeTabs",
  ]);
});

test("tab.sense returns hybrid DOM nodes plus screenshot metadata", async () => {
  const agent = setupBrowserRuntime({
    context,
    request: async (method) => {
      if (method === "getInfo") return { backend: "in-app", browserId: "in-app" };
      if (method === "listTabs") {
        return { tabs: [{ tabId: "tab-1", url: "https://example.com", title: "Example" }] };
      }
      if (method === "describeTab") {
        return { tab: { tabId: "tab-1", url: "https://example.com", title: "Example" } };
      }
      if (method === "screenshot") {
        return {
          image: "data:image/jpeg;base64,AA==",
          width: 800,
          height: 600,
          scaleX: 2,
          scaleY: 2,
          bytes: 2,
          format: "jpeg",
        };
      }
      if (method === "domObserve") {
        return {
          generation: 1,
          nodes: [
            {
              ref: "dom:1:1",
              role: "button",
              label: "关注",
              bounds: { x: 10, y: 20, width: 40, height: 20 },
            },
          ],
        };
      }
      return {};
    },
  });
  const browser = await agent.browsers.getDefault();
  const [tab] = await browser.tabs.list();
  const sense = await tab.sense({ maxNodes: 10 });
  assert.equal(sense.__type, "PageSense");
  assert.equal(sense.url, "https://example.com");
  assert.equal(sense.shot.image.startsWith("data:image/jpeg"), true);
  assert.equal(sense.nodes.length, 1);
  assert.equal(sense.nodes[0].label, "关注");
  assert.equal(sense.nodes[0].center.x, 30);
  assert.equal(sense.nodes[0].center.y, 30);
  assert.equal(sense.nodes[0].centerImage.x, 15);
  assert.equal(sense.nodes[0].centerImage.y, 15);
  assert.equal(typeof tab.sense, "function");
});

test("browser client routes playwright evaluate, snapshot, and element helpers", async () => {
  const calls = [];
  const agent = setupBrowserRuntime({
    context,
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "getInfo") return { backend: "in-app", browserId: "in-app" };
      if (method === "listTabs") {
        return { tabs: [{ tabId: "tab-1", url: "https://example.com", title: "Example" }] };
      }
      if (method === "playwrightEvaluate") return { value: 2 };
      if (method === "domSnapshot") return { snapshot: "1 link", count: 1 };
      if (method === "elementInfo") return { matchCount: 1, element: { tag: "a" } };
      if (method === "elementScreenshot") return { image: "data:image/jpeg;base64,AA==", format: "jpeg" };
      if (method === "exportContent") return { type: "text", text: "body" };
      if (method === "getJsDialog") return { open: false, dialog: null };
      if (method === "locatorAction") return { value: "/path" };
      return {};
    },
  });
  const browser = await agent.browsers.getDefault();
  const [tab] = await browser.tabs.list();

  assert.equal(await tab.playwright.evaluate("() => 1"), 2);
  assert.equal((await tab.playwright.domSnapshot()).count, 1);
  assert.equal((await tab.playwright.elementInfo({ css: "a" })).element.tag, "a");
  assert.equal((await tab.playwright.elementScreenshot({ css: "img" })).format, "jpeg");
  assert.equal((await tab.content.export({ type: "text" })).text, "body");
  assert.equal((await tab.getJsDialog()).open, false);
  assert.equal(await tab.playwright.locator("a").getAttribute("href"), "/path");
  assert.equal(await tab.playwright.locator("a").evaluate("(el) => el.href"), 2);

  // Common agent pitfall: page-like APIs under playwright.*
  assert.equal(await tab.playwright.title(), "Example");
  assert.equal(await tab.playwright.url(), "https://example.com");
  assert.equal(typeof tab.playwright.screenshot, "function");
  assert.equal(typeof tab.playwright.goto, "function");

  assert.equal(calls.some((call) => call.method === "playwrightEvaluate"), true);
  assert.equal(calls.some((call) => call.method === "domSnapshot"), true);
  assert.equal(calls.some((call) => call.method === "elementInfo"), true);
  assert.equal(calls.some((call) => call.method === "elementScreenshot"), true);
  assert.equal(calls.some((call) => call.method === "exportContent"), true);
  assert.equal(calls.some((call) => call.method === "getJsDialog"), true);
  assert.equal(calls.some((call) => call.method === "describeTab"), true);
  assert.equal(
    calls.some((call) => call.method === "locatorAction" && call.params.action === "getAttribute"),
    true,
  );
  assert.equal(
    calls.some((call) => call.method === "playwrightEvaluate" && call.params.selector?.css === "a"),
    true,
  );
});
