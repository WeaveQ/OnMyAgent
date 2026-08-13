import test from "node:test";
import assert from "node:assert/strict";

import { STATUS_ITEM_ACTION, STATUS_ITEM_EVENTS } from "./status-item-menu.mjs";
import { createStatusItemController } from "./status-item.mjs";

function createMockTrayEnv() {
  /** @type {Array<{ label?: string, type?: string, click?: () => void }>} */
  let lastTemplate = [];
  const trayHandlers = new Map();
  const tray = {
    setToolTip() {},
    setContextMenu(menu) {
      this.menu = menu;
    },
    on(event, handler) {
      trayHandlers.set(event, handler);
    },
    popUpContextMenu() {
      this.popped = true;
    },
    destroy() {
      this.destroyed = true;
    },
    destroyed: false,
    popped: false,
    menu: null,
  };

  const Menu = {
    buildFromTemplate(template) {
      lastTemplate = template;
      return { template };
    },
  };

  const nativeImage = {
    lastCreatePath: null,
    lastTemplateFlag: null,
    lastResize: null,
    createFromPath(p) {
      this.lastCreatePath = p;
      const image = {
        isEmpty: () => false,
        // Simulate oversized asset so install path must downscale to menu-bar size.
        getSize: () => ({ width: 32, height: 32 }),
        resize(opts) {
          nativeImage.lastResize = opts;
          return this;
        },
        setTemplateImage(flag) {
          nativeImage.lastTemplateFlag = flag;
          this.template = flag;
        },
        template: false,
      };
      return image;
    },
    createEmpty() {
      return {
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        resize() {
          return this;
        },
        setTemplateImage() {},
      };
    },
  };

  return {
    tray,
    Tray: class {
      constructor() {
        return tray;
      }
    },
    Menu,
    nativeImage,
    lastTemplate: () => lastTemplate,
    trayHandlers,
  };
}

test("status item install builds native menu with template tray on darwin", () => {
  const mocks = createMockTrayEnv();
  const controller = createStatusItemController({
    app: { getLocale: () => "zh-CN", name: "OnMyAgent", quit() {} },
    Tray: mocks.Tray,
    Menu: mocks.Menu,
    nativeImage: mocks.nativeImage,
    createMainWindow: async () => ({}),
    getMainWindow: () => null,
    platform: "darwin",
  });
  const installed = controller.install();
  assert.ok(installed);
  const template = mocks.lastTemplate();
  assert.ok(template.some((item) => item.type === "separator"));
  assert.ok(template.some((item) => item.label === "新建任务"));
  assert.ok(template.some((item) => item.label === "快捷对话"));
  assert.ok(
    template.some(
      (item) =>
        item.label === "快捷对话" && item.accelerator === "CommandOrControl+B",
    ),
  );
  assert.ok(!template.some((item) => item.label === "打开专家市场"));
  assert.ok(template.some((item) => typeof item.click === "function"));
  // Order: quick chat first, show window after new task.
  const labels = template.map((item) => item.label).filter(Boolean);
  assert.equal(labels[0], "快捷对话");
  assert.ok(labels.indexOf("显示主窗口") > labels.indexOf("新建任务"));
});

test("setVisible hides and restores menu-bar tray on darwin", () => {
  const mocks = createMockTrayEnv();
  const controller = createStatusItemController({
    app: { getLocale: () => "en", name: "OnMyAgent", quit() {} },
    Tray: mocks.Tray,
    Menu: mocks.Menu,
    nativeImage: mocks.nativeImage,
    createMainWindow: async () => ({}),
    getMainWindow: () => null,
    platform: "darwin",
  });
  assert.equal(controller.isVisible(), false);
  const shown = controller.setVisible(true);
  assert.equal(shown.visible, true);
  assert.equal(controller.isVisible(), true);
  assert.ok(controller.getTray());

  const hidden = controller.setVisible(false);
  assert.equal(hidden.visible, false);
  assert.equal(controller.isVisible(), false);
  assert.equal(controller.getTray(), null);
  assert.equal(mocks.tray.destroyed, true);

  const restored = controller.setVisible(true);
  assert.equal(restored.visible, true);
  assert.equal(controller.isVisible(), true);
});

