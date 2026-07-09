#!/usr/bin/env node

/**
 * onmyagent-ui-mcp
 *
 * MCP server that exposes OnMyAgent's UI control surface as MCP tools.
 * Speaks MCP stdio and proxies to the OnMyAgent desktop bridge HTTP API.
 *
 * Requires OnMyAgent desktop running with the local UI control bridge active.
 *
 * Usage:
 *   npx onmyagent-ui-mcp
 *   # Backward compatible: npx onmyagent-ui-mcp
 *
 * MCP config (OpenCode / Claude Desktop / Cursor / etc.):
 *   {
 *     "mcpServers": {
 *       "onmyagent-ui": {
 *         "command": "npx",
 *         "args": ["-y", "onmyagent-ui-mcp"]
 *       }
 *     }
 *   }
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Bridge discovery ──

const DISCOVERY_FILE = "onmyagent-ui-control.json";
const BRIDGE_CACHE_MS = 2_000;
const BRIDGE_TIMEOUT_MS = 5_000;
let cachedBridge = null;
let cachedBridgeAt = 0;

function userAppDataDir() {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support");
  if (platform() === "win32") return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function discoveryPaths() {
  return [
    process.env.ONMYAGENT_UI_CONTROL_DISCOVERY?.trim(),
    join(userAppDataDir(), "com.differentai.onmyagent", DISCOVERY_FILE),
    join(userAppDataDir(), "com.differentai.onmyagent.dev", DISCOVERY_FILE),
  ].filter(Boolean);
}

function clearBridgeCache() {
  cachedBridge = null;
  cachedBridgeAt = 0;
}

async function discoverBridge() {
  if (cachedBridge && Date.now() - cachedBridgeAt < BRIDGE_CACHE_MS) return cachedBridge;

  for (const candidate of discoveryPaths()) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.baseUrl === "string" && typeof parsed.token === "string") {
        cachedBridge = { baseUrl: parsed.baseUrl, token: parsed.token, path: candidate };
        cachedBridgeAt = Date.now();
        return cachedBridge;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

async function bridgeRequest(path, options = {}) {
  const bridge = await discoverBridge();
  if (!bridge) {
    return {
      ok: false,
      error: "OnMyAgent is not running. Launch the OnMyAgent desktop app first.",
      hint: "The MCP server connects to a running OnMyAgent instance via its local bridge.",
    };
  }
  const url = `${bridge.baseUrl}${path}`;
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      signal: AbortSignal.timeout(options.timeoutMs ?? BRIDGE_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      if (!response.ok) clearBridgeCache();
      return parsed;
    } catch {
      if (!response.ok) clearBridgeCache();
      return { ok: false, error: text || `HTTP ${response.status}` };
    }
  } catch (error) {
    clearBridgeCache();
    return { ok: false, error: `Bridge unreachable at ${url}: ${error.message}` };
  }
}

function formatArgs(action) {
  const lines = [];
  if (Array.isArray(action.args) && action.args.length > 0) {
    lines.push("    Args:");
    for (const arg of action.args) {
      const required = arg.required ? "required" : "optional";
      const type = arg.type || "unknown";
      lines.push(`      - ${arg.name} (${type}, ${required})${arg.description ? `: ${arg.description}` : ""}`);
    }
  } else if (action.requiresArgs) {
    lines.push("    Args: required; this action has not published detailed argument metadata yet.");
  }
  if (action.previewArgs !== undefined) {
    lines.push(`    Example: ${JSON.stringify(action.previewArgs)}`);
  }
  return lines.join("\n");
}

function formatActionLine(action) {
  const disabled = action.disabled ? " [disabled]" : "";
  const busy = action.busy ? " [busy]" : "";
  const args = formatArgs(action);
  return `${action.id}${disabled}${busy}\n    ${action.label || ""}${action.description ? ` — ${action.description}` : ""}${args ? `\n${args}` : ""}`;
}

function formatExecutionResult(actionId, result) {
  const payload = result?.result ?? result;
  if (payload === true || payload === undefined || payload === null) return `Executed ${actionId}.`;
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return `Result: ${payload}`;
  if (typeof payload === "object") {
    const lines = [`Executed ${actionId}.`];
    for (const [key, value] of Object.entries(payload).slice(0, 12)) {
      if (key === "ok" || key === "actionId") continue;
      const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
      lines.push(`${key}: ${rendered}`);
    }
    return lines.join("\n");
  }
  return `Executed ${actionId}.`;
}

// ── MCP Server ──

const server = new McpServer({
  name: "onmyagent-ui",
  version: "0.1.0",
});

// ── ui.snapshot ──
server.tool(
  "ui_snapshot",
  "Get a snapshot of the current OnMyAgent UI state: active route, narration, visible actions, and status. Use this before taking action to understand what the user sees.",
  {},
  async () => {
    const result = await bridgeRequest("/snapshot");
    if (!result.ok && result.error) {
      return { content: [{ type: "text", text: `Error: ${result.error}${result.hint ? `\n${result.hint}` : ""}` }], isError: true };
    }
    const snapshot = result.snapshot ?? result;
    const lines = [];
    if (snapshot.route) lines.push(`Route: ${snapshot.route}`);
    if (snapshot.status) lines.push(`Status: ${snapshot.status}`);
    if (snapshot.narration) lines.push(`Narration: ${snapshot.narration}`);
    if (snapshot.busyActionId) lines.push(`Busy: ${snapshot.busyActionId}`);
    if (Array.isArray(snapshot.actions)) {
      lines.push(`\nActions (${snapshot.actions.length}):`);
      for (const action of snapshot.actions) {
        const args = Array.isArray(action.args) && action.args.length ? ` [${action.args.map((a) => a.name).join(", ")}]` : "";
        lines.push(`  ${action.id} — ${action.label || action.description || ""}${args}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") || "OnMyAgent is reachable, but it did not return visible UI state." }] };
  }
);

// ── ui.list_actions ──
server.tool(
  "ui_list_actions",
  "List all UI control actions currently available in OnMyAgent: session navigation, composer control, transcript access, and more. Each action has an id you can pass to ui_execute_action.",
  {},
  async () => {
    const result = await bridgeRequest("/actions");
    if (!result.ok && result.error) {
      return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    if (!Array.isArray(result.actions) || result.actions.length === 0) {
      return { content: [{ type: "text", text: "No actions available. Is OnMyAgent on the main screen?" }] };
    }
    const text = result.actions.map(formatActionLine).join("\n\n");
    return { content: [{ type: "text", text: `${result.actions.length} actions:\n\n${text}` }] };
  }
);

// ── ui.execute_action ──
server.tool(
  "ui_execute_action",
  "Execute an OnMyAgent UI action by its id. Use ui_list_actions first to see available actions and their required arguments.",
  {
    actionId: z.string().describe("The action id from ui_list_actions, e.g. 'session.create_task' or 'composer.set_text'"),
    args: z.record(z.unknown()).optional().describe("JSON arguments for the action, if required"),
  },
  async ({ actionId, args }) => {
    const result = await bridgeRequest("/execute", {
      method: "POST",
      body: { actionId, args: args ?? {} },
    });
    if (!result.ok && result.error) {
      return { content: [{ type: "text", text: `Error executing ${actionId}: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: formatExecutionResult(actionId, result) }] };
  }
);

// ── ui.status ──
server.tool(
  "ui_status",
  "Check if OnMyAgent is running and the bridge is reachable. Returns connection status and app info.",
  {},
  async () => {
    const bridge = await discoverBridge();
    if (!bridge) {
      return { content: [{ type: "text", text: "OnMyAgent is not running.\nLaunch the OnMyAgent desktop app to enable UI control." }], isError: true };
    }
    try {
      const response = await fetch(`${bridge.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      return { content: [{ type: "text", text: `Connected to ${data.app || "OnMyAgent"}\nBridge: ${bridge.baseUrl}\nVersion: ${data.version ?? "?"}` }] };
    } catch (error) {
      clearBridgeCache();
      return { content: [{ type: "text", text: `Bridge file found but not reachable: ${error.message}\nOnMyAgent may have quit. Relaunch it.` }], isError: true };
    }
  }
);


// ── Convenience wrappers (read-only where possible; write actions still
// route through ui_execute_action, which the renderer gates via the ACP
// approval store on side-effectful action ids).
server.tool(
  "ui_list_sessions",
  "List sessions surfaced by the OnMyAgent renderer. Read-only. Convenience wrapper over ui_execute_action with actionId='session.list'.",
  {},
  async () => {
    const result = await bridgeRequest("/execute", {
      method: "POST",
      body: { actionId: "session.list_sessions", args: {} },
    });
    if (!result.ok && result.error) {
      return { content: [{ type: "text", text: `Error: ${result.error}. If the action is not registered, use ui_list_actions to discover the current renderer's session ids.` }], isError: true };
    }
    return { content: [{ type: "text", text: formatExecutionResult("session.list_sessions", result) }] };
  }
);

server.tool(
  "ui_focus_session",
  "Bring a specific OnMyAgent session into focus. Convenience wrapper over ui_execute_action with actionId='session.focus'. Requires user approval on first use per session.",
  {
    sessionId: z.string().describe("The session id to focus"),
  },
  async ({ sessionId }) => {
    const result = await bridgeRequest("/execute", {
      method: "POST",
      body: { actionId: "session.open", args: { sessionId } },
    });
    if (!result.ok && result.error) {
      return { content: [{ type: "text", text: `Error focusing session ${sessionId}: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: formatExecutionResult("session.open", result) }] };
  }
);

server.tool(
  "ui_describe_workspace",
  "Describe the active OnMyAgent workspace context: current route, narration, and any workspace hints exposed by the snapshot. Read-only.",
  {},
  async () => {
    const result = await bridgeRequest("/snapshot");
    if (!result.ok && result.error) {
      return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
    }
    const snapshot = result.snapshot ?? result;
    const lines = [];
    if (snapshot.route) lines.push(`Route: ${snapshot.route}`);
    if (snapshot.status) lines.push(`Status: ${snapshot.status}`);
    if (snapshot.narration) lines.push(`Narration: ${snapshot.narration}`);
    return { content: [{ type: "text", text: lines.join("\n") || "No workspace hints available from snapshot." }] };
  }
);

// ── Start ──
const transport = new StdioServerTransport();
await server.connect(transport);
