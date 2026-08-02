/**
 * Cold-start contracts: single prepare, window before deferred services,
 * no eager blank browser tab flag.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  MAIN_WINDOW_EAGER_BLANK_BROWSER_TAB,
  createColdRuntimeBootstrapTask,
  runDesktopWhenReady,
} from "./desktop-cold-start.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("createColdRuntimeBootstrapTask", () => {
  test("runs bootRuntime without calling prepareFreshRuntime", async () => {
    const calls = [];
    const task = createColdRuntimeBootstrapTask({
      bootRuntime: async () => {
        calls.push("bootRuntime");
        return { ok: true };
      },
    });
    // Simulated engineStart path would call prepareFreshRuntime once; cold
    // bootstrap task must not add a second prepare.
    const result = await task();
    assert.deepEqual(calls, ["bootRuntime"]);
    assert.equal(result.ok, true);
  });

  test("rejects missing bootRuntime", () => {
    assert.throws(
      () => createColdRuntimeBootstrapTask({}),
      /bootRuntime is required/,
    );
  });
});

describe("runDesktopWhenReady", () => {
  test("creates main window before channel autoStart and Computer Use restore", async () => {
    const order = [];
    let restoreStartedAfterWindow = false;
    let channelStartedAfterWindow = false;
    let windowCreated = false;
    let restoreResolve;
    const restoreGate = new Promise((resolve) => {
      restoreResolve = resolve;
    });

    const { stepLog } = await runDesktopWhenReady({
      startBrowserRpc: async () => {
        order.push("rpc");
      },
      installMediaPermissionHandlers: () => order.push("media"),
      installApplicationMenu: () => order.push("menu"),
      installStatusItem: () => order.push("status"),
      ensureUserDataDirs: async () => {
        order.push("dirs");
      },
      migrateLegacyWorkspaceState: async () => {
        order.push("migrate");
      },
      createMainWindow: async () => {
        windowCreated = true;
        order.push("window");
        return {
          webContents: {
            on: (_event, _fn) => undefined,
          },
        };
      },
      restoreComputerUseServices: async () => {
        // If this were awaited before window, windowCreated would still be false.
        restoreStartedAfterWindow = windowCreated;
        order.push("cu-restore");
        restoreResolve();
      },
      startUiControl: async () => {
        order.push("ui-control");
      },
      channelAutoStarts: [
        async () => {
          channelStartedAfterWindow = windowCreated;
          order.push("channel-weixin");
        },
        async () => {
          order.push("channel-feishu");
        },
      ],
      queueDeepLinks: () => order.push("deeplinks"),
      flushPendingDeepLinks: () => undefined,
      hasRuntimeBootstrap: () => false,
      setRuntimeBootstrap: (task) => {
        order.push("set-bootstrap");
        void task;
      },
      bootRuntimeForSelectedWorkspace: async () => {
        order.push("boot-runtime");
        return { ok: true };
      },
      ensureAutoUpdater: () => order.push("updater"),
      onDeferredError: () => undefined,
    });

    // Critical path must open the window before any deferred step is scheduled
    // as a completed await. createMainWindow is in stepLog before scheduleDeferred.
    const windowIdx = stepLog.indexOf("createMainWindow");
    const deferredIdx = stepLog.indexOf("scheduleDeferredServices");
    assert.ok(windowIdx >= 0, "createMainWindow in step log");
    assert.ok(deferredIdx > windowIdx, "deferred services after window");

    // Wait for microtask-scheduled deferred work.
    await restoreGate;
    await new Promise((r) => setImmediate(r));

    assert.equal(restoreStartedAfterWindow, true);
    assert.equal(channelStartedAfterWindow, true);

    const windowOrderIdx = order.indexOf("window");
    const cuIdx = order.indexOf("cu-restore");
    const channelIdx = order.indexOf("channel-weixin");
    assert.ok(windowOrderIdx >= 0);
    assert.ok(cuIdx > windowOrderIdx, "CU restore after window create");
    assert.ok(channelIdx > windowOrderIdx, "channel autoStart after window create");

    // Runtime bootstrap is scheduled without an extra prepareFreshRuntime step.
    assert.ok(stepLog.includes("runtimeBootstrap"));
    assert.ok(!stepLog.includes("prepareFreshRuntime"));
  });

  test("does not re-enter runtime bootstrap when already pending", async () => {
    let bootCalls = 0;
    await runDesktopWhenReady({
      startBrowserRpc: async () => undefined,
      installMediaPermissionHandlers: () => undefined,
      installApplicationMenu: () => undefined,
      installStatusItem: () => undefined,
      ensureUserDataDirs: async () => undefined,
      migrateLegacyWorkspaceState: async () => undefined,
      createMainWindow: async () => ({
        webContents: { on: () => undefined },
      }),
      restoreComputerUseServices: async () => undefined,
      startUiControl: async () => undefined,
      channelAutoStarts: [],
      queueDeepLinks: () => undefined,
      flushPendingDeepLinks: () => undefined,
      hasRuntimeBootstrap: () => true,
      setRuntimeBootstrap: () => {
        throw new Error("should not set bootstrap when already pending");
      },
      bootRuntimeForSelectedWorkspace: async () => {
        bootCalls += 1;
        return { ok: true };
      },
      ensureAutoUpdater: () => undefined,
    });
    assert.equal(bootCalls, 0);
  });
});

describe("MAIN_WINDOW_EAGER_BLANK_BROWSER_TAB contract", () => {
  test("flag is false so cold path skips about:blank tab", () => {
    assert.equal(MAIN_WINDOW_EAGER_BLANK_BROWSER_TAB, false);
  });

  test("desktop-window ships the flag gate (no unconditional about:blank)", () => {
    const source = readFileSync(
      path.join(__dirname, "desktop-window.mjs"),
      "utf8",
    );
    assert.match(source, /MAIN_WINDOW_EAGER_BLANK_BROWSER_TAB/);
    // Must not have the old unconditional pattern without the flag.
    assert.doesNotMatch(
      source,
      /if\s*\(\s*!browserController\.hasActiveBrowserTab\(\)\s*\)\s*\{\s*browserController\.createBrowserTab\(\s*["']about:blank["']/,
    );
  });

  test("main.mjs uses runDesktopWhenReady and does not double prepareFreshRuntime on cold bootstrap", () => {
    const source = readFileSync(path.join(__dirname, "main.mjs"), "utf8");
    assert.match(source, /runDesktopWhenReady/);
    // Old cold path wrapped prepareFreshRuntime then bootRuntime — must be gone.
    assert.doesNotMatch(
      source,
      /runtimeBootstrapPromise\s*=\s*\(async\s*\(\)\s*=>\s*\{\s*await\s+runtimeManager\.prepareFreshRuntime/,
    );
  });
});
