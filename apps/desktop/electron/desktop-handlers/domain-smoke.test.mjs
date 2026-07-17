import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HANDLER_COMMAND_NAMES as workspaceCommands,
  createWorkspaceDomainHandlers,
} from "./workspace.mjs";
import {
  HANDLER_COMMAND_NAMES as systemCommands,
  createSystemDomainHandlers,
} from "./system.mjs";
import {
  HANDLER_COMMAND_NAMES as localAgentsCommands,
  createLocalAgentsDomainHandlers,
} from "./local-agents.mjs";
import {
  HANDLER_COMMAND_NAMES as messagingCommands,
  createMessagingDomainHandlers,
} from "./messaging.mjs";
import {
  HANDLER_COMMAND_NAMES as agentManagementCommands,
  createAgentManagementDomainHandlers,
} from "./agent-management.mjs";
import {
  HANDLER_COMMAND_NAMES as opencodeCommands,
  createOpencodeDomainHandlers,
} from "./opencode.mjs";
import {
  HANDLER_COMMAND_NAMES as runtimeCommands,
  createRuntimeDomainHandlers,
} from "./runtime.mjs";
import {
  HANDLER_COMMAND_NAMES as skillsCommands,
  createSkillsDomainHandlers,
} from "./skills.mjs";
import {
  createAllDesktopDomainHandlers,
  DESKTOP_HANDLER_COMMANDS,
  listImplementedDesktopCommands,
  mergeHandlers,
} from "./index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function mockDeps() {
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

const domains = [
  { name: "workspace", names: workspaceCommands, create: createWorkspaceDomainHandlers },
  { name: "system", names: systemCommands, create: createSystemDomainHandlers },
  { name: "local-agents", names: localAgentsCommands, create: createLocalAgentsDomainHandlers },
  { name: "messaging", names: messagingCommands, create: createMessagingDomainHandlers },
  {
    name: "agent-management",
    names: agentManagementCommands,
    create: createAgentManagementDomainHandlers,
  },
  { name: "opencode", names: opencodeCommands, create: createOpencodeDomainHandlers },
  { name: "runtime", names: runtimeCommands, create: createRuntimeDomainHandlers },
  { name: "skills", names: skillsCommands, create: createSkillsDomainHandlers },
];

test("each domain factory exposes exactly its HANDLER_COMMAND_NAMES", () => {
  for (const domain of domains) {
    const handlers = domain.create(mockDeps());
    assert.deepEqual(
      Object.keys(handlers).sort(),
      [...domain.names].sort(),
      `${domain.name} handler keys must match HANDLER_COMMAND_NAMES`,
    );
    for (const key of Object.keys(handlers)) {
      assert.equal(typeof handlers[key], "function", `${domain.name}.${key}`);
    }
  }
});

test("createAllDesktopDomainHandlers merges every domain without collision", () => {
  const all = createAllDesktopDomainHandlers(mockDeps());
  const keys = Object.keys(all).sort();
  assert.deepEqual(keys, [...DESKTOP_HANDLER_COMMANDS].sort());
  assert.deepEqual(keys, [...listImplementedDesktopCommands()].sort());
});

test("mergeHandlers throws on duplicate command registration", () => {
  assert.throws(
    () =>
      mergeHandlers(
        { sharedCommand: async () => 1 },
        { sharedCommand: async () => 2 },
      ),
    /registered more than once/,
  );
});

test("workspaceBootstrap dispatches through mocked deps (domain smoke)", async () => {
  let called = false;
  const handlers = createWorkspaceDomainHandlers({
    ...mockDeps(),
    readWorkspaceState: async () => {
      called = true;
      return { workspaces: [], selectedId: null };
    },
  });
  const result = await handlers.workspaceBootstrap({}, []);
  assert.equal(called, true);
  assert.deepEqual(result, { workspaces: [], selectedId: null });
});

test("main.mjs still wires domain handlers through the command router", () => {
  const main = readFileSync(resolve(__dirname, "../main.mjs"), "utf8");
  assert.match(main, /createAllDesktopDomainHandlers/);
  assert.match(main, /createDesktopCommandRouter/);
  assert.match(main, /from "\.\/desktop-handlers\/index\.mjs"/);
  assert.match(main, /from "\.\/desktop-command-router\.mjs"/);
});
