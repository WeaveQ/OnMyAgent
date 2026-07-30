/**
 * Desktop system preferences: launch-at-login, keep-awake, taskbar/dock badge,
 * completion sound, and optional global app-snapshot hotkey registration.
 */
import {
  app,
  globalShortcut,
  powerSaveBlocker,
  BrowserWindow,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {number | null} */
let powerSaveBlockerId = null;

/** @type {string | null} */
let registeredAppSnapshotAccelerator = null;

/**
 * @returns {{ enabled: boolean; openAtLogin: boolean; openAsHidden: boolean }}
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
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        if (win.isDestroyed()) continue;
        // Overlay text is limited; use badge count API when available (Electron 39+).
        if (typeof win.setBadgeCount === "function") {
          win.setBadgeCount(value);
        } else if (typeof app.setBadgeCount === "function") {
          app.setBadgeCount(value);
        }
        if (value > 0 && typeof win.flashFrame === "function") {
          // Do not force flash every update — only when count appears.
        }
      }
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
    // double-command / double-control need native listeners; not via globalShortcut.
    if (!raw || raw === "double-command" || raw === "double-control") {
      return {
        ok: true,
        mode: raw || "none",
        registered: false,
        note: "special-combo-requires-native-hook",
      };
    }

    const ok = globalShortcut.register(raw, () => {
      try {
        onTrigger?.();
      } catch (error) {
        console.error("[app-snapshot-hotkey] trigger failed", error);
      }
    });
    if (ok) {
      registeredAppSnapshotAccelerator = raw;
    }
    return { ok: Boolean(ok), mode: raw, registered: Boolean(ok) };
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
