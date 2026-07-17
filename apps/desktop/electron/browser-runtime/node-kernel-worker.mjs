import { createInterface } from "node:readline";
import vm from "node:vm";

import { setupBrowserRuntime } from "./browser-client.mjs";

const allowedModules = new Set(JSON.parse(process.argv[2] ?? "[]"));
const context = vm.createContext({
  console: Object.freeze({
    log() {},
    error() {},
    warn() {},
  }),
  setTimeout,
  clearTimeout,
});
const browserRequests = new Map();
let browserRequestId = 0;

context.globalThis = context;
context.nodeRepl = Object.freeze({
  async import(moduleName) {
    if (typeof moduleName !== "string" || !allowedModules.has(moduleName)) {
      throw new Error(`module is not allowed: ${String(moduleName)}`);
    }
    return import(moduleName);
  },
  emitImage(value) {
    if (typeof value !== "string" || !value.startsWith("data:image/")) {
      throw new TypeError("emitImage expects an image data URL");
    }
    return { type: "image", imageUrl: value };
  },
});

function serialize(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    if (request.kind === "browser-response") {
      const pending = browserRequests.get(request.browserRequestId);
      if (!pending) return;
      browserRequests.delete(request.browserRequestId);
      if (request.ok) pending.resolve(request.result);
      else pending.reject(new Error(request.error));
      return;
    }
    if (request.kind === "configure-browser") {
      const boundContext = request.context;
      context.agent = setupBrowserRuntime({
        context: boundContext,
        request(method, params) {
          browserRequestId += 1;
          const id = browserRequestId;
          return new Promise((resolve, reject) => {
            browserRequests.set(id, { resolve, reject });
            process.stdout.write(`${JSON.stringify({
              kind: "browser-request",
              browserRequestId: id,
              method,
              params,
              context: boundContext,
            })}\n`);
          });
        },
      });
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, value: true })}\n`);
      return;
    }
    const source = `(async () => (${request.code}))()`;
    const promise = new vm.Script(source, { filename: "onmyagent-node-repl.mjs" })
      .runInContext(context, { timeout: request.syncTimeoutMs });
    const value = await promise;
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, value: serialize(value) })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      id: request?.id ?? null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
  }
});
