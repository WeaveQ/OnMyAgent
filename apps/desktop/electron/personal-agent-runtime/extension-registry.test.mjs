import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  adapterToCustomAgent,
  loadExtensions,
  normalizeAcpAdapterContribution,
  readExtensionManifest,
  setExtensionEnabled,
} from "./extension-registry.mjs";
import { configurePersonalAgentRuntimeState, personalAgentExtensionsRoot } from "./runtime-state.mjs";

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(() => fn());
  chain = run.then(() => {}, () => {});
  return run;
}

async function tempRuntimeStateRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-ext-registry-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: root });
  await mkdir(personalAgentExtensionsRoot(), { recursive: true });
  return root;
}

async function writeBundledManifest(rootDir, folder, manifest) {
  const dir = path.join(rootDir, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "onmyagent-extension.json"), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

test("normalizeAcpAdapterContribution rejects missing id", () => {
  assert.throws(() => normalizeAcpAdapterContribution({ connectionType: "cli", defaultCliPath: "x" }, { name: "ext" }), /id is required/);
});

test("normalizeAcpAdapterContribution rejects missing cliPath for cli connection", () => {
  assert.throws(() => normalizeAcpAdapterContribution({ id: "a", connectionType: "cli" }, { name: "ext" }), /cliCommand or defaultCliPath is required/);
});

test("normalizeAcpAdapterContribution defaults supportsAcp for cli", () => {
  const adapter = normalizeAcpAdapterContribution({ id: "a", connectionType: "cli", cliCommand: "codex" }, { name: "ext" });
  assert.equal(adapter.supportsAcp, true);
  assert.equal(adapter.connectionType, "cli");
  assert.equal(adapter.defaultCliPath, "codex");
});

test("readExtensionManifest parses bundled adapter contribution", (t) => serial(async () => {
  await tempRuntimeStateRoot();
  const bundledRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-ext-bundle-"));
  const dir = await writeBundledManifest(bundledRoot, "demo", {
    name: "demo.ext",
    version: "0.1.0",
    contributes: {
      acpAdapters: [
        { id: "demo-adapter", connectionType: "cli", cliCommand: "codex", defaultCliPath: "codex" },
      ],
    },
  });
  const parsed = await readExtensionManifest(path.join(dir, "onmyagent-extension.json"), "bundled");
  assert.equal(parsed?.extension.name, "demo.ext");
  assert.equal(parsed?.adapters.length, 1);
  assert.equal(parsed?.adapters[0].fullyQualifiedId, "ext:demo.ext:demo-adapter");
}));

test("loadExtensions merges bundled + user extensions and honors disabled state", (t) => serial(async () => {
  await tempRuntimeStateRoot();
  const bundledRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-ext-bundle-"));
  await writeBundledManifest(bundledRoot, "bundled-a", {
    name: "bundled.a",
    version: "1.0.0",
    contributes: { acpAdapters: [{ id: "b1", connectionType: "cli", cliCommand: "codex" }] },
  });
  await writeBundledManifest(personalAgentExtensionsRoot(), "user-b", {
    name: "user.b",
    version: "2.0.0",
    contributes: { acpAdapters: [{ id: "u1", connectionType: "cli", cliCommand: "claude" }] },
  });

  let result = await loadExtensions({ bundledRoots: [bundledRoot] });
  assert.equal(result.extensions.length, 2);
  assert.equal(result.enabledAdapters.length, 2);

  await setExtensionEnabled("bundled.a", false);
  result = await loadExtensions({ bundledRoots: [bundledRoot] });
  assert.equal(result.extensions.length, 2);
  assert.equal(result.enabledAdapters.length, 1);
  assert.equal(result.enabledAdapters[0].fullyQualifiedId, "ext:user.b:u1");
}));

test("adapterToCustomAgent produces provider=custom virtual agent", () => {
  const adapter = normalizeAcpAdapterContribution({
    id: "buddy",
    connectionType: "cli",
    cliCommand: "codebuddy",
    defaultCliPath: "npx @tencent-ai/codebuddy-code",
    acpArgs: ["--acp"],
    authRequired: true,
    supportsStreaming: true,
    supportsResume: false,
    supportsApproval: true,
    supportsModelOverride: true,
  }, { name: "example.ext", version: "1.0.0", source: "bundled", installRoot: "/tmp" });
  const agent = adapterToCustomAgent(adapter);
  assert.equal(agent.provider, "custom");
  assert.equal(agent.id, "ext:example.ext:buddy");
  assert.equal(agent.connectionType, "cli");
  assert.equal(agent.supportsAcp, true);
  assert.equal(agent.supportsStreaming, true);
  assert.deepEqual(agent.acpArgs, ["--acp"]);
  assert.equal(agent.executablePath, "npx @tencent-ai/codebuddy-code");
  assert.equal(agent.agent_source, "extension");
  assert.equal(agent.extensionName, "example.ext");
});
