/**
 * Pure builders for the desktop status item / system tray.
 * macOS menu bar + Windows notification area. No Electron imports —
 * unit-testable without app.whenReady().
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** Stable action ids for status-item menu (and future dock menu reuse). */
export const STATUS_ITEM_ACTION = Object.freeze({
  SHOW_WINDOW: "showWindow",
  NEW_TASK: "newTask",
  OPEN_EXPERT_MARKETPLACE: "openExpertMarketplace",
  DESKTOP_PERMISSIONS: "desktopPermissions",
  OPEN_SETTINGS: "openSettings",
  QUIT: "quit",
});

/** Native→renderer bridge events (preload re-dispatches as window events). */
export const STATUS_ITEM_EVENTS = Object.freeze({
  OPEN_SETTINGS: "onmyagent:native-menu:open-settings",
  NEW_TASK: "onmyagent:native-menu:new-task",
  OPEN_EXPERT_MARKETPLACE: "onmyagent:native-menu:open-expert-marketplace",
  DESKTOP_PERMISSIONS: "onmyagent:native-menu:desktop-permissions",
});

const LABELS = Object.freeze({
  en: Object.freeze({
    showWindow: "Show Main Window",
    newTask: "New Task",
    openExpertMarketplace: "Open Expert Marketplace",
    desktopPermissions: "Desktop Control Permissions…",
    openSettings: "Open Settings…",
    quit: "Quit OnMyAgent",
  }),
  zh: Object.freeze({
    showWindow: "显示主窗口",
    newTask: "新建任务",
    openExpertMarketplace: "打开专家市场",
    desktopPermissions: "桌面控制权限…",
    openSettings: "打开设置…",
    quit: "退出 OnMyAgent",
  }),
  "zh-TW": Object.freeze({
    showWindow: "顯示主視窗",
    newTask: "新建任務",
    openExpertMarketplace: "打開專家市場",
    desktopPermissions: "桌面控制權限…",
    openSettings: "打開設定…",
    quit: "結束 OnMyAgent",
  }),
});

/**
 * Map Electron/app locale string to a status-item locale key.
 * @param {string | null | undefined} appLocale
 * @returns {"en" | "zh" | "zh-TW"}
 */
