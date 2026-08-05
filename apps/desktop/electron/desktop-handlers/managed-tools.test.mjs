import assert from "node:assert/strict";
import { test } from "node:test";

import { createManagedToolsDomainHandlers } from "./managed-tools.mjs";

const installedStatus = {
  pluginId: "officecli",
  state: "installed",
  supported: true,
  platform: "darwin-arm64",
  installedVersion: "1.0.102",
  latestVersion: "1.0.102",
  previousVersion: null,
  usable: true,
  lastCheckedAt: 1,
};

test("managed tool status uses the cached path unless refresh is requested", async () => {
  const calls = [];
  const handlers = createManagedToolsDomainHandlers({
    officeCliManager: {
      getStatus: async () => {
        calls.push("getStatus");
        return installedStatus;
      },
      checkForUpdates: async (forceRefresh) => {
        calls.push(`checkForUpdates:${String(forceRefresh)}`);
        return { ...installedStatus, latestVersion: "1.0.103", state: "update_available" };
      },
    },
  });

  assert.deepEqual(await handlers.officeCliGetStatus(null, []), installedStatus);
  assert.equal(calls.join(","), "getStatus");
  assert.equal(
    (await handlers.officeCliGetStatus(null, [{ forceRefresh: true }])).state,
    "update_available",
  );
  assert.equal(calls.join(","), "getStatus,checkForUpdates:true");
});

test("managed tool install delegates to the verified manager operation", async () => {
  let installed = false;
  const handlers = createManagedToolsDomainHandlers({
    officeCliManager: {
      installLatest: async () => {
        installed = true;
        return installedStatus;
      },
      getStatus: async () => installedStatus,
    },
  });

  assert.deepEqual(await handlers.officeCliInstallLatest(), installedStatus);
  assert.equal(installed, true);
});

test("managed tool uninstall converts conflicts into a typed error status", async () => {
  const handlers = createManagedToolsDomainHandlers({
    officeCliManager: {
      uninstall: async () => {
        const error = new Error("user-owned skill");
        error.code = "skill_conflict";
        throw error;
      },
      getStatus: async () => installedStatus,
    },
  });

  assert.deepEqual(await handlers.officeCliUninstall(), {
    ...installedStatus,
    state: "error",
    errorCode: "skill_conflict",
    errorMessage: "user-owned skill",
  });
});
