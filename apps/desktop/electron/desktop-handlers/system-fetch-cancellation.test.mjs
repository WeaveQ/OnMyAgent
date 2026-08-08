import assert from "node:assert/strict";
import test from "node:test";

import { createSystemDomainHandlers } from "./system.mjs";

test("remote desktop fetch is aborted by its renderer cancellation token", async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      observedSignal = init.signal;
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  try {
    const handlers = createSystemDomainHandlers();
    const pending = handlers.__fetch(null, [
      "https://remote.example.test/snapshot",
      { requestId: "request-1", timeoutMs: 10_000 },
    ]);
    await Promise.resolve();

    assert.deepEqual(
      await handlers.__fetchCancel(null, ["request-1"]),
      { ok: true },
    );
    await assert.rejects(pending, /cancelled/i);
    assert.equal(observedSignal?.aborted, true);
    assert.deepEqual(
      await handlers.__fetchCancel(null, ["request-1"]),
      { ok: false },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a cancellation arriving before fetch registration prevents the request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };
  try {
    const handlers = createSystemDomainHandlers();
    assert.deepEqual(
      await handlers.__fetchCancel(null, ["early-request"]),
      { ok: false },
    );
    await assert.rejects(
      handlers.__fetch(null, [
        "https://remote.example.test/snapshot",
        { requestId: "early-request", timeoutMs: 10_000 },
      ]),
      /cancelled/i,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remembered early cancellations have a hard capacity bound", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("ok");
  };
  try {
    const handlers = createSystemDomainHandlers();
    for (let index = 0; index < 1_025; index += 1) {
      await handlers.__fetchCancel(null, [`burst-${index}`]);
    }

    const oldest = await handlers.__fetch(null, [
      "https://remote.example.test/oldest",
      { requestId: "burst-0" },
    ]);
    assert.equal(oldest.status, 200);
    await assert.rejects(
      handlers.__fetch(null, [
        "https://remote.example.test/newest",
        { requestId: "burst-1024" },
      ]),
      /cancelled/i,
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
