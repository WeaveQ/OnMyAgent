import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";

export function createUiControlServer({
  app,
  appName,
  appIdentifier,
  createMainWindow,
}) {
  let uiControlServer = null;
  let uiControlDiscoveryPath = null;
  const uiControlToken = randomBytes(32).toString("hex");

  function sendJsonResponse(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }

  function readJsonRequestBody(request) {
    return new Promise((resolve, reject) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 128_000) {
          reject(new Error("Request body too large"));
          request.destroy();
        }
      });
      request.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Request body must be JSON"));
        }
      });
      request.on("error", reject);
    });
  }

  function authorizedUiControlRequest(request) {
    const auth = request.headers.authorization ?? "";
    return auth === `Bearer ${uiControlToken}`;
  }

  function jsonForJavaScript(value) {
    return JSON.stringify(JSON.stringify(value ?? {}));
  }

  async function evaluateOnMyAgentControl(expression, options = {}) {
    const win = await createMainWindow();
    if (options.focus === true) {
      win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    return win.webContents.executeJavaScript(expression, true);
  }

  async function runOnMyAgentControlCommand(command, args = {}) {
    const argsJsonLiteral = jsonForJavaScript(args);
    if (command === "snapshot") {
      return evaluateOnMyAgentControl(`(async () => {
        const control = window.__onmyagentControl;
        if (!control) return { ok: false, error: "OnMyAgent control surface is not available yet." };
        control.setEnabled?.(true);
        return { ok: true, ...control.snapshot() };
      })()`);
    }
    if (command === "actions") {
      return evaluateOnMyAgentControl(`(async () => {
        const control = window.__onmyagentControl;
        if (!control) return { ok: false, error: "OnMyAgent control surface is not available yet." };
        control.setEnabled?.(true);
        return { ok: true, actions: control.listActions() };
      })()`);
    }
    if (command === "execute") {
      return evaluateOnMyAgentControl(
        `(async () => {
        const control = window.__onmyagentControl;
        const input = JSON.parse(${argsJsonLiteral});
        if (!control) return { ok: false, error: "OnMyAgent control surface is not available yet." };
        if (!input || typeof input.actionId !== "string" || !input.actionId.trim()) {
          return { ok: false, error: "Missing OnMyAgent actionId." };
        }
        control.setEnabled?.(true);
        return control.execute(input.actionId, input.args ?? {});
      })()`,
        { focus: true },
      );
    }
    return { ok: false, error: `Unknown OnMyAgent control command: ${command}` };
  }

  async function startUiControlServer() {
    if (uiControlServer) return;
    uiControlServer = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/health") {
          sendJsonResponse(response, 200, {
            ok: true,
            app: appName,
            version: 1,
          });
          return;
        }
        if (!authorizedUiControlRequest(request)) {
          sendJsonResponse(response, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        if (request.method === "GET" && url.pathname === "/snapshot") {
          sendJsonResponse(
            response,
            200,
            await runOnMyAgentControlCommand("snapshot"),
          );
          return;
        }
        if (request.method === "GET" && url.pathname === "/actions") {
          sendJsonResponse(
            response,
            200,
            await runOnMyAgentControlCommand("actions"),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/execute") {
          sendJsonResponse(
            response,
            200,
            await runOnMyAgentControlCommand(
              "execute",
              await readJsonRequestBody(request),
            ),
          );
          return;
        }
        sendJsonResponse(response, 404, { ok: false, error: "Not found" });
      } catch (error) {
        sendJsonResponse(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    await new Promise((resolve, reject) => {
      uiControlServer.once("error", reject);
      uiControlServer.listen(0, "127.0.0.1", () => resolve(undefined));
    });
    const address = uiControlServer.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) throw new Error("Could not start OnMyAgent UI control bridge.");
    uiControlDiscoveryPath = path.join(
      app.getPath("userData"),
      "onmyagent-ui-control.json",
    );
    const discoveryPayload = `${JSON.stringify(
      {
        version: 1,
        app: appName,
        identifier: appIdentifier,
        platform: process.platform,
        baseUrl: `http://127.0.0.1:${port}`,
        token: uiControlToken,
      },
      null,
      2,
    )}\n`;
    // Atomic write: write to tmp then rename so partial reads never yield a
    // truncated bridge descriptor to the MCP client.
    const discoveryTmpPath = `${uiControlDiscoveryPath}.tmp`;
    await writeFile(discoveryTmpPath, discoveryPayload, "utf8");
    await rename(discoveryTmpPath, uiControlDiscoveryPath);
  }

  async function stopUiControlServer() {
    if (uiControlDiscoveryPath) {
      await rm(uiControlDiscoveryPath, { force: true }).catch(() => undefined);
      uiControlDiscoveryPath = null;
    }
    if (!uiControlServer) return;
    await new Promise((resolve) =>
      uiControlServer.close(() => resolve(undefined)),
    );
    uiControlServer = null;
  }

  return {
    start: startUiControlServer,
    stop: stopUiControlServer,
  };
}
