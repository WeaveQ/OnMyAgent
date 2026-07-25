import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./node-kernel-worker.mjs", import.meta.url));

function createKernel(options) {
  const child = spawn(
    options.nodePath,
    ["--max-old-space-size=128", workerPath, JSON.stringify(options.allowedModules)],
    {
      cwd: options.cwd,
      // nodePath defaults to process.execPath, which is the Electron binary
      // inside the desktop app. Without ELECTRON_RUN_AS_NODE the child boots
      // as a full Electron app, never reads stdin, and every eval times out.
      // Real Node binaries ignore this variable, so it is safe to always set.
      env: { ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const pending = new Map();
  let output = "";
  let stderr = "";
  let dead = false;

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
        const writeBrowserResponse = (payload) => {
          if (dead || child.stdin.destroyed) return;
          try {
            child.stdin.write(`${JSON.stringify(payload)}\n`);
          } catch {
            // Worker already gone; ignore.
          }
        };
        if (typeof options.browserRequest !== "function") {
          writeBrowserResponse({
            kind: "browser-response",
            browserRequestId: response.browserRequestId,
            ok: false,
            error: "browser runtime is not configured",
          });
          continue;
        }
        void options.browserRequest(response.method, response.params, response.context)
          .then((result) => writeBrowserResponse({
            kind: "browser-response",
            browserRequestId: response.browserRequestId,
            ok: true,
            result,
          }))
          .catch((error) => writeBrowserResponse({
            kind: "browser-response",
            browserRequestId: response.browserRequestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
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
  const failPending = (error) => {
    dead = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  // Dead/killed workers can still surface EPIPE on stdin before "exit" runs.
  // Without a listener the error becomes uncaught and flakes CI on Linux.
  child.stdin.on("error", (error) => {
    if (error && (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED")) {
      failPending(new Error(`node kernel exited${stderr ? `: ${stderr}` : ""}`));
      return;
    }
    failPending(error instanceof Error ? error : new Error(String(error)));
  });

  child.on("exit", () => {
    failPending(new Error(`node kernel exited${stderr ? `: ${stderr}` : ""}`));
  });

  let requestId = 0;
  const sendRequest = (payload) => {
    requestId += 1;
    const id = requestId;
    return new Promise((resolve, reject) => {
      if (dead || child.killed || child.exitCode !== null || child.stdin.destroyed) {
        reject(new Error("node kernel exited"));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
        reject(new Error(`node kernel timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        dead = true;
        reject(
          error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED"
            ? new Error("node kernel exited")
            : error instanceof Error
              ? error
              : new Error(String(error)),
        );
      }
    });
  };
  return {
    isDead: () => dead,
    evaluate(code) {
      return sendRequest({
        code,
        // vm timeout only covers the sync prelude before the first await.
        // Keep it generous enough for large agent-authored scripts.
        syncTimeoutMs: Math.min(options.timeoutMs, 15_000),
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
    // Browser navigations (e.g. heavy sites) need more than a few seconds.
    timeoutMs: options.timeoutMs ?? 60_000,
    browserRequest: options.browserRequest,
  };

  const kernelFor = (sessionId) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new TypeError("node kernel sessionId is required");
    }
    let kernel = kernels.get(sessionId);
    if (!kernel || kernel.isDead()) {
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
