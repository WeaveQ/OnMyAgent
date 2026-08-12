import test from "node:test";
import assert from "node:assert/strict";
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
