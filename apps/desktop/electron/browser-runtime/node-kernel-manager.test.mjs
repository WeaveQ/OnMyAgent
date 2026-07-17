import assert from "node:assert/strict";
import test from "node:test";

import { createNodeKernelManager } from "./node-kernel-manager.mjs";

test("node kernels preserve values across messages in one session", async () => {
  const manager = createNodeKernelManager();
  try {
    assert.equal(await manager.evaluate("session-a", "globalThis.counter = 4"), 4);
    assert.equal(await manager.evaluate("session-a", "counter += 3"), 7);
  } finally {
    await manager.dispose();
  }
});

test("node kernels isolate globals between sessions", async () => {
  const manager = createNodeKernelManager();
  try {
    await manager.evaluate("session-a", "globalThis.secretValue = 42");
    await assert.rejects(
      manager.evaluate("session-b", "secretValue"),
      /secretValue is not defined/,
    );
  } finally {
    await manager.dispose();
  }
});

test("reset destroys a session kernel and clears its state", async () => {
  const manager = createNodeKernelManager();
  try {
    await manager.evaluate("session-a", "globalThis.transientValue = 9");
    await manager.reset("session-a");
    await assert.rejects(
      manager.evaluate("session-a", "transientValue"),
      /transientValue is not defined/,
    );
  } finally {
    await manager.dispose();
  }
});

test("node kernels respawn after the worker process dies", async () => {
  const manager = createNodeKernelManager({ timeoutMs: 200 });
  try {
    await manager.evaluate("session-a", "globalThis.kept = 'first'");

    // Hang at the async level so the timeout timer SIGKILLs the worker. A dead
    // worker left in the cache must respawn on the next call instead of
    // hanging until the next timeout.
    await assert.rejects(
      manager.evaluate("session-a", "await new Promise(() => {})"),
      /node kernel timed out after 200ms/,
    );

    // The exit handler fires async after SIGKILL; retry until the kernel is
    // marked dead and kernelFor respawns a fresh worker.
    let value;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        value = await manager.evaluate("session-a", "globalThis.kept ?? 'respawned'");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(value, "respawned");
  } finally {
    await manager.dispose();
  }
});


test("node kernels accept multi-statement code with return", async () => {
  const manager = createNodeKernelManager();
  try {
    const value = await manager.evaluate(
      "session-a",
      "const a = 2\nconst b = 3\nreturn a * b",
    );
    assert.equal(value, 6);
  } finally {
    await manager.dispose();
  }
});

test("node kernels reject disabled module imports", async () => {
  const manager = createNodeKernelManager({ allowedModules: ["node:url"] });
  try {
    await assert.rejects(
      manager.evaluate("session-a", "await nodeRepl.import('node:fs')"),
      /module is not allowed/i,
    );
  } finally {
    await manager.dispose();
  }
});

test("node kernels expose agent.browsers with manager-owned session context", async () => {
  const calls = [];
  const manager = createNodeKernelManager({
    browserRequest: async (method, params, context) => {
      calls.push({ method, params, context });
      if (method === "getInfo") return { backend: "in-app", capabilities: ["tabs"] };
      return {};
    },
  });
  const context = {
    workspaceId: "workspace-1",
    sessionId: "session-a",
    messageId: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    backend: "in-app",
  };
  try {
    await manager.configureBrowserSession("session-a", context);

    assert.equal(
      await manager.evaluate("session-a", "await agent.browsers.getDefault().then(browser => browser.name)"),
      "in-app",
    );
    assert.deepEqual(calls[0].context, context);
  } finally {
    await manager.dispose();
  }
});
