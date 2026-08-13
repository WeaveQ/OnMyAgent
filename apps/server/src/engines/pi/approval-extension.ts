/**
 * Pi approval bridge extension (B3 bridge path).
 *
 * Injected via `pi --extension <this-file>` on every managed PiEngine process.
 * The extension intercepts tool calls and routes them through OnMyAgent's
 * approval flow:
 *
 *   1. `tool_call` fires before a tool executes (agent-loop.js:419 consumes
 *      `beforeResult?.block` — returning `{block:true}` prevents execution).
 *   2. The handler calls `ctx.ui.confirm(...)`. In RPC mode this is translated
 *      into an `extension_ui_request` (method "confirm") on stdout, and the
 *      handler blocks until the RPC client writes back an
 *      `extension_ui_response` on stdin with the matching id.
 *   3. The RPC client (PiEngine) bridges the request to the workspace SSE
 *      stream as `permission_request`; the UI replies, and the client sends
 *      `extension_ui_response` → the handler returns `{block:true}` (denied)
 *      or undefined (allowed) → the tool runs or is blocked.
 *
 * Deny-by-default policy: any tool the bridge is asked to gate that is NOT in
 * the allowlist is blocked. The allowlist covers read-only / low-risk tools;
 * everything else (bash, write, edit, network, file ops) requires approval.
 */

const ALWAYS_ALLOW = new Set([
  // Read-only inspection
  "read",
  "grep",
  "glob",
  "list",
  "ls",
  "search",
  "status",
  // Thinking / context
  "get_context",
  "get_state",
  "get_messages",
  // Output the user is already watching
  "notify",
]);

type PiHost = {
  on: (
    event: string,
    handler: (payload: Record<string, unknown>, ctx: { ui: { confirm: (title: string, message: string) => Promise<boolean> } }) => Promise<unknown>,
  ) => void;
};

export default function (pi: PiHost) {
  pi.on("tool_call", async (event, ctx) => {
    const toolName = String(event.toolName ?? "");
    if (ALWAYS_ALLOW.has(toolName)) return;

    let detail = "";
    const input =
      event.input && typeof event.input === "object"
        ? (event.input as Record<string, unknown>)
        : {};
    if (toolName === "bash" && typeof input?.command === "string") {
      detail = input.command.length > 120 ? `${input.command.slice(0, 120)}…` : input.command;
    } else if (typeof input?.path === "string") {
      detail = input.path;
    } else if (typeof input?.url === "string") {
      detail = input.url;
    } else {
      try {
        detail = JSON.stringify(input).slice(0, 160);
      } catch {
        detail = "";
      }
    }

    const title = toolName === "bash" ? "Allow shell command?" : `Allow ${toolName}?`;
    const message = detail ? `${toolName}: ${detail}` : toolName;
    let confirmed: boolean;
    try {
      confirmed = await ctx.ui.confirm(title, message);
    } catch {
      // No UI channel (should not happen in RPC mode — hasUI is true); deny.
      return { block: true, reason: "Approval UI unavailable" };
    }
    if (!confirmed) {
      return { block: true, reason: "Blocked by OnMyAgent approval" };
    }
    return undefined;
  });
}
