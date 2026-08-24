import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPersonalAgentRuntime } from "./index.mjs";
import {
  createConversation,
  listConversationsByProvider,
  readConversationEvents,
} from "./conversation-store.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-conversation-correctness-"));
  configurePersonalAgentRuntimeState({
    runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state"),
  });
  return workspaceRoot;
}

async function cleanup(workspaceRoot) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function legacyStub() {
  return {
    normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex" }),
    detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", status: "online" }),
    listAgents: async () => ({ agents: [] }),
    start: async () => ({ status: "legacy-start" }),
    run: async () => ({ status: "legacy-run" }),
    status: () => ({ status: "missing" }),
    cancel: async () => ({ ok: true }),
  };
}

async function waitForRun(runtime, runId) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = runtime.getRun(runId);
    if (snapshot.status !== "running") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`run ${runId} did not finish`);
}

test("reused conversations retain both turns and archive messages after restart", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    let turn = 0;
    const runtime = createPersonalAgentRuntime({
      legacy: legacyStub(),
      adapters: {
        codex: ({ appendEvent }) => ({
          sendMessage: async ({ prompt }) => {
            turn += 1;
            appendEvent({ type: "assistant_chunk", text: `stream-${turn}` });
            return {
              output: `reply-${prompt}`,
              command: "fake-codex",
              connectionMode: "Codex ACP session",
              providerSessionId: "provider-session-1",
            };
          },
        }),
      },
    });
    const conversation = await runtime.createConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      title: "Two turns",
    });
    await runtime.importConversationFromArchive({
      workspaceRoot,
      agent: { provider: "codex" },
      conversationId: conversation.conversation.id,
      messages: [
        { id: "archive-user", role: "user", content: "archived-user", createdAt: 1 },
        { id: "archive-assistant", role: "assistant", content: "archived-assistant", createdAt: 2 },
      ],
    });

    for (const prompt of ["first-user", "second-user"]) {
      const started = await runtime.startMessage({
        workspaceRoot,
        agent: { provider: "codex" },
        conversationId: conversation.conversation.id,
        prompt,
      });
      await waitForRun(runtime, started.runId);
    }

    const persisted = await readConversationEvents(
      workspaceRoot,
      "codex",
      "codex",
      conversation.conversation.id,
    );
    const text = persisted.messages.map((message) => message.text).filter(Boolean);
    for (const expected of [
      "archived-user",
      "archived-assistant",
      "first-user",
      "reply-first-user",
      "second-user",
      "reply-second-user",
    ]) {
      assert.equal(text.includes(expected), true, `missing ${expected}`);
    }

    const reloaded = await createPersonalAgentRuntime({
      legacy: legacyStub(),
      adapters: {},
    }).getConversationStatus({
      workspaceRoot,
      agent: { provider: "codex" },
      conversationId: conversation.conversation.id,
    });
    const reloadedText = reloaded.conversationMessages.map((message) => message.text).filter(Boolean);
    for (const expected of ["archived-user", "archived-assistant", "first-user", "second-user"]) {
      assert.equal(reloadedText.includes(expected), true, `restart missing ${expected}`);
    }
  } finally {
    await cleanup(workspaceRoot);
  }
});

test("reset is scoped to the selected conversation", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    let releaseSend = () => undefined;
    const hold = new Promise((resolve) => {
      releaseSend = resolve;
    });
    const runtime = createPersonalAgentRuntime({
      legacy: legacyStub(),
      adapters: {
        codex: ({ appendEvent }) => ({
          sendMessage: async () => {
            appendEvent({ type: "log", text: "started" });
            await hold;
            return { output: "done", command: "fake-codex" };
          },
          cancel: async () => undefined,
        }),
      },
    });
    const runningConversation = await runtime.createConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      title: "Running conversation",
    });
    const idleConversation = await runtime.createConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      title: "Idle conversation",
    });

    const started = await runtime.startMessage({
      workspaceRoot,
      agent: { provider: "codex" },
      conversationId: runningConversation.conversation.id,
      prompt: "hold",
    });
    const resetIdle = await runtime.resetConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      conversationId: idleConversation.conversation.id,
    });
    assert.equal(resetIdle.ok, true);

    const resetRunning = await runtime.resetConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      conversationId: runningConversation.conversation.id,
    });
    assert.equal(resetRunning.ok, false);
    assert.equal(resetRunning.error, "agent has an active run");

    releaseSend();
    await waitForRun(runtime, started.runId);
  } finally {
    await cleanup(workspaceRoot);
  }
});

