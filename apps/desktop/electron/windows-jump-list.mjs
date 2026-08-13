/**
 * Windows taskbar jump list (right-click the app on the taskbar).
 * 计算机控制 uses the brand app icon — not a generic monitor glyph.
 */
import { existsSync } from "node:fs";
import path from "node:path";

export const JUMP_LIST_ACTION = Object.freeze({
  NEW_TASK: "new-task",
  RECENT_SESSION: "recent-session",
  OPEN_MARKET: "open-market",
  QUICK_CAPTURE: "quick-capture",
  DESKTOP_CONTROL: "desktop-control",
  OPEN_SETTINGS: "open-settings",
});

export const JUMP_LIST_FLAG_PREFIX = "--onmyagent-action=";

const LABELS = Object.freeze({
  en: Object.freeze({
    newTask: "New Task",
    recentSession: "Continue last task",
    openMarket: "Open marketplace",
    quickCapture: "Quick capture",
    desktopControl: "Computer Control",
    openSettings: "Open settings",
  }),
  zh: Object.freeze({
    newTask: "新建任务",
    recentSession: "继续上次任务",
    openMarket: "打开市场",
    quickCapture: "快速捕获",
    desktopControl: "计算机控制",
    openSettings: "打开设置",
  }),
  "zh-TW": Object.freeze({
    newTask: "新建任務",
    recentSession: "繼續上次任務",
    openMarket: "打開市場",
    quickCapture: "快速擷取",
    desktopControl: "電腦控制",
    openSettings: "打開設定",
  }),
});

/**
 * @param {string | null | undefined} appLocale
 * @returns {"en" | "zh" | "zh-TW"}
 */
