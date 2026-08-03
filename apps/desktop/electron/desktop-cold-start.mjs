/**
 * Desktop cold-start orchestration helpers.
 *
 * Pure / injectable so unit tests can prove:
 * - main window opens before deferred channel autoStart / Computer Use restore
 * - cold runtime bootstrap does not double-call prepareFreshRuntime
 *   (engineStart already cleans once)
 */

/**
 * Build the async task used for the first packaged runtime bootstrap.
 * Intentionally does NOT call prepareFreshRuntime — engineStart does that once.
 *
 * @param {{ bootRuntime: () => Promise<unknown> }} options
 * @returns {() => Promise<unknown>}
 */
export function createColdRuntimeBootstrapTask(options) {
  const bootRuntime = options?.bootRuntime;
  if (typeof bootRuntime !== "function") {
    throw new Error("bootRuntime is required");
  }
  return () => bootRuntime();
}

/**
 * Ordered cold-start runner for app.whenReady.
 * Critical path: minimal setup → createMainWindow → then deferred services.
 *
 * @param {object} deps
 * @param {() => Promise<unknown>} deps.startBrowserRpc
 * @param {() => void} deps.installMediaPermissionHandlers
 * @param {() => void} deps.installApplicationMenu
 * @param {() => void} deps.installStatusItem
 * @param {() => Promise<unknown>} deps.ensureUserDataDirs
 * @param {() => Promise<unknown>} deps.migrateLegacyWorkspaceState
 * @param {() => Promise<{ webContents: { on: Function } }>} deps.createMainWindow
 * @param {() => Promise<unknown>} deps.restoreComputerUseServices
 * @param {() => Promise<unknown>} deps.startUiControl
 * @param {Array<() => Promise<unknown>>} deps.channelAutoStarts
 * @param {() => void} deps.queueDeepLinks
 * @param {(activity: unknown) => void} [deps.onComputerUseActivity]
 * @param {(appshot: unknown) => void} [deps.onComputerUseAppshot]
 * @param {(listener: (activity: unknown) => void) => void} [deps.watchComputerUseActivity]
 * @param {(listener: (appshot: unknown) => void) => void} [deps.watchComputerUseAppshots]
 * @param {() => void} deps.flushPendingDeepLinks
 * @param {() => boolean} deps.hasRuntimeBootstrap
 * @param {(task: Promise<unknown>) => void} deps.setRuntimeBootstrap
 * @param {() => Promise<unknown>} deps.bootRuntimeForSelectedWorkspace
 * @param {() => void} deps.ensureAutoUpdater
 * @param {(error: unknown, label: string) => void} [deps.onDeferredError]
 * @returns {Promise<{ window: unknown, stepLog: string[] }>}
 */
export async function runDesktopWhenReady(deps) {
  const stepLog = [];
  const log = (step) => {
    stepLog.push(step);
  };
  const onDeferredError =
    typeof deps.onDeferredError === "function"
      ? deps.onDeferredError
      : () => undefined;

  log("startBrowserRpc");
  await deps.startBrowserRpc();

  log("installMediaPermissionHandlers");
  deps.installMediaPermissionHandlers();

  log("installApplicationMenu");
  deps.installApplicationMenu();

  log("installStatusItem");
  deps.installStatusItem();

  log("ensureUserDataDirs");
  await deps.ensureUserDataDirs();

  // Shared workspace state migration is cheap and needed before runtime boot
  // reads the selected workspace — keep it on the critical path.
  log("migrateLegacyWorkspaceState");
  await deps.migrateLegacyWorkspaceState();

  log("queueDeepLinks");
  deps.queueDeepLinks();

  // Open the window before deferred channel / Computer Use work so first paint
  // is not blocked by messaging autoStart or CU restore I/O.
  log("createMainWindow");
  const win = await deps.createMainWindow();

  if (typeof deps.watchComputerUseActivity === "function" && deps.onComputerUseActivity) {
    log("watchComputerUseActivity");
    deps.watchComputerUseActivity(deps.onComputerUseActivity);
  }
  if (typeof deps.watchComputerUseAppshots === "function" && deps.onComputerUseAppshot) {
    log("watchComputerUseAppshots");
    deps.watchComputerUseAppshots(deps.onComputerUseAppshot);
  }

  if (win?.webContents?.on && typeof deps.flushPendingDeepLinks === "function") {
    win.webContents.on("did-finish-load", () => {
      deps.flushPendingDeepLinks();
    });
  }

  // Deferred: never await on the cold path after the window has started.
  log("scheduleDeferredServices");
  void Promise.resolve()
    .then(() => deps.restoreComputerUseServices())
    .catch((error) => onDeferredError(error, "ComputerUse"));
  void Promise.resolve()
    .then(() => deps.startUiControl())
    .catch((error) => onDeferredError(error, "ui-control"));

  const channelAutoStarts = Array.isArray(deps.channelAutoStarts)
    ? deps.channelAutoStarts
    : [];
  for (const autoStart of channelAutoStarts) {
    if (typeof autoStart !== "function") continue;
    void Promise.resolve()
      .then(() => autoStart())
      .catch((error) => onDeferredError(error, "channel-autoStart"));
  }

  if (!deps.hasRuntimeBootstrap()) {
    log("runtimeBootstrap");
    const task = createColdRuntimeBootstrapTask({
      bootRuntime: deps.bootRuntimeForSelectedWorkspace,
    })().catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    deps.setRuntimeBootstrap(task);
  }

  log("ensureAutoUpdater");
  deps.ensureAutoUpdater();

  return { window: win, stepLog };
}

/**
 * Whether createMainWindow should eagerly open an about:blank browser tab.
 * Cold path keeps this false; first real browser open creates a tab on demand.
 */
export const MAIN_WINDOW_EAGER_BLANK_BROWSER_TAB = false;
