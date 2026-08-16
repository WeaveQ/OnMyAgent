/**
 * Cold-start contracts: single prepare, window before deferred services,
 * no eager blank browser tab flag.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  MAIN_WINDOW_EAGER_BLANK_BROWSER_TAB,
  createColdRuntimeBootstrapTask,
  runDesktopWhenReady,
} from "./desktop-cold-start.mjs";
import { createStatusItemLifecycle } from "./status-item.mjs";

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
    let supervisorStartedAfterWindow = false;
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
      startTaskSupervisor: async () => {
        supervisorStartedAfterWindow = windowCreated;
        order.push("task-supervisor");
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
    assert.equal(supervisorStartedAfterWindow, true);

    const windowOrderIdx = order.indexOf("window");
    const cuIdx = order.indexOf("cu-restore");
    const channelIdx = order.indexOf("channel-weixin");
    const supervisorIdx = order.indexOf("task-supervisor");
    assert.ok(windowOrderIdx >= 0);
    assert.ok(cuIdx > windowOrderIdx, "CU restore after window create");
    assert.ok(channelIdx > windowOrderIdx, "channel autoStart after window create");
    assert.ok(supervisorIdx > windowOrderIdx, "Task Supervisor after window create");

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

  test("desktop-window does not clear Chromium cache on every dev launch", () => {
    const source = readFileSync(
      path.join(__dirname, "desktop-window.mjs"),
      "utf8",
    );
    assert.doesNotMatch(source, /session\.defaultSession\.clearCache\(/);
  });

  test("main.mjs uses runDesktopWhenReady and does not double prepareFreshRuntime on cold bootstrap", () => {
    const source = readFileSync(path.join(__dirname, "main.mjs"), "utf8");
    assert.match(source, /runDesktopWhenReady/);
    assert.match(source, /startTaskSupervisor:\s*async\s*\(\)\s*=>\s*\{[\s\S]*await startTaskSupervisorBackground\(\{\s*runtimeBootstrap:\s*desktopRuntimeBoot\.getRuntimeBootstrapPromise\(\)/);
    // Old cold path wrapped prepareFreshRuntime then bootRuntime — must be gone.
    assert.doesNotMatch(
      source,
      /runtimeBootstrapPromise\s*=\s*\(async\s*\(\)\s*=>\s*\{\s*await\s+runtimeManager\.prepareFreshRuntime/,
    );
  });

  test("explicit quit pauses the durable owner before disposing desktop services and restores tray state on failure", () => {
    const source = readFileSync(path.join(__dirname, "main.mjs"), "utf8");
    const start = source.indexOf('app.on("before-quit"');
    const end = source.indexOf('app.on("second-instance"', start);
    assert.ok(start >= 0 && end > start, "before-quit lifecycle exists");
    const lifecycle = source.slice(start, end);
    const pause = lifecycle.indexOf("await disposeRuntimeBeforeQuit()");
    const terminalDispose = lifecycle.indexOf("codeTerminalManager.dispose()");
    assert.ok(pause >= 0 && terminalDispose > pause, "desktop cleanup follows durable pause");
    assert.match(lifecycle, /if \(safeQuitPromise\) return/);
    assert.match(lifecycle, /statusItem\.cancelQuitting\(\)/);
  });
});

describe("updater quit lifecycle", () => {
  test("updater quit signal disables hide-on-close before Electron closes windows", () => {
    const nativeAutoUpdater = new EventEmitter();
    const lifecycle = createStatusItemLifecycle({
      app: { getLocale: () => "en", name: "OnMyAgent", quit() {} },
      Tray: class {},
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: {},
      createMainWindow: async () => ({}),
      getMainWindow: () => null,
      nativeAutoUpdater,
      platform: "darwin",
    });

    assert.equal(lifecycle.shouldHideOnClose(), true);
    nativeAutoUpdater.emit("before-quit-for-update");
    assert.equal(lifecycle.shouldHideOnClose(), false);
  });
});
