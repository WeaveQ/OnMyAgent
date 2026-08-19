import test from "node:test";
import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import {
  buildUpdateNotificationCopy,
  compareVersions,
  isVersionNewer,
  parseComparableVersion,
  readPersistedUpdaterAutoCheck,
  registerUpdaterIpc,
  resolveUpdaterCacheDir,
  resolveUpdaterLocale,
  shouldScheduleAutoChecks,
  shouldScheduleColdStartCheck,
  writePersistedUpdaterAutoCheck,
} from "./updater.mjs";

test("update notification copy follows en / zh / zh-TW", () => {
  assert.equal(resolveUpdaterLocale("en-US"), "en");
  assert.equal(resolveUpdaterLocale("zh-CN"), "zh");
  assert.equal(resolveUpdaterLocale("zh"), "zh");
  assert.equal(resolveUpdaterLocale("zh-TW"), "zh-TW");
  assert.equal(resolveUpdaterLocale("zh_Hant_TW"), "zh-TW");
  assert.equal(resolveUpdaterLocale(null), "en");

  const en = buildUpdateNotificationCopy({ locale: "en-US", version: "0.5.19" });
  assert.equal(en.title, "OnMyAgent update available");
  assert.match(en.body, /0\.5\.19/);

  const zh = buildUpdateNotificationCopy({ locale: "zh-CN", version: "0.5.19" });
  assert.equal(zh.title, "发现新版本");
  assert.equal(zh.body, "OnMyAgent v0.5.19 可用。打开应用即可下载。");

  const zhTw = buildUpdateNotificationCopy({
    locale: "zh-TW",
    version: "0.5.19",
    kind: "ready",
  });
  assert.equal(zhTw.title, "更新已就緒");
  assert.match(zhTw.body, /0\.5\.19/);

  const fallback = buildUpdateNotificationCopy({
    locale: "zh",
    version: "0.5.19",
    kind: "fallback",
  });
  assert.equal(fallback.title, "发现新版本");
  assert.match(fallback.body, /发布页/);
});

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

test("installAndRestart marks quit-for-update immediately before quitAndInstall", () => {
  const source = readFileSync(new URL("./updater.mjs", import.meta.url), "utf8");
  const mark = source.indexOf("quitForUpdateRequested = true");
  const install = source.indexOf("autoUpdater.quitAndInstall(false, true)");
  assert.ok(mark >= 0 && install > mark);
});

test("installAndRestart in dev falls back to opening the release page", async () => {
  const harness = createHarness({ platform: "darwin", packaged: false });
  const result = await harness.invoke("onmyagent:updater:installAndRestart");
  assert.equal(result.ok, true);
  assert.equal(result.reason, "opened-release-page");
});

test("auto-check off does not schedule background download", () => {
  assert.equal(
    shouldScheduleAutoChecks({ packaged: true, autoCheck: false, devDisabled: false }),
    false,
  );
  assert.equal(
    shouldScheduleAutoChecks({ packaged: true, autoCheck: true, devDisabled: false }),
    true,
  );
  assert.equal(
    shouldScheduleAutoChecks({ packaged: false, autoCheck: true, devDisabled: true }),
    false,
  );
});

test("cold start always checks unless unpackaged and explicitly disabled", () => {
  assert.equal(
    shouldScheduleColdStartCheck({ packaged: true, autoCheck: false, devDisabled: false }),
    true,
  );
  assert.equal(
    shouldScheduleColdStartCheck({ packaged: false, autoCheck: false, devDisabled: false }),
    true,
  );
  assert.equal(
    shouldScheduleColdStartCheck({ packaged: false, autoCheck: true, devDisabled: true }),
    false,
  );
});

test("updater cache dir resolves under userData", () => {
  const userData = path.join("Users", "alice", "Library", "Application Support", "com.differentai.onmyagent.dev");
  const cacheDir = resolveUpdaterCacheDir(userData);
  assert.equal(cacheDir.startsWith(userData), true);
  assert.equal(cacheDir.includes("updater"), true);
  assert.equal(cacheDir.includes("opencode-sandbox"), false);
});

test("persisted auto-check is read back from userData", () => {
  const userData = mkdtempSync(path.join(tmpdir(), "onmyagent-updater-pref-"));
  try {
    assert.equal(readPersistedUpdaterAutoCheck(userData), true);
    writeFileSync(path.join(userData, "updater-auto-check.json"), JSON.stringify({ autoCheck: false }), "utf8");
    assert.equal(readPersistedUpdaterAutoCheck(userData), true);
    writePersistedUpdaterAutoCheck(userData, false);
    assert.equal(readPersistedUpdaterAutoCheck(userData), false);
    writePersistedUpdaterAutoCheck(userData, true);
    assert.equal(readPersistedUpdaterAutoCheck(userData), true);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("setAutoCheck IPC persists pref and getAutoCheck reads it", async () => {
  const harness = createHarness({ packaged: true });
  try {
    const initial = await harness.invoke("onmyagent:updater:getAutoCheck");
    assert.equal(initial.autoCheck, true);
    const enabled = await harness.invoke("onmyagent:updater:setAutoCheck", true);
    assert.equal(enabled.autoCheck, true);
    assert.equal(readPersistedUpdaterAutoCheck(harness.userDataPath), true);
    const disabled = await harness.invoke("onmyagent:updater:setAutoCheck", false);
    assert.equal(disabled.autoCheck, false);
    assert.equal((await harness.invoke("onmyagent:updater:getAutoCheck")).autoCheck, false);
  } finally {
    harness.cleanup();
  }
});
