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
  QUICK_CAPTURE: "quickCapture",
  DESKTOP_PERMISSIONS: "desktopPermissions",
  OPEN_SETTINGS: "openSettings",
  QUIT: "quit",
});

/** Native→renderer bridge events (preload re-dispatches as window events). */
export const STATUS_ITEM_EVENTS = Object.freeze({
  OPEN_SETTINGS: "onmyagent:native-menu:open-settings",
  NEW_TASK: "onmyagent:native-menu:new-task",
  QUICK_CAPTURE: "onmyagent:native-menu:quick-capture",
  DESKTOP_PERMISSIONS: "onmyagent:native-menu:desktop-permissions",
});

const LABELS = Object.freeze({
  en: Object.freeze({
    showWindow: "Show Main Window",
    newTask: "New Task",
    quickCapture: "Quick Chat",
    desktopPermissions: "Computer Control",
    openSettings: "Open Settings…",
    quit: "Quit OnMyAgent",
  }),
  zh: Object.freeze({
    showWindow: "显示主窗口",
    newTask: "新建任务",
    quickCapture: "快捷对话",
    desktopPermissions: "计算机控制",
    openSettings: "打开设置…",
    quit: "退出 OnMyAgent",
  }),
  "zh-TW": Object.freeze({
    showWindow: "顯示主視窗",
    newTask: "新建任務",
    quickCapture: "快捷對話",
    desktopPermissions: "電腦控制",
    openSettings: "打開設定…",
    quit: "結束 OnMyAgent",
  }),
});

/** Default accelerators shown in the tray menu (display; global hotkeys registered elsewhere). */
export const STATUS_ITEM_DEFAULT_ACCELERATORS = Object.freeze({
  [STATUS_ITEM_ACTION.QUICK_CAPTURE]: "CommandOrControl+B",
  [STATUS_ITEM_ACTION.NEW_TASK]: "CommandOrControl+N",
  [STATUS_ITEM_ACTION.OPEN_SETTINGS]: "CommandOrControl+,",
});

/**
 * Map Electron/app locale string to a status-item locale key.
 * @param {string | null | undefined} appLocale
 * @returns {"en" | "zh" | "zh-TW"}
 */
export function resolveStatusItemLocale(appLocale) {
  const raw = String(appLocale ?? "en").trim().toLowerCase().replace(/_/g, "-");
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hant") || raw.startsWith("zh-hk") || raw.startsWith("zh-mo")) {
    return "zh-TW";
  }
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

const CHINESE_REGION_TIME_ZONES = new Set([
  "Asia/Shanghai",
  "Asia/Chongqing",
  "Asia/Harbin",
  "Asia/Urumqi",
  "Asia/Hong_Kong",
  "Asia/Macau",
  "Asia/Taipei",
]);

/**
 * Match in-app `detectInitialLanguage`: preferred OS languages first, then
 * Chinese-region time zone. Do not use Chromium `app.getLocale()` alone —
 * packaged Electron often reports en even when the UI defaults to zh.
 *
 * @param {{
 *   languages?: string[] | null,
 *   timeZone?: string | null,
 *   appLocale?: string | null,
 * }} [input]
 * @returns {"en" | "zh" | "zh-TW"}
 */
export function resolveStatusItemLocaleFromEnvironment(input = {}) {
  const languages = Array.isArray(input.languages) ? input.languages : [];
  for (const raw of languages) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const mapped = resolveStatusItemLocale(raw);
    if (mapped !== "en") return mapped;
  }
  const timeZone = String(input.timeZone ?? "").trim();
  if (CHINESE_REGION_TIME_ZONES.has(timeZone)) {
    if (timeZone === "Asia/Taipei" || timeZone === "Asia/Hong_Kong" || timeZone === "Asia/Macau") {
      return "zh-TW";
    }
    return "zh";
  }
  return resolveStatusItemLocale(input.appLocale);
}

/**
 * @param {"en" | "zh" | "zh-TW"} locale
 */
export function statusItemLabels(locale) {
  return LABELS[locale] ?? LABELS.en;
}

/**
 * Menu structure: quick chat first, then new task / show window, system, quit.
 * Pure data — consumers map `id` to click handlers and build Electron Menu.
 *
 * @param {{
 *   locale?: string | null,
 *   accelerators?: Record<string, string | null | undefined> | null,
 * }} [options]
 * @returns {Array<{ type: "separator" } | { type: "item", id: string, label: string, accelerator?: string }>}
 */
export function buildStatusItemMenuSpec(options = {}) {
  const locale = resolveStatusItemLocale(options.locale);
  const labels = statusItemLabels(locale);
  const accelOverrides =
    options.accelerators && typeof options.accelerators === "object"
      ? options.accelerators
      : {};

  /** @param {string} actionId */
  const acceleratorFor = (actionId) => {
    if (Object.prototype.hasOwnProperty.call(accelOverrides, actionId)) {
      const raw = String(accelOverrides[actionId] ?? "").trim();
      return raw || undefined;
    }
    return STATUS_ITEM_DEFAULT_ACCELERATORS[actionId] || undefined;
  };

  return [
    {
      type: "item",
      id: STATUS_ITEM_ACTION.QUICK_CAPTURE,
      label: labels.quickCapture,
      accelerator: acceleratorFor(STATUS_ITEM_ACTION.QUICK_CAPTURE),
    },
    {
      type: "item",
      id: STATUS_ITEM_ACTION.NEW_TASK,
      label: labels.newTask,
      accelerator: acceleratorFor(STATUS_ITEM_ACTION.NEW_TASK),
    },
    {
      type: "item",
      id: STATUS_ITEM_ACTION.SHOW_WINDOW,
      label: labels.showWindow,
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
      accelerator: acceleratorFor(STATUS_ITEM_ACTION.OPEN_SETTINGS),
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
 * Windows: the same brand mark as the window / taskbar (`icon.png`) — rounded
 * plate + wave. Do not use the outline `trayIcon` glyph (that is a macOS
 * template cousin and reads as a different logo in the notification area).
 * Full-color brand PNG must NOT be template-marked.
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
    // win32: brand app icon first so the tray matches the window / jump list.
    if (appIconPath && exists(appIconPath)) {
      return { path: appIconPath, template: false };
    }
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
