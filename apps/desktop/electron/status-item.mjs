/**
 * Desktop status item / system tray (Electron Tray) controller.
 * macOS menu bar (template icon) + Windows notification area (color icon).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STATUS_ITEM_ACTION,
  STATUS_ITEM_EVENTS,
  buildStatusItemMenuSpec,
  resolveStatusItemIcon,
  resolveStatusItemLocale,
  shouldHideMainWindowOnClose,
  shouldInstallStatusItem,
  shouldQuitOnWindowAllClosed,
} from "./status-item-menu.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ICON_PATH = path.join(
  __dirname,
  "../resources/icons/icon.png",
);

/**
 * @param {object} input
 * @param {import("electron").App} input.app
 * @param {typeof import("electron").Tray} input.Tray
 * @param {typeof import("electron").Menu} input.Menu
 * @param {typeof import("electron").nativeImage} input.nativeImage
 * @param {() => Promise<import("electron").BrowserWindow>} input.createMainWindow
 * @param {() => import("electron").BrowserWindow | null} input.getMainWindow
 * @param {() => void} [input.quitApp]
 * @param {() => Promise<unknown>} [input.openDesktopPermissions]
 * @param {() => Promise<unknown> | unknown} [input.openQuickCapture]
 * @param {string | null} [input.appIconPath] Brand app icon (icon.png); used to
 *   locate trayTemplate.png beside it, or as a color fallback.
 * @param {string} [input.iconPath] Deprecated alias of appIconPath.
 * @param {NodeJS.Platform | string} [input.platform]
 */
