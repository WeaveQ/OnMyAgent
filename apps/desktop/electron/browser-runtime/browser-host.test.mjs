import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserHost } from "./browser-host.mjs";

function createFakeViewFactory(runtimeValues = []) {
  const views = [];
  return {
    views,
    create() {
      const commands = [];
      const view = {
        webContents: {
          id: views.length + 1,
          commands,
          destroyed: false,
          debugger: {
            attached: false,
            attach() { this.attached = true; },
            detach() { this.attached = false; },
            isAttached() { return this.attached; },
            async sendCommand(method, params) {
              commands.push({ method, params });
              if (method === "Runtime.evaluate" && runtimeValues.length) {
                return { result: { value: runtimeValues.shift() } };
              }
              return { ok: true };
            },
          },
          async loadURL(url) { this.url = url; },
          getURL() { return this.url ?? "about:blank"; },
          getTitle() { return "Fixture"; },
          destroy() { this.destroyed = true; },
          isDestroyed() { return this.destroyed; },
        },
        setBounds() {},
      };
      views.push(view);
      return view;
    },
  };
}

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  messageId: "message-1",
  turnId: "turn-1",
  agentId: "agent-1",
  backend: "in-app",
};

test("host creates a background agent tab without selecting or focusing it", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });

  const result = await host.dispatch("createTab", { url: "https://example.com" }, context);

  assert.equal(result.tab.owner, "agent");
  assert.equal(result.tab.sessionId, "session-1");
  assert.equal(result.tab.visible, false);
  assert.equal(factory.views[0].webContents.getURL(), "https://example.com");
});

test("host permits CDP only for tabs owned by the calling session", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);

  await host.dispatch("executeCdp", {
    tabId: created.tab.tabId,
    method: "DOM.getDocument",
    params: {},
  }, context);
  assert.deepEqual(factory.views[0].webContents.commands[0], {
    method: "DOM.getDocument",
    params: {},
  });
  await assert.rejects(
    host.dispatch("executeCdp", {
      tabId: created.tab.tabId,
      method: "DOM.getDocument",
      params: {},
    }, { ...context, sessionId: "session-2" }),
    /not owned/i,
  );
});

test("host blocks raw CDP navigation and download policy bypasses", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);

  for (const method of ["Page.navigate", "Browser.setDownloadBehavior"]) {
    await assert.rejects(
      host.dispatch("executeCdp", { tabId: created.tab.tabId, method, params: {} }, context),
      /host policy/i,
    );
  }
});

test("turn end destroys temporary tabs and detaches their debuggers", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  await host.dispatch("createTab", {}, context);

  const result = await host.dispatch("turnEnded", {}, context);

  assert.equal(result.closedTabIds.length, 1);
  assert.equal(factory.views[0].webContents.destroyed, true);
  assert.equal(factory.views[0].webContents.debugger.attached, false);
});

test("host authorizes navigation before loading the target URL", async () => {
  const factory = createFakeViewFactory();
  const events = [];
  const host = createBrowserHost({
    createView: factory.create,
    authorize: async (action) => events.push({ type: "authorize", action }),
  });
  const created = await host.dispatch("createTab", {}, context);

  await host.dispatch("navigate", {
    tabId: created.tab.tabId,
    url: "https://example.com/account",
  }, context);

  assert.equal(events[0].action.kind, "navigate");
  assert.equal(factory.views[0].webContents.getURL(), "https://example.com/account");
});

test("host authorizes a createTab URL before loading it", async () => {
  const factory = createFakeViewFactory();
  const events = [];
  const host = createBrowserHost({
    createView: factory.create,
    authorize: async (action) => {
      events.push(action);
      if (action.url.startsWith("javascript:")) throw new Error("navigation blocked");
    },
  });

  await assert.rejects(
    host.dispatch("createTab", { url: "javascript:alert(1)" }, context),
    /navigation blocked/i,
  );
  assert.equal(events[0].kind, "navigate");
  assert.equal(factory.views.length, 0);
});

