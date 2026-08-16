import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChannelAssistantBindingStore } from "../AssistantBindingStore.mjs";

const tmpDir = path.join(os.tmpdir(), `channel-binding-store-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

console.log("Test 1: initialize + empty settings");
const store = new ChannelAssistantBindingStore({ userDataDir: tmpDir });
await store.initialize();
const empty = store.getPlatformSettings("Weixin");
assert.equal(empty.platform, "weixin");
assert.equal(empty.assistant, null);
assert.equal(empty.default_model, null);
console.log("✓ empty");

console.log("Test 2: setAssistant persists");
await store.setAssistant("weixin", { assistant_id: "asst-1", name: "Codex WX" });
const withAssistant = store.getPlatformSettings("weixin");
assert.equal(withAssistant.assistant?.assistant_id, "asst-1");
console.log("✓ setAssistant");

console.log("Test 3: setAssistant validates");
await assert.rejects(() => store.setAssistant("weixin", {}));
console.log("✓ validation");

console.log("Test 4: default model");
await store.setDefaultModel("weixin", { id: "cfg-1", use_model: "gpt-5.1" });
const withModel = store.getPlatformSettings("weixin");
assert.equal(withModel.default_model?.use_model, "gpt-5.1");
console.log("✓ default model");

console.log("Test 5: per-chat binding");
await store.setChatAssistant("weixin", "chat-42", { assistant_id: "asst-chat" });
const perChat = store.getChatAssistant("weixin", "chat-42");
assert.equal(perChat?.assistant_id, "asst-chat");
console.log("✓ per-chat");

console.log("Test 6: legacy custom_agent_id migrates to assistant_id on load");
const rawPath = path.join(tmpDir, "channel-settings", "assistant-bindings.json");
const data = JSON.parse(await fs.readFile(rawPath, "utf8"));
data.platforms.legacy = { assistant: { custom_agent_id: "legacy", backend: "codex", agent_type: "codex" }, default_model: null };
await fs.writeFile(rawPath, JSON.stringify(data), "utf8");
const store2 = new ChannelAssistantBindingStore({ userDataDir: tmpDir });
await store2.initialize();
const legacy = store2.getPlatformSettings("legacy");
assert.equal(legacy.assistant?.assistant_id, "legacy");
assert.equal(legacy.assistant?.custom_agent_id, undefined);
assert.equal(legacy.assistant?.backend, undefined);
const persisted = JSON.parse(await fs.readFile(rawPath, "utf8"));
assert.equal(persisted.platforms.legacy.assistant.assistant_id, "legacy");
assert.equal(persisted.platforms.legacy.assistant.custom_agent_id, undefined);
console.log("✓ legacy migrated");

console.log("Test 7: pseudo-agent binding + rollback to external agent (P1-02)");
await store.setChatAssistant("weixin", "chat-onmyagent", { assistant_id: "onmyagent" });
const boundOnmyagent = store.getChatAssistant("weixin", "chat-onmyagent");
assert.equal(boundOnmyagent?.assistant_id, "onmyagent");
console.log("✓ onmyagent bound to chat");
await store.setChatAssistant("weixin", "chat-onmyagent", { assistant_id: "asst-codex" });
const rebound = store.getChatAssistant("weixin", "chat-onmyagent");
assert.equal(rebound?.assistant_id, "asst-codex");
console.log("✓ rolled back to external agent without data loss");

console.log("Test 8: dispatch and weixin no longer dual-read custom_agent_id");
const dispatchSource = await fs.readFile(
  path.join(import.meta.dirname, "..", "agent-dispatch.mjs"),
  "utf8",
);
const weixinSource = await fs.readFile(
  path.join(import.meta.dirname, "..", "..", "weixin", "agent-context.mjs"),
  "utf8",
);
assert.equal(dispatchSource.includes("custom_agent_id"), false);
assert.equal(weixinSource.includes("custom_agent_id"), false);
assert.equal(dispatchSource.includes("assistant_id ??"), false);
console.log("✓ dispatch/weixin assistant_id only");

console.log("All assistant binding store tests passed");
