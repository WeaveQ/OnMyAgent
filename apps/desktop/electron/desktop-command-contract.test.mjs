import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopCommandGroups,
  desktopCommandNames,
} from "../../../packages/types/src/desktop-ipc-commands.mjs";
import { createDesktopCommandRouter } from "./desktop-command-router.mjs";
import {
  DESKTOP_HANDLER_COMMANDS,
  listImplementedDesktopCommands,
} from "./desktop-handlers/index.mjs";

test("desktop commands are assigned to exactly one domain", () => {
  const grouped = Object.values(desktopCommandGroups).flat();
  assert.deepEqual(grouped, desktopCommandNames);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("shared desktop contract and Electron handlers have exact parity", () => {
  const implemented = [...listImplementedDesktopCommands()].sort();
  const declared = [...desktopCommandNames].sort();
  const handlerKeys = [...DESKTOP_HANDLER_COMMANDS].sort();

  assert.equal(
    DESKTOP_HANDLER_COMMANDS.length,
    new Set(DESKTOP_HANDLER_COMMANDS).size,
    "DESKTOP_HANDLER_COMMANDS must not contain duplicate command names",
  );
  assert.equal(
    DESKTOP_HANDLER_COMMANDS.length,
    desktopCommandNames.length,
    "DESKTOP_HANDLER_COMMANDS length must equal desktopCommandNames",
  );
  assert.deepEqual(implemented, declared);
  assert.deepEqual(handlerKeys, declared);

  const declaredSet = new Set(declared);
  const missing = declared.filter((name) => !DESKTOP_HANDLER_COMMANDS.includes(name));
  const extra = DESKTOP_HANDLER_COMMANDS.filter((name) => !declaredSet.has(name));
  assert.deepEqual(missing, [], `handlers missing from DESKTOP_HANDLER_COMMANDS: ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `DESKTOP_HANDLER_COMMANDS has undeclared commands: ${extra.join(", ")}`);
});

test("desktop router exposes one handler registry per command domain", () => {
  const router = createDesktopCommandRouter((_event, command) => command);
  assert.deepEqual([...router.domainHandlers.keys()], Object.keys(desktopCommandGroups));
  assert.equal(
    [...router.domainHandlers.values()].reduce((count, handlers) => count + handlers.size, 0),
    desktopCommandNames.length,
  );
});

test("generated Desktop command union is current", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["scripts/checks/generate-desktop-command-types.mjs", "--check"],
    { cwd: new URL("../../..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