export function resolveJumpListLocale(appLocale) {
  const raw = String(appLocale ?? "en").trim().toLowerCase().replace(/_/g, "-");
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hant")) return "zh-TW";
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

/**
 * Prefer .ico for Windows jump-list item icons; fall back to brand PNG.
 * @param {{ appIconPath?: string | null, existsSync?: (p: string) => boolean }} [options]
 * @returns {string | null}
 */
export function resolveJumpListAppIconPath(options = {}) {
  const exists = options.existsSync ?? existsSync;
  const appIconPath =
    typeof options.appIconPath === "string" && options.appIconPath.trim()
      ? options.appIconPath.trim()
      : null;
  /** @type {string[]} */
  const candidates = [];
  if (appIconPath) {
    const dir = path.dirname(appIconPath);
    const ext = path.extname(appIconPath);
    candidates.push(
      path.join(dir, `icon.ico`),
      appIconPath.replace(new RegExp(`${ext.replace(".", "\\.")}$`), ".ico"),
      path.join(dir, "..", "icon.ico"),
      appIconPath,
    );
  }
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return null;
}

/** @typedef {typeof JUMP_LIST_ACTION[keyof typeof JUMP_LIST_ACTION]} JumpListAction */

/** @type {Set<string>} */
const JUMP_LIST_ACTIONS = new Set(Object.values(JUMP_LIST_ACTION));

/**
 * @param {string | null | undefined} arg
 * @returns {JumpListAction | null}
 */
export function parseJumpListActionArg(arg) {
  const raw = String(arg ?? "");
  if (!raw.startsWith(JUMP_LIST_FLAG_PREFIX)) return null;
  const value = raw.slice(JUMP_LIST_FLAG_PREFIX.length).trim();
  return JUMP_LIST_ACTIONS.has(value) ? /** @type {JumpListAction} */ (value) : null;
}

/**
 * @param {readonly string[] | null | undefined} argv
 */
export function parseJumpListActionFromArgv(argv) {
  for (const arg of argv ?? []) {
    const action = parseJumpListActionArg(arg);
    if (action) return action;
  }
  return null;
}

/**
 * @param {{
 *   locale?: string | null,
 *   program: string,
 *   appIconPath?: string | null,
 *   existsSync?: (p: string) => boolean,
 * }} input
 */
export function buildWindowsJumpListTasks(input) {
  const locale = resolveJumpListLocale(input.locale);
  const labels = LABELS[locale] ?? LABELS.en;
  const brandIcon = resolveJumpListAppIconPath({
    appIconPath: input.appIconPath,
    existsSync: input.existsSync,
  });
  const iconPath = brandIcon || input.program;

  /** @param {string} action @param {string} title */
  const task = (action, title) => ({
    type: "task",
    title,
    description: title,
    program: input.program,
    args: `${JUMP_LIST_FLAG_PREFIX}${action}`,
    iconPath,
    iconIndex: 0,
  });

  return [
    task(JUMP_LIST_ACTION.NEW_TASK, labels.newTask),
    task(JUMP_LIST_ACTION.RECENT_SESSION, labels.recentSession),
    task(JUMP_LIST_ACTION.OPEN_MARKET, labels.openMarket),
    task(JUMP_LIST_ACTION.QUICK_CAPTURE, labels.quickCapture),
    // Brand mark — not a generic monitor / imageres desktop glyph.
    task(JUMP_LIST_ACTION.DESKTOP_CONTROL, labels.desktopControl),
    task(JUMP_LIST_ACTION.OPEN_SETTINGS, labels.openSettings),
  ];
}

/**
 * Route a parsed jump-list action through existing tray / window handlers.
 * @param {JumpListAction | null | undefined} action
 * @param {{
 *   runStatusAction: (id: string) => Promise<unknown> | unknown,
 *   sendToMainWindow: (eventName: string) => Promise<unknown> | unknown,
 * }} handlers
 */
export async function dispatchJumpListAction(action, handlers) {
  if (!action) return;
  switch (action) {
    case JUMP_LIST_ACTION.NEW_TASK:
      await handlers.runStatusAction("newTask");
      return;
    case JUMP_LIST_ACTION.QUICK_CAPTURE:
      await handlers.runStatusAction("quickCapture");
      return;
    case JUMP_LIST_ACTION.DESKTOP_CONTROL:
      await handlers.runStatusAction("desktopPermissions");
      return;
    case JUMP_LIST_ACTION.OPEN_SETTINGS:
      await handlers.runStatusAction("openSettings");
      return;
    case JUMP_LIST_ACTION.RECENT_SESSION:
      await handlers.sendToMainWindow("onmyagent:native-menu:recent-session");
      return;
    case JUMP_LIST_ACTION.OPEN_MARKET:
      await handlers.sendToMainWindow(
        "onmyagent:native-menu:open-expert-marketplace",
      );
  }
}

/**
 * Bind jump-list install + argv consume to the tray / window controllers.
 * @param {{
 *   app: { getLocale?: () => string, setJumpList?: (cats: unknown) => string, setUserTasks?: (tasks: unknown) => void },
 *   program: string,
 *   appIconPath?: string | null,
 *   platform?: string,
 *   statusItem: { runAction: (id: string) => Promise<unknown> | unknown, installSafely?: () => void },
 *   createMainWindow: () => Promise<{
 *     isMinimized: () => boolean,
 *     isDestroyed: () => boolean,
 *     restore: () => void,
 *     show: () => void,
 *     focus: () => void,
 *     webContents: { send: (eventName: string) => void },
 *   }>,
 * }} input
 */
export function createWindowsJumpListRuntime(input) {
  const handlers = {
    runStatusAction: (id) => input.statusItem.runAction(id),
    sendToMainWindow: async (eventName) => {
      const win = await input.createMainWindow();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (!win.isDestroyed()) win.webContents.send(eventName);
    },
  };
  return {
    install() {
      input.statusItem.installSafely?.();
      const jump = installWindowsJumpList({
        app: input.app,
        program: input.program,
        appIconPath: input.appIconPath,
        platform: input.platform,
      });
      if (!jump.ok && !jump.skipped) {
        console.warn("[jump-list] install failed", jump);
      }
      return jump;
    },
    consumeArgv(argv) {
      return dispatchJumpListAction(parseJumpListActionFromArgv(argv), handlers);
    },
  };
}

export function installWindowsJumpList(input) {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") return { ok: false, skipped: true, reason: "not-win32" };
  const locale =
    typeof input.app.getLocale === "function" ? input.app.getLocale() : "en";
  const tasks = buildWindowsJumpListTasks({
    locale,
    program: input.program,
    appIconPath: input.appIconPath,
  });
  try {
    if (typeof input.app.setJumpList === "function") {
      const status = input.app.setJumpList([
        { type: "tasks", name: "Tasks", items: tasks },
      ]);
      return { ok: status === "ok" || status == null, status, count: tasks.length };
    }
    if (typeof input.app.setUserTasks === "function") {
      input.app.setUserTasks(tasks);
      return { ok: true, status: "user-tasks", count: tasks.length };
    }
    return { ok: false, reason: "unsupported" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
