import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createBrowserCapabilityAuthority } from "./browser-capability-authority.mjs";
import {
  BrowserRpcFrameDecoder,
  encodeBrowserRpcFrame,
} from "./browser-rpc-protocol.mjs";
import { createBrowserRpcServer, resolveBrowserRpcEndpoint } from "./browser-rpc-server.mjs";
import { createBrowserSafetyPolicy } from "./browser-safety-policy.mjs";
import {
  buildLocalAgentBrowserMcpServer,
  createLocalAgentBrowserMcpToolDefinitions,
  createLocalAgentBrowserMcpToolHandler,
} from "./browser-mcp.mjs";
import {
  createBrowserRpcClient,
  runBrowserMcpStdio,
} from "./browser-mcp-stdio.mjs";

const context = {
  workspaceId: "workspace-1",
  sessionId: "local-agent-conversation-1",
  messageId: "message-1",
  turnId: "turn-1",
  agentId: "codex",
  backend: "in-app",
};

const environment = {
  ONMYAGENT_BROWSER_RPC_ENDPOINT: "/tmp/onmyagent-browser-test.sock",
  ONMYAGENT_BROWSER_RPC_BOOTSTRAP: "bootstrap-secret",
  ONMYAGENT_BROWSER_WORKSPACE_ID: context.workspaceId,
  ONMYAGENT_BROWSER_SESSION_ID: context.sessionId,
  ONMYAGENT_BROWSER_MESSAGE_ID: context.messageId,
  ONMYAGENT_BROWSER_TURN_ID: context.turnId,
  ONMYAGENT_BROWSER_AGENT_ID: context.agentId,
  ONMYAGENT_BROWSER_BACKEND: context.backend,
};

test("Browser MCP descriptor carries only scoped RPC credentials and context", () => {
  const descriptor = buildLocalAgentBrowserMcpServer({
    rpcEnvironment: {
      ONMYAGENT_BROWSER_RPC_ENDPOINT: "/tmp/browser.sock",
      ONMYAGENT_BROWSER_RPC_BOOTSTRAP: "secret",
    },
    context,
    execPath: "/usr/local/bin/node",
    bridgePath: "/app/browser-mcp-stdio.mjs",
    electronRuntime: true,
  });

  assert.deepEqual(descriptor, {
    name: "onmyagent-in-app-browser",
    command: "/usr/local/bin/node",
    args: ["/app/browser-mcp-stdio.mjs"],
    env: [
      { name: "ONMYAGENT_BROWSER_RPC_ENDPOINT", value: "/tmp/browser.sock" },
      { name: "ONMYAGENT_BROWSER_RPC_BOOTSTRAP", value: "secret" },
      { name: "ONMYAGENT_BROWSER_WORKSPACE_ID", value: "workspace-1" },
      { name: "ONMYAGENT_BROWSER_SESSION_ID", value: "local-agent-conversation-1" },
      { name: "ONMYAGENT_BROWSER_MESSAGE_ID", value: "message-1" },
      { name: "ONMYAGENT_BROWSER_TURN_ID", value: "turn-1" },
      { name: "ONMYAGENT_BROWSER_AGENT_ID", value: "codex" },
      { name: "ONMYAGENT_BROWSER_BACKEND", value: "in-app" },
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
    ],
  });
  assert.equal(descriptor.env.some(({ name }) => name === "PATH"), false);
  assert.throws(
    () => buildLocalAgentBrowserMcpServer({
      rpcEnvironment: { endpoint: "/tmp/browser.sock", bootstrap: "secret" },
      context: { ...context, backend: "chrome" },
    }),
    /backend must be in-app/,
  );
});

test("Browser MCP exposes named bounded tools and rejects eval/CDP surfaces", () => {
  const definitions = createLocalAgentBrowserMcpToolDefinitions();
  const names = definitions.map((tool) => tool.name);
  assert.equal(names.includes("browser_selected_tab"), false);
  assert.equal(names.includes("browser_claim_tab"), false);
  assert.equal(names.includes("browser_documentation"), false);
  assert.ok(names.includes("browser_open_tab"));
  assert.ok(names.includes("browser_snapshot"));
  assert.ok(names.includes("browser_click"));
  assert.ok(names.includes("browser_type"));
  assert.ok(names.includes("browser_locator_action"));
  assert.ok(names.includes("browser_screenshot"));
  assert.equal(names.some((name) => /eval|cdp|repl/i.test(name)), false);
  assert.equal(names.length, new Set(names).size);

  const calls = [];
  const handler = createLocalAgentBrowserMcpToolHandler({
    request: async (method, params) => {
      calls.push({ method, params });
      return method === "screenshot"
        ? { image: "data:image/png;base64,AA==", width: 1, height: 1 }
        : { ok: true };
    },
  });

  return handler.call("browser_screenshot", { tabId: "tab-1", format: "png" }).then((result) => {
    assert.equal(result.content[0].type, "image");
    assert.equal(calls[0].method, "screenshot");
    return handler.call("browser_click", { tabId: "tab-1", ref: "dom:1:1" });
  }).then(() => {
    assert.deepEqual(calls[1], {
      method: "domAction",
      params: { tabId: "tab-1", ref: "dom:1:1", action: "click" },
    });
    return assert.rejects(
      handler.call("browser_locator_action", { tabId: "tab-1", action: "evaluate", selector: { css: "body" } }),
      /unsupported/,
    );
  });
});

