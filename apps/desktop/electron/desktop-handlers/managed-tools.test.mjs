import assert from "node:assert/strict";
import { test } from "node:test";

import { createManagedToolsDomainHandlers } from "./managed-tools.mjs";

const officeStatus = {
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

const larkStatus = {
  pluginId: "lark-cli",
  state: "installed",
  supported: true,
  platform: "darwin-arm64",
  installedVersion: "1.0.84",
  latestVersion: "1.0.84",
  previousVersion: null,
  usable: true,
  lastCheckedAt: 1,
};

const connectionStatus = {
  phase: "installed_disconnected",
  installed: true,
  installedVersion: "1.0.84",
  appId: null,
  brand: null,
  userName: null,
  userOpenId: null,
  userTokenValid: false,
  botReady: false,
  message: null,
  errorCode: null,
  errorMessage: null,
  lastCheckedAt: 1,
};

const tencentDocsStatus = {
  phase: "disconnected",
  mcpConfigured: false,
  skillInstalled: false,
  authorized: false,
  serverNames: ["tencent-docs"],
  message: null,
  errorCode: null,
  errorMessage: null,
  lastCheckedAt: 1,
};

function stubManagers(overrides = {}) {
  return {
    officeCliManager: {
      getStatus: async () => officeStatus,
      checkForUpdates: async () => officeStatus,
      installLatest: async () => officeStatus,
      uninstall: async () => officeStatus,
      ...(overrides.officeCliManager ?? {}),
    },
    larkCliManager: {
      getStatus: async () => larkStatus,
      checkForUpdates: async () => larkStatus,
      installLatest: async () => larkStatus,
      uninstall: async () => larkStatus,
      ...(overrides.larkCliManager ?? {}),
    },
    larkCliAuth: {
      getConnectionStatus: async () => connectionStatus,
      getRecommendedScopesJson: async () => '{"scopes":{"user":[]}}\n',
      submitManualCredentials: async () => connectionStatus,
      startUserLogin: async () => ({
        sessionId: "s1",
        verificationUrl: "https://example.com",
        qrcodeDataUrl: null,
      }),
      completeUserLogin: async () => connectionStatus,
      startConfigInit: async () => ({
        verificationUrl: null,
        qrcodeDataUrl: null,
        pending: false,
      }),
      cancelConfigInit: async () => ({ ok: true }),
      disconnect: async () => connectionStatus,
      ...(overrides.larkCliAuth ?? {}),
    },
    tencentDocsConnector: {
      getStatus: async () => tencentDocsStatus,
      startConnect: async () => ({
        sessionId: "td1",
        authorizationUrl: "https://example.com/oauth",
      }),
      completeConnect: async () => ({
        ...tencentDocsStatus,
        phase: "connected",
        authorized: true,
        mcpConfigured: true,
        skillInstalled: true,
      }),
      cancelConnect: async () => ({ ok: true }),
      disconnect: async () => tencentDocsStatus,
      ...(overrides.tencentDocsConnector ?? {}),
    },
  };
}

test("managed tool status uses the cached path unless refresh is requested", async () => {
  const calls = [];
  const handlers = createManagedToolsDomainHandlers(
    stubManagers({
      officeCliManager: {
        getStatus: async () => {
          calls.push("getStatus");
          return officeStatus;
        },
        checkForUpdates: async (forceRefresh) => {
          calls.push(`checkForUpdates:${String(forceRefresh)}`);
          return { ...officeStatus, latestVersion: "1.0.103", state: "update_available" };
        },
      },
    }),
  );

  assert.deepEqual(await handlers.officeCliGetStatus(null, []), officeStatus);
  assert.equal(calls.join(","), "getStatus");
  assert.equal(
    (await handlers.officeCliGetStatus(null, [{ forceRefresh: true }])).state,
    "update_available",
  );
  assert.equal(calls.join(","), "getStatus,checkForUpdates:true");
});

test("managed tool install delegates to the verified manager operation", async () => {
  let installed = false;
  const handlers = createManagedToolsDomainHandlers(
    stubManagers({
      officeCliManager: {
        installLatest: async () => {
          installed = true;
          return officeStatus;
        },
        getStatus: async () => officeStatus,
      },
    }),
  );

  assert.deepEqual(await handlers.officeCliInstallLatest(), officeStatus);
  assert.equal(installed, true);
});

test("managed tool uninstall converts conflicts into a typed error status", async () => {
  const handlers = createManagedToolsDomainHandlers(
    stubManagers({
      officeCliManager: {
        uninstall: async () => {
          const error = new Error("user-owned skill");
          error.code = "skill_conflict";
          throw error;
        },
        getStatus: async () => officeStatus,
      },
    }),
  );

  assert.deepEqual(await handlers.officeCliUninstall(), {
    ...officeStatus,
    state: "error",
    errorCode: "skill_conflict",
    errorMessage: "user-owned skill",
  });
});

test("lark-cli handlers delegate to larkCliManager", async () => {
  let installed = false;
  const handlers = createManagedToolsDomainHandlers(
    stubManagers({
      larkCliManager: {
        getStatus: async () => larkStatus,
        installLatest: async () => {
          installed = true;
          return larkStatus;
        },
        uninstall: async () => ({ ...larkStatus, state: "not_installed", installedVersion: null }),
      },
    }),
  );

  assert.equal((await handlers.larkCliGetStatus(null, [])).pluginId, "lark-cli");
  assert.deepEqual(await handlers.larkCliInstallLatest(), larkStatus);
  assert.equal(installed, true);
  assert.equal((await handlers.larkCliUninstall()).state, "not_installed");
});
