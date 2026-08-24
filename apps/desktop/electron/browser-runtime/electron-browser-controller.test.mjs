import assert from "node:assert/strict";
import test from "node:test";

import { createElectronBrowserController } from "./electron-browser-controller.mjs";

function createHarness({ onLoadURL } = {}) {
  const views = [];
  const windowChildren = [];
  const mainWindow = {
    isDestroyed: () => false,
    contentView: {
      children: windowChildren,
      addChildView(view) { windowChildren.push(view); },
      removeChildView(view) {
        const index = windowChildren.indexOf(view);
        if (index >= 0) windowChildren.splice(index, 1);
      },
    },
    webContents: { isDestroyed: () => false, send() {} },
  };
  class WebContentsView {
    constructor(options) {
      const listeners = new Map();
      let url = "about:blank";
      let title = "";
      let destroyed = false;
      this.options = options;
      this.bounds = null;
      this.webContents = {
        debugger: {
          isAttached: () => false,
          attach() {},
          detach() {},
          async sendCommand() { return {}; },
        },
        async loadURL(nextUrl) {
          url = nextUrl;
          return onLoadURL?.({ url: nextUrl, webContents: this });
        },
        getURL: () => url,
        getTitle: () => title,
        isDestroyed: () => destroyed,
        isLoading: () => false,
        destroy() { destroyed = true; listeners.get("destroyed")?.(); },
        close() { destroyed = true; listeners.get("destroyed")?.(); },
        on(name, callback) { listeners.set(name, callback); },
        once(name, callback) { listeners.set(name, callback); },
        setWindowOpenHandler(handler) { this.windowOpenHandler = handler; },
        navigationHistory: {
          canGoBack: () => false,
          canGoForward: () => false,
          goBack() {},
          goForward() {},
        },
        reload() {},
      };
      views.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
  }
  return { WebContentsView, mainWindow, views, windowChildren };
}

function agentContext(sessionId = "session-1") {
  return {
    workspaceId: "workspace-1",
    sessionId,
    messageId: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    backend: "in-app",
  };
}

function createController(harness, options = {}) {
  const openedExternal = [];
  const controller = createElectronBrowserController({
    WebContentsView: harness.WebContentsView,
    dirname: "/tmp",
    openExternal: async (url) => {
      openedExternal.push(url);
      return true;
    },
    ...options,
  });
  return { controller, openedExternal };
}

function projectTabs(controller) {
  return controller.listBrowserTabs().map(({ owner, sessionId, url, isActive }) =>
    ({ owner, sessionId, url, isActive }));
}

const tabState = (owner, sessionId, url, isActive) => ({ owner, sessionId, url, isActive });

test("page-created HTTP windows become user tabs in the exact source session", async () => {
  const harness = createHarness();
  const sent = [];
  harness.mainWindow.webContents.send = (channel) => {
    sent.push(channel);
  };
  const { controller, openedExternal } = createController(harness);
  controller.setMainWindow(harness.mainWindow);
  const sourceContext = agentContext("session-source");
  const { tab: sourceTab } = await controller.runtime.host.dispatch(
    "createTab",
    { url: "https://source.example" },
    sourceContext,
  );
  controller.createBrowserTab("https://other.example", {
    select: true,
    sessionId: "session-other",
  });

  const result = harness.views[0].webContents.windowOpenHandler({
    url: "https://child.example",
  });

  assert.deepEqual(result, { action: "deny" });
  assert.equal(controller.listBrowserTabs().length, 3);
  assert.deepEqual(
    projectTabs(controller),
    [
      tabState("agent", "session-source", "https://source.example", false),
      tabState("user", "session-other", "https://other.example", false),
      tabState("user", "session-source", "https://child.example", true),
    ],
  );
  assert.equal(sourceTab.owner, "agent");
  assert.equal(sent.includes("onmyagent:browser:panel-opened"), true);
  assert.deepEqual(openedExternal, []);
  await controller.close();
});

test("page-created unsupported and malformed URLs are denied without fallback", async () => {
  const harness = createHarness();
  const { controller, openedExternal } = createController(harness);
  controller.createBrowserTab("https://source.example", {
    sessionId: "session-source",
  });
  const sourceWebContents = harness.views[0].webContents;

  for (const url of ["mailto:person@example.com", "not a valid URL"]) {
    assert.deepEqual(sourceWebContents.windowOpenHandler({ url }), { action: "deny" });
  }
  assert.equal(controller.listBrowserTabs().length, 1);
  assert.deepEqual(openedExternal, []);
  await controller.close();
});

test("a popup during initial agent navigation stays selected in the source session", async () => {
  let popupResult = null;
  const harness = createHarness({
    onLoadURL({ url, webContents }) {
      if (url === "https://source-initial.example") {
        popupResult = webContents.windowOpenHandler({
          url: "https://child-initial.example",
        });
      }
    },
  });
  const { controller, openedExternal } = createController(harness);
  const context = agentContext("session-initial");

  await controller.runtime.host.dispatch(
    "createTab",
    { url: "https://source-initial.example" },
    context,
  );

  assert.deepEqual(popupResult, { action: "deny" });
  assert.deepEqual(
    projectTabs(controller),
    [
      tabState("agent", "session-initial", "https://source-initial.example", false),
      tabState("user", "session-initial", "https://child-initial.example", true),
    ],
  );
  assert.deepEqual(openedExternal, []);
  await controller.close();
});

test("a popup after claim uses the authoritative claimed session", async () => {
  const harness = createHarness();
  const { controller, openedExternal } = createController(harness);
  const sourceTab = controller.createBrowserTab("https://source-claimed.example");
  const context = agentContext("session-claimed");
  await controller.runtime.host.dispatch(
    "claimTab",
    { tabId: sourceTab.tabId },
    context,
  );

  const result = sourceTab.view.webContents.windowOpenHandler({
    url: "https://child-claimed.example",
  });

  assert.deepEqual(result, { action: "deny" });
  assert.deepEqual(
    projectTabs(controller),
    [
      tabState("claimed", "session-claimed", "https://source-claimed.example", false),
      tabState("user", "session-claimed", "https://child-claimed.example", true),
    ],
  );
  assert.deepEqual(openedExternal, []);
  await controller.close();
});

test("a rejected popup navigation is handled while the window stays denied", async () => {
  const harness = createHarness({
    onLoadURL({ url }) {
      if (url === "https://child-rejects.example") {
        return Promise.reject(new Error("navigation failed"));
      }
    },
  });
  const unhandledRejections = [];
  const onUnhandledRejection = (error) => {
    unhandledRejections.push(error);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  const { controller, openedExternal } = createController(harness);
  const sourceTab = controller.createBrowserTab("https://source.example", {
    sessionId: "session-source",
  });

  try {
    const result = sourceTab.view.webContents.windowOpenHandler({
      url: "https://child-rejects.example",
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(result, { action: "deny" });
    assert.equal(controller.listBrowserTabs().length, 2);
    assert.deepEqual(openedExternal, []);
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    await controller.close();
  }
});

test("navigate selects its source unless the load creates a newer popup selection", async () => {
  let popupOnUrl = null;
  let popupResult = null;
  const harness = createHarness({
    onLoadURL({ url, webContents }) {
      if (url === popupOnUrl) {
        popupResult = webContents.windowOpenHandler({
          url: "https://child-navigate.example",
        });
      }
    },
  });
  const { controller, openedExternal } = createController(harness);
  const context = agentContext("session-navigate");
  const { tab: sourceTab } = await controller.runtime.host.dispatch(
    "createTab",
    { url: "https://source-before-navigate.example" },
    context,
  );
  controller.createBrowserTab("https://other-before-normal.example", {
    select: true,
    sessionId: "session-other",
  });

  await controller.runtime.host.dispatch(
    "navigate",
    { tabId: sourceTab.tabId, url: "https://source-normal.example" },
    context,
  );
  assert.equal(controller.browserStatePayload().activeTabId, sourceTab.tabId);

  controller.createBrowserTab("https://other-before-popup.example", {
    select: true,
    sessionId: "session-other",
  });
  popupOnUrl = "https://source-popup.example";
  await controller.runtime.host.dispatch(
    "navigate",
    { tabId: sourceTab.tabId, url: popupOnUrl },
    context,
  );

  const tabs = controller.listBrowserTabs();
  const childTab = tabs.find((tab) => tab.url === "https://child-navigate.example");
  assert.deepEqual(popupResult, { action: "deny" });
  assert.deepEqual(
    childTab
      ? {
          owner: childTab.owner,
          sessionId: childTab.sessionId,
          isActive: childTab.isActive,
        }
      : null,
    {
      owner: "user",
      sessionId: "session-navigate",
      isActive: true,
    },
  );
  assert.equal(
    tabs.find((tab) => tab.tabId === sourceTab.tabId)?.isActive,
    false,
  );
  assert.deepEqual(openedExternal, []);
  await controller.close();
});

test("navigate preserves an explicit ABA selection made while loading", async () => {
  let resolveNavigate;
  let notifyNavigateStarted;
  const navigateStarted = new Promise((resolve) => {
    notifyNavigateStarted = resolve;
  });
  const harness = createHarness({
    onLoadURL({ url }) {
      if (url === "https://source-deferred.example") {
        notifyNavigateStarted();
        return new Promise((resolve) => {
          resolveNavigate = resolve;
        });
      }
    },
  });
  const { controller, openedExternal } = createController(harness);
  const context = agentContext("session-deferred");
  const { tab: sourceTab } = await controller.runtime.host.dispatch(
    "createTab",
    { url: "https://source-before-deferred.example" },
    context,
  );
  const originalTab = controller.createBrowserTab("https://original.example", {
    select: true,
    sessionId: "session-other",
  });
  const interveningTab = controller.createBrowserTab("https://intervening.example", {
    select: false,
    sessionId: "session-other",
  });

  const pendingNavigate = controller.runtime.host.dispatch(
    "navigate",
    { tabId: sourceTab.tabId, url: "https://source-deferred.example" },
    context,
  );
  await navigateStarted;
  controller.selectBrowserTab(interveningTab.tabId);
  controller.selectBrowserTab(originalTab.tabId);
  resolveNavigate();
  await pendingNavigate;

  assert.equal(controller.browserStatePayload().activeTabId, originalTab.tabId);
  assert.equal(
    controller.listBrowserTabs().find((tab) => tab.tabId === sourceTab.tabId)?.isActive,
    false,
  );
  assert.deepEqual(openedExternal, []);
  await controller.close();
});

test("controller shares one WebContents model for user and agent tabs", async () => {
  const harness = createHarness();
  const { controller } = createController(harness);
  controller.setMainWindow(harness.mainWindow);
  const userTab = controller.createBrowserTab("https://example.com", { select: true });
  const context = agentContext();
  const { tab: agentTab } = await controller.runtime.dispatch(
    "createTab",
    { url: "https://agent.example", temporary: true },
    context,
  );

  assert.equal(controller.listBrowserTabs().length, 2);
  assert.equal(controller.listBrowserTabs().find((tab) => tab.tabId === userTab.tabId)?.owner, "user");
  assert.equal(controller.listBrowserTabs().find((tab) => tab.tabId === agentTab.tabId)?.owner, "agent");
  assert.equal(harness.views.length, 2);
  await controller.close();
});

test("agent createTab selects the tab and asks the renderer to open the browser panel", async () => {
  const harness = createHarness();
  const sent = [];
  harness.mainWindow.webContents.send = (channel, ...args) => {
    sent.push({ channel, args });
  };
  const { controller } = createController(harness);
  controller.setMainWindow(harness.mainWindow);
  controller.createBrowserTab("about:blank", { select: true });
  controller.attachBrowserView({ x: 10, y: 20, width: 800, height: 600 });
  const context = agentContext();
  // Direct host path (what agent tabs.new uses via node-kernel browserRequest)
  const { tab: agentTab } = await controller.runtime.host.dispatch(
    "createTab",
    { url: "https://agent.example" },
    context,
  );

  assert.equal(controller.browserStatePayload().activeTabId, agentTab.tabId);
  assert.equal(
    sent.some((entry) => entry.channel === "onmyagent:browser:panel-opened"),
    true,
  );
  assert.equal(harness.windowChildren.length, 1);
  await controller.close();
});

test("agent tabs.new via nodeReplWrite also opens the browser panel", async () => {
  const harness = createHarness();
  const sent = [];
  harness.mainWindow.webContents.send = (channel) => {
    sent.push(channel);
  };
  const { controller } = createController(harness, {
    isBrowserEnabled: async () => true,
  });
  controller.setMainWindow(harness.mainWindow);
  const context = agentContext("session-repl");
  const result = await controller.runtime.dispatch(
    "nodeReplWrite",
    {
      code: `
globalThis.browser ??= await agent.browsers.getDefault();
globalThis.tab ??= await browser.tabs.new({ url: "https://agent-repl.example" });
return { id: tab.id, url: await tab.url() };
`,
    },
    context,
  );
  assert.equal(result.value?.id?.startsWith("tab-"), true);
  assert.equal(sent.includes("onmyagent:browser:panel-opened"), true);
  assert.equal(
    controller.listBrowserTabs().some((tab) => tab.owner === "agent"),
    true,
  );
  await controller.close();
});

test("turn cleanup closes temporary agent tabs but preserves user tabs", async () => {
  const harness = createHarness();
  const { controller } = createController(harness);
  controller.createBrowserTab("about:blank");
  const context = agentContext();
  await controller.runtime.dispatch("createTab", { temporary: true }, context);
  await controller.runtime.dispatch("turnEnded", {}, context);

  assert.deepEqual(controller.listBrowserTabs().map((tab) => tab.owner), ["user"]);
  await controller.close();
});
