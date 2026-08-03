/**
 * Desktop system preferences: launch-at-login, keep-awake, taskbar/dock badge,
 * completion sound, and optional global app-snapshot hotkey registration.
 */
import {
  app,
  globalShortcut,
  powerSaveBlocker,
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
