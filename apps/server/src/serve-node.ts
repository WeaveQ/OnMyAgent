/**
 * Node.js HTTP adapter for the OnMyAgent server.
 *
 * Provides a `serve()` function with the same interface as Bun.serve()
 * but backed by `node:http`. This allows the server to run in any Node.js
 * environment (including Electron's main process) without Bun.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { nodeReadableToWebStream } from "./core/node-web-stream.js";

export type ServeOptions = {
  hostname: string;
  port: number;
  fetch: (request: Request) => Response | Promise<Response>;
  idleTimeout?: number;
};

export type ServeResult = {
  port: number;
  stop: () => void | Promise<void>;
};

function isResponseWritable(nodeRes: ServerResponse): boolean {
  return !nodeRes.destroyed && !nodeRes.closed && !nodeRes.writableEnded;
}

function isWriteAfterEndError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "ERR_STREAM_WRITE_AFTER_END" || error.message.includes("write after end");
}

function endResponse(nodeRes: ServerResponse, chunk?: string): void {
  if (!isResponseWritable(nodeRes)) return;
  nodeRes.end(chunk);
}

async function waitForDrainOrClose(nodeRes: ServerResponse): Promise<void> {
  if (!isResponseWritable(nodeRes)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      nodeRes.off("drain", done);
      nodeRes.off("close", done);
      nodeRes.off("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      cleanup();
      if (isWriteAfterEndError(error)) {
        resolve();
        return;
      }
      reject(error);
    };

    nodeRes.once("drain", done);
    nodeRes.once("close", done);
    nodeRes.once("error", fail);
  });
}

/**
 * Convert a Node.js IncomingMessage into a Web API Request.
 */
function toWebRequest(
  nodeReq: IncomingMessage,
  hostname: string,
  port: number,
  signal: AbortSignal,
): Request {
  const url = `http://${hostname}:${port}${nodeReq.url ?? "/"}`;
  const method = nodeReq.method ?? "GET";
  const headers = new Headers();

  // Node headers can be string | string[] | undefined
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const hasBody = method !== "GET" && method !== "HEAD";

  const body = hasBody ? nodeReadableToWebStream<Uint8Array>(nodeReq) : null;

  return new Request(url, {
    method,
    headers,
    body,
    signal,
    // @ts-expect-error duplex is required for streaming request bodies in Node
    duplex: hasBody ? "half" : undefined,
  });
}

function requestDisconnectReason(): Error {
  return new Error("HTTP client disconnected");
}

function createRequestLifecycle(
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
): { signal: AbortSignal; complete: () => void } {
  const controller = new AbortController();
  let completed = false;

  const abort = () => {
    if (completed || controller.signal.aborted) return;
    controller.abort(requestDisconnectReason());
  };
  const abortIncompleteResponse = () => {
    if (nodeRes.writableFinished) return;
    abort();
  };

  nodeReq.once("aborted", abort);
  nodeReq.socket.once("close", abortIncompleteResponse);
  nodeRes.once("close", abortIncompleteResponse);

  const complete = () => {
    if (completed) return;
    completed = true;
    nodeReq.off("aborted", abort);
    nodeReq.socket.off("close", abortIncompleteResponse);
    nodeRes.off("close", abortIncompleteResponse);
  };

  return { signal: controller.signal, complete };
}

/**
 * Write a Web API Response to a Node.js ServerResponse.
 */
async function writeWebResponse(
  webRes: Response,
  nodeRes: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const headersObj: Record<string, string | string[]> = {};
  webRes.headers.forEach((value, key) => {
    const existing = headersObj[key];
    if (existing) {
      headersObj[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      headersObj[key] = value;
    }
  });

  if (!isResponseWritable(nodeRes)) return;

  nodeRes.writeHead(webRes.status, headersObj);

  if (!webRes.body) {
    endResponse(nodeRes);
    return;
  }

  const reader = webRes.body.getReader();
  let completed = false;
  let cancelPromise: Promise<void> | null = null;
  const cancelReader = () => {
    if (completed || cancelPromise) return;
    cancelPromise = reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (signal.aborted || !isResponseWritable(nodeRes)) {
        cancelReader();
        break;
      }
      if (!nodeRes.write(value)) {
        await waitForDrainOrClose(nodeRes);
      }
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    if (!completed) cancelReader();
    if (cancelPromise) await cancelPromise;
    reader.releaseLock();
    endResponse(nodeRes);
  }
}

/**
 * Start an HTTP server with a Web-standard fetch handler.
 *
 * Interface mirrors Bun.serve() so the caller doesn't need to change.
 */
export function serve(options: ServeOptions): Promise<ServeResult> {
  const { hostname, port, fetch: fetchHandler } = options;

  const server = createServer(async (nodeReq, nodeRes) => {
    const lifecycle = createRequestLifecycle(nodeReq, nodeRes);
    nodeRes.on("error", (error) => {
      if (isWriteAfterEndError(error)) {
        console.warn("[serve-node] Ignored response write after end");
        return;
      }
      console.error("[serve-node] Response stream error:", error);
    });

    try {
      const webReq = toWebRequest(
        nodeReq,
        hostname,
        boundPort,
        lifecycle.signal,
      );
      const webRes = await fetchHandler(webReq);
      await writeWebResponse(webRes, nodeRes, lifecycle.signal);
    } catch (error) {
      if (lifecycle.signal.aborted) return;
      console.error("[serve-node] Unhandled error:", error);
      if (!isResponseWritable(nodeRes)) return;
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { "Content-Type": "application/json" });
      }
      endResponse(nodeRes, JSON.stringify({ error: "internal_error" }));
    } finally {
      lifecycle.complete();
    }
  });

  // Set keep-alive timeout to match Bun's idleTimeout
  if (options.idleTimeout) {
    server.keepAliveTimeout = options.idleTimeout * 1000;
  }

  let boundPort = port;

  return new Promise<ServeResult>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, hostname, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        boundPort = addr.port;
      }
      let stopPromise: Promise<void> | null = null;
      resolve({
        port: boundPort,
        stop: () => {
          if (stopPromise) return stopPromise;
          stopPromise = new Promise<void>((stopResolve, stopReject) => {
            server.close((error) => {
              if (error) {
                if (String(error).includes("ERR_SERVER_NOT_RUNNING") || String(error).includes("Server is not running")) {
                  stopResolve();
                  return;
                }
                stopReject(error);
                return;
              }
              stopResolve();
            });
            server.closeAllConnections();
          });
          return stopPromise;
        },
      });
    });
  });
}
