import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBrowserCapabilityAuthority } from "./browser-capability-authority.mjs";
import {
  createBrowserRpcRequest,
  encodeBrowserRpcFrame,
  BrowserRpcFrameDecoder,
} from "./browser-rpc-protocol.mjs";
import { createBrowserRpcServer, resolveBrowserRpcEndpoint } from "./browser-rpc-server.mjs";

const context = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  messageId: "message-1",
  turnId: "turn-1",
  agentId: "agent-1",
  backend: "in-app",
};
const peer = { peerPid: process.pid, peerIdentity: `uid:${process.getuid?.() ?? 0}` };

function requestOnce(endpoint, message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const decoder = new BrowserRpcFrameDecoder();
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      const messages = decoder.push(chunk);
      if (!messages.length) return;
      socket.end();
      resolve(messages[0]);
    });
    socket.once("connect", () => socket.write(encodeBrowserRpcFrame(message)));
  });
}

test("browser RPC endpoint uses named pipes on Windows and sockets elsewhere", () => {
  assert.match(resolveBrowserRpcEndpoint({ platform: "win32", runtimeDir: "ignored", instanceId: "abc" }), /^\\\\\.\\pipe\\/);
  assert.equal(
    resolveBrowserRpcEndpoint({ platform: "darwin", runtimeDir: "/tmp/onmyagent", instanceId: "abc" }),
    "/tmp/onmyagent/browser-abc.sock",
  );
});

test("browser RPC server authenticates the peer-scoped capability before dispatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-rpc-"));
  const endpoint = path.join(root, "browser.sock");
  const authority = createBrowserCapabilityAuthority({ secret: Buffer.alloc(32, 5) });
  const calls = [];
  const server = createBrowserRpcServer({
    authority,
    resolvePeer: async () => peer,
    dispatch: async (method, params, requestContext) => {
      calls.push({ method, params, requestContext });
      return { backend: "in-app" };
    },
  });
  try {
    await server.listen(endpoint);
    const capability = authority.issue({
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      backend: context.backend,
      ...peer,
    });
    const request = {
      ...createBrowserRpcRequest(1, "getInfo", {}, context),
      capability,
    };

    const response = await requestOnce(endpoint, request);

    assert.deepEqual(response, { jsonrpc: "2.0", id: 1, result: { backend: "in-app" } });
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser RPC server rejects invalid capabilities without dispatching", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-rpc-"));
  const endpoint = path.join(root, "browser.sock");
  let dispatched = false;
  const server = createBrowserRpcServer({
    authority: createBrowserCapabilityAuthority({ secret: Buffer.alloc(32, 6) }),
    resolvePeer: async () => peer,
    dispatch: async () => { dispatched = true; },
  });
  try {
    await server.listen(endpoint);
    const request = {
      ...createBrowserRpcRequest(2, "getInfo", {}, context),
      capability: "invalid",
    };
    const response = await requestOnce(endpoint, request);

    assert.equal(response.id, 2);
    assert.equal(response.error.code, -32001);
    assert.equal(dispatched, false);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser RPC bootstrap issues a capability only after host authentication", async () => {
  const authority = createBrowserCapabilityAuthority({ secret: Buffer.alloc(32, 7) });
  const endpoint = resolveBrowserRpcEndpoint({
    platform: process.platform,
    runtimeDir: await mkdtemp(path.join(os.tmpdir(), "browser-rpc-bootstrap-")),
    instanceId: "test",
  });
  const peer = { peerPid: 314, peerIdentity: "uid:501" };
  const server = createBrowserRpcServer({
    authority,
    resolvePeer: async () => peer,
    authorizeBootstrap: async (value) => value === "bootstrap-secret",
    async dispatch() { return {}; },
  });
  await server.listen(endpoint);
  try {
    const denied = await requestOnce(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method: "getCapability",
      params: { bootstrap: "wrong" },
      context,
    });
    assert.equal(denied.error.code, -32001);

    const issued = await requestOnce(endpoint, {
      jsonrpc: "2.0",
      id: 2,
      method: "getCapability",
      params: { bootstrap: "bootstrap-secret" },
      context,
    });
    assert.equal(typeof issued.result.capability, "string");
    assert.equal(
      authority.verify(issued.result.capability, {
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        backend: context.backend,
        ...peer,
      }).peerPid,
      314,
    );
  } finally {
    await server.close();
  }
});
