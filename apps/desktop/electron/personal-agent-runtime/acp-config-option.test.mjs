import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-acp-config-option-"));
  configurePersonalAgentRuntimeState({
    runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state"),
  });
  return workspaceRoot;
}

async function cleanup(workspaceRoot) {
  await rm(workspaceRoot, { recursive: true, force: true });
}

function fixtureAgent(fixture, sessionEventsFile, args = []) {
  return {
    id: "config-acp",
    name: "Config ACP",
    provider: "custom",
    executablePath: process.execPath,
    customArgs: [fixture, ...args, `--session-events-file=${sessionEventsFile}`],
    managedAcpTool: { id: "config-acp-test" },
  };
}

test("missing ACP config session is replaced once before applying the option", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const sessionEventsFile = path.join(workspaceRoot, "stale-session-events.jsonl");
    const adapter = createGenericAcpAdapter({ appendEvent: () => undefined, registerCancel: () => undefined });

    const result = await adapter.setConfigOption({
      workspaceRoot,
      conversationWorkdir: workspaceRoot,
      sessionId: "missing-provider-session",
      optionId: "model",
      value: "fake-model-1",
      agent: fixtureAgent(fixture, sessionEventsFile),
    });

    assert.equal(result.ok, true);
    assert.equal(result.sessionId, "fake-session-1");
    const sessionEvents = (await readFile(sessionEventsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(sessionEvents.map((event) => event.method), [
      "session/set_config_option",
      "session/new",
      "session/set_config_option",
    ]);
    assert.equal(sessionEvents[0].sessionId, "missing-provider-session");
    assert.equal(sessionEvents[1].cwd, workspaceRoot);
    assert.equal(sessionEvents[2].sessionId, "fake-session-1");
  } finally {
    await cleanup(workspaceRoot);
  }
});

test("ordinary config validation errors do not replace the supplied session", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const sessionEventsFile = path.join(workspaceRoot, "rejected-session-events.jsonl");
    const adapter = createGenericAcpAdapter({ appendEvent: () => undefined, registerCancel: () => undefined });

    await assert.rejects(
      adapter.setConfigOption({
        workspaceRoot,
        conversationWorkdir: workspaceRoot,
        sessionId: "existing-provider-session",
        optionId: "unknown-model-config",
        value: "not-advertised",
        agent: fixtureAgent(fixture, sessionEventsFile, ["--reject-standard-config"]),
      }),
      /Config option not found: unknown-model-config/,
    );

    const sessionEvents = (await readFile(sessionEventsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(sessionEvents.map((event) => event.method), ["session/set_config_option"]);
    assert.equal(sessionEvents[0].sessionId, "existing-provider-session");
  } finally {
    await cleanup(workspaceRoot);
  }
});

test("default-model reset is explicit and never degrades to the literal model null", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const standardEventsFile = path.join(workspaceRoot, "reset-standard-events.jsonl");
    const adapter = createGenericAcpAdapter({ appendEvent: () => undefined, registerCancel: () => undefined });

    const reset = await adapter.setConfigOption({
      workspaceRoot,
      conversationWorkdir: workspaceRoot,
      sessionId: "existing-provider-session",
      optionId: "model",
      value: null,
      agent: fixtureAgent(fixture, standardEventsFile),
    });
    assert.equal(reset.ok, true);
    const standardEvents = (await readFile(standardEventsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(standardEvents[0].method, "session/set_config_option");
    assert.equal(standardEvents[0].value, null);

    const legacyEventsFile = path.join(workspaceRoot, "reset-legacy-events.jsonl");
    await assert.rejects(
      adapter.setConfigOption({
        workspaceRoot,
        conversationWorkdir: workspaceRoot,
        sessionId: "existing-provider-session",
        optionId: "model",
        value: null,
        agent: fixtureAgent(fixture, legacyEventsFile, ["--no-standard-config", "--no-legacy-config"]),
      }),
      /does not support resetting the model/,
    );
    const legacyEvents = (await readFile(legacyEventsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(legacyEvents.map((event) => event.method), [
      "session/set_config_option",
      "config/set",
    ]);
  } finally {
    await cleanup(workspaceRoot);
  }
});
