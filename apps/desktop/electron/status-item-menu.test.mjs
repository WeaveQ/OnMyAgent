import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_ITEM_ACTION,
  STATUS_ITEM_EVENTS,
  buildStatusItemMenuSpec,
  resolveStatusItemIcon,
  resolveStatusItemLocale,
  shouldHideMainWindowOnClose,
  shouldInstallStatusItem,
  shouldQuitOnWindowAllClosed,
  statusItemActionIds,
  statusItemLabels,
} from "./status-item-menu.mjs";

test("status item installs on darwin and win32", () => {
  assert.equal(shouldInstallStatusItem("darwin"), true);
  assert.equal(shouldInstallStatusItem("win32"), true);
  assert.equal(shouldInstallStatusItem("linux"), false);
});

test("window-all-closed: mac keeps alive; win quits only without tray", () => {
  assert.equal(shouldQuitOnWindowAllClosed("darwin", true), false);
  assert.equal(shouldQuitOnWindowAllClosed("darwin", false), false);
  assert.equal(shouldQuitOnWindowAllClosed("win32", true), false);
  assert.equal(shouldQuitOnWindowAllClosed("win32", false), true);
  assert.equal(shouldQuitOnWindowAllClosed("linux", false), true);
});

test("hide-on-close: mac always; win only with tray visible", () => {
  assert.equal(shouldHideMainWindowOnClose("darwin", false, true), true);
  assert.equal(shouldHideMainWindowOnClose("darwin", false, false), true);
  assert.equal(shouldHideMainWindowOnClose("darwin", true, true), false);
  assert.equal(shouldHideMainWindowOnClose("win32", false, true), true);
  assert.equal(shouldHideMainWindowOnClose("win32", false, false), false);
  assert.equal(shouldHideMainWindowOnClose("linux", false, true), false);
});

test("menu spec groups quick actions with separators (IA)", () => {
  const spec = buildStatusItemMenuSpec({ locale: "en" });
  const kinds = spec.map((entry) => entry.type);
  assert.deepEqual(kinds, [
    "item",
    "separator",
    "item",
    "item",
    "item",
    "separator",
    "item",
    "item",
    "separator",
    "item",
  ]);

  const ids = statusItemActionIds({ locale: "en" });
  assert.deepEqual(ids, [
    STATUS_ITEM_ACTION.SHOW_WINDOW,
    STATUS_ITEM_ACTION.NEW_TASK,
    STATUS_ITEM_ACTION.QUICK_CAPTURE,
    STATUS_ITEM_ACTION.OPEN_EXPERT_MARKETPLACE,
    STATUS_ITEM_ACTION.DESKTOP_PERMISSIONS,
    STATUS_ITEM_ACTION.OPEN_SETTINGS,
    STATUS_ITEM_ACTION.QUIT,
  ]);
});

test("locale resolution covers en / zh / zh-TW", () => {
  assert.equal(resolveStatusItemLocale("en-US"), "en");
  assert.equal(resolveStatusItemLocale("zh-CN"), "zh");
  assert.equal(resolveStatusItemLocale("zh"), "zh");
  assert.equal(resolveStatusItemLocale("zh-TW"), "zh-TW");
  assert.equal(resolveStatusItemLocale("zh_Hant_TW"), "zh-TW");
  assert.equal(resolveStatusItemLocale(null), "en");
});

test("labels are localized for zh and zh-TW", () => {
  assert.equal(statusItemLabels("zh").newTask, "新建任务");
  assert.equal(statusItemLabels("zh").showWindow, "显示主窗口");
  assert.equal(statusItemLabels("zh-TW").newTask, "新建任務");
  assert.equal(statusItemLabels("en").quit, "Quit OnMyAgent");
  const zhSpec = buildStatusItemMenuSpec({ locale: "zh-CN" });
  assert.ok(zhSpec.some((e) => e.type === "item" && e.label === "打开专家市场"));
});

test("status-item events reuse native-menu bridge naming", () => {
  assert.equal(
    STATUS_ITEM_EVENTS.OPEN_SETTINGS,
    "onmyagent:native-menu:open-settings",
  );
  assert.equal(STATUS_ITEM_EVENTS.NEW_TASK, "onmyagent:native-menu:new-task");
  assert.equal(
    STATUS_ITEM_EVENTS.QUICK_CAPTURE,
    "onmyagent:native-menu:quick-capture",
  );
  assert.equal(
    STATUS_ITEM_EVENTS.OPEN_EXPERT_MARKETPLACE,
    "onmyagent:native-menu:open-expert-marketplace",
  );
  assert.equal(
    STATUS_ITEM_EVENTS.DESKTOP_PERMISSIONS,
    "onmyagent:native-menu:desktop-permissions",
  );
});

test("resolveStatusItemIcon prefers monochrome trayTemplate over brand PNG on mac", () => {
  const files = new Set([
    "/app/icons/trayTemplate.png",
    "/app/icons/trayIcon.png",
    "/app/icons/icon.png",
  ]);
  const existsSync = (p) => files.has(p);

  const template = resolveStatusItemIcon({
    appIconPath: "/app/icons/icon.png",
    existsSync,
    platform: "darwin",
  });
  assert.equal(template.path, "/app/icons/trayTemplate.png");
  assert.equal(template.template, true);

  const colorOnly = resolveStatusItemIcon({
    appIconPath: "/app/icons/icon.png",
    existsSync: (p) => p === "/app/icons/icon.png",
    platform: "darwin",
  });
  assert.equal(colorOnly.path, "/app/icons/icon.png");
  assert.equal(colorOnly.template, false);

  const missing = resolveStatusItemIcon({
    appIconPath: "/missing/icon.png",
    existsSync: () => false,
  });
  assert.equal(missing.path, null);
  assert.equal(missing.template, false);
});

test("resolveStatusItemIcon prefers color trayIcon on Windows", () => {
  const files = new Set([
    "/app/icons/trayTemplate.png",
    "/app/icons/trayIcon.png",
    "/app/icons/icon.png",
  ]);
  const color = resolveStatusItemIcon({
    appIconPath: "/app/icons/icon.png",
    existsSync: (p) => files.has(p),
    platform: "win32",
  });
  assert.equal(color.path, "/app/icons/trayIcon.png");
  assert.equal(color.template, false);
});
