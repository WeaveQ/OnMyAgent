import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedJsonLineDecoder,
  encodeJsonRpcMessage,
  parseJsonRpcMessage,
} from "./index.mjs";

test("frames JSON-RPC messages across UTF-8 chunks", () => {
  const decoder = new BoundedJsonLineDecoder();
  const encoded = Buffer.from(encodeJsonRpcMessage({ jsonrpc: "2.0", id: 1, result: "好" }));
  expectLines(decoder.push(encoded.subarray(0, encoded.length - 2)), []);
  const lines = decoder.push(encoded.subarray(encoded.length - 2));
  assert.deepEqual(lines.map(parseJsonRpcMessage), [{ jsonrpc: "2.0", id: 1, result: "好" }]);
});

test("drops an oversized line and resumes at the next frame", () => {
  const decoder = new BoundedJsonLineDecoder({ maxLineBytes: 16 });
  expectLines(decoder.push("x".repeat(17)), []);
  const lines = decoder.push("ignored\n{\"ok\":true}\n");
  assert.deepEqual(lines.map(parseJsonRpcMessage), [{ ok: true }]);
});

test("rejects empty, malformed, and non-object messages", () => {
  assert.equal(parseJsonRpcMessage(""), null);
  assert.equal(parseJsonRpcMessage("{"), null);
  assert.equal(parseJsonRpcMessage("[]"), null);
});

function expectLines(actual, expected) {
  assert.deepEqual(actual, expected);
}
