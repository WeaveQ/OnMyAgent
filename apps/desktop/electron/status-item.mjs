/**
 * macOS menu-bar status item (Electron Tray) controller.
 * Uses native Menu + template icon — not a custom painted popup.
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
      case STATUS_ITEM_ACTION.OPEN_EXPERT_MARKETPLACE:
        await sendToMainWindow(STATUS_ITEM_EVENTS.OPEN_EXPERT_MARKETPLACE);
        return;
      case STATUS_ITEM_ACTION.DESKTOP_PERMISSIONS:
        await showAndFocusMainWindow();
        if (typeof openDesktopPermissions === "function") {
          await openDesktopPermissions();
        } else {
          await sendToMainWindow(STATUS_ITEM_EVENTS.DESKTOP_PERMISSIONS);
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

  function buildNativeMenu() {
    const locale = resolveStatusItemLocale(
      typeof app.getLocale === "function" ? app.getLocale() : "en",
    );
    const spec = buildStatusItemMenuSpec({ locale });
    /** @type {import("electron").MenuItemConstructorOptions[]} */
    const template = spec.map((entry) => {
      if (entry.type === "separator") return { type: "separator" };
      return {
        label: entry.label,
        click: () => {
          void runAction(entry.id);
        },
      };
    });
    return Menu.buildFromTemplate(template);
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

    // Menu-bar peers are ~18pt. Pin logical size so oversized PNGs do not
    // dominate the bar. Prefer shipping 18/@2x 36 trayTemplate assets.
    const traySize = platform === "darwin" ? 18 : 16;
    if (typeof image.getSize === "function") {
      const { width, height } = image.getSize();
      // Only downscale; never upscale a crisp @1x template.
      if (width > traySize || height > traySize) {
        image = image.resize({ width: traySize, height: traySize });
      }
    }

    // Monochrome black-on-transparent only. White glyphs become invisible
    // under setTemplateImage; full-color brand PNGs become white squares.
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
    // Left-click on macOS also pops the menu (matches status-item convention).
    tray.on("click", () => {
      tray?.popUpContextMenu();
    });
    console.info("[status-item] menu-bar status item installed");
    return tray;
  }

  function dispose() {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  }

  function refreshMenu() {
    if (!tray) return;
    tray.setContextMenu(buildNativeMenu());
  }

  return {
    install,
    dispose,
    refreshMenu,
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
      shouldHideMainWindowOnClose(platform, controller.isAppQuitting()),
    shouldQuitOnLastWindow: () => shouldQuitOnWindowAllClosed(platform),
    markQuitting: () => controller.markQuitting(),
    dispose: () => controller.dispose(),
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
