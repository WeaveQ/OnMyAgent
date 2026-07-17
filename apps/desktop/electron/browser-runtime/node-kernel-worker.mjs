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

function summarizeBrowserHandle(value) {
  if (value == null || typeof value !== "object") return null;
  // Browser handle from setupBrowserRuntime
  if (typeof value.browserId === "string" && value.tabs && typeof value.tabs.new === "function") {
    return {
      __type: "Browser",
      browserId: value.browserId,
      name: value.name ?? value.browserId,
    };
  }
  // Tab handle
  if (typeof value.id === "string" && value.playwright && typeof value.goto === "function") {
    return {
      __type: "Tab",
      id: value.id,
      note: "Keep this Tab in a variable. Use await tab.url() / await tab.title() for live fields.",
    };
  }
  return null;
}

function serialize(value) {
  if (value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") {
    return { __type: "Function", name: value.name || "anonymous" };
  }
  const handle = summarizeBrowserHandle(value);
  if (handle) return handle;
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, current) => {
        if (typeof current === "function") return undefined;
        if (typeof current === "bigint") return current.toString();
        const nested = summarizeBrowserHandle(current);
        if (nested) return nested;
        return current;
      }),
    );
  } catch {
    return String(value);
  }
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
    // Prefer the expression form so the value of `code` is returned; fall back
    // to a block body so multi-statement code (const/await/return) is accepted.
    let script;
    try {
      script = new vm.Script(`(async () => (${request.code}))()`, { filename: "onmyagent-node-repl.mjs" });
    } catch {
      script = new vm.Script(`(async () => { ${request.code} })()`, { filename: "onmyagent-node-repl.mjs" });
    }
    const promise = script.runInContext(context, { timeout: request.syncTimeoutMs });
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
