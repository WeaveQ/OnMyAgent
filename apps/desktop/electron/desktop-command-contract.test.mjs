import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  desktopCommandGroups,
  desktopCommandNames,
} from "../../../packages/types/src/desktop-ipc-commands.mjs";
import { createDesktopCommandRouter } from "./desktop-command-router.mjs";
import {
  createAllDesktopDomainHandlers,
  DESKTOP_HANDLER_COMMANDS,
  listImplementedDesktopCommands,
} from "./desktop-handlers/index.mjs";

/** Minimal dep proxy so factories can be constructed without a full main.mjs graph. */
function mockDesktopHandlerDeps() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        return async () => ({ ok: true, mocked: String(prop) });
      },
    },
  );
}

test("desktop commands are assigned to exactly one domain", () => {
  const grouped = Object.values(desktopCommandGroups).flat();
  assert.deepEqual(grouped, desktopCommandNames);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("system group no longer owns knowledge / company / computerUse commands", () => {
  const system = desktopCommandGroups.system;
  assert.ok(!system.some((name) => name.startsWith("knowledge")));
  assert.ok(!system.some((name) => name.startsWith("company")));
  assert.ok(!system.some((name) => name.includes("ComputerUse") || name.includes("Appshot")));
  assert.equal(desktopCommandGroups.knowledge[0], "knowledgeEnsureVault");
  assert.equal(desktopCommandGroups.company[0], "companySettingsRead");
  assert.equal(desktopCommandGroups.computerUse[0], "getComputerUseMcpCommand");
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

  /** @type {Set<string>} */
  const declaredSet = new Set(declared);
  /** @type {Set<string>} */
  const handlerSet = new Set(DESKTOP_HANDLER_COMMANDS);
  const missing = declared.filter((name) => !handlerSet.has(name));
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

/**
 * Runtime registration path used by main.mjs: every handler key from
 * createAllDesktopDomainHandlers must be a subset of (and exact multiset match for)
 * the declared `@onmyagent/types` command map. Fails if a handler is undeclared.
 */
test("createAllDesktopDomainHandlers keys ⊆ declared desktopCommandNames", () => {
  const handlers = createAllDesktopDomainHandlers(mockDesktopHandlerDeps());
  // Keep string keys for Set/has and Object.entries — DesktopCommandName is a
  // branded union and fails checkJs when indexing with plain string.
  const registered = Object.keys(handlers).sort();
  /** @type {string[]} */
  const declared = [...desktopCommandNames].map(String).sort();
  /** @type {Set<string>} */
  const declaredSet = new Set(declared);

  const undeclared = registered.filter((name) => !declaredSet.has(name));
  assert.deepEqual(
    undeclared,
    [],
    `handlers registered but not declared in desktopCommandNames: ${undeclared.join(", ")}`,
  );

  // Full parity (handlers ⊆ declarations AND declarations ⊆ handlers).
  assert.deepEqual(
    registered,
    declared,
    "registered handlers must match declared desktopCommandNames exactly",
  );

  for (const [name, handler] of Object.entries(handlers)) {
    assert.equal(typeof handler, "function", `handler ${name} must be a function`);
  }
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

test("engine IPC payloads use EngineStartOptions / EngineDoctorOptions, not unknown", () => {
  const mapPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/types/src/desktop-ipc-command-map.ts",
  );
  const source = readFileSync(mapPath, "utf8");
  const start = source.indexOf("engineStart:");
  const end = source.indexOf("engineInstall:");
  assert.ok(start >= 0 && end > start, "engine command slice missing");
  const slice = source.slice(start, end);
  assert.match(slice, /EngineStartOptions/);
  assert.match(slice, /EngineDoctorOptions/);
  assert.doesNotMatch(slice, /Record<string, unknown>/);
  assert.match(slice, /engineRestart: DesktopCommandContract<\[EngineStartOptions\?\]/);
});
