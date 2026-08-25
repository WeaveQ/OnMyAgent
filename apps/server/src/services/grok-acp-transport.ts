import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  BoundedJsonLineDecoder,
  encodeJsonRpcMessage,
  parseJsonRpcMessage,
} from "@onmyagent/acp-runtime";
import { ApiError } from "../core/errors.js";

type JsonObject = Record<string, unknown>;
type Pending = { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class GrokAcpTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, Pending>();
  readonly #onNotification: (method: string, params: unknown) => void;
  readonly #onRequest: (method: string, params: unknown) => Promise<unknown>;
  #nextId = 1;
  #disposed = false;
  readonly #lineDecoder = new BoundedJsonLineDecoder();

  constructor(input: {
    child: ChildProcessWithoutNullStreams;
    onNotification?: (method: string, params: unknown) => void;
    onRequest?: (method: string, params: unknown) => Promise<unknown>;
  }) {
    this.#child = input.child;
    this.#onNotification = input.onNotification ?? (() => undefined);
    this.#onRequest = input.onRequest ?? (async (method) => { throw new ApiError(400, "grok_acp_request_unsupported", `Unsupported ACP request: ${method}`); });
    input.child.stdout.on("data", (chunk: Buffer | string) =>
      this.#handleChunk(chunk));
    input.child.once("close", () => this.dispose(new ApiError(503, "grok_acp_process_closed", "Grok ACP process closed")));
    input.child.once("error", (error) => this.dispose(error));
  }

  request(method: string, params: JsonObject, timeoutMs = 60_000): Promise<unknown> {
    if (this.#disposed) return Promise.reject(new ApiError(503, "grok_acp_transport_disposed", "Grok ACP transport is closed"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ApiError(504, "grok_acp_request_timeout", `Grok ACP request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#child.stdin.write(encodeJsonRpcMessage({ jsonrpc: "2.0", id, method, params }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params: JsonObject): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new ApiError(
        503,
        "grok_acp_transport_disposed",
        "Grok ACP transport is closed",
      ));
    }
    return new Promise((resolve, reject) => {
      this.#child.stdin.write(
        encodeJsonRpcMessage({ jsonrpc: "2.0", method, params }),
        (error) => error ? reject(error) : resolve(),
      );
    });
  }

  dispose(error: Error = new ApiError(503, "grok_acp_transport_disposed", "Grok ACP transport is closed")): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
    this.#child.stdin.destroy();
    this.#child.stdout.destroy();
    this.#child.stderr.destroy();
  }

  #handleLine(line: string): void {
    const message = parseJsonRpcMessage(line);
    if (!message) return;
    const id = typeof message.id === "number" ? message.id : null;
    const method = typeof message.method === "string" ? message.method : null;
    if (id !== null && method) {
      void this.#onRequest(method, message.params).then(
        (result) => this.#respond(id, { result }),
        (error) => this.#respond(id, { error: { code: -32000, message: error instanceof Error ? error.message : "Request failed" } }),
      );
      return;
    }
    if (id !== null && ("result" in message || "error" in message)) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      if (message.error) pending.reject(remoteError(pending.method, message.error));
      else pending.resolve(message.result);
      return;
    }
    if (method) this.#onNotification(method, message.params);
  }

  #handleChunk(chunk: Buffer | string): void {
    for (const line of this.#lineDecoder.push(chunk)) this.#handleLine(line);
  }

  #respond(id: number, value: { result?: unknown; error?: unknown }): void {
    if (!this.#disposed) this.#child.stdin.write(encodeJsonRpcMessage({ jsonrpc: "2.0", id, ...value }));
  }
}

function remoteError(method: string, value: unknown): ApiError {
  const error = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
  const safeSignal = [error.message, error.data]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  if (/authentication required|not authenticated|login required/i.test(safeSignal)) {
    return new ApiError(
      401,
      "grok_auth_required",
      "Grok authentication is required",
    );
  }
  if (/model.+(unavailable|not found|not allowed)/i.test(safeSignal)) {
    return new ApiError(
      409,
      "grok_model_unavailable",
      "The selected Grok model is unavailable",
    );
  }
  const jsonRpcCode = typeof error.code === "number" && Number.isInteger(error.code)
    ? error.code
    : undefined;
  return new ApiError(
    502,
    "grok_acp_remote_error",
    `Grok ACP ${method} failed`,
    jsonRpcCode === undefined ? undefined : { jsonRpcCode },
  );
}
