import { extractAcpSessionId, spawnAcpClient } from "./acp-client.mjs";
import { terminateProcessTree } from "./utils.mjs";

const AUTH_ERROR_PATTERN = /auth|login|unauthorized|forbidden|api key|credential|sign in|not logged in|认证|登录|未授权|凭证/i;

function isAuthError(message) {
  return AUTH_ERROR_PATTERN.test(String(message ?? ""));
}

/**
 * Two-step ACP probe:
 *   1. spawn the CLI + run ACP `initialize`  → distinguishes fail_cli vs fail_acp
 *   2. run `session/new`                      → distinguishes needs_auth vs online
 *
 * Returns a structured result:
 *   { ok, step, status, initialized, sessionResult, error, events }
 * where step ∈ "fail_cli" | "fail_acp" | "needs_auth" | "online".
 */
export async function probeAcpCommand({ command, args = [], cwd = process.cwd(), env = undefined, timeoutMs = 10_000 }) {
  const events = [];
  const { child, client } = spawnAcpClient({
    command,
    args,
    cwd,
    env: env ?? process.env,
    appendEvent: (event) => events.push(event),
  });

  let initialized = null;
  try {
    // Step 1: CLI spawn + ACP initialize handshake.
    try {
      initialized = await client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "onmyagent-acp-probe", version: "0.1.0" },
        clientCapabilities: {},
      }, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A process that exits or never speaks JSON-RPC failed at the CLI layer;
      // an initialize that is answered with an error is an ACP-layer failure.
      const step = /ACP process exited|ENOENT|command not found|not found|spawn/i.test(message) ? "fail_cli" : "fail_acp";
      return {
        ok: false,
        step,
        status: step === "fail_cli" ? "missing" : "offline",
        initialized: null,
        sessionResult: null,
        error: message,
        events,
      };
    }

    // Step 2: session/new to detect auth-required vs a genuinely online agent.
    try {
      const sessionResult = await client.request("session/new", { cwd, mcpServers: [] }, timeoutMs);
      const sessionId = extractAcpSessionId(sessionResult);
      if (!sessionId) {
        return { ok: false, step: "fail_acp", status: "offline", initialized, sessionResult, error: "session/new returned no sessionId", events };
      }
      // Some CLIs (Kimi CLI, Qwen Code, GitHub Copilot CLI) accept
      // initialize/session/new even when the user is not logged in, and
      // declare the login flow via `authMethods` instead of failing.
      // Detect that state by combining two signals:
      //   1. initialize.authMethods is non-empty (a login flow exists), and
      //   2. session configOptions expose a model `select` whose options list
      //      is empty and currentValue is empty (no model catalog was
      //      loaded, which happens when the account has not been resolved).
      // When both hold, treat the agent as `needs_auth` so it stays out of
      // the runtime picker until the user actually logs in.
      const authMethods = Array.isArray(initialized?.authMethods) ? initialized.authMethods : [];
      if (authMethods.length) {
        const configOptions = Array.isArray(sessionResult?.configOptions) ? sessionResult.configOptions : [];
        const modelSelect = configOptions.find((option) => {
          if (!option || typeof option !== "object") return false;
          const type = String(option.type ?? option.kind ?? "").toLowerCase();
          if (type && type !== "select") return false;
          const category = String(option.category ?? "").toLowerCase();
          const id = String(option.id ?? option.name ?? "").toLowerCase();
          return category === "model" || id === "model" || id === "models";
        });
        if (modelSelect) {
          const opts = Array.isArray(modelSelect.options) ? modelSelect.options : [];
          const currentValue = String(modelSelect.currentValue ?? modelSelect.value ?? "").trim();
          if (opts.length === 0 && !currentValue) {
            const authName = String(authMethods[0]?.name ?? authMethods[0]?.id ?? "login").trim() || "login";
            return {
              ok: false,
              step: "needs_auth",
              status: "needs_auth",
              initialized,
              sessionResult,
              error: `authentication required (${authName})`,
              events,
            };
          }
        }
      }
      return { ok: true, step: "online", status: "online", initialized, sessionResult, error: null, events };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAuthError(message)) {
        return { ok: false, step: "needs_auth", status: "needs_auth", initialized, sessionResult: null, error: message, events };
      }
      return { ok: false, step: "fail_acp", status: "offline", initialized, sessionResult: null, error: message, events };
    }
  } finally {
    client.dispose();
    if (child.exitCode === null && child.signalCode === null) {
      await terminateProcessTree(child);
    }
  }
}
