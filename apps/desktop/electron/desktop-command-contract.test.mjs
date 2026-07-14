import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  desktopCommandGroups,
  desktopCommandNames,
} from "../../../packages/types/src/desktop-ipc-commands.mjs";
import { createDesktopCommandRouter } from "./desktop-command-router.mjs";

const mainSourceUrl = new URL("./main.mjs", import.meta.url);

function implementedDesktopCommands(source) {
  return [...source.matchAll(/^\s*case "([^"]+)":/gm)].map((match) => match[1]);
}

test("desktop commands are assigned to exactly one domain", () => {
  const grouped = Object.values(desktopCommandGroups).flat();
  assert.deepEqual(grouped, desktopCommandNames);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("shared desktop contract and Electron handlers have exact parity", async () => {
  const source = await readFile(mainSourceUrl, "utf8");
  const implemented = implementedDesktopCommands(source).sort();
  const declared = [...desktopCommandNames].sort();
  assert.deepEqual(implemented, declared);
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
