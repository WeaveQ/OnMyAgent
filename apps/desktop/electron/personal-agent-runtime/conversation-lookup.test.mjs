import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import {
  createConversation,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";
import {
  CHANNEL_AGENT_ID_RE,
  getConversationById,
  listChannelConversations,
} from "./conversation-lookup.mjs";

// `configurePersonalAgentRuntimeState` mutates module-global state, so the
// tests that touch disk must never interleave. Serialize them with a chain.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(() => fn());
  chain = run.then(() => {}, () => {});
  return run;
}

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-conv-lookup-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state") });
  return workspaceRoot;
}

test("CHANNEL_AGENT_ID_RE matches the six known platforms", () => {
  for (const platform of ["weixin", "feishu", "wecom", "lark", "dingtalk", "telegram"]) {
    assert.ok(
      CHANNEL_AGENT_ID_RE.test(`codex-${platform}-a1b2c3d4e5f6`),
      `should match scoped agent id for ${platform}`,
    );
  }
});

test("CHANNEL_AGENT_ID_RE does not match non-channel agent ids", () => {
  assert.ok(!CHANNEL_AGENT_ID_RE.test("codex-default"));
  assert.ok(!CHANNEL_AGENT_ID_RE.test("codex-weixin")); // no hash
  assert.ok(!CHANNEL_AGENT_ID_RE.test("codex-slack-a1b2c3d4e5f6")); // unknown platform
  assert.ok(!CHANNEL_AGENT_ID_RE.test("codex-weixin-XYZ")); // non-hex hash
});

test("getConversationById finds a conversation via the fast (scoped) path", () =>
  serial(async () => {
    const workspaceRoot = await tempWorkspace();
    const created = await createConversation(workspaceRoot, "codex", "default", { title: "Fast path" });
    const found = await getConversationById(workspaceRoot, created.id);
    assert.ok(found);
    assert.equal(found.id, created.id);
    assert.equal(found.title, "Fast path");
  }));

test("getConversationById falls back to scanning all workspaces", () =>
  serial(async () => {
    const home = await tempWorkspace();
    const other = await tempWorkspace();
    // Create under `other`, then query from `home` — must still resolve.
    const created = await createConversation(other, "codex", "default", { title: "Cross workspace" });
    const found = await getConversationById(home, created.id);
    assert.ok(found);
    assert.equal(found.id, created.id);
    assert.equal(found.title, "Cross workspace");
  }));

test("getConversationById tags a scoped channel agent id as source:channel", () =>
  serial(async () => {
    const workspaceRoot = await tempWorkspace();
    const created = await createConversation(workspaceRoot, "codex", "codex-weixin-abcdef123456", {
      title: "Channel scoped",
      source: "studio-created",
    });
    const found = await getConversationById(workspaceRoot, created.id);
    assert.ok(found);
    assert.equal(found.source, "channel");
  }));

test("getConversationById returns null for an unknown id", () =>
  serial(async () => {
    const workspaceRoot = await tempWorkspace();
    const found = await getConversationById(workspaceRoot, "conv-does-not-exist");
    assert.equal(found, null);
  }));

test("listChannelConversations returns only channel-scoped conversations", () =>
  serial(async () => {
    const workspaceRoot = await tempWorkspace();
    const channelConv = await createConversation(workspaceRoot, "codex", "codex-feishu-112233445566", {
      title: "IM conversation",
      source: "channel",
    });
    await createConversation(workspaceRoot, "codex", "default", { title: "Normal studio conversation" });
    await writeConversationEvents(workspaceRoot, "codex", "codex-feishu-112233445566", channelConv.id, [], []);

    const { conversations } = await listChannelConversations(workspaceRoot);
    // The normal (agentId "default") conversation must NOT appear.
    assert.ok(!conversations.some((item) => item.source !== "channel"), "every result must be channel-scoped");
    const match = conversations.find((item) => item.id === channelConv.id);
    assert.ok(match, "the channel conversation must be returned");
    assert.equal(match.source, "channel");
  }));

test("listChannelConversations recognises channel agent id even without source tag", () =>
  serial(async () => {
    const workspaceRoot = await tempWorkspace();
    // Historical binding persisted without source:"channel" but with a scoped agent id.
    const legacy = await createConversation(workspaceRoot, "codex", "codex-lark-deadbeef0001", {
      title: "Legacy IM binding",
    });
    const { conversations } = await listChannelConversations(workspaceRoot);
    const match = conversations.find((item) => item.id === legacy.id);
    assert.ok(match, "the scoped agent conversation must be returned");
    assert.equal(match.source, "channel");
    // No non-channel conversation should leak into the result.
    assert.ok(conversations.every((item) => item.source === "channel"));
  }));
