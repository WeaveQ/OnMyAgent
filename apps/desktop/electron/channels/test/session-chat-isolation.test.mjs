import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ChannelSessionStore } from "../ChannelSessionStore.mjs";

test("ChannelSessionStore never reuses one Agent session across chat ids or accounts", async (t) => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "onmyagent-session-isolation-"));
  t.after(() => fs.rm(userDataDir, { recursive: true, force: true }));
  const store = new ChannelSessionStore({ userDataDir });
  await store.initialize();
  const common = { platformType: "telegram", platformUserId: "peer", agentType: "codex/agent" };
  const first = await store.getOrCreateSession({ ...common, accountId: "bot-a", chatId: "chat-a" });
  const second = await store.getOrCreateSession({ ...common, accountId: "bot-a", chatId: "chat-b" });
  const third = await store.getOrCreateSession({ ...common, accountId: "bot-b", chatId: "chat-a" });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.id, third.id);
  assert.equal((await store.getOrCreateSession({ ...common, accountId: "bot-a", chatId: "chat-a" })).id, first.id);
  await store.dispose();
});
