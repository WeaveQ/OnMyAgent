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
      if (method === "screenshot") return { image: "data:image/png;base64,AA==" };
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
  assert.equal((await tab.screenshot()).image.startsWith("data:image/png"), true);
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
