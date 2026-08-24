import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";
import { injectPersonalAgentContext } from "./context-injection.mjs";
import { configurePersonalAgentRuntimeState, resetPersonalAgentRuntimeState } from "./runtime-state.mjs";
import { providerWorkdir } from "./workdir.mjs";

const browserServer = {
  name: "onmyagent-in-app-browser",
  command: process.execPath,
  args: ["browser-mcp-stdio.mjs"],
  env: [],
};

test("Local Agent context routes Browser work to the injected OnMyAgent MCP", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-context-"));
  try {
    const file = await injectPersonalAgentContext({
      workdir: root,
      provider: "codex",
      workspaceRoot: root,
      mcpServers: [browserServer],
    });
    const text = await readFile(file, "utf8");
    assert.match(text, /authoritative browser surface.*`onmyagent-in-app-browser`/i);
    assert.match(text, /call its `browser_\*` tools directly/i);
    assert.match(text, /Do not read or follow.*`control-in-app-browser`/i);
    assert.match(text, /do not use `node_repl`, `mcp\.node_repl\.js`/i);
    assert.match(text, /Temporary research tabs should stay in the background/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Browser routing instructions are absent when the MCP was not injected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-no-browser-context-"));
  try {
    const file = await injectPersonalAgentContext({
      workdir: root,
      provider: "codex",
      workspaceRoot: root,
      mcpServers: [],
    });
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /OnMyAgent in-app Browser/);
    assert.doesNotMatch(text, /control-in-app-browser/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP send writes Browser routing only when the named server reaches the adapter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-adapter-context-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(root, "runtime-state") });
  try {
    const adapter = acpGenericTest.createGenericAcpAdapterForTest({
      appendEvent: () => undefined,
      registerCancel: () => undefined,
    });
    const fixture = path.join(import.meta.dirname, "fixtures", "fake-acp-cli.mjs");
    const agent = {
      id: "codex-browser-routing-test",
      provider: "codex",
      executablePath: process.execPath,
      customArgs: [fixture],
      managedAcpTool: { id: "codex-acp-test" },
    };
    await adapter.sendMessage({
      workspaceRoot: root,
      prompt: "use-onmyagent-browser",
      approvalMode: "ask",
      agent,
      mcpServers: [browserServer],
    });
    const text = await readFile(path.join(providerWorkdir(root, "codex", agent.id), "AGENTS.md"), "utf8");
    assert.match(text, /authoritative browser surface.*`onmyagent-in-app-browser`/i);
    assert.match(text, /do not use `node_repl`/i);
  } finally {
    resetPersonalAgentRuntimeState();
    await rm(root, { recursive: true, force: true });
  }
});
