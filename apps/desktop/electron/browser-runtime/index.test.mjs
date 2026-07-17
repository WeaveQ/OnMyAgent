import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserRuntime } from "./index.mjs";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  messageId: "message-1",
  turnId: "turn-1",
  agentId: "agent-1",
  backend: "in-app",
};

test("browser runtime evaluates Node REPL code with a persistent bound Browser client", async () => {
  const hostCalls = [];
  const runtime = createBrowserRuntime({
    host: {
      async dispatch(method, params, requestContext) {
        hostCalls.push({ method, params, requestContext });
        if (method === "getInfo") return { backend: "in-app", capabilities: ["tabs"] };
        return {};
      },
      destroy() {},
    },
  });
  try {
    assert.equal((await runtime.dispatch("nodeReplWrite", { code: "globalThis.value = 3" }, context)).value, 3);
    assert.equal((await runtime.dispatch("nodeReplWrite", { code: "value += 2" }, context)).value, 5);
    assert.equal(
      (await runtime.dispatch("nodeReplWrite", {
        code: "await agent.browsers.getDefault().then(browser => browser.name)",
      }, context)).value,
      "in-app",
    );
    assert.equal(hostCalls[0].requestContext.sessionId, "session-1");
  } finally {
    await runtime.close();
  }
});

test("session deletion clears its Node kernel", async () => {
  const calls = [];
  const runtime = createBrowserRuntime({
    host: { async dispatch(method) { calls.push(method); return {}; }, destroy() {} },
  });
  try {
    await runtime.dispatch("nodeReplWrite", { code: "globalThis.value = 3" }, context);
    await runtime.dispatch("sessionDeleted", {}, context);
    assert.equal(calls.includes("sessionDeleted"), true);
    await assert.rejects(
      runtime.dispatch("nodeReplWrite", { code: "value" }, context),
      /value is not defined/,
    );
  } finally {
    await runtime.close();
  }
});
