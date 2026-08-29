export const LOCAL_AGENT_BROWSER_MCP_NAME = "onmyagent-in-app-browser";

export const LOCAL_AGENT_BROWSER_MCP_TOOL_NAMES = Object.freeze([
  "browser_get_info",
  "browser_list_tabs",
  "browser_open_tab",
  "browser_navigate",
  "browser_navigate_history",
  "browser_reload",
  "browser_screenshot",
  "browser_dom_observe",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_dom_action",
  "browser_locator_action",
  "browser_tab_content",
  "browser_export_content",
  "browser_finalize_tabs",
  "browser_mark_tab",
]);

const LOCAL_AGENT_BROWSER_MCP_TOOL_NAME_SET = new Set(LOCAL_AGENT_BROWSER_MCP_TOOL_NAMES);

export function isLocalAgentBrowserMcpToolName(value) {
  return typeof value === "string" && LOCAL_AGENT_BROWSER_MCP_TOOL_NAME_SET.has(value);
}
