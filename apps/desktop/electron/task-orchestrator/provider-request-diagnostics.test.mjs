import assert from "node:assert/strict";
import test from "node:test";

import {
  createFallbackWarningAccumulator,
  createProviderRequestDiagnosticsAccumulator,
  extractProviderRequestId,
} from "./provider-request-diagnostics.mjs";

test("request IDs come only from explicit ACP/provider fields", () => {
  assert.equal(extractProviderRequestId({ requestId: "req-1", text: "requestId=leak" }), "req-1");
  assert.equal(extractProviderRequestId({ id: "req-2", text: "provider request" }), null);
  assert.equal(extractProviderRequestId({ providerRequestId: "../secret" }), null);
  assert.equal(extractProviderRequestId({ acp_request_id: "req-3" }), "req-3");
});

test("fragmented and repeated fallback warnings count once per occurrence", () => {
  const accumulator = createFallbackWarningAccumulator();
  accumulator.push("Warning: Falling back from Web");
  assert.equal(accumulator.count(), 0);
  accumulator.push("Sockets to HTTPS transport.");
  assert.equal(accumulator.count(), 1);
  accumulator.push(" Falling back from WebSockets to HTTPS transport.");
  assert.equal(accumulator.count(), 2);
});

test("prompt-result fallback warnings and explicit IDs are accumulated", () => {
  const accumulator = createProviderRequestDiagnosticsAccumulator();
  const first = accumulator.observe({ requestId: "req-4", warnings: ["Falling back from WebSockets to HTTPS transport."] });
  assert.deepEqual(first, { requestId: "req-4", fallbackCount: 1 });
  const second = accumulator.observePromptResult({ provider_request_id: "req-5", result: { output: "Falling back from WebSockets to HTTPS transport." } });
  assert.deepEqual(second, { requestId: "req-5", fallbackCount: 2 });
});

test("nested provider envelopes still require an allowlisted explicit request-id field", () => {
  const accumulator = createProviderRequestDiagnosticsAccumulator();
  assert.equal(accumulator.observe({ result: { providerRequestID: "req-nested" }, text: "requestId=free-form" }).requestId, "req-nested");
  assert.equal(accumulator.observe({ result: { id: "not-allowlisted" } }).requestId, "req-nested");
});