test("host captures screenshots and dispatches coordinate input through CDP", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);

  await host.dispatch("screenshot", { tabId: created.tab.tabId }, context);
  await host.dispatch("coordinateAction", {
    tabId: created.tab.tabId,
    action: "click",
    x: 10,
    y: 15,
  }, context);

  assert.deepEqual(factory.views[0].webContents.commands.map((command) => command.method), [
    "Runtime.evaluate",
    "Page.captureScreenshot",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
  ]);
});

test("host claims user tabs before allowing session control", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  const userView = factory.create();
  host.registerUserTab("user-tab", userView);

  const claimed = await host.dispatch("claimTab", { tabId: "user-tab" }, context);

  assert.equal(claimed.tab.owner, "claimed");
  assert.equal(claimed.tab.sessionId, "session-1");
});

test("coordinate CUA supports move, double click, drag, scroll, type, and keypress", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);
  const tabId = created.tab.tabId;

  await host.dispatch("coordinateAction", { tabId, action: "move", x: 1, y: 2 }, context);
  await host.dispatch("coordinateAction", { tabId, action: "doubleClick", x: 3, y: 4 }, context);
  await host.dispatch("coordinateAction", {
    tabId,
    action: "drag",
    from: { x: 5, y: 6 },
    to: { x: 15, y: 16 },
  }, context);
  await host.dispatch("coordinateAction", { tabId, action: "scroll", x: 8, y: 9, deltaY: 400 }, context);
  await host.dispatch("coordinateAction", { tabId, action: "type", text: "hello" }, context);
  await host.dispatch("coordinateAction", { tabId, action: "keypress", key: "ENTER" }, context);

  assert.deepEqual(factory.views[0].webContents.commands.map((command) => command.method), [
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.insertText",
    "Input.dispatchKeyEvent",
    "Input.dispatchKeyEvent",
  ]);
});

test("read-only evaluation rejects mutation and returns only serialized values", async () => {
  const factory = createFakeViewFactory();
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);
  const tabId = created.tab.tabId;

  await assert.rejects(
    host.dispatch("evaluateReadonly", { tabId, expression: "document.body.textContent = 'x'" }, context),
    /read-only/i,
  );
  await host.dispatch("evaluateReadonly", { tabId, expression: "document.title" }, context);
  assert.equal(factory.views[0].webContents.commands.at(-1).method, "Runtime.evaluate");
  assert.equal(factory.views[0].webContents.commands.at(-1).params.returnByValue, true);
});

test("host implements locator, DOM-CUA, content, dialog, clipboard, and user-tab services", async () => {
  const factory = createFakeViewFactory([
    [{ visible: true, editable: false, hitTarget: true, label: "Continue" }],
    true,
    [{ selector: "#continue", role: "button", label: "Continue" }],
    true,
    "Page text",
  ]);
  let clipboardText = "initial";
  const host = createBrowserHost({
    createView: factory.create,
    clipboard: {
      readText: () => clipboardText,
      writeText: (value) => { clipboardText = value; },
    },
  });
  const userView = factory.create();
  host.registerUserTab("user-tab", userView);
  const created = await host.dispatch("createTab", {}, context);
  const tabId = created.tab.tabId;

  await host.dispatch("locatorAction", {
    tabId,
    selector: { role: "button", name: "Continue" },
    action: "click",
  }, context);
  const observation = await host.dispatch("domObserve", { tabId }, context);
  await host.dispatch("domAction", {
    tabId,
    action: "click",
    ref: observation.nodes[0].ref,
  }, context);
  assert.deepEqual(await host.dispatch("tabContent", { tabId }, context), { text: "Page text" });
  await host.dispatch("dialogAction", { tabId, action: "dismiss" }, context);
  assert.deepEqual(await host.dispatch("clipboardRead", { tabId }, context), { text: "initial" });
  await host.dispatch("clipboardWrite", { tabId, text: "next" }, context);
  assert.equal(clipboardText, "next");
  assert.equal((await host.dispatch("listUserTabs", {}, context)).tabs[0].tabId, "user-tab");
  assert.equal((await host.dispatch("selectedTab", {}, context)).tab.tabId, tabId);
});