test("Browser MCP capability summary reports only the bounded named surface", async () => {
  const handler = createLocalAgentBrowserMcpToolHandler({
    request: async () => ({
      protocolVersion: 1,
      backend: "in-app",
      browserId: "in-app",
      capabilities: ["tabs", "cdp", "cua", "playwright"],
    }),
  });

  const result = await handler.call("browser_get_info", {});
  assert.equal(result.structuredContent.backend, "in-app");
  assert.ok(result.structuredContent.capabilities.includes("dom-actions"));
  assert.equal(result.structuredContent.capabilities.includes("cdp"), false);
  assert.equal(result.structuredContent.capabilities.includes("playwright"), false);
  assert.ok(result.structuredContent.tools.includes("browser_open_tab"));
  await assert.rejects(
    handler.call("browser_mark_tab", { tabId: "tab-1" }),
    /requires deliverable or handoff/,
  );
});

test("Browser MCP handler keeps navigation under the shared safety policy", async () => {
  const safety = createBrowserSafetyPolicy({ requestApproval: async () => { throw new Error("must not prompt"); } });
  const calls = [];
  const handler = createLocalAgentBrowserMcpToolHandler({
    request: async (method, params) => {
      if (method === "navigate" || method === "createTab") {
        await safety.authorize({ kind: "navigate", url: params.url, context });
      }
      calls.push({ method, params });
      return { ok: true };
    },
  });

  await handler.call("browser_navigate", { tabId: "tab-1", url: "https://example.com" });
  assert.equal(calls.length, 1);
  await assert.rejects(
    handler.call("browser_navigate", { tabId: "tab-1", url: "https://user:password@example.com" }),
    /credentials in URLs are not allowed/,
  );
});

