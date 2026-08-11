/**
 * Desktop system preferences: launch-at-login, keep-awake, taskbar/dock badge,
 * completion sound, and optional global app-snapshot hotkey registration.
 */
import {
  app,
  globalShortcut,
  powerSaveBlocker,
  Notification,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {number | null} */
let powerSaveBlockerId = null;

/** @type {string | null} */
let registeredAppSnapshotAccelerator = null;

/** @type {string | null} */
let registeredQuickCaptureAccelerator = null;

/**
 * @returns {{
 *   enabled: boolean;
 *   openAtLogin: boolean;
 *   openAsHidden: boolean;
 *   error?: string;
 * }}
 */
export function getLaunchAtLogin() {
  try {
    const settings = app.getLoginItemSettings();
    return {
      enabled: Boolean(settings.openAtLogin),
      openAtLogin: Boolean(settings.openAtLogin),
      openAsHidden: Boolean(settings.openAsHidden),
    };
  } catch (error) {
    return {
      enabled: false,
      openAtLogin: false,
      openAsHidden: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {boolean} enabled
 * @returns {{
 *   enabled: boolean;
 *   openAtLogin: boolean;
 *   openAsHidden: boolean;
 *   error?: string;
 * }}
 */
export function setLaunchAtLogin(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled === true,
      openAsHidden: false,
    });
    return getLaunchAtLogin();
  } catch (error) {
    return {
      enabled: false,
      openAtLogin: false,
      openAsHidden: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {boolean} enabled
 */
export function setKeepSystemAwake(enabled) {
  try {
    if (enabled === true) {
      if (powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        return { enabled: true, id: powerSaveBlockerId };
      }
      powerSaveBlockerId = powerSaveBlocker.start("prevent-display-sleep");
      return { enabled: true, id: powerSaveBlockerId };
    }
    if (powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
    powerSaveBlockerId = null;
    return { enabled: false, id: null };
  } catch (error) {
    return {
      enabled: false,
      id: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getKeepSystemAwake() {
  const active =
    powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId);
  return { enabled: active, id: active ? powerSaveBlockerId : null };
}

/**
 * Dock badge (macOS) or taskbar overlay count representation (Windows).
 * @param {number | string | null | undefined} count
 */
export function setDockUnreadBadge(count) {
  const n =
    typeof count === "number"
      ? count
      : typeof count === "string"
        ? Number.parseInt(count, 10)
        : 0;
  const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

  try {
    if (process.platform === "darwin" && app.dock) {
      app.dock.setBadge(value > 0 ? String(value) : "");
      return { ok: true, platform: "macos", value };
    }

    if (process.platform === "win32") {
      // Badge count is on app, not BrowserWindow (Electron typings).
      if (typeof app.setBadgeCount === "function") {
        app.setBadgeCount(value);
      }
      return { ok: true, platform: "windows", value };
    }

    if (typeof app.setBadgeCount === "function") {
      app.setBadgeCount(value);
    }
    return { ok: true, platform: process.platform, value };
  } catch (error) {
    return {
      ok: false,
      platform: process.platform,
      value,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolve a short completion sound path if packaged; else null (renderer may use Web Audio).
 */
export function getAgentReadySoundPath() {
  const candidates = [
    path.join(__dirname, "../resources/sounds/agent-ready.wav"),
    path.join(__dirname, "../resources/sounds/agent-ready.mp3"),
    path.join(app.getAppPath(), "resources/sounds/agent-ready.wav"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Show an OS desktop notification via Electron main-process Notification.
 * Renderer HTML5 Notification is unreliable on Windows; updater already uses this path.
 *
 * @param {{
 *   title?: string | null,
 *   body?: string | null,
 *   force?: boolean,
 *   href?: string | null,
 * } | null | undefined} input
 * @param {{
 *   getMainWindow?: () => import("electron").BrowserWindow | null | undefined,
 * }} [options]
 * @returns {{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   error?: string,
 * }}
 */
export function showDesktopNotification(input, options = {}) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body : "";
  const force = input?.force === true;
  const href = typeof input?.href === "string" ? input.href.trim() : "";

  if (!title) {
    return { ok: false, error: "missing_title" };
  }

  try {
    if (typeof Notification?.isSupported === "function" && !Notification.isSupported()) {
      return { ok: false, error: "unsupported" };
    }

    const getMainWindow = options.getMainWindow;
    const mainWindow =
      typeof getMainWindow === "function" ? (getMainWindow() ?? null) : null;

    // Match product rule: suppress when the main window is focused unless forced
    // (agent-ready is background-only; automation uses force: true).
    if (
      !force &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isFocused()
    ) {
      return { ok: true, skipped: true, reason: "focused" };
    }

    const notification = new Notification({
      title,
      body: body || "",
      silent: false,
    });

    notification.on("click", () => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        if (href) {
          // Navigate renderer route without a separate IPC event surface.
          const script = `(function(){try{window.history.pushState(null,"",${JSON.stringify(href)});window.dispatchEvent(new PopStateEvent("popstate"));}catch(_){}})();`;
          void mainWindow.webContents.executeJavaScript(script).catch(() => undefined);
        }
      } catch {
        // ignore click handler failures
      }
    });

    notification.show();
    return { ok: true, skipped: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {string | null | undefined} accelerator Electron accelerator or special token
 * @param {() => void} onTrigger
 */
export function registerAppSnapshotHotkey(accelerator, onTrigger) {
  try {
    if (registeredAppSnapshotAccelerator) {
      try {
        globalShortcut.unregister(registeredAppSnapshotAccelerator);
      } catch {
        // ignore
      }
      registeredAppSnapshotAccelerator = null;
    }

    const raw = typeof accelerator === "string" ? accelerator.trim() : "";
    // Legacy dual-mod tokens → standard Electron accelerator (no native helper).
    const normalized =
      !raw || raw === "double-command" || raw === "double-control"
        ? raw
          ? "CommandOrControl+Shift+A"
          : ""
        : raw;
    if (!normalized) {
      return { ok: true, mode: "none", registered: false };
    }

    const ok = globalShortcut.register(normalized, () => {
      try {
        onTrigger?.();
      } catch (error) {
        console.error("[app-snapshot-hotkey] trigger failed", error);
      }
    });
    if (ok) {
      registeredAppSnapshotAccelerator = normalized;
    }
    return { ok: Boolean(ok), mode: normalized, registered: Boolean(ok) };
  } catch (error) {
    return {
      ok: false,
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function unregisterAppSnapshotHotkey() {
  if (!registeredAppSnapshotAccelerator) return { ok: true };
  try {
    globalShortcut.unregister(registeredAppSnapshotAccelerator);
  } catch {
    // ignore
  }
  registeredAppSnapshotAccelerator = null;
  return { ok: true };
}

/**
 * Global shortcut for the quick-capture mini panel (Spotlight-style).
 * @param {string | null | undefined} accelerator Electron accelerator
 * @param {() => void} onTrigger
 */
export function registerQuickCaptureHotkey(accelerator, onTrigger) {
  try {
    if (registeredQuickCaptureAccelerator) {
      try {
        globalShortcut.unregister(registeredQuickCaptureAccelerator);
      } catch {
        // ignore
      }
      registeredQuickCaptureAccelerator = null;
    }

    const normalized = typeof accelerator === "string" ? accelerator.trim() : "";
    if (!normalized) {
      return { ok: true, mode: "none", registered: false };
    }

    const ok = globalShortcut.register(normalized, () => {
      try {
        onTrigger?.();
      } catch (error) {
        console.error("[quick-capture-hotkey] trigger failed", error);
      }
    });
    if (ok) {
      registeredQuickCaptureAccelerator = normalized;
    }
    return { ok: Boolean(ok), mode: normalized, registered: Boolean(ok) };
  } catch (error) {
    return {
      ok: false,
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function unregisterQuickCaptureHotkey() {
  if (!registeredQuickCaptureAccelerator) return { ok: true };
  try {
    globalShortcut.unregister(registeredQuickCaptureAccelerator);
  } catch {
    // ignore
  }
  registeredQuickCaptureAccelerator = null;
  return { ok: true };
}
