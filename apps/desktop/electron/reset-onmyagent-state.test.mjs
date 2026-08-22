import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  listOnMyAgentResetTargets,
  normalizeResetMode,
  RESET_RELAUNCH_EXIT_CODE,
  resetOnMyAgentLocalData,
  waitForPendingFullResetMarkerGone,
} from "./reset-onmyagent-state.mjs";

test("waitForPendingFullResetMarkerGone returns once the marker disappears", async () => {
  assert.equal(RESET_RELAUNCH_EXIT_CODE, 82);
  let present = true;
  let now = 0;
  const gone = await waitForPendingFullResetMarkerGone({
    markerPath: "/tmp/fake-pending-reset",
    exists: () => present,
    now: () => now,
    sleep: async () => {
      present = false;
      now += 150;
    },
    timeoutMs: 1_000,
  });
  assert.equal(gone, true);
});

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
  assert.deepEqual(result, { removed: [], missing: [], errors: [], deferred: [] });
});

test("full reset drains runtimes before deleting its first target", async () => {
  const order = [];
  await resetOnMyAgentLocalData({
    mode: "all",
    homeDir: "/tmp/reset-home",
    userDataDir: "/tmp/reset-user-data",
    prepareDestructiveReset: async (reason) => order.push(`prepare:${reason}`),
    remove: async (target) => order.push(`remove:${target}`),
  });
  assert.equal(order[0], "prepare:full_reset");
  assert.match(order[1], /^remove:/);
});

test("failed full-reset drain leaves every target intact", async () => {
  let removes = 0;
  await assert.rejects(
    resetOnMyAgentLocalData({
      mode: "all",
      homeDir: "/tmp/reset-home",
      userDataDir: "/tmp/reset-user-data",
      prepareDestructiveReset: async () => {
        throw Object.assign(new Error("drain failed"), { code: "TASK_DRAIN_FAILED" });
      },
      remove: async () => { removes += 1; },
    }),
    /drain failed/,
  );
  assert.equal(removes, 0);
});

test("retryable busy locks are deferred instead of failing the reset", async () => {
  const result = await resetOnMyAgentLocalData({
    mode: "all",
    homeDir: "/tmp/reset-home-busy",
    userDataDir: "/tmp/reset-user-data-busy",
    writeMarker: async () => undefined,
    remove: async (target) => {
      if (target === "/tmp/reset-user-data-busy") {
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      }
    },
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.deferred.some((item) => item.includes("EBUSY") || item.includes("busy")));
});

test("full reset writes a pending marker and schedules deferred cleanup", async () => {
  const order = [];
  await resetOnMyAgentLocalData({
    mode: "all",
    homeDir: "/tmp/reset-home-defer",
    userDataDir: "/tmp/reset-user-data-defer",
    writeMarker: async ({ path: file }) => order.push(`marker:${file}`),
    prepareDestructiveReset: async () => order.push("prepare"),
    remove: async (target) => order.push(`remove:${target}`),
    scheduleDeferred: ({ markerPath }) => order.push(`schedule:${markerPath}`),
  });
  assert.equal(order[0], "prepare");
  assert.ok(order.some((item) => item.startsWith("marker:")));
  assert.ok(order.at(-1)?.startsWith("schedule:"));
});

test("onboarding reset does not drain long-running tasks", async () => {
  let preparations = 0;
  await resetOnMyAgentLocalData({
    mode: "onboarding",
    prepareDestructiveReset: async () => { preparations += 1; },
  });
  assert.equal(preparations, 0);
});
