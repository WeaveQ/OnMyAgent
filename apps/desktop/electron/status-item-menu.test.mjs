import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_ITEM_ACTION,
  STATUS_ITEM_EVENTS,
  buildStatusItemMenuSpec,
  resolveStatusItemLocale,
  shouldHideMainWindowOnClose,
  shouldInstallStatusItem,
  shouldQuitOnWindowAllClosed,
  statusItemActionIds,
  statusItemLabels,
} from "./status-item-menu.mjs";

test("status item installs only on darwin", () => {
  assert.equal(shouldInstallStatusItem("darwin"), true);
  assert.equal(shouldInstallStatusItem("win32"), false);
  assert.equal(shouldInstallStatusItem("linux"), false);
});

test("window-all-closed quits non-darwin only", () => {
  assert.equal(shouldQuitOnWindowAllClosed("darwin"), false);
  assert.equal(shouldQuitOnWindowAllClosed("win32"), true);
  assert.equal(shouldQuitOnWindowAllClosed("linux"), true);
});

test("hide-on-close only for darwin while not quitting", () => {
  assert.equal(shouldHideMainWindowOnClose("darwin", false), true);
  assert.equal(shouldHideMainWindowOnClose("darwin", true), false);
  assert.equal(shouldHideMainWindowOnClose("win32", false), false);
  assert.equal(shouldHideMainWindowOnClose("linux", true), false);
});

test("menu spec groups six actions with separators (IA)", () => {
  const spec = buildStatusItemMenuSpec({ locale: "en" });
  const kinds = spec.map((entry) => entry.type);
  assert.deepEqual(kinds, [
    "item",
    "separator",
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
    STATUS_ITEM_EVENTS.OPEN_EXPERT_MARKETPLACE,
    "onmyagent:native-menu:open-expert-marketplace",
  );
  assert.equal(
    STATUS_ITEM_EVENTS.DESKTOP_PERMISSIONS,
    "onmyagent:native-menu:desktop-permissions",
  );
});