test("status item install works on win32 with non-template icon", () => {
  const mocks = createMockTrayEnv();
  const controller = createStatusItemController({
    app: { getLocale: () => "en", name: "OnMyAgent", quit() {} },
    Tray: mocks.Tray,
    Menu: mocks.Menu,
    nativeImage: mocks.nativeImage,
    createMainWindow: async () => ({}),
    getMainWindow: () => null,
    platform: "win32",
  });
  assert.ok(controller.install());
  assert.equal(controller.isVisible(), true);
  // Windows must not mark images as template.
  assert.notEqual(mocks.nativeImage.lastTemplateFlag, true);
});

test("darwin tray uses trayTemplate as template image, not brand PNG as template", () => {
  const mocks = createMockTrayEnv();
  // Real shipped assets next to the test module.
  const iconsDir = new URL("../resources/icons/", import.meta.url);
  const appIconPath = new URL("../resources/icons/icon.png", import.meta.url)
    .pathname;
  const controller = createStatusItemController({
    app: { getLocale: () => "en", name: "OnMyAgent", quit() {} },
    Tray: mocks.Tray,
    Menu: mocks.Menu,
    nativeImage: mocks.nativeImage,
    createMainWindow: async () => ({}),
    getMainWindow: () => null,
    platform: "darwin",
    appIconPath,
  });
  controller.install();
  assert.ok(
    String(mocks.nativeImage.lastCreatePath || "").includes("trayTemplate"),
    `expected trayTemplate path, got ${mocks.nativeImage.lastCreatePath}`,
  );
  assert.equal(mocks.nativeImage.lastTemplateFlag, true);
  // Menu-bar peer size (~18pt), not full 32px asset.
  assert.deepEqual(mocks.nativeImage.lastResize, { width: 18, height: 18 });
  void iconsDir;
});

test("runAction show/settings/new-task/permissions/quit use real handlers", async () => {
  const sent = [];
  let shown = 0;
  let quitCalls = 0;
  let permissionCalls = 0;
  const win = {
    isMinimized: () => false,
    isVisible: () => true,
    isDestroyed: () => false,
    restore() {},
    show() {
      shown += 1;
    },
    focus() {},
    webContents: {
      send(event) {
        sent.push(event);
      },
    },
  };

  const mocks = createMockTrayEnv();
  const controller = createStatusItemController({
    app: { getLocale: () => "en", name: "OnMyAgent", quit() {} },
    Tray: mocks.Tray,
    Menu: mocks.Menu,
    nativeImage: mocks.nativeImage,
    createMainWindow: async () => win,
    getMainWindow: () => win,
    quitApp: () => {
      quitCalls += 1;
    },
    openDesktopPermissions: async () => {
      permissionCalls += 1;
    },
    platform: "darwin",
  });

  await controller.runAction(STATUS_ITEM_ACTION.SHOW_WINDOW);
  assert.ok(shown >= 1);

  await controller.runAction(STATUS_ITEM_ACTION.NEW_TASK);
  assert.ok(sent.includes(STATUS_ITEM_EVENTS.NEW_TASK));

  await controller.runAction(STATUS_ITEM_ACTION.OPEN_SETTINGS);
  assert.ok(sent.includes(STATUS_ITEM_EVENTS.OPEN_SETTINGS));

  await controller.runAction(STATUS_ITEM_ACTION.DESKTOP_PERMISSIONS);
  assert.equal(permissionCalls, 1);
  assert.ok(
    sent.includes(STATUS_ITEM_EVENTS.DESKTOP_PERMISSIONS),
    "desktop permissions should notify renderer to open Settings → System",
  );

  assert.equal(controller.isAppQuitting(), false);
  await controller.runAction(STATUS_ITEM_ACTION.QUIT);
  assert.equal(quitCalls, 1);
  assert.equal(controller.isAppQuitting(), true);
  controller.cancelQuitting();
  assert.equal(controller.isAppQuitting(), false);
  await controller.runAction(STATUS_ITEM_ACTION.QUIT);
  assert.equal(quitCalls, 2);
  assert.equal(controller.isAppQuitting(), true);
});
