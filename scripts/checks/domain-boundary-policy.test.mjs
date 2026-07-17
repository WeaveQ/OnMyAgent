import assert from "node:assert/strict";
import test from "node:test";

import {
  domainDependencyIsAllowed,
  domainImportUsesPublicEntrypoint,
} from "./domain-boundary-policy.mjs";

test("allows declared domain dependencies only through the target public entrypoint", () => {
  assert.equal(domainDependencyIsAllowed("session", "agents"), true);
  assert.equal(domainImportUsesPublicEntrypoint("agents", "agents"), true);
  assert.equal(domainImportUsesPublicEntrypoint("agents/index.ts", "agents"), true);
  assert.equal(domainImportUsesPublicEntrypoint("agents/agent-registry-store.ts", "agents"), false);
});

test("rejects reverse utility dependencies moved to neutral owners", () => {
  assert.equal(domainDependencyIsAllowed("local-agents", "session"), false);
  assert.equal(domainDependencyIsAllowed("messaging", "session"), false);
  assert.equal(domainDependencyIsAllowed("workspace", "session"), false);
  assert.equal(domainDependencyIsAllowed("shared", "agents"), false);
});

test("allows local-agents host toasts via shell-feedback", () => {
  assert.equal(domainDependencyIsAllowed("local-agents", "shell-feedback"), true);
});

test("rejects undeclared domain dependencies", () => {
  assert.equal(domainDependencyIsAllowed("plugins", "session"), false);
  assert.equal(domainDependencyIsAllowed("connections", "workspace"), false);
});

test("allows shared infrastructure only through its public entrypoint", () => {
  assert.equal(domainDependencyIsAllowed("session", "shared"), true);
  assert.equal(domainDependencyIsAllowed("connections", "shared"), true);
  assert.equal(domainImportUsesPublicEntrypoint("shared", "shared"), true);
  assert.equal(
    domainImportUsesPublicEntrypoint("shared/extension-state.ts", "shared"),
    false,
  );
});
