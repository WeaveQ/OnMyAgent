/**
 * Tencent Meeting (腾讯会议) remote MCP connector constants.
 */

export const PLUGIN_ID = "tencent-meeting";
export const OWNER = "onmyagent";
export const MCP_SERVER_NAME = "tencent-meeting";
/** Official hosted MCP. Auth: X-Tencent-Meeting-Token header. */
export const MCP_URL = "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1";
/** Personal token page (AI Skill zone). */
export const TOKEN_PAGE_URL = "https://meeting.tencent.com/ai-skill.html";
/** Skill version header expected by hosted MCP proxy docs. */
export const SKILL_VERSION = "1.0.0";

export const STATE_FILE = "state.json";
export const TOKEN_FILE = "oauth-tokens.json";