export function resolveStatusItemLocale(appLocale) {
  const raw = String(appLocale ?? "en").trim().toLowerCase().replace(/_/g, "-");
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hant")) return "zh-TW";
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

/**
 * @param {"en" | "zh" | "zh-TW"} locale
 */
export function statusItemLabels(locale) {
  return LABELS[locale] ?? LABELS.en;
}

/**
 * Menu structure: window / quick actions / system / quit (with separators).
 * Pure data — consumers map `id` to click handlers and build Electron Menu.
 *
 * @param {{ locale?: string | null }} [options]
 * @returns {Array<{ type: "separator" } | { type: "item", id: string, label: string }>}
 */
export function buildStatusItemMenuSpec(options = {}) {
  const locale = resolveStatusItemLocale(options.locale);
  const labels = statusItemLabels(locale);
  return [
    { type: "item", id: STATUS_ITEM_ACTION.SHOW_WINDOW, label: labels.showWindow },
    { type: "separator" },
    { type: "item", id: STATUS_ITEM_ACTION.NEW_TASK, label: labels.newTask },
    {
      type: "item",
      id: STATUS_ITEM_ACTION.OPEN_EXPERT_MARKETPLACE,
      label: labels.openExpertMarketplace,
    },
    { type: "separator" },
    {
      type: "item",
      id: STATUS_ITEM_ACTION.DESKTOP_PERMISSIONS,
      label: labels.desktopPermissions,
    },
    {
      type: "item",
      id: STATUS_ITEM_ACTION.OPEN_SETTINGS,
      label: labels.openSettings,
    },
    { type: "separator" },
    { type: "item", id: STATUS_ITEM_ACTION.QUIT, label: labels.quit },
  ];
}

/** Ordered action ids (excludes separators) — useful for contract tests. */
export function statusItemActionIds(options = {}) {
  return buildStatusItemMenuSpec(options)
    .filter((entry) => entry.type === "item")
    .map((entry) => entry.id);
}

/**
 * Install tray / menu-bar status item on macOS and Windows.
 * Linux left off for now (DE tray support varies widely).
 * @param {NodeJS.Platform | string} platform
 */
export function shouldInstallStatusItem(platform) {
  return platform === "darwin" || platform === "win32";
}

/**
 * Last-window policy:
 * - macOS: process stays alive via Dock even without tray
 * - Windows: keep alive only while tray is visible (minimize-to-tray)
 * - else: quit
 *
 * @param {NodeJS.Platform | string} platform
 * @param {boolean} [trayVisible]
 */
export function shouldQuitOnWindowAllClosed(platform, trayVisible = false) {
  if (platform === "darwin") return false;
  if (platform === "win32") return !trayVisible;
  return true;
}

/**
 * Hide main window on close (tray remains) unless the app is quitting.
 * - macOS: always hide-to-Dock while running
 * - Windows: hide only when tray is installed (true minimize-to-tray)
 *
 * @param {NodeJS.Platform | string} platform
 * @param {boolean} isQuitting
 * @param {boolean} [trayVisible]
 */
export function shouldHideMainWindowOnClose(
  platform,
  isQuitting,
  trayVisible = false,
) {
  if (isQuitting) return false;
  if (platform === "darwin") return true;
  if (platform === "win32") return Boolean(trayVisible);
  return false;
}

/**
 * Resolve the best on-disk image for the tray / menu-bar status item.
 *
 * macOS: monochrome `trayTemplate.png` with template flag (system recolors).
 * Windows: color `trayIcon.png` (template images are not used).
 * Full-color brand PNG is last-resort fallback and must NOT be template-marked.
 *
 * @param {{
 *   appIconPath?: string | null,
 *   iconsDir?: string | null,
 *   platform?: string,
 *   existsSync?: (p: string) => boolean,
 * }} [options]
 * @returns {{ path: string | null, template: boolean }}
 */
export function resolveStatusItemIcon(options = {}) {
  const exists = options.existsSync ?? existsSync;
  const platform = options.platform ?? process.platform;
  const appIconPath =
    typeof options.appIconPath === "string" && options.appIconPath.trim()
      ? options.appIconPath.trim()
      : null;
  const iconsDir =
    (typeof options.iconsDir === "string" && options.iconsDir.trim()) ||
    (appIconPath ? path.dirname(appIconPath) : null);

  /** @type {string[]} */
  const colorCandidates = [];
  /** @type {string[]} */
  const templateCandidates = [];

  if (iconsDir) {
    // Windows notification area prefers a color icon; do not setTemplateImage.
    colorCandidates.push(
      path.join(iconsDir, "trayIcon.png"),
      path.join(iconsDir, "trayIcon@2x.png"),
    );
    // Electron loads trayTemplate@2x.png automatically when the base name ends with Template.
    templateCandidates.push(path.join(iconsDir, "trayTemplate.png"));
    if (platform === "darwin" || platform === "win32") {
      // Dev icons live under icons/dev/ — also try sibling production templates.
      templateCandidates.push(
        path.join(iconsDir, "..", "trayTemplate.png"),
        path.join(iconsDir, "dev", "trayTemplate.png"),
      );
      colorCandidates.push(
        path.join(iconsDir, "..", "trayIcon.png"),
        path.join(iconsDir, "dev", "trayIcon.png"),
      );
    }
  }

  if (platform === "darwin") {
    for (const candidate of templateCandidates) {
      if (candidate && exists(candidate)) {
        return { path: candidate, template: true };
      }
    }
  } else {
    // win32 / future: prefer color tray assets.
    for (const candidate of colorCandidates) {
      if (candidate && exists(candidate)) {
        return { path: candidate, template: false };
      }
    }
    // Accept monochrome template file as non-template glyph if no color asset.
    for (const candidate of templateCandidates) {
      if (candidate && exists(candidate)) {
        return { path: candidate, template: false };
      }
    }
  }

  // Color fallback: app brand icon (do not setTemplateImage).
  if (appIconPath && exists(appIconPath)) {
    return { path: appIconPath, template: false };
  }

  return { path: null, template: false };
}
