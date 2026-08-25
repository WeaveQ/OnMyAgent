import { StringDecoder } from "node:string_decoder";

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

export function encodeJsonRpcMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonRpcMessage(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export class BoundedJsonLineDecoder {
  #buffer = "";
  #decoder = new StringDecoder("utf8");
  #droppingOversizedLine = false;
  #maxLineBytes;

  constructor(options = {}) {
    const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
      throw new TypeError("maxLineBytes must be a positive safe integer");
    }
    this.#maxLineBytes = maxLineBytes;
  }

  push(chunk) {
    let text = typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    if (this.#droppingOversizedLine) {
      const newline = text.indexOf("\n");
      if (newline < 0) return [];
      this.#droppingOversizedLine = false;
      text = text.slice(newline + 1);
    }
    this.#buffer += text;
    const lines = [];
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(line) <= this.#maxLineBytes) lines.push(line);
    }
    if (Buffer.byteLength(this.#buffer) > this.#maxLineBytes) {
      this.#buffer = "";
      this.#droppingOversizedLine = true;
    }
    return lines;
  }

  end() {
    const tail = this.#decoder.end();
    const lines = tail ? this.push(tail) : [];
    if (!this.#droppingOversizedLine && this.#buffer) {
      if (Buffer.byteLength(this.#buffer) <= this.#maxLineBytes) {
        lines.push(this.#buffer.replace(/\r$/, ""));
      }
    }
    this.#buffer = "";
    this.#droppingOversizedLine = false;
    return lines;
  }
}
