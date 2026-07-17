import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./node-kernel-worker.mjs", import.meta.url));

function createKernel(options) {
  const child = spawn(
    options.nodePath,
    ["--max-old-space-size=128", workerPath, JSON.stringify(options.allowedModules)],
    {
      cwd: options.cwd,
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const pending = new Map();
  let output = "";
  let stderr = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    while (true) {
      const newline = output.indexOf("\n");
      if (newline < 0) break;
      const line = output.slice(0, newline);
      output = output.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      if (response.kind === "browser-request") {
        if (typeof options.browserRequest !== "function") {
          child.stdin.write(`${JSON.stringify({
            kind: "browser-response",
            browserRequestId: response.browserRequestId,
            ok: false,
            error: "browser runtime is not configured",
          })}\n`);
          continue;
        }
        void options.browserRequest(response.method, response.params, response.context)
          .then((result) => child.stdin.write(`${JSON.stringify({
            kind: "browser-response",
            browserRequestId: response.browserRequestId,
            ok: true,
            result,
          })}\n`))
          .catch((error) => child.stdin.write(`${JSON.stringify({
            kind: "browser-response",
            browserRequestId: response.browserRequestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`));
        continue;
      }
      const request = pending.get(response.id);
      if (!request) continue;
      pending.delete(response.id);
      clearTimeout(request.timer);
      if (response.ok) request.resolve(response.value);
      else request.reject(new Error(response.error));
    }
  });
  child.on("exit", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`node kernel exited${stderr ? `: ${stderr}` : ""}`));
    }
    pending.clear();
  });

  let requestId = 0;
  const sendRequest = (payload) => {
    requestId += 1;
    const id = requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        child.kill("SIGKILL");
        reject(new Error(`node kernel timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    });
  };
  return {
    evaluate(code) {
      return sendRequest({
          code,
          syncTimeoutMs: Math.min(options.timeoutMs, 1_000),
      });
    },
    configureBrowser(context) {
      return sendRequest({ kind: "configure-browser", context });
    },
    stop() {
      if (child.exitCode !== null) return Promise.resolve();
      return new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
      });
    },
  };
}

export function createNodeKernelManager(options = {}) {
  const kernels = new Map();
  const settings = {
    nodePath: options.nodePath ?? process.execPath,
    allowedModules: options.allowedModules ?? ["node:url", "node:path"],
    cwd: options.cwd ?? process.cwd(),
    timeoutMs: options.timeoutMs ?? 10_000,
    browserRequest: options.browserRequest,
  };

  const kernelFor = (sessionId) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new TypeError("node kernel sessionId is required");
    }
    let kernel = kernels.get(sessionId);
    if (!kernel) {
      kernel = createKernel(settings);
      kernels.set(sessionId, kernel);
    }
    return kernel;
  };

  return {
    evaluate(sessionId, code) {
      if (typeof code !== "string" || !code.trim()) {
        return Promise.reject(new TypeError("node kernel code is required"));
      }
      return kernelFor(sessionId).evaluate(code);
    },
    configureBrowserSession(sessionId, context) {
      return kernelFor(sessionId).configureBrowser(context);
    },
    async reset(sessionId) {
      const kernel = kernels.get(sessionId);
      if (!kernel) return;
      kernels.delete(sessionId);
      await kernel.stop();
    },
    async dispose() {
      const active = [...kernels.values()];
      kernels.clear();
      await Promise.all(active.map((kernel) => kernel.stop()));
    },
  };
}
