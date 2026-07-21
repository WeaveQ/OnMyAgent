/**
 * Main window creation, theme vibrancy, and media permission helpers.
 * Extracted from main.mjs (mechanical split; main remains composition root).
 */
import path from "node:path";
import { BrowserWindow } from "electron";

/**
 * @param {object} options
 * @param {() => import("electron").BrowserWindow | null} options.getMainWindow
 * @param {(win: import("electron").BrowserWindow | null) => void} options.setMainWindow
 * @param {import("electron").App} options.app
 * @param {import("electron").NativeTheme} options.nativeTheme
 * @param {typeof import("electron").session} options.session
 * @param {string} options.appName
 * @param {boolean} options.isDevMode
 * @param {number} options.minWidth
 * @param {number} options.minHeight
 * @param {import("electron").NativeImage | null} options.appIconImage
 * @param {string} options.dirname
 * @param {(win: import("electron").BrowserWindow) => void} options.applyApplicationMenuVisibility
 * @param {object} options.browserController
 * @param {() => void} options.flushPendingDeepLinks
 */
export function createDesktopWindowController(options) {
  const {
    getMainWindow,
    setMainWindow,
    app,
    nativeTheme,
    session,
    appName,
    isDevMode,
    minWidth,
    minHeight,
    appIconImage,
    dirname: electronDirname,
    applyApplicationMenuVisibility,
    browserController,
    flushPendingDeepLinks,
  } = options;

  function isLocalRendererOrigin(origin) {
    const value = String(origin ?? "").trim();
    if (!value || value === "file://") return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "file:" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]"
      );
    } catch {
      return false;
    }
  }

  function isMainWindowWebContents(webContents) {
    const mainWindow = getMainWindow();
    return Boolean(
      mainWindow && webContents && webContents.id === mainWindow.webContents.id,
    );
  }

  function shouldAllowMainWindowPermission(
    webContents,
    permission,
    origin,
    details = {},
  ) {
    if (!isMainWindowWebContents(webContents)) return false;
    if (!isLocalRendererOrigin(origin)) return false;
    if (permission !== "media" && permission !== "audioCapture") return true;
    const mediaType =
      typeof details.mediaType === "string" ? details.mediaType : "";
    if (mediaType && mediaType !== "audio") return false;
    const mediaTypes = Array.isArray(details.mediaTypes)
      ? details.mediaTypes
      : [];
    return (
      mediaTypes.length === 0 ||
      (mediaTypes.includes("audio") && !mediaTypes.includes("video"))
    );
  }

  function installMediaPermissionHandlers() {
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        callback(
          shouldAllowMainWindowPermission(
            webContents,
            permission,
            details?.requestingUrl,
            details,
          ),
        );
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission, requestingOrigin, details) =>
        shouldAllowMainWindowPermission(
          webContents,
          permission,
          requestingOrigin,
          details,
        ),
    );
  }

  function macosVibrancyForCurrentTheme() {
    // under-window for both themes: blur the desktop behind the frame so the
    // primary rail / list chrome can show WeChat-like frosted translucency.
    // (Light used to use "sidebar", which reads too solid next to wallpaper.)
    /** @type {"under-window"} */
    const material = "under-window";
    return material;
  }

  function applyNativeTheme(mode) {
    nativeTheme.themeSource = mode;

    if (process.platform !== "darwin") {
      return true;
    }

    const mainWindow = getMainWindow();
    mainWindow?.setVibrancy(macosVibrancyForCurrentTheme());
    mainWindow?.setBackgroundColor("#00000001");

    return true;
  }

  function activeWindowFromEvent(event) {
    return BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
  }

  async function createMainWindow() {
    let mainWindow = getMainWindow();
    if (mainWindow) return mainWindow;

    const preloadPath = path.join(electronDirname, "preload.mjs");
    const windowAppearanceOptions = {};
    if (process.platform === "darwin") {
      Object.assign(windowAppearanceOptions, {
        backgroundColor: "#00000001",
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 6, y: 12 },
        vibrancy: macosVibrancyForCurrentTheme(),
        visualEffectState: "active",
      });
    }

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: minWidth,
      minHeight: minHeight,
      title: appName,
      show: false,
      ...windowAppearanceOptions,
      ...(appIconImage && !appIconImage.isEmpty()
        ? { icon: appIconImage }
        : {}),
      webPreferences: {
        // The renderer owns session dispatch + event streams; keep it running
        // while hidden/minimized so background tasks are not interrupted.
        backgroundThrottling: false,
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    setMainWindow(mainWindow);
    mainWindow.setMinimumSize(minWidth, minHeight);
    applyApplicationMenuVisibility(mainWindow);

    if (isDevMode) {
      mainWindow.on("page-title-updated", (event) => {
        event.preventDefault();
        getMainWindow()?.setTitle(appName);
      });
      mainWindow.setTitle(appName);
    }

    mainWindow.once("ready-to-show", () => {
      if (isDevMode) {
        getMainWindow()?.setTitle(appName);
      }
      getMainWindow()?.show();
      if (isDevMode && process.env.ONMYAGENT_OPEN_DEVTOOLS === "1") {
        try {
          getMainWindow()?.webContents.openDevTools({ mode: "detach" });
        } catch (error) {
          console.warn("[main] openDevTools failed:", error?.message ?? error);
        }
      }
      flushPendingDeepLinks();
    });

    // Detach BrowserViews while the window is still alive. Doing this only on
    // "closed" races Electron teardown and throws "Object has been destroyed".
    mainWindow.on("close", () => {
      try {
        browserController.destroyBrowserView();
      } catch (error) {
        console.warn(
          "[main] destroyBrowserView on close failed:",
          error?.message ?? error,
        );
      }
    });
    mainWindow.on("closed", () => {
      try {
        browserController.destroyBrowserView();
      } catch {
        // Already cleaned up in "close", or window is fully gone.
      }
      browserController.setMainWindow(null);
      setMainWindow(null);
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const local =
        url.startsWith("file://") ||
        url.startsWith("http://127.0.0.1") ||
        url.startsWith("http://localhost");
      if (!local) {
        void browserController.openAllowedExternalUrl(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });

    const startUrl =
      process.env.ONMYAGENT_ELECTRON_START_URL?.trim() ||
      process.env.ELECTRON_START_URL?.trim();
    try {
      // Drop residual Chromium caches before the first paint so a previous
      // optimize-deps graph cannot blank the window after a Vite rebuild.
      if (isDevMode) {
        try {
          await session.defaultSession.clearCache();
        } catch (cacheError) {
          console.warn(
            "[main-window] clearCache failed:",
            cacheError?.message ?? cacheError,
          );
        }
      }
      if (startUrl) {
        if (isDevMode) {
          await mainWindow.loadURL(startUrl, {
            extraHeaders: "Cache-Control: no-cache\nPragma: no-cache\n",
          });
        } else {
          await mainWindow.loadURL(startUrl);
        }
      } else {
        const packagedIndexPath = path.join(
          process.resourcesPath,
          "app-dist",
          "index.html",
        );
        const devIndexPath = path.resolve(electronDirname, "../../app/dist/index.html");
        await mainWindow.loadFile(
          app.isPackaged ? packagedIndexPath : devIndexPath,
        );
      }
    } catch (error) {
      console.warn("[main-window] initial load failed", error);
      await mainWindow.loadURL("about:blank").catch(() => undefined);
    }

    browserController.setMainWindow(mainWindow);
    if (!browserController.hasActiveBrowserTab()) {
      browserController.createBrowserTab("about:blank", { select: true });
    }

    return mainWindow;
  }

  return {
    installMediaPermissionHandlers,
    macosVibrancyForCurrentTheme,
    applyNativeTheme,
    activeWindowFromEvent,
    createMainWindow,
  };
}
