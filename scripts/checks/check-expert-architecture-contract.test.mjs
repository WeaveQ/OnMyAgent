import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateExpertArchitectureContracts } from "./check-expert-architecture-contract.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

function writeFixtureFile(root, relativePath, source) {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
}

function passingFixture() {
  const root = mkdtempSync(join(tmpdir(), "onmyagent-architecture-contract-"));
  writeFixtureFile(root, "apps/app/src/react-app/capabilities/session-identity/expert-directory-cache.ts", `
export function writeExpertDirectoryCache() { return true; }
export const key = "onmyagent:expert-directory:";
`);
  writeFixtureFile(root, "apps/app/src/react-app/capabilities/session-identity/expert-directory-query.ts", `
import { writeExpertDirectoryCache } from "./expert-directory-cache";
export function refresh() { writeExpertDirectoryCache(); }
`);
  writeFixtureFile(root, "apps/app/src/react-app/shell/session-route/sessions.ts", `
export async function refresh(client) { return client.listSessions("w", { scope: "workspace" }); }
`);
  writeFixtureFile(root, "apps/server/src/services/workspace-sessions.ts", `
export async function aggregateWorkspaceSessionLists() { return { scope: "workspace", items: [] }; }
`);
  writeFixtureFile(root, "apps/server/src/routes/workspace-session-routes.ts", `
export function route(scope) { return scope === "workspace"; }
`);
  return root;
}

test("architecture contract passes on the current Expert source tree", () => {
  const result = evaluateExpertArchitectureContracts(repoRoot);
  assert.equal(result.ok, true, result.failures.map((failure) => failure.message).join("\n"));
  assert.equal(result.checks.find((check) => check.name === "one Expert Directory cache writer")?.ok, true);
});

test("architecture contract passes a minimal stable-symbol fixture", () => {
  const root = passingFixture();
  try {
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, true, result.failures.map((failure) => failure.message).join("\n"));
    assert.equal(result.checks.find((check) => check.name === "prompt proxy contract hook (when P9 exists)")?.skipped, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects a legacy renderer delete symbol", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/domains/session/pages/legacy.ts", `export function legacy() { return deleteSessionOrigin(); }\n`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "legacy-renderer-symbol" && failure.message.includes("deleteSessionOrigin")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects the legacy Expert package uninstall call", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/domains/agents/legacy-uninstall.ts", `
export function removePackage() { return uninstallExpertPackage({ marketplace: "my-experts", packageName: "mine" }); }
`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "legacy-renderer-symbol" && failure.message.includes("uninstallExpertPackage")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects a second Expert Directory cache writer", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/domains/session/pages/second-cache-writer.ts", `export function writeExpertDirectoryCache() { return false; }\n`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "expert-directory-cache-writer-count"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects 404-derived Expert deletion inference in a newly added consumer", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/shell/session-route/new-expert-consumer.ts", `
export function recover(error) { if (error.status === 404) return "delete"; }
`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "expert-404-deletion-inference"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract ignores 404 handling outside Expert/session consumer roots", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/domains/settings/unrelated-error.ts", `
export function recover(error) { if (error.status === 404) return "ignore"; }
`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, true, result.failures.map((failure) => failure.message).join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects session_not_found inference in a newly added identity consumer", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/capabilities/session-identity/new-directory-consumer.ts", `
export function recover(error) { if (error.code === "session_not_found") return "delete"; }
`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "expert-404-deletion-inference"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects synchronous renderer Expert identity reads", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/domains/session/pages/bad-identity.tsx", `
export function View() { return readCustomAgentIdForSession("s"); }
`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "renderer-sync-expert-identity-read"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects duplicate Expert cache key ownership", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/app/src/react-app/domains/session/pages/duplicate-key.ts", `
export const key = "onmyagent:expert-directory:";
`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "expert-storage-owner"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt proxy contract is conditional and fails only once a P9 hook exists", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(root, "apps/server/src/services/expert-runtime-contract.ts", `export async function assertExpertRuntimeContract() { return true; }\n`);
    writeFixtureFile(root, "apps/server/src/services/opencode-proxy.ts", `export function prompt() { return "prompt_async"; }\n`);
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "prompt-contract-uncovered"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture checker does not require deleted paths to exist in an empty fixture", () => {
  const root = passingFixture();
  try {
    assert.equal(existsSync(join(root, "apps/app/src/react-app/domains/agents/session-origin-hydration.ts")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture contract rejects generated Expert manifest metadata drift", () => {
  const root = passingFixture();
  try {
    writeFixtureFile(
      root,
      "apps/desktop/resources/marketplace/experts/plugins/sample/.expert-plugin/plugin.json",
      JSON.stringify({ skills: ["./skills/a"], introStyle: "short-colleague", approvedAgentIds: ["safe"] }),
    );
    writeFixtureFile(
      root,
      "apps/app/src/react-app/domains/plugins/expert-marketplace/builtin-experts.manifest.json",
      JSON.stringify({ experts: [{ packageName: "sample", manifest: { skills: [], introStyle: "default" } }] }),
    );
    const result = evaluateExpertArchitectureContracts(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "expert-manifest-metadata-drift"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