test("Browser RPC client bootstraps a peer capability before named dispatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-mcp-"));
  const endpoint = resolveBrowserRpcEndpoint({ platform: process.platform, runtimeDir: root, instanceId: "client" });
  const authority = createBrowserCapabilityAuthority({ secret: Buffer.alloc(32, 9) });
  const requests = [];
  const peer = { peerPid: process.pid, peerIdentity: `uid:${process.getuid?.() ?? 0}` };
  const rpcServer = createBrowserRpcServer({
    authority,
    resolvePeer: async (_socket, request) => {
      if (request?.method === "getCapability") return { peerPid: request.params.peerPid, peerIdentity: peer.peerIdentity };
      return peer;
    },
    authorizeBootstrap: async (value) => value === "bootstrap-secret",
    dispatch: async (method, params, requestContext) => {
      requests.push({ method, params, requestContext });
      if (method === "listTabs") return { tabs: [{ tabId: "tab-1" }] };
      return { ok: true };
    },
  });
  await rpcServer.listen(endpoint);
  const client = createBrowserRpcClient({ endpoint, bootstrap: "bootstrap-secret", context });
  try {
    assert.deepEqual(await client.request("listTabs", {}), { tabs: [{ tabId: "tab-1" }] });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "listTabs");
    assert.deepEqual(requests[0].requestContext, context);
  } finally {
    await client.close();
    await rpcServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Browser RPC client renews the capability for requests after its TTL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-mcp-ttl-"));
  const endpoint = resolveBrowserRpcEndpoint({ platform: process.platform, runtimeDir: root, instanceId: "ttl" });
  let now = 1_000;
  let bootstrapCount = 0;
  const authority = createBrowserCapabilityAuthority({
    secret: Buffer.alloc(32, 10),
    now: () => now,
    ttlMs: 10,
  });
  const peer = { peerPid: process.pid, peerIdentity: `uid:${process.getuid?.() ?? 0}` };
  const rpcServer = createBrowserRpcServer({
    authority,
    resolvePeer: async () => peer,
    authorizeBootstrap: async (value) => {
      bootstrapCount += 1;
      return value === "bootstrap-secret";
    },
    dispatch: async (method) => ({ method, now }),
  });
  await rpcServer.listen(endpoint);
  const client = createBrowserRpcClient({ endpoint, bootstrap: "bootstrap-secret", context });
  try {
    assert.deepEqual(await client.request("listTabs", {}), { method: "listTabs", now: 1_000 });
    now = 1_011;
    assert.deepEqual(await client.request("listTabs", {}), { method: "listTabs", now: 1_011 });
    assert.equal(bootstrapCount, 2, "each request must obtain a fresh capability");
  } finally {
    await client.close();
    await rpcServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Browser MCP stdio implements initialize, tools/list and tools/call", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) if (line) lines.push(JSON.parse(line));
  });
  let resolveLine;
  const nextLine = () => new Promise((resolve) => {
    const existing = lines.shift();
    if (existing) resolve(existing);
    else resolveLine = resolve;
  });
  output.on("data", () => {
    if (resolveLine && lines.length) {
      const resolve = resolveLine;
      resolveLine = null;
      resolve(lines.shift());
    }
  });
  const rpcCalls = [];
  const rpc = {
    async request(method, params) {
      rpcCalls.push({ method, params });
      return { method, params, ok: true };
    },
    async close() { rpcCalls.push({ method: "close" }); },
  };
  const run = runBrowserMcpStdio({ environment, input, output, rpc });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  const initialized = await nextLine();
  assert.equal(initialized.result.serverInfo.name, "onmyagent-in-app-browser");
  assert.match(initialized.result.instructions, /named OnMyAgent in-app Browser tools/);
  assert.match(initialized.result.instructions, /Do not use mcp\.node_repl/);

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const listed = await nextLine();
  assert.ok(listed.result.tools.some((tool) => tool.name === "browser_open_tab"));

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_list_tabs", arguments: {} } })}\n`);
  const called = await nextLine();
  assert.equal(called.result.structuredContent.ok, true);
  input.end();
  await run;
  assert.deepEqual(rpcCalls, [
    { method: "listTabs", params: {} },
    { method: "turnEnded", params: {} },
    { method: "close" },
  ]);
});

test("Browser MCP stdio waits for in-flight tools before turn cleanup", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const order = [];
  let releaseTool;
  const toolPending = new Promise((resolve) => { releaseTool = resolve; });
  const rpc = {
    async request(method) {
      if (method === "listTabs") {
        order.push("tool-started");
        await toolPending;
        order.push("tool-finished");
        return { tabs: [] };
      }
      order.push(method);
      return { ok: true };
    },
    async close() { order.push("close"); },
  };
  const run = runBrowserMcpStdio({ environment, input, output, rpc });
  input.end(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "browser_list_tabs", arguments: {} },
  })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["tool-started"]);
  releaseTool();
  await run;
  assert.deepEqual(order, ["tool-started", "tool-finished", "turnEnded", "close"]);
});

test("Browser RPC client surfaces bootstrap and remote errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-mcp-error-"));
  const endpoint = resolveBrowserRpcEndpoint({ platform: process.platform, runtimeDir: root, instanceId: "error" });
  const authority = createBrowserCapabilityAuthority({ secret: Buffer.alloc(32, 8) });
  const peer = { peerPid: process.pid, peerIdentity: `uid:${process.getuid?.() ?? 0}` };
  const rpcServer = createBrowserRpcServer({
    authority,
    resolvePeer: async () => peer,
    authorizeBootstrap: async (value) => value === "good",
    dispatch: async () => { throw new Error("tab not found"); },
  });
  await rpcServer.listen(endpoint);
  const bad = createBrowserRpcClient({ endpoint, bootstrap: "bad", context });
  const good = createBrowserRpcClient({ endpoint, bootstrap: "good", context });
  try {
    await assert.rejects(bad.request("listTabs", {}), /bootstrap rejected/);
    await assert.rejects(good.request("listTabs", {}), /tab not found/);
  } finally {
    await bad.close();
    await good.close();
    await rpcServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Browser RPC client bounds a connected request that never receives a response", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-mcp-timeout-"));
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\onmyagent-browser-timeout-${path.basename(root)}`
    : path.join(root, "timeout.sock");
  const server = net.createServer((socket) => {
    socket.on("data", () => undefined);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const client = createBrowserRpcClient({
    endpoint,
    bootstrap: "unused",
    context,
    requestTimeoutMs: 25,
  });
  try {
    await assert.rejects(client.request("listTabs", {}), /timed out after 25ms/);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
