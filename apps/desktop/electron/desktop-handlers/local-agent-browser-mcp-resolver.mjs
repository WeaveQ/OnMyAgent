import { randomBytes } from "node:crypto";

import { buildLocalAgentBrowserMcpServer } from "../browser-runtime/browser-mcp.mjs";
import { localWorkspaceId } from "../desktop-workspace-ids.mjs";

const BROWSER_MCP_PROVIDERS = new Set(["codex", "claude"]);

export function createLocalAgentBrowserMcpResolver(options = {}) {
  const browserController = options.browserController;
  if (!browserController) throw new TypeError("browserController is required");
  const buildServer = options.buildServer ?? buildLocalAgentBrowserMcpServer;
  const workspaceIdFor = options.workspaceIdFor ?? localWorkspaceId;
  const nonce = options.nonce ?? (() => randomBytes(8).toString("hex"));
  const warn = options.warn ?? ((message) => console.warn(message));

  return async function resolveLocalAgentBrowserMcpServer(input = {}) {
    const provider = String(input?.agent?.provider ?? "").trim().toLowerCase();
    if (!BROWSER_MCP_PROVIDERS.has(provider)) return null;
    const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
    const conversationId = String(input?.conversationId ?? "").trim();
    if (!workspaceRoot || !conversationId) return null;
    if (!(await browserController.isAutomationEnabled())) return null;
    const rpcEnvironment = browserController.browserEnvironment();
    if (
      !String(rpcEnvironment.ONMYAGENT_BROWSER_RPC_ENDPOINT ?? "").trim()
      || !String(rpcEnvironment.ONMYAGENT_BROWSER_RPC_BOOTSTRAP ?? "").trim()
    ) {
      warn("[local-agent] in-app Browser RPC is unavailable; Browser MCP was not injected");
      return null;
    }
    const workspaceId = workspaceIdFor(workspaceRoot);
    const sessionId = `localAgent:${workspaceId}:${conversationId}`;
    const turnNonce = String(nonce());
    return buildServer({
      execPath: options.execPath ?? process.execPath,
      electronRuntime: options.electronRuntime ?? Boolean(process.versions.electron),
      rpcEnvironment,
      context: {
        workspaceId,
        sessionId,
        messageId: `${sessionId}:message:${turnNonce}`,
        turnId: `${sessionId}:turn:${turnNonce}`,
        agentId: String(input?.agent?.id ?? provider).trim() || provider,
        backend: "in-app",
      },
    });
  };
}
