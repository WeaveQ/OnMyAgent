import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

import {
  appendConversationEvents,
  conversationEventsLogFile,
  mergeConversationEvents,
  readConversationEvents,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(() => fn());
  chain = run.then(() => {}, () => {});
  return run;
}

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-conv-events-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state") });
  return workspaceRoot;
}

test("readConversationEvents does not duplicate leftover jsonl after checkpoint", async () => serial(async () => {
  const workspaceRoot = await tempWorkspace();
  const events = [
    { type: "user", text: "hello", at: 1 },
    { type: "status", text: "started", at: 2 },
  ];
  await writeConversationEvents(workspaceRoot, "codex", "codex", "conv-1", events, []);
  await writeFile(
    conversationEventsLogFile(workspaceRoot, "codex", "codex", "conv-1"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const loaded = await readConversationEvents(workspaceRoot, "codex", "codex", "conv-1");
  assert.equal(loaded.events.length, 2);
  assert.deepEqual(loaded.events.map((event) => event.type), ["user", "status"]);
}));

test("mergeConversationEvents keeps new log events after the checkpoint", () => {
  const merged = mergeConversationEvents(
    [{ type: "user", text: "hello", at: 1 }],
    [
      { type: "user", text: "hello", at: 1 },
      { type: "status", text: "delta", at: 2 },
    ],
  );
  assert.deepEqual(merged, [
    { type: "user", text: "hello", at: 1 },
    { type: "status", text: "delta", at: 2 },
  ]);
});

test("appendConversationEvents after checkpoint still hydrates new lines", async () => serial(async () => {
  const workspaceRoot = await tempWorkspace();
  await writeConversationEvents(
    workspaceRoot,
    "codex",
    "codex",
    "conv-2",
    [{ type: "user", text: "hello", at: 1 }],
    [],
  );
  await appendConversationEvents(
    workspaceRoot,
    "codex",
    "codex",
    "conv-2",
    [{ type: "status", text: "delta", at: 2 }],
  );
  const loaded = await readConversationEvents(workspaceRoot, "codex", "codex", "conv-2");
  assert.deepEqual(loaded.events.map((event) => event.type), ["user", "status"]);
}));