test("normal provider lists exclude channel conversations", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const normal = await createConversation(workspaceRoot, "codex", "codex", {
      title: "Studio conversation",
    });
    const channel = await createConversation(workspaceRoot, "codex", "codex-weixin-abcdef123456", {
      title: "Channel conversation",
      source: "channel",
    });

    const listed = await listConversationsByProvider(workspaceRoot, "codex", "codex");
    assert.equal(listed.conversations.some((conversation) => conversation.id === normal.id), true);
    assert.equal(listed.conversations.some((conversation) => conversation.id === channel.id), false);
    assert.equal(listed.conversations.every((conversation) => conversation.source !== "channel"), true);
  } finally {
    await cleanup(workspaceRoot);
  }
});

test("model config keeps the selected conversation authoritative across provider session replacement", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const calls = [];
    const runtime = createPersonalAgentRuntime({
      legacy: legacyStub(),
      adapters: {
        codex: () => ({
          setConfigOption: async (input) => {
            calls.push(input);
            return {
              ok: true,
              sessionId: calls.length === 1 ? "provider-session-replacement" : input.sessionId,
              optionId: input.optionId,
              value: input.value,
            };
          },
        }),
      },
    });
    const created = await runtime.createConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      providerSessionId: "provider-session-selected",
      resumeKey: "provider-session-selected",
    });

    const result = await runtime.setConfigOption({
      workspaceRoot,
      conversationId: created.conversation.id,
      sessionId: "stale-renderer-session",
      providerSessionId: "stale-renderer-session",
      resumeKey: "stale-renderer-session",
      optionId: "model",
      value: "model-b",
      agent: { provider: "codex" },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sessionId, "provider-session-selected");
    assert.equal(calls[0].conversationId, created.conversation.id);

    await runtime.setConfigOption({
      workspaceRoot,
      conversationId: created.conversation.id,
      sessionId: "stale-renderer-session",
      providerSessionId: "stale-renderer-session",
      resumeKey: "stale-renderer-session",
      optionId: "model",
      value: "model-c",
      agent: { provider: "codex" },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].sessionId, "provider-session-replacement");

    const listed = await runtime.listConversations({
      workspaceRoot,
      agent: { provider: "codex" },
    });
    const selected = listed.conversations.find((conversation) => conversation.id === created.conversation.id);
    assert.equal(selected?.providerSessionId, "provider-session-replacement");
  } finally {
    await cleanup(workspaceRoot);
  }
});

test("model config rejects an unknown conversation instead of falling back to another one", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    let calls = 0;
    const runtime = createPersonalAgentRuntime({
      legacy: legacyStub(),
      adapters: {
        codex: () => ({
          setConfigOption: async () => {
            calls += 1;
            return { ok: true, sessionId: "unexpected" };
          },
        }),
      },
    });
    await runtime.createConversation({
      workspaceRoot,
      agent: { provider: "codex" },
      providerSessionId: "provider-session-existing",
    });

    await assert.rejects(
      runtime.setConfigOption({
        workspaceRoot,
        conversationId: "conv-does-not-exist",
        optionId: "model",
        value: "model-b",
        agent: { provider: "codex" },
      }),
      /conversation .* not found/i,
    );
    assert.equal(calls, 0);
  } finally {
    await cleanup(workspaceRoot);
  }
});
