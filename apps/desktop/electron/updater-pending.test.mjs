import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { registerUpdaterIpc } from "./updater.mjs";

function snapshotPath(userDataPath) {
  return path.join(userDataPath, "updater-last-known.json");
}

function writeSnapshot(userDataPath, payload) {
  writeFileSync(snapshotPath(userDataPath), JSON.stringify(payload), "utf8");
}

test("startup seeds ready-to-install state from a persisted snapshot", async () => {
  const userDataPath = mkdtempSync(path.join(tmpdir(), "onmyagent-pending-"));
  try {
    writeSnapshot(userDataPath, {
      available: true,
      currentVersion: "0.4.25",
      latestVersion: "0.4.27",
      releaseTag: "v0.4.27",
      releaseUrl: "https://example.test/release",
      releaseNotes: "notes",
      readyToInstall: true,
    });

    const handlers = new Map();
    const sent = [];
    registerUpdaterIpc({
      app: {
        isPackaged: true,
        getVersion: () => "0.4.25",
        getPath: () => userDataPath,
        on() {},
      },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      getMainWindow: () => ({
        webContents: {
          send: (channel, payload) => sent.push({ channel, payload }),
          isDestroyed: () => false,
        },
        isDestroyed: () => false,
      }),
      Notification: function () {
        return { on() {}, show() {} };
      },
      shell: { openExternal: async () => undefined },
      platform: "darwin",
    });

    const getLastKnown = handlers.get("onmyagent:updater:getLastKnown");
    const last = await getLastKnown();
    assert.equal(last.available, true);
    assert.equal(last.readyToInstall, true);
    assert.equal(last.latestVersion, "0.4.27");
    assert.equal(last.platformFlow, "in-app");

    // Seed only restores UI-ready state. Without a real electron-updater
    // `update-downloaded` (and without autoUpdater in this harness), install
    // must not pretend to quitAndInstall — it falls back to the release page.
    const install = await handlers.get("onmyagent:updater:installAndRestart")();
    assert.equal(install.ok, true);
    assert.equal(install.reason, "opened-release-page");
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("stale snapshot for the already-running version is discarded", () => {
  const userDataPath = mkdtempSync(path.join(tmpdir(), "onmyagent-stale-"));
  try {
    writeSnapshot(userDataPath, {
      available: true,
      currentVersion: "0.4.25",
      latestVersion: "0.4.25",
      readyToInstall: true,
    });

    registerUpdaterIpc({
      app: {
        isPackaged: true,
        getVersion: () => "0.4.25",
        getPath: () => userDataPath,
        on() {},
      },
      ipcMain: { handle() {} },
      getMainWindow: () => null,
      Notification: function () {
        return { on() {}, show() {} };
      },
      shell: { openExternal: async () => undefined },
      platform: "darwin",
    });

    assert.equal(existsSync(snapshotPath(userDataPath)), false);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

function createMockAutoUpdater({ version = "0.5.13", emitDownloaded = true } = {}) {
  const emitter = new EventEmitter();
  let checked = false;
  const autoUpdater = {
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    checkCalls: 0,
    downloadCalls: 0,
    quitAndInstallCalls: 0,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    setFeedURL() {},
    async checkForUpdates() {
      autoUpdater.checkCalls += 1;
      checked = true;
      // Matches electron-updater with autoDownload=false: no update-downloaded.
      emitter.emit("update-available", { version });
      return { updateInfo: { version }, downloadPromise: null };
    },
    async downloadUpdate() {
      autoUpdater.downloadCalls += 1;
      if (!checked) throw new Error("Please check update first");
      const info = { version };
      if (emitDownloaded) emitter.emit("update-downloaded", info);
      return ["C:\\cache\\update.exe"];
    },
    quitAndInstall() {
      autoUpdater.quitAndInstallCalls += 1;
    },
  };
  return autoUpdater;
}

test("seed-ready install wires cache via downloadUpdate then quitAndInstall", async () => {
  const userDataPath = mkdtempSync(path.join(tmpdir(), "onmyagent-wire-"));
  const mock = createMockAutoUpdater();
  try {
    writeSnapshot(userDataPath, {
      available: true,
      currentVersion: "0.5.12",
      latestVersion: "0.5.13",
      releaseTag: "v0.5.13",
      readyToInstall: true,
    });

    const handlers = new Map();
    const api = registerUpdaterIpc({
      app: {
        isPackaged: true,
        getVersion: () => "0.5.12",
        getPath: () => userDataPath,
        on() {},
      },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      getMainWindow: () => null,
      Notification: function () {
        return { on() {}, show() {} };
      },
      shell: { openExternal: async () => undefined },
      platform: "win32",
      createAutoUpdater: async () => mock,
    });

    await api.ensureAutoUpdater();
    const install = await handlers.get("onmyagent:updater:installAndRestart")();
    assert.equal(install.ok, true);
    assert.equal(mock.downloadCalls >= 1, true);
    assert.equal(mock.quitAndInstallCalls, 1);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("seed-ready install fails with still_verifying when cache never wires", async () => {
  const userDataPath = mkdtempSync(path.join(tmpdir(), "onmyagent-nowire-"));
  const mock = createMockAutoUpdater({ emitDownloaded: false });
  try {
    writeSnapshot(userDataPath, {
      available: true,
      currentVersion: "0.5.12",
      latestVersion: "0.5.13",
      readyToInstall: true,
    });

    const handlers = new Map();
    const api = registerUpdaterIpc({
      app: {
        isPackaged: true,
        getVersion: () => "0.5.12",
        getPath: () => userDataPath,
        on() {},
      },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      getMainWindow: () => null,
      Notification: function () {
        return { on() {}, show() {} };
      },
      shell: { openExternal: async () => undefined },
      platform: "win32",
      createAutoUpdater: async () => mock,
      pendingInstallTimeoutMs: 20,
    });

    await api.ensureAutoUpdater();
    const install = await handlers.get("onmyagent:updater:installAndRestart")();
    assert.equal(install.ok, false);
    assert.equal(install.reasonCode, "still_verifying");
    assert.equal(mock.quitAndInstallCalls, 0);
    assert.match(install.reason ?? "", /still being verified/i);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
