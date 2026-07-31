/**
 * Pure builders for the macOS menu-bar status item (tray equivalent).
 * No Electron imports — unit-testable without app.whenReady().
 */

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
 * Install menu-bar status item only on macOS for this goal.
 * @param {NodeJS.Platform | string} platform
 */
export function shouldInstallStatusItem(platform) {
  return platform === "darwin";
}

/**
 * Last-window policy: mac keeps the process alive (status item / activate).
 * @param {NodeJS.Platform | string} platform
 */
export function shouldQuitOnWindowAllClosed(platform) {
  return platform !== "darwin";
}

/**
 * Hide main window on close (status item remains) unless the app is quitting.
 * @param {NodeJS.Platform | string} platform
 * @param {boolean} isQuitting
 */
export function shouldHideMainWindowOnClose(platform, isQuitting) {
  return platform === "darwin" && !isQuitting;
}
