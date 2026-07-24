import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  listOnMyAgentResetTargets,
  normalizeResetMode,
  resetOnMyAgentLocalData,
} from "./reset-onmyagent-state.mjs";

test("normalizeResetMode defaults to onboarding", () => {
  assert.equal(normalizeResetMode(undefined), "onboarding");
  assert.equal(normalizeResetMode("onboarding"), "onboarding");
  assert.equal(normalizeResetMode("ALL"), "all");
  assert.equal(normalizeResetMode("nope"), "onboarding");
});

test("onboarding mode has no disk wipe targets (renderer owns prefs/guide)", () => {
  const home = "/tmp/home-onmyagent-reset";
  const userData = path.join(home, "Library/Application Support/com.differentai.onmyagent.dev");
  const targets = listOnMyAgentResetTargets({
    mode: "onboarding",
    homeDir: home,
    userDataDir: userData,
    appDataDir: path.join(home, "Library/Application Support"),
    platform: "darwin",
  });

  assert.deepEqual(targets, []);
});

test("all mode includes product wipe paths and excludes shared CLI homes", () => {
  const home = "/tmp/home-onmyagent-reset-all";
  const appData = path.join(home, "Library/Application Support");
  const userData = path.join(appData, "com.differentai.onmyagent.dev");
  const targets = listOnMyAgentResetTargets({
    mode: "all",
    homeDir: home,
    userDataDir: userData,
    appDataDir: appData,
    platform: "darwin",
  });

  const legacyProductHome = path.join(home, `.${"open"}${"work"}`);
  for (const expected of [
    userData,
    path.join(home, ".onmyagent"),
    path.join(home, ".studio-switch"),
    legacyProductHome,
    path.join(home, ".config/onmyagent"),
    path.join(appData, "OnMyAgent"),
    path.join(home, "Library/Preferences/com.differentai.onmyagent.plist"),
  ]) {
    assert.ok(targets.includes(expected), `missing ${expected}`);
  }

  for (const forbidden of [
    path.join(home, ".config/opencode"),
    path.join(home, ".opencode"),
    path.join(home, ".claude"),
    path.join(home, ".codex"),
    path.join(home, ".openclaw"),
    path.join(home, ".agents"),
  ]) {
    assert.ok(!targets.includes(forbidden), `must not wipe ${forbidden}`);
  }
});

test("resetOnMyAgentLocalData reports removed / missing / errors for all mode", async () => {
  const calls = [];
  const result = await resetOnMyAgentLocalData({
    mode: "all",
    homeDir: "/tmp/reset-home",
    userDataDir: "/tmp/reset-user-data",
    appDataDir: "/tmp/reset-home/Application Support",
    desktopBootstrapPath: "/tmp/reset-home/.config/onmyagent/desktop-bootstrap.json",
    platform: "darwin",
    remove: async (target) => {
      calls.push(target);
      if (target.endsWith("workspace-state.json")) {
        const err = new Error("no such file");
        /** @type {any} */ (err).code = "ENOENT";
        throw err;
      }
      if (target.endsWith("onmyagent-workspaces.json")) {
        throw new Error("busy");
      }
    },
  });

  assert.ok(calls.length >= 2);
  assert.ok(result.errors.some((item) => item.includes("busy")));
  assert.ok(result.missing.some((item) => item.endsWith("workspace-state.json")));
  assert.ok(result.removed.length >= 1);
});

test("onboarding reset returns empty result without calling remove", async () => {
  let calls = 0;
  const result = await resetOnMyAgentLocalData({
    mode: "onboarding",
    homeDir: "/tmp/reset-home",
    userDataDir: "/tmp/reset-user-data",
    remove: async () => {
      calls += 1;
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, { removed: [], missing: [], errors: [] });
});
