import assert from "node:assert/strict";
import test from "node:test";

import { createElectronBrowserController } from "./electron-browser-controller.mjs";

function createHarness() {
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
        async loadURL(nextUrl) { url = nextUrl; },
        getURL: () => url,
        getTitle: () => title,
        isDestroyed: () => destroyed,
        isLoading: () => false,
        destroy() { destroyed = true; listeners.get("destroyed")?.(); },
        close() { destroyed = true; listeners.get("destroyed")?.(); },
        on(name, callback) { listeners.set(name, callback); },
        once(name, callback) { listeners.set(name, callback); },
        setWindowOpenHandler() {},
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

test("controller shares one WebContents model for user and agent tabs", async () => {
  const harness = createHarness();
  const controller = createElectronBrowserController({
    WebContentsView: harness.WebContentsView,
    dirname: "/tmp",
    openExternal: async () => true,
  });
  controller.setMainWindow(harness.mainWindow);
  const userTab = controller.createBrowserTab("https://example.com", { select: true });
  const context = {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    messageId: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    backend: "in-app",
  };
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
  const controller = createElectronBrowserController({
    WebContentsView: harness.WebContentsView,
    dirname: "/tmp",
    openExternal: async () => true,
  });
  controller.setMainWindow(harness.mainWindow);
  controller.createBrowserTab("about:blank", { select: true });
  controller.attachBrowserView({ x: 10, y: 20, width: 800, height: 600 });
  const context = {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    messageId: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    backend: "in-app",
  };
  const { tab: agentTab } = await controller.runtime.dispatch(
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

test("turn cleanup closes temporary agent tabs but preserves user tabs", async () => {
  const harness = createHarness();
  const controller = createElectronBrowserController({
    WebContentsView: harness.WebContentsView,
    dirname: "/tmp",
    openExternal: async () => true,
  });
  controller.createBrowserTab("about:blank");
  const context = {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    messageId: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    backend: "in-app",
  };
  await controller.runtime.dispatch("createTab", { temporary: true }, context);
  await controller.runtime.dispatch("turnEnded", {}, context);

  assert.deepEqual(controller.listBrowserTabs().map((tab) => tab.owner), ["user"]);
  await controller.close();
});
