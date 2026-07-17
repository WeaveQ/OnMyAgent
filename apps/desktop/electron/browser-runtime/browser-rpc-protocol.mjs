const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;
const CONTEXT_KEYS = [
  "workspaceId",
  "sessionId",
  "messageId",
  "turnId",
  "agentId",
  "backend",
];

function requireExecutionContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("browser RPC context is required");
  }
  for (const key of CONTEXT_KEYS) {
    if (typeof context[key] !== "string" || !context[key].trim()) {
      throw new TypeError(`browser RPC context.${key} is required`);
    }
  }
  if (context.backend !== "in-app" && context.backend !== "chrome") {
    throw new TypeError("browser RPC context.backend is invalid");
  }
  return { ...context };
}

export function createBrowserRpcRequest(id, method, params, context) {
  if ((typeof id !== "string" && typeof id !== "number") || id === "") {
    throw new TypeError("browser RPC id is required");
  }
  if (typeof method !== "string" || !method.trim()) {
    throw new TypeError("browser RPC method is required");
  }
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: params ?? {},
    context: requireExecutionContext(context),
  };
}

export function encodeBrowserRpcFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class BrowserRpcFrameDecoder {
  #buffer = Buffer.alloc(0);
  #maxFrameBytes;

  constructor(options = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError("browser RPC chunk must be a Buffer");
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > this.#maxFrameBytes) {
        this.#buffer = Buffer.alloc(0);
        throw new RangeError(`browser RPC frame exceeds ${this.#maxFrameBytes} bytes`);
      }
      if (this.#buffer.length < length + 4) break;
      const payload = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.subarray(length + 4);
      messages.push(JSON.parse(payload.toString("utf8")));
    }
    return messages;
  }
}