export function createStatusItemController(input) {
  const {
    app,
    Tray,
    Menu,
    nativeImage,
    createMainWindow,
    getMainWindow,
    quitApp = () => app.quit(),
    openDesktopPermissions,
    openQuickCapture,
    appIconPath = input.iconPath ?? DEFAULT_APP_ICON_PATH,
    platform = process.platform,
  } = input;

  /** @type {import("electron").Tray | null} */
  let tray = null;
  let isQuitting = false;

  function markQuitting() {
    isQuitting = true;
  }

  function isAppQuitting() {
    return isQuitting;
  }

  async function showAndFocusMainWindow() {
    const win = await createMainWindow();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.show();
    win.focus();
    return win;
  }

  async function sendToMainWindow(eventName) {
    const win = await showAndFocusMainWindow();
    if (!win.isDestroyed()) {
      win.webContents.send(eventName);
    }
  }

  async function runAction(actionId) {
    switch (actionId) {
      case STATUS_ITEM_ACTION.SHOW_WINDOW:
        await showAndFocusMainWindow();
        return;
      case STATUS_ITEM_ACTION.NEW_TASK:
        await sendToMainWindow(STATUS_ITEM_EVENTS.NEW_TASK);
        return;
      case STATUS_ITEM_ACTION.QUICK_CAPTURE:
        if (typeof openQuickCapture === "function") {
          await openQuickCapture();
        } else {
          await sendToMainWindow(STATUS_ITEM_EVENTS.QUICK_CAPTURE);
        }
        return;
      case STATUS_ITEM_ACTION.DESKTOP_PERMISSIONS:
        // Always open the main window + in-app settings (system / permissions).
        // Optional openDesktopPermissions may open OS privacy panes / helper apps.
        await showAndFocusMainWindow();
        await sendToMainWindow(STATUS_ITEM_EVENTS.DESKTOP_PERMISSIONS);
        if (typeof openDesktopPermissions === "function") {
          try {
            await openDesktopPermissions();
          } catch (error) {
            console.warn(
              "[status-item] openDesktopPermissions failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        return;
      case STATUS_ITEM_ACTION.OPEN_SETTINGS:
        await sendToMainWindow(STATUS_ITEM_EVENTS.OPEN_SETTINGS);
        return;
      case STATUS_ITEM_ACTION.QUIT:
        markQuitting();
        quitApp();
        return;
      default:
        return;
    }
  }

  /** @type {Record<string, string>} */
  let acceleratorOverrides = {};

  function buildNativeMenu() {
    const locale = resolveStatusItemLocale(
      typeof app.getLocale === "function" ? app.getLocale() : "en",
    );
    const spec = buildStatusItemMenuSpec({
      locale,
      accelerators: acceleratorOverrides,
    });
    /** @type {import("electron").MenuItemConstructorOptions[]} */
    const template = spec.map((entry) => {
      if (entry.type === "separator") return { type: "separator" };
      /** @type {import("electron").MenuItemConstructorOptions} */
      const item = {
        label: entry.label,
        click: () => {
          void runAction(entry.id);
        },
      };
      // Electron shows this on the trailing edge of the tray menu (⌘B style).
      if (entry.accelerator) item.accelerator = entry.accelerator;
      return item;
    });
    return Menu.buildFromTemplate(template);
  }

  /**
   * Rebuild tray menu accelerators when Settings → Shortcuts change.
   * Maps product keymap ids → status-item action ids.
   * @param {Record<string, string> | null | undefined} overrides
   */
  function setKeymapAcceleratorOverrides(overrides) {
    const next = overrides && typeof overrides === "object" ? overrides : {};
    /** @type {Record<string, string>} */
    const mapped = {};
    if (typeof next.quickCapture === "string") {
      mapped[STATUS_ITEM_ACTION.QUICK_CAPTURE] = next.quickCapture;
    }
    if (typeof next.newTask === "string") {
      mapped[STATUS_ITEM_ACTION.NEW_TASK] = next.newTask;
    }
    if (typeof next.openSettings === "string") {
      mapped[STATUS_ITEM_ACTION.OPEN_SETTINGS] = next.openSettings;
    }
    acceleratorOverrides = mapped;
    if (tray) {
      tray.setContextMenu(buildNativeMenu());
    }
  }

  function loadStatusItemIcon() {
    const resolved = resolveStatusItemIcon({
      appIconPath,
      platform,
    });

    if (!resolved.path) {
      console.warn("[status-item] no tray icon path resolved", {
        appIconPath,
        platform,
      });
      return nativeImage.createEmpty();
    }

    let image = nativeImage.createFromPath(resolved.path);
    if (image.isEmpty()) {
      console.warn("[status-item] tray icon empty at", resolved.path);
      return nativeImage.createEmpty();
    }

    // Menu-bar peers ~18pt (mac); Windows notification area ~16px.
    // Prefer shipping 18/@2x 36 trayTemplate and 16/32 trayIcon assets.
    const traySize = platform === "darwin" ? 18 : 16;
    if (typeof image.getSize === "function") {
      const { width, height } = image.getSize();
      // Only downscale; never upscale a crisp @1x template.
      if (width > traySize || height > traySize) {
        image = image.resize({ width: traySize, height: traySize });
      }
    }

    // macOS template only: black glyph + alpha, recolored by the system.
    // Windows uses color icons — never setTemplateImage there.
    if (resolved.template && typeof image.setTemplateImage === "function") {
      image.setTemplateImage(true);
    }
    return image;
  }

  function install() {
    if (!shouldInstallStatusItem(platform)) {
      return null;
    }
    if (tray) return tray;

    const image = loadStatusItemIcon();
    if (image.isEmpty()) {
      console.warn(
        "[status-item] refusing empty tray image — status item skipped",
      );
      return null;
    }
    tray = new Tray(image);
    tray.setToolTip(
      typeof app.name === "string" && app.name.trim()
        ? app.name
        : "OnMyAgent",
    );
    tray.setIgnoreDoubleClickEvents?.(true);
    tray.setContextMenu(buildNativeMenu());
    // macOS: left-click opens the menu (status-item convention).
    // Windows: left-click shows the window; right-click uses context menu.
    tray.on("click", () => {
      if (platform === "win32") {
        void runAction(STATUS_ITEM_ACTION.SHOW_WINDOW);
        return;
      }
      tray?.popUpContextMenu();
    });
    console.info("[status-item] tray / status item installed", {
      platform: String(platform),
    });
    return tray;
  }

  function dispose() {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  }

  /**
   * Show or hide the menu-bar status item without changing quit/hide policy.
   * @param {boolean} visible
   * @returns {{ ok: boolean, visible: boolean, platform: string }}
   */
  function setVisible(visible) {
    if (!shouldInstallStatusItem(platform)) {
      return { ok: true, visible: false, platform: String(platform) };
    }
    if (visible) {
      install();
      return {
        ok: Boolean(tray),
        visible: Boolean(tray),
        platform: String(platform),
      };
    }
    dispose();
    return { ok: true, visible: false, platform: String(platform) };
  }

  function isVisible() {
    return Boolean(tray);
  }

  function refreshMenu() {
    if (!tray) return;
    tray.setContextMenu(buildNativeMenu());
  }

  return {
    install,
    dispose,
    setVisible,
    isVisible,
    refreshMenu,
    setKeymapAcceleratorOverrides,
    runAction,
    showAndFocusMainWindow,
    markQuitting,
    isAppQuitting,
    /** @internal test/diag */
    getTray: () => tray,
  };
}

/**
 * Thin lifecycle adapter for main.mjs so composition stays short.
 * @param {Parameters<typeof createStatusItemController>[0]} input
 */
export function createStatusItemLifecycle(input) {
  const platform = input.platform ?? process.platform;
  const controller = createStatusItemController({ ...input, platform });
  return {
    shouldHideOnClose: () =>
      shouldHideMainWindowOnClose(
        platform,
        controller.isAppQuitting(),
        controller.isVisible(),
      ),
    shouldQuitOnLastWindow: () =>
      shouldQuitOnWindowAllClosed(platform, controller.isVisible()),
    markQuitting: () => controller.markQuitting(),
    dispose: () => controller.dispose(),
    setVisible: (visible) => {
      try {
        return controller.setVisible(Boolean(visible));
      } catch (error) {
        console.warn(
          "[status-item] setVisible failed:",
          error instanceof Error ? error.message : error,
        );
        return {
          ok: false,
          visible: controller.isVisible(),
          platform: String(platform),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    isVisible: () => controller.isVisible(),
    setKeymapAcceleratorOverrides: (overrides) =>
      controller.setKeymapAcceleratorOverrides(overrides),
    installSafely() {
      try {
        controller.install();
      } catch (error) {
        console.warn(
          "[status-item] install failed:",
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}
