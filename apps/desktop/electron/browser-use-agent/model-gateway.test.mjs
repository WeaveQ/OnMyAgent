import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserUseModelGateway } from "./model-gateway.mjs";

async function post(environment, body, signal) {
  return fetch(`${environment.ONMYAGENT_MODEL_GATEWAY_URL}/v1/invoke`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${environment.ONMYAGENT_MODEL_GATEWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}

test("forwards validated Browser Use model requests for one owner", async () => {
  const calls = [];
  const gateway = createBrowserUseModelGateway({
    async invokeModel(request) {
      calls.push(request);
      return { value: { action: "click", index: 4 }, usage: { inputTokens: 10, outputTokens: 3 } };
    },
  });
  await gateway.start();
  try {
    const owner = gateway.environmentForRun({
      ownerId: "conversation:owner-a",
      model: { providerID: "openai", modelID: "gpt-4.1" },
    });
    const response = await post(owner, {
      messages: [{ role: "user", content: [{ type: "text", text: "Open the page" }] }],
      outputSchema: { type: "object", properties: { action: { type: "string" } } },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      value: { action: "click", index: 4 },
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ownerId, "conversation:owner-a");
    assert.deepEqual(calls[0].model, { providerID: "openai", modelID: "gpt-4.1" });
    assert.equal(calls[0].messages[0].role, "user");
  } finally {
    await gateway.stop();
  }
});

test("isolates bearer tokens and returns redacted health", async () => {
  const gateway = createBrowserUseModelGateway({ invokeModel: async () => ({ value: "ok" }) });
  await gateway.start();
  try {
    const ownerA = gateway.environmentForRun({ ownerId: "owner-a", model: null });
    const ownerB = gateway.environmentForRun({ ownerId: "owner-b", model: null });
    assert.notEqual(ownerA.ONMYAGENT_MODEL_GATEWAY_TOKEN, ownerB.ONMYAGENT_MODEL_GATEWAY_TOKEN);

    const unauthorized = await fetch(`${ownerA.ONMYAGENT_MODEL_GATEWAY_URL}/v1/health`);
    assert.equal(unauthorized.status, 401);
    const health = await fetch(`${ownerA.ONMYAGENT_MODEL_GATEWAY_URL}/v1/health`, {
      headers: { authorization: `Bearer ${ownerA.ONMYAGENT_MODEL_GATEWAY_TOKEN}` },
    });
    assert.deepEqual(await health.json(), { ready: true });
    assert.doesNotMatch(JSON.stringify(await gateway.status()), /token|owner-a|127\.0\.0\.1/i);

    const crossOwner = await post(
      { ...ownerA, ONMYAGENT_MODEL_GATEWAY_TOKEN: ownerB.ONMYAGENT_MODEL_GATEWAY_TOKEN },
      { messages: [{ role: "user", content: "test" }] },
    );
    assert.equal(crossOwner.status, 200);
  } finally {
    await gateway.stop();
  }
});

test("rejects invalid requests and propagates cancellation", async () => {
  let observedAbort = false;
  const gateway = createBrowserUseModelGateway({
    invokeModel(request) {
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(new Error("cancelled"));
        }, { once: true });
      });
    },
  });
  await gateway.start();
  try {
    const owner = gateway.environmentForRun({ ownerId: "owner", model: null });
    const invalid = await post(owner, { messages: [] });
    assert.equal(invalid.status, 400);

    const controller = new AbortController();
    const pending = post(owner, { messages: [{ role: "user", content: "wait" }] }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assert.rejects(pending, /abort/i);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(observedAbort, true);
  } finally {
    await gateway.stop();
  }
});
