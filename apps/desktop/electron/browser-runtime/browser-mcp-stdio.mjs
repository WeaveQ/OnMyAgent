import net from "node:net";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  browserMcpEnvironmentKeys,
  createLocalAgentBrowserMcpToolHandler,
  createLocalAgentBrowserMcpToolDefinitions,
} from "./browser-mcp.mjs";
import {
  BrowserRpcFrameDecoder,
  createBrowserRpcRequest,
  encodeBrowserRpcFrame,
} from "./browser-rpc-protocol.mjs";

function readEnvironment(environment = process.env) {
  const keys = browserMcpEnvironmentKeys();
  const read = (key, label) => {
    const value = environment[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
    return value.trim();
  };
  return {
    endpoint: read(keys.rpc.endpoint, "browser RPC endpoint"),
    bootstrap: read(keys.rpc.bootstrap, "browser RPC bootstrap"),
    context: {
      workspaceId: read(keys.context.workspaceId, "browser MCP workspace id"),
      sessionId: read(keys.context.sessionId, "browser MCP session id"),
      messageId: read(keys.context.messageId, "browser MCP message id"),
      turnId: read(keys.context.turnId, "browser MCP turn id"),
      agentId: read(keys.context.agentId, "browser MCP agent id"),
      backend: read(keys.context.backend, "browser MCP backend"),
    },
  };
}

function rpcErrorMessage(response) {
  return response?.error?.message ? String(response.error.message) : "browser RPC request failed";
}

export function createBrowserRpcClient(options = {}) {
  const endpoint = String(options.endpoint ?? "").trim();
  const bootstrap = String(options.bootstrap ?? "").trim();
  const context = options.context;
  if (!endpoint) throw new TypeError("browser RPC endpoint is required");
  if (!bootstrap) throw new TypeError("browser RPC bootstrap is required");
  if (!context || typeof context !== "object") throw new TypeError("browser RPC context is required");
  const requestTimeoutMs = Math.max(1, Number(options.requestTimeoutMs) || 65_000);

  let socket = null;
  let decoder = null;
  let nextId = 1;
  let connected = null;
  const pending = new Map();

  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const connect = async () => {
    if (connected) return connected;
    connected = new Promise((resolve, reject) => {
      decoder = new BrowserRpcFrameDecoder();
      socket = net.createConnection(endpoint);
      const fail = (error) => {
        const detail = error instanceof Error ? error : new Error(String(error));
        rejectPending(detail);
        if (!socket?.destroyed) socket?.destroy();
        socket = null;
        connected = null;
        reject(detail);
      };
      socket.once("connect", resolve);
      socket.once("error", fail);
      socket.on("close", () => {
        if (pending.size) rejectPending(new Error("browser RPC connection closed"));
        socket = null;
        connected = null;
      });
      socket.on("data", (chunk) => {
        try {
          for (const response of decoder.push(chunk)) {
            const entry = pending.get(response?.id);
            if (!entry) continue;
            pending.delete(response.id);
            clearTimeout(entry.timer);
            if (response?.error) entry.reject(new Error(rpcErrorMessage(response)));
            else entry.resolve(response?.result);
          }
        } catch (error) {
          fail(error);
        }
      });
    });
    return connected;
  };

  const send = async (method, params, capability) => {
    await connect();
    const id = nextId++;
    const request = createBrowserRpcRequest(id, method, params, context);
    if (capability) request.capability = capability;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`browser RPC request timed out after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        socket.write(encodeBrowserRpcFrame(request));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  };

  const ensureBootstrapped = async () => {
    // Capabilities are intentionally short-lived. Renew on every tool call so
    // a long-running MCP process cannot keep using a token after its TTL.
    const result = await send("getCapability", { bootstrap, peerPid: process.pid });
    const capability = result?.capability;
    if (typeof capability !== "string" || !capability) {
      throw new Error("browser RPC capability was not issued");
    }
    return capability;
  };

  return {
    async request(method, params = {}) {
      const capability = await ensureBootstrapped();
      return send(method, params, capability);
    },
    async close() {
      rejectPending(new Error("browser MCP bridge closed"));
      if (socket && !socket.destroyed) socket.end();
      socket = null;
      connected = null;
    },
  };
}

function writeResponse(output, id, result = null, error = null) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    ...(error ? { error: { code: error.code ?? -32000, message: error.message ?? String(error) } } : { result }),
  };
  output.write(`${JSON.stringify(payload)}\n`);
}

export async function runBrowserMcpStdio(options = {}) {
  const environment = readEnvironment(options.environment ?? process.env);
  const rpc = options.rpc ?? createBrowserRpcClient(environment);
  const handler = options.handler ?? createLocalAgentBrowserMcpToolHandler({
    request: (method, params) => rpc.request(method, params),
  });
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const inFlight = new Set();

  const onLine = async (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      writeResponse(output, null, null, Object.assign(new Error("invalid JSON-RPC request"), { code: -32700 }));
      return;
    }
    const id = request?.id ?? null;
    try {
      const method = String(request?.method ?? "");
      if (method === "initialize") {
        writeResponse(output, id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "onmyagent-in-app-browser", version: "1" },
          instructions: [
            "Use only the named OnMyAgent in-app Browser tools exposed by this MCP server.",
            "Do not use mcp.node_repl, browser REPL, arbitrary page evaluation, CDP ports, system Chrome, external Chrome, or Computer Use fallbacks.",
            "Browser tabs are scoped to this Local Agent session; use the tab IDs returned by the Browser tools.",
          ].join(" "),
        });
        return;
      }
      if (method === "notifications/initialized") return;
      if (method === "tools/list") {
        writeResponse(output, id, { tools: handler.definitions ?? createLocalAgentBrowserMcpToolDefinitions() });
        return;
      }
      if (method === "tools/call") {
        const name = String(request?.params?.name ?? "");
        const result = await handler.call(name, request?.params?.arguments ?? {});
        writeResponse(output, id, result);
        return;
      }
      if (id !== null) writeResponse(output, id, null, Object.assign(new Error(`method not found: ${method}`), { code: -32601 }));
    } catch (error) {
      if (id !== null) writeResponse(output, id, null, error instanceof Error ? error : new Error(String(error)));
    }
  };

  lines.on("line", (line) => {
    const operation = onLine(line).finally(() => inFlight.delete(operation));
    inFlight.add(operation);
  });
  await new Promise((resolve) => lines.once("close", resolve));
  await Promise.allSettled([...inFlight]);
  try {
    await rpc.request?.("turnEnded", {});
  } catch {
    // The Browser host may already be shutting down. Temporary tabs are also
    // bounded by session ownership, so bridge teardown remains best-effort.
  } finally {
    await rpc.close?.();
  }
}

const isMainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
if (isMainModule) {
  try {
    await runBrowserMcpStdio();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
