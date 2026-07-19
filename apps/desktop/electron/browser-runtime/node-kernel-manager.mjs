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
  // Avoid unhandled 'error' when writing after the worker already exited.
  child.stdin.on("error", () => {
    dead = true;
  });
  child.on("error", () => {
    dead = true;
  });
  child.on("exit", () => {
    dead = true;
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
      if (dead || child.killed || child.exitCode !== null) {
        dead = true;
        reject(new Error("node kernel exited"));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        // Mark dead before SIGKILL so concurrent writers do not race on stdin.
        dead = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        reject(new Error(`node kernel timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        const ok = child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
        if (ok === false) {
          // Backpressure is fine; still track the request until response/timeout.
        }
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        dead = true;
        reject(error instanceof Error ? error : new Error(String(error)));
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
    async evaluate(sessionId, code) {
      if (typeof code !== "string" || !code.trim()) {
        throw new TypeError("node kernel code is required");
      }
      // One automatic retry when a dead/timed-out worker is still briefly
      // referenced (exit handler race). Second failure surfaces to the caller.
      try {
        return await kernelFor(sessionId).evaluate(code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/node kernel (exited|timed out)/i.test(message) && error?.code !== "EPIPE") {
          throw error;
        }
        const stale = kernels.get(sessionId);
        if (stale) {
          kernels.delete(sessionId);
          void stale.stop();
        }
        return kernelFor(sessionId).evaluate(code);
      }
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
