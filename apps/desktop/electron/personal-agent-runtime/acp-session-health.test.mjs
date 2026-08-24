import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { failedToolUpdateCode } from "./acp-session-health.mjs";
import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";
import { configurePersonalAgentRuntimeState, resetPersonalAgentRuntimeState } from "./runtime-state.mjs";
import { readSession } from "./session-store.mjs";

test("ordinary terminal failure preserves ACP session health and resume", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-acp-session-health-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state") });
  try {
    const fixture = path.join(import.meta.dirname, "fixtures", "fake-acp-cli.mjs");
    const events = [];
    const adapter = acpGenericTest.createGenericAcpAdapterForTest({
      appendEvent: (event) => events.push(event),
      registerCancel: () => undefined,
    });
    const agent = {
      id: "codex-terminal-failure-test",
      name: "Codex terminal failure test",
      provider: "codex",
      executablePath: process.execPath,
      customArgs: [fixture, "--fail-terminal-tool-after-assistant"],
      managedAcpTool: { id: "codex-acp-test" },
    };

    const first = await adapter.sendMessage({ workspaceRoot, prompt: "terminal-failure-with-answer", approvalMode: "ask", agent });
    const stored = await readSession(workspaceRoot, "codex", agent.id);
    assert.equal(stored.health, "healthy");
    assert.equal(stored.lastFailureCode, undefined);
    assert.equal(failedToolUpdateCode('{"_meta":{"terminal_exit":{"exit_code":1}}}'), "acp_tool_failed");
    assert.equal(failedToolUpdateCode('{"_meta":{"terminal_exit":{"exit_code":null}}}'), "acp_bridge_interrupted");
    assert.equal(events.some((event) => event.type === "status" && /preserving the assistant response/.test(String(event.text ?? ""))), true);

    const resetEventStart = events.length;
    const second = await adapter.sendMessage({
      workspaceRoot,
      prompt: "resume-after-terminal-failure",
      providerSessionId: first.providerSessionId,
      resumeKey: first.resumeKey,
      approvalMode: "ask",
      agent,
    });
    assert.equal(second.providerSessionId, first.providerSessionId);
    assert.equal(events.slice(resetEventStart).some((event) => event.type === "tips" && /context was not replayed/.test(String(event.text ?? ""))), false);
  } finally {
    resetPersonalAgentRuntimeState();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
