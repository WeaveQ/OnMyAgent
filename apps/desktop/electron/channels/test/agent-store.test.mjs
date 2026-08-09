import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannelStore } from "../agent-store.mjs";

test("active-run mutations preserve independent keys and completed deletes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-channel-store-"));
  try {
    const store = createChannelStore({ rootDir: root, platformDir: "test" });
    for (let index = 0; index < 25; index += 1) {
      await Promise.all([
        store.writeActiveRun("account", "run-a", { runId: `a-${index}`, status: "running" }),
        store.writeActiveRun("account", "run-b", { runId: `b-${index}`, status: "running" }),
      ]);
      const written = new Map((await store.listActiveRuns("account")).map((run) => [run.runKey, run]));
      assert.equal(written.size, 2);
      assert.equal(written.get("run-a")?.runId, `a-${index}`);
      assert.equal(written.get("run-b")?.runId, `b-${index}`);

      await Promise.all([
        store.deleteActiveRun("account", "run-a"),
        store.writeActiveRun("account", "run-b", { status: "pending_approval" }),
      ]);
      assert.equal(await store.readActiveRun("account", "run-a"), null);
      assert.equal((await store.readActiveRun("account", "run-b"))?.status, "pending_approval");
      assert.deepEqual((await store.listActiveRuns("account")).map((run) => run.runKey), ["run-b"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat-history mutations preserve 100 cross-key and 100 same-key concurrent appends", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-channel-history-"));
  try {
    const store = createChannelStore({ rootDir: root, platformDir: "test" });
    const crossKeyWrites = [];
    for (let index = 0; index < 100; index += 1) {
      crossKeyWrites.push(store.appendChatHistory("account", "history-a", [{ id: `a-${index}` }], 0));
      crossKeyWrites.push(store.appendChatHistory("account", "history-b", [{ id: `b-${index}` }], 0));
    }
    const [historyA, historyB] = await Promise.all([
      store.readChatHistory("account", "history-a"),
      store.readChatHistory("account", "history-b"),
    ]);
    await Promise.all(crossKeyWrites);
    assert.deepEqual(historyA.map((entry) => entry.id), Array.from({ length: 100 }, (_value, index) => `a-${index}`));
    assert.deepEqual(historyB.map((entry) => entry.id), Array.from({ length: 100 }, (_value, index) => `b-${index}`));

    const sameKeyWrites = Array.from({ length: 100 }, (_value, index) => (
      store.appendChatHistory("account", "history-same", [{ id: `same-${index}` }], 0)
    ));
    const sameKeyHistory = await store.readChatHistory("account", "history-same");
    await Promise.all(sameKeyWrites);
    assert.deepEqual(sameKeyHistory.map((entry) => entry.id), Array.from({ length: 100 }, (_value, index) => `same-${index}`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat-history clear and append are ordered without erasing other keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-channel-history-clear-"));
  try {
    const store = createChannelStore({ rootDir: root, platformDir: "test" });
    await Promise.all([
      store.appendChatHistory("account", "target", [{ id: "old" }], 0),
      store.appendChatHistory("account", "retained", [{ id: "keep" }], 0),
    ]);

    await Promise.all([
      store.clearChatHistory("account", "target"),
      store.appendChatHistory("account", "target", [{ id: "after-clear" }], 0),
    ]);
    assert.deepEqual(await store.readChatHistory("account", "target"), [{ id: "after-clear" }]);
    assert.deepEqual(await store.readChatHistory("account", "retained"), [{ id: "keep" }]);

    await Promise.all([
      store.appendChatHistory("account", "target", [{ id: "before-clear" }], 0),
      store.clearChatHistory("account", "target"),
    ]);
    assert.deepEqual(await store.readChatHistory("account", "target"), []);
    assert.deepEqual(await store.readChatHistory("account", "retained"), [{ id: "keep" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat-setting writes share the per-file mutation barrier", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-channel-settings-"));
  try {
    const store = createChannelStore({ rootDir: root, platformDir: "test" });
    const writes = [];
    for (let index = 0; index < 100; index += 1) {
      writes.push(store.writeChatSetting("account", "chat-a", { [`field-${index}`]: index }));
      writes.push(store.writeChatSetting("account", "chat-b", { [`field-${index}`]: index }));
    }
    const [chatA, chatB] = await Promise.all([
      store.readChatSetting("account", "chat-a"),
      store.readChatSetting("account", "chat-b"),
    ]);
    await Promise.all(writes);
    assert.equal(Object.keys(chatA).length, 100);
    assert.equal(Object.keys(chatB).length, 100);
    for (let index = 0; index < 100; index += 1) {
      assert.equal(chatA[`field-${index}`], index);
      assert.equal(chatB[`field-${index}`], index);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a caught active-run write failure does not leak an unhandled rejection", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "onmyagent-channel-store-failure-"));
  const root = path.join(parent, "root");
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    await writeFile(root, "not a directory", "utf8");
    const store = createChannelStore({ rootDir: root, platformDir: "test" });
    await assert.rejects(() => store.writeActiveRun("account", "run-a", { runId: "failed" }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);

    await unlink(root);
    await mkdir(root);
    await store.writeActiveRun("account", "run-b", { runId: "recovered" });
    assert.equal((await store.readActiveRun("account", "run-b"))?.runId, "recovered");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await rm(parent, { recursive: true, force: true });
  }
});

test("a caught chat-history write failure does not poison the shared file queue", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "onmyagent-channel-history-failure-"));
  const root = path.join(parent, "root");
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    await writeFile(root, "not a directory", "utf8");
    const store = createChannelStore({ rootDir: root, platformDir: "test" });
    await assert.rejects(() => store.appendChatHistory("account", "history", [{ id: "failed" }], 0));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);

    await unlink(root);
    await mkdir(root);
    await store.appendChatHistory("account", "history", [{ id: "recovered" }], 0);
    assert.deepEqual(await store.readChatHistory("account", "history"), [{ id: "recovered" }]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await rm(parent, { recursive: true, force: true });
  }
});
