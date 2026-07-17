import { mkdir, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { BrowserRpcFrameDecoder, encodeBrowserRpcFrame } from "./browser-rpc-protocol.mjs";

export function resolveBrowserRpcEndpoint({ platform, runtimeDir, instanceId }) {
  if (platform === "win32") return `\\\\.\\pipe\\onmyagent-browser-${instanceId}`;
  return path.join(runtimeDir, `browser-${instanceId}.sock`);
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function createBrowserRpcServer(options) {
  if (typeof options?.dispatch !== "function") throw new TypeError("browser RPC dispatch is required");
  if (typeof options?.resolvePeer !== "function") throw new TypeError("browser RPC peer resolver is required");
  if (!options.authority) throw new TypeError("browser RPC capability authority is required");
  const sockets = new Set();
  const authenticatedPeers = new WeakMap();
  let endpoint = null;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const decoder = new BrowserRpcFrameDecoder();
    socket.on("data", async (chunk) => {
      let messages;
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        socket.write(encodeBrowserRpcFrame(rpcError(null, -32700, error.message)));
        socket.destroy();
        return;
      }
      for (const request of messages) {
        const id = request?.id ?? null;
        try {
          if (request?.jsonrpc !== "2.0" || typeof request.method !== "string") {
            throw new Error("invalid browser RPC request");
          }
          const peer = authenticatedPeers.get(socket) ?? await options.resolvePeer(socket, request);
          if (request.method === "getCapability") {
            if (typeof options.authorizeBootstrap !== "function") {
              throw new Error("browser capability bootstrap is disabled");
            }
            const authorized = await options.authorizeBootstrap(
              request.params?.bootstrap,
              peer,
            );
            if (!authorized) throw new Error("browser capability bootstrap rejected");
            authenticatedPeers.set(socket, peer);
            const capability = options.authority.issue({
              workspaceId: request.context?.workspaceId,
              sessionId: request.context?.sessionId,
              backend: request.context?.backend,
              peerPid: peer.peerPid,
              peerIdentity: peer.peerIdentity,
            });
            socket.write(encodeBrowserRpcFrame({ jsonrpc: "2.0", id, result: { capability } }));
            continue;
          }
          options.authority.verify(request.capability, {
            workspaceId: request.context?.workspaceId,
            sessionId: request.context?.sessionId,
            backend: request.context?.backend,
            peerPid: peer.peerPid,
            peerIdentity: peer.peerIdentity,
          });
          const result = await options.dispatch(request.method, request.params ?? {}, request.context);
          socket.write(encodeBrowserRpcFrame({ jsonrpc: "2.0", id, result }));
        } catch (error) {
          const authenticationFailure = /capability|peer/i.test(error.message);
          socket.write(encodeBrowserRpcFrame(rpcError(
            id,
            authenticationFailure ? -32001 : -32603,
            error.message,
          )));
        }
      }
    });
  });

  return {
    async listen(target) {
      endpoint = target;
      if (process.platform !== "win32") {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await unlink(target).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(target, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return target;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
      if (endpoint && process.platform !== "win32") {
        await unlink(endpoint).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      endpoint = null;
    },
  };
}
