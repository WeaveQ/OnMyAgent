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
    createFromPath() {
      return {
        isEmpty: () => false,
        resize: () => ({
          isEmpty: () => false,
          setTemplateImage(flag) {
            this.template = flag;
          },
          template: false,
        }),
        setTemplateImage() {},
      };
    },
    createEmpty() {
      return {
        isEmpty: () => true,
        resize: () => this,
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

test("status item install is no-op on non-darwin", () => {
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
  assert.equal(controller.install(), null);
  assert.equal(controller.getTray(), null);
});

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
  assert.ok(template.some((item) => item.label === "打开专家市场"));
  assert.ok(template.some((item) => typeof item.click === "function"));
});

test("runAction show/settings/new-task/marketplace/permissions/quit use real handlers", async () => {
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

  await controller.runAction(STATUS_ITEM_ACTION.OPEN_EXPERT_MARKETPLACE);
  assert.ok(sent.includes(STATUS_ITEM_EVENTS.OPEN_EXPERT_MARKETPLACE));

  await controller.runAction(STATUS_ITEM_ACTION.OPEN_SETTINGS);
  assert.ok(sent.includes(STATUS_ITEM_EVENTS.OPEN_SETTINGS));

  await controller.runAction(STATUS_ITEM_ACTION.DESKTOP_PERMISSIONS);
  assert.equal(permissionCalls, 1);

  assert.equal(controller.isAppQuitting(), false);
  await controller.runAction(STATUS_ITEM_ACTION.QUIT);
  assert.equal(quitCalls, 1);
  assert.equal(controller.isAppQuitting(), true);
});
