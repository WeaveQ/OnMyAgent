import assert from "node:assert/strict";
import test from "node:test";

import {
  JUMP_LIST_ACTION,
  JUMP_LIST_FLAG_PREFIX,
  buildWindowsJumpListTasks,
  parseJumpListActionFromArgv,
  resolveJumpListAppIconPath,
  installWindowsJumpList,
  createWindowsJumpListRuntime,
  dispatchJumpListAction,
} from "./windows-jump-list.mjs";

test("parseJumpListActionFromArgv reads --onmyagent-action", () => {
  assert.equal(
    parseJumpListActionFromArgv([
      "electron.exe",
      `${JUMP_LIST_FLAG_PREFIX}${JUMP_LIST_ACTION.DESKTOP_CONTROL}`,
    ]),
    JUMP_LIST_ACTION.DESKTOP_CONTROL,
  );
  assert.equal(parseJumpListActionFromArgv(["electron.exe"]), null);
  assert.equal(
    parseJumpListActionFromArgv([`${JUMP_LIST_FLAG_PREFIX}nope`]),
    null,
  );
});

test("resolveJumpListAppIconPath prefers icon.ico beside brand png", () => {
  const files = new Set([
    "C:/icons/dev/icon.png",
    "C:/icons/icon.ico",
  ]);
  const resolved = resolveJumpListAppIconPath({
    appIconPath: "C:/icons/dev/icon.png",
    existsSync: (p) => files.has(p.replaceAll("\\", "/")),
  });
  assert.ok(resolved);
  assert.match(resolved.replaceAll("\\", "/"), /icon\.ico$/);
});

test("computer-control task uses the brand app icon, not a monitor glyph", () => {
  const tasks = buildWindowsJumpListTasks({
    locale: "zh-CN",
    program: "C:/OnMyAgent.exe",
    appIconPath: "C:/icons/icon.png",
    existsSync: (p) =>
      p.replaceAll("\\", "/").endsWith("icon.ico") ||
      p.replaceAll("\\", "/") === "C:/icons/icon.png",
  });
  const control = tasks.find((item) => item.title === "计算机控制");
  assert.ok(control);
  assert.equal(control.args, `${JUMP_LIST_FLAG_PREFIX}desktop-control`);
  assert.match(String(control.iconPath).replaceAll("\\", "/"), /icon\.(ico|png)$/);
  assert.notEqual(control.iconPath, "C:/Windows/System32/imageres.dll");
});

test("installWindowsJumpList is a no-op off Windows", () => {
  const result = installWindowsJumpList({
    app: {},
    program: "x",
    platform: "darwin",
  });
  assert.equal(result.skipped, true);
});

test("dispatchJumpListAction maps desktop-control to tray desktopPermissions", async () => {
  /** @type {string[]} */
  const ran = [];
  await dispatchJumpListAction("desktop-control", {
    runStatusAction: (id) => {
      ran.push(id);
    },
    sendToMainWindow: () => {
      ran.push("send");
    },
  });
  assert.deepEqual(ran, ["desktopPermissions"]);
});

test("createWindowsJumpListRuntime install + consumeArgv", async () => {
  /** @type {string[]} */
  const ran = [];
  const runtime = createWindowsJumpListRuntime({
    app: { getLocale: () => "zh-CN" },
    program: "C:/OnMyAgent.exe",
    appIconPath: "C:/icons/icon.png",
    platform: "darwin",
    statusItem: {
      runAction: (id) => {
        ran.push(id);
      },
      installSafely: () => {
        ran.push("install");
      },
    },
    createMainWindow: async () => {
      throw new Error("unused on darwin consume of new-task");
    },
  });
  const jump = runtime.install();
  assert.equal(jump.skipped, true);
  await runtime.consumeArgv(["app.exe", `${JUMP_LIST_FLAG_PREFIX}${JUMP_LIST_ACTION.NEW_TASK}`]);
  assert.deepEqual(ran, ["install", "newTask"]);
});
