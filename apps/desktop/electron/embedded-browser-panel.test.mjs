import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createEmbeddedBrowserPanel } from "./embedded-browser-panel.mjs";

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
    this.url = "";
  }

  isDestroyed() { return this.closed; }
  getURL() { return this.url; }
  getTitle() { return this.url; }
  isLoading() { return false; }
  loadURL(url) { this.url = url; return Promise.resolve(); }
  setWindowOpenHandler() {}
  close() { this.closed = true; this.emit("destroyed"); }
}

class FakeWebContentsView {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    FakeWebContentsView.instances.push(this);
  }
}

function createPanel() {
  FakeWebContentsView.instances = [];
  return createEmbeddedBrowserPanel({
    app: { isPackaged: false },
    WebContentsView: FakeWebContentsView,
    clipboard: { writeText() {} },
    shell: { openExternal() {} },
    dirname: "/tmp/onmyagent-electron",
  });
}

test("creates owner-scoped embedded tabs with a preload marker argument", () => {
  const panel = createPanel();
  const first = panel.createBrowserTab("https://example.com/a", {
    ownerId: "conversation:a",
  });
  panel.createBrowserTab("https://example.com/b", {
    ownerId: "conversation:b",
  });

  assert.deepEqual(
    FakeWebContentsView.instances[0].options.webPreferences.additionalArguments,
    [`--onmyagent-browser-tab-id=${encodeURIComponent(first.tabId)}`],
  );
  assert.deepEqual(
    panel.listBrowserTabs({ ownerId: "conversation:a" }).map((tab) => tab.tabId),
    [first.tabId],
  );
});

test("closes tabs for one owner without touching another owner", () => {
  const panel = createPanel();
  const first = panel.createBrowserTab("about:blank", { ownerId: "conversation:a" });
  const second = panel.createBrowserTab("about:blank", { ownerId: "conversation:a" });
  const other = panel.createBrowserTab("about:blank", { ownerId: "conversation:b" });

  assert.deepEqual(panel.closeBrowserTabsByOwner("conversation:a"), [
    first.tabId,
    second.tabId,
  ]);
  assert.deepEqual(panel.listBrowserTabs().map((tab) => tab.tabId), [other.tabId]);
  assert.equal(FakeWebContentsView.instances[2].webContents.closed, false);
});
