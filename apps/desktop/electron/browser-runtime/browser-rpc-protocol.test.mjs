import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserRpcFrameDecoder,
  createBrowserRpcRequest,
  encodeBrowserRpcFrame,
} from "./browser-rpc-protocol.mjs";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  messageId: "message-1",
  turnId: "turn-1",
  agentId: "agent-1",
  backend: "in-app",
};

test("browser RPC framing survives split and coalesced socket chunks", () => {
  const first = createBrowserRpcRequest(1, "getInfo", {}, context);
  const second = createBrowserRpcRequest(2, "listTabs", {}, context);
  const bytes = Buffer.concat([
    encodeBrowserRpcFrame(first),
    encodeBrowserRpcFrame(second),
  ]);
  const decoder = new BrowserRpcFrameDecoder();

  assert.deepEqual(decoder.push(bytes.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(bytes.subarray(3, 11)), []);
  assert.deepEqual(decoder.push(bytes.subarray(11)), [first, second]);
});

test("browser RPC rejects frames larger than the configured limit", () => {
  const decoder = new BrowserRpcFrameDecoder({ maxFrameBytes: 8 });
  const frame = Buffer.alloc(4);
  frame.writeUInt32LE(9, 0);

  assert.throws(() => decoder.push(frame), /frame exceeds 8 bytes/i);
});

test("browser RPC requires the full hidden execution context", () => {
  assert.throws(
    () => createBrowserRpcRequest(1, "getInfo", {}, { ...context, sessionId: "" }),
    /sessionId/i,
  );
});