test("host supports playwrightEvaluate, domSnapshot, elementInfo, exportContent, getJsDialog", async () => {
  const factory = createFakeViewFactory([
    3,
    { url: "https://example.com", title: "Example", snapshot: "1 link \"Home\"", count: 1 },
    {
      matchCount: 1,
      element: {
        tag: "a",
        role: "link",
        label: "Home",
        bounds: { x: 1, y: 2, width: 10, height: 12 },
      },
    },
    { type: "text", text: "hello", title: "Example", url: "https://example.com" },
    { url: "https://cdn.example.com/a.jpg" },
  ]);
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);
  const tabId = created.tab.tabId;

  const evaluated = await host.dispatch("playwrightEvaluate", {
    tabId,
    pageFunction: "() => document.querySelectorAll('a').length",
  }, context);
  assert.deepEqual(evaluated, { value: 3 });

  await assert.rejects(
    host.dispatch("playwrightEvaluate", {
      tabId,
      pageFunction: "() => fetch('/x')",
    }, context),
    /host capabilities|mutate/i,
  );

  const snapshot = await host.dispatch("domSnapshot", { tabId }, context);
  assert.equal(snapshot.count, 1);
  assert.match(snapshot.snapshot, /Home/);

  const info = await host.dispatch("elementInfo", { tabId, css: "a" }, context);
  assert.equal(info.matchCount, 1);
  assert.equal(info.element.tag, "a");

  const exported = await host.dispatch("exportContent", { tabId, type: "text" }, context);
  assert.equal(exported.text, "hello");

  const dialog = await host.dispatch("getJsDialog", { tabId }, context);
  assert.equal(dialog.open, false);
  assert.equal(dialog.dialog, null);

  const media = await host.dispatch("coordinateAction", {
    tabId,
    action: "downloadMedia",
    url: "https://cdn.example.com/a.jpg",
  }, context);
  assert.equal(media.url, "https://cdn.example.com/a.jpg");
});

test("host elementScreenshot captures a clipped page region", async () => {
  const factory = createFakeViewFactory([
    { x: 10, y: 20, width: 100, height: 50, dpr: 1, viewportWidth: 800, viewportHeight: 600 },
  ]);
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);
  const tabId = created.tab.tabId;

  factory.views[0].webContents.debugger.sendCommand = async (method, params) => {
    factory.views[0].webContents.commands.push({ method, params });
    if (method === "Runtime.evaluate") {
      return { result: { value: { x: 10, y: 20, width: 100, height: 50, dpr: 1 } } };
    }
    if (method === "Page.captureScreenshot") {
      return { data: "AAAA" };
    }
    return { ok: true };
  };

  const shot = await host.dispatch("elementScreenshot", {
    tabId,
    css: "img.hero",
    format: "jpeg",
  }, context);
  assert.equal(shot.format, "jpeg");
  assert.equal(shot.image.startsWith("data:image/jpeg;base64,"), true);
  assert.equal(shot.bounds.width, 100);
  assert.equal(
    factory.views[0].webContents.commands.some((command) => command.method === "Page.captureScreenshot"),
    true,
  );
});

test("host locator getAttribute is read-only", async () => {
  const factory = createFakeViewFactory(["https://example.com/item"]);
  const host = createBrowserHost({ createView: factory.create });
  const created = await host.dispatch("createTab", {}, context);
  const result = await host.dispatch("locatorAction", {
    tabId: created.tab.tabId,
    selector: { css: "a.card" },
    action: "getAttribute",
    name: "href",
  }, context);
  assert.equal(result.value, "https://example.com/item");
});
