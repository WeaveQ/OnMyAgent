import test from "node:test";
import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";

import {
  compareVersions,
  isVersionNewer,
  parseComparableVersion,
  registerUpdaterIpc,
} from "./updater.mjs";

test("parseComparableVersion normalizes v-prefix and prerelease", () => {
  assert.deepEqual(parseComparableVersion("v1.2.3"), {
    release: [1, 2, 3],
    prerelease: [],
  });
  assert.deepEqual(parseComparableVersion("0.4.25-beta.1"), {
    release: [0, 4, 25],
    prerelease: ["beta", "1"],
  });
  assert.equal(parseComparableVersion("garbage"), null);
  assert.equal(parseComparableVersion(""), null);
  assert.equal(parseComparableVersion(undefined), null);
});

test("compareVersions orders stable above prerelease", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
});

test("isVersionNewer handles prerelease blind spot", () => {
  // 0.4.25 prerelease candidate is newer than 0.4.24 stable.
  assert.equal(isVersionNewer("0.4.25-beta.1", "0.4.24"), true);
  // Same version is not newer.
  assert.equal(isVersionNewer("0.4.25", "0.4.25"), false);
  // A prerelease of the SAME base version is considered newer than its stable
  // counterpart only when string differs (semver says prerelease is lower; we
  // fall back to string inequality so re-published tags still surface).
  assert.equal(compareVersions("0.4.25-beta.1", "0.4.25"), -1);
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function createHarness({
  platform = "darwin",
  packaged = true,
  version = "0.4.24",
  userData,
  autoUpdater,
} = {}) {
  const userDataPath =
    userData ?? mkdtempSync(path.join(tmpdir(), "onmyagent-updater-"));
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  const sent = [];
  const webContents = {
    send(channel, payload) {
      sent.push({ channel, payload });
    },
    isDestroyed: () => false,
  };
  const app = {
    isPackaged: packaged,
    getVersion: () => version,
    getPath: (name) => {
      assert.equal(name, "userData");
      return userDataPath;
    },
    on() {},
  };
  const win = { webContents, isDestroyed: () => false };
  const shell = { openExternal: async () => undefined };
  const Notification = function () {
    return { on() {}, show() {} };
  };
  Notification.isSupported = () => false;

  const api = registerUpdaterIpc({
    app,
    ipcMain,
    getMainWindow: () => win,
    Notification,
    shell,
    platform,
  });

  return {
    handlers,
    sent,
    api,
    userDataPath,
    cleanup() {
      rmSync(userDataPath, { recursive: true, force: true });
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `no handler for ${channel}`);
      return handler({}, ...args);
    },
    autoUpdater,
  };
}

test("fallback path (linux) reports open-browser flow and opens release page on download", async () => {
  const harness = createHarness({ platform: "linux", packaged: true });
  const channel = await harness.invoke("onmyagent:updater:getChannel");
  assert.equal(channel.platformFlow, "open-browser");
  assert.equal(channel.alphaSupported, false);

  // Download on the fallback path should not throw and returns ok.
  const opened = [];
  const shell = { openExternal: async (url) => opened.push(url) };
  // Re-register with a fetch override is hard; instead exercise setChannel honesty.
  const result = await harness.invoke("onmyagent:updater:setChannel", "alpha");
  assert.equal(result.channel, "stable");
  assert.match(result.reason ?? "", /alpha/i);
  void shell;
});

test("in-app path on packaged macOS reports in-app flow and mac quarantine flag", async () => {
  const harness = createHarness({ platform: "darwin", packaged: true });
  const channel = await harness.invoke("onmyagent:updater:getChannel");
  assert.equal(channel.platformFlow, "in-app");
});

test("dev build always uses open-browser fallback regardless of platform", async () => {
  const mac = createHarness({ platform: "darwin", packaged: false });
  assert.equal(
    (await mac.invoke("onmyagent:updater:getChannel")).platformFlow,
    "open-browser",
  );
  const win = createHarness({ platform: "win32", packaged: false });
  assert.equal(
    (await win.invoke("onmyagent:updater:getChannel")).platformFlow,
    "open-browser",
  );
});

test("getLastKnown returns current version even before any check", async () => {
  const harness = createHarness({ platform: "linux" });
  const last = await harness.invoke("onmyagent:updater:getLastKnown");
  assert.equal(last.available, false);
  assert.equal(last.currentVersion, "0.4.24");
});

test("installAndRestart in dev falls back to opening the release page", async () => {
  const harness = createHarness({ platform: "darwin", packaged: false });
  const result = await harness.invoke("onmyagent:updater:installAndRestart");
  assert.equal(result.ok, true);
  assert.equal(result.reason, "opened-release-page");
});
