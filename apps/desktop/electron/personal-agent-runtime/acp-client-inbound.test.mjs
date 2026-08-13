import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, it } from "node:test";

import { AcpJsonRpcClient } from "./acp-client.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.writes = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      child.writes.push(String(chunk));
      callback();
    },
  });
  return child;
}

function responses(child) {
  return child.writes.flatMap((chunk) => chunk.trim().split("\n").filter(Boolean).map(JSON.parse));
}

describe("ACP inbound request ownership", () => {
  it("emits at most one response when a handler responds and then throws", async () => {
    const child = fakeChild();
    const client = new AcpJsonRpcClient({
      child,
      onRequest: async (message, rpcClient) => {
        rpcClient.respond(message.id, { optionId: "approve" });
        throw new Error("late handler failure");
      },
    });
    client.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "session/request_permission", params: {} }));
    await client.drainInboundRequests(100);
    assert.deepEqual(responses(child), [{ jsonrpc: "2.0", id: 7, result: { optionId: "approve" } }]);
    client.dispose();
  });

  it("aborts and removes a held inbound request when drain reaches its deadline", async () => {
    const child = fakeChild();
    let aborted = false;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const client = new AcpJsonRpcClient({
      child,
      onRequest: async (_message, _rpcClient, signal) => {
        signal.addEventListener("abort", () => { aborted = true; release(); }, { once: true });
        await held;
      },
    });
    client.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "session/request_permission", params: {} }));
    await assert.rejects(client.drainInboundRequests(10), /did not settle/);
    assert.equal(aborted, true);
    assert.equal(client.inboundRequests.size, 0);
    assert.equal(responses(child).filter((message) => message.id === 9).length, 1);
    client.dispose();
    const writesAfterDispose = child.writes.length;
    assert.equal(client.respond(9, { optionId: "late" }), false);
    assert.equal(child.writes.length, writesAfterDispose);
  });
});
