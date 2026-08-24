import { fileURLToPath } from "node:url";

import {
  LOCAL_AGENT_BROWSER_MCP_NAME,
  LOCAL_AGENT_BROWSER_MCP_TOOL_NAMES,
} from "./browser-mcp-contract.mjs";

export { LOCAL_AGENT_BROWSER_MCP_NAME } from "./browser-mcp-contract.mjs";

const RPC_ENVIRONMENT_KEYS = Object.freeze({
  endpoint: "ONMYAGENT_BROWSER_RPC_ENDPOINT",
  bootstrap: "ONMYAGENT_BROWSER_RPC_BOOTSTRAP",
});

const CONTEXT_ENVIRONMENT_KEYS = Object.freeze({
  workspaceId: "ONMYAGENT_BROWSER_WORKSPACE_ID",
  sessionId: "ONMYAGENT_BROWSER_SESSION_ID",
  messageId: "ONMYAGENT_BROWSER_MESSAGE_ID",
  turnId: "ONMYAGENT_BROWSER_TURN_ID",
  agentId: "ONMYAGENT_BROWSER_AGENT_ID",
  backend: "ONMYAGENT_BROWSER_BACKEND",
});

const REQUIRED_CONTEXT_KEYS = [
  "workspaceId",
  "sessionId",
  "messageId",
  "turnId",
  "agentId",
  "backend",
];

const DOM_ACTIONS = [
  "click",
  "doubleClick",
  "type",
  "scroll",
  "keypress",
  "downloadMedia",
];

const LOCATOR_ACTIONS = [
  "click",
  "fill",
  "type",
  "press",
  "hover",
  "check",
  "uncheck",
  "selectOption",
  "textContent",
  "innerText",
  "getAttribute",
  "count",
  "isVisible",
  "isEnabled",
  "waitFor",
];

const MCP_BROWSER_CAPABILITIES = Object.freeze([
  "tabs",
  "navigation",
  "content",
  "screenshot",
  "dom-observation",
  "dom-actions",
  "locator-actions",
]);

const SELECTOR_PROPERTIES = Object.freeze({
  css: { type: "string" },
  role: { type: "string" },
  name: { type: "string" },
  testId: { type: "string" },
  text: { type: "string" },
  label: { type: "string" },
  placeholder: { type: "string" },
  nth: { type: "integer" },
});

function objectSchema(properties = {}, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function tabIdProperty() {
  return { tabId: { type: "string", minLength: 1 } };
}

function selectorProperty() {
  return {
    selector: {
      type: "object",
      additionalProperties: false,
      properties: SELECTOR_PROPERTIES,
    },
  };
}

export function createLocalAgentBrowserMcpToolDefinitions() {
  const definitions = [
    {
      name: "browser_get_info",
      description: "Read the in-app Browser capability summary.",
      inputSchema: objectSchema(),
    },
    {
      name: "browser_list_tabs",
      description: "List tabs owned by this Local Agent browser session.",
      inputSchema: objectSchema(),
    },
    {
      name: "browser_open_tab",
      description: "Open a new in-app Browser tab. Navigation only accepts http/https URLs without embedded credentials.",
      inputSchema: objectSchema({
        url: { type: "string" },
        temporary: { type: "boolean" },
        deliverable: { type: "boolean" },
        handoff: { type: "boolean" },
      }),
    },
    {
      name: "browser_navigate",
      description: "Navigate a session-owned tab to an http/https URL without embedded credentials.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        url: { type: "string", minLength: 1 },
        timeoutMs: { type: "integer", minimum: 1, maximum: 60_000 },
      }, ["tabId", "url"]),
    },
    {
      name: "browser_navigate_history",
      description: "Move a session-owned tab backward or forward in its navigation history.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        direction: { type: "string", enum: ["back", "forward"] },
      }, ["tabId", "direction"]),
    },
    {
      name: "browser_reload",
      description: "Reload a session-owned Browser tab.",
      inputSchema: objectSchema(tabIdProperty(), ["tabId"]),
    },
    {
      name: "browser_screenshot",
      description: "Capture a bounded screenshot of a session-owned Browser tab.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        format: { type: "string", enum: ["jpeg", "png"] },
        maxWidth: { type: "integer", minimum: 1, maximum: 1920 },
        quality: { type: "integer", minimum: 1, maximum: 100 },
      }, ["tabId"]),
    },
    {
      name: "browser_dom_observe",
      description: "Inspect the visible interactive DOM nodes of a session-owned Browser tab.",
      inputSchema: objectSchema(tabIdProperty(), ["tabId"]),
    },
    {
      name: "browser_snapshot",
      description: "Read a bounded DOM snapshot of a session-owned Browser tab without page evaluation.",
      inputSchema: objectSchema(tabIdProperty(), ["tabId"]),
    },
    {
      name: "browser_click",
      description: "Click one observed DOM reference in a session-owned Browser tab.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        ref: { type: "string", minLength: 1 },
      }, ["tabId", "ref"]),
    },
    {
      name: "browser_type",
      description: "Type text into one observed editable DOM reference in a session-owned Browser tab.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        ref: { type: "string", minLength: 1 },
        value: { type: "string" },
      }, ["tabId", "ref", "value"]),
    },
    {
      name: "browser_dom_action",
      description: "Perform a bounded click, typing, scrolling, keypress, or media-download action using a DOM reference.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        action: { type: "string", enum: DOM_ACTIONS },
        ref: { type: "string" },
        value: { type: "string" },
        deltaY: { type: "number" },
        key: { type: "string" },
        text: { type: "string" },
        promptText: { type: "string" },
      }, ["tabId", "action"]),
    },
    {
      name: "browser_locator_action",
      description: "Use a bounded Playwright-style locator action without page evaluation.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        ...selectorProperty(),
        action: { type: "string", enum: LOCATOR_ACTIONS },
        value: { type: "string" },
        key: { type: "string" },
        name: { type: "string" },
        timeoutMs: { type: "integer", minimum: 1, maximum: 60_000 },
      }, ["tabId", "action"]),
    },
    {
      name: "browser_tab_content",
      description: "Read the text content of a session-owned Browser tab.",
      inputSchema: objectSchema(tabIdProperty(), ["tabId"]),
    },
    {
      name: "browser_export_content",
      description: "Export bounded text or document content from a session-owned Browser tab.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        type: { type: "string", enum: ["text", "markdown", "html"] },
      }, ["tabId"]),
    },
    {
      name: "browser_finalize_tabs",
      description: "Close temporary Browser tabs owned by this Local Agent session.",
      inputSchema: objectSchema({
        tabIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 100 },
      }, ["tabIds"]),
    },
    {
      name: "browser_mark_tab",
      description: "Mark a session-owned tab as a deliverable or handoff tab.",
      inputSchema: objectSchema({
        ...tabIdProperty(),
        deliverable: { type: "boolean", enum: [true] },
        handoff: { type: "boolean", enum: [true] },
      }, ["tabId"]),
    },
  ];
  if (
    definitions.length !== LOCAL_AGENT_BROWSER_MCP_TOOL_NAMES.length
    || definitions.some((tool, index) => tool.name !== LOCAL_AGENT_BROWSER_MCP_TOOL_NAMES[index])
  ) {
    throw new Error("browser MCP tool definitions drifted from the shared contract");
  }
  return definitions;
}

const TOOL_METHODS = Object.freeze({
  browser_get_info: "getInfo",
  browser_list_tabs: "listTabs",
  browser_open_tab: "createTab",
  browser_navigate: "navigate",
  browser_navigate_history: "navigateHistory",
  browser_reload: "reload",
  browser_screenshot: "screenshot",
  browser_dom_observe: "domObserve",
  browser_snapshot: "domSnapshot",
  browser_click: "domAction",
  browser_type: "domAction",
  browser_dom_action: "domAction",
  browser_locator_action: "locatorAction",
  browser_tab_content: "tabContent",
  browser_export_content: "exportContent",
  browser_finalize_tabs: "finalizeTabs",
  browser_mark_tab: "markTab",
});

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function normalizeContext(context) {
  const source = requireObject(context, "browser MCP context");
  const normalized = {};
  for (const key of REQUIRED_CONTEXT_KEYS) {
    normalized[key] = requireString(source[key], `browser MCP context.${key}`);
  }
  if (normalized.backend !== "in-app") {
    throw new Error("browser MCP backend must be in-app");
  }
  return normalized;
}

function normalizeRpcEnvironment(environment) {
  const source = requireObject(environment, "browser RPC environment");
  return {
    endpoint: requireString(source[RPC_ENVIRONMENT_KEYS.endpoint] ?? source.endpoint, "browser RPC endpoint"),
    bootstrap: requireString(source[RPC_ENVIRONMENT_KEYS.bootstrap] ?? source.bootstrap, "browser RPC bootstrap"),
  };
}

/**
 * Build the ACP stdio MCP descriptor. The descriptor deliberately carries only
 * the Browser RPC capability and the scoped execution context; it never copies
 * the parent process environment or exposes a Node/REPL entry point.
 */
export function buildLocalAgentBrowserMcpServer(options = {}) {
  const rpc = normalizeRpcEnvironment(options.rpcEnvironment ?? options.environment);
  const context = normalizeContext(options.context);
  const command = requireString(options.command ?? options.execPath ?? process.execPath, "browser MCP command");
  const bridgePath = requireString(
    options.bridgePath ?? fileURLToPath(new URL("./browser-mcp-stdio.mjs", import.meta.url)),
    "browser MCP bridge path",
  );
  const env = [
    { name: RPC_ENVIRONMENT_KEYS.endpoint, value: rpc.endpoint },
    { name: RPC_ENVIRONMENT_KEYS.bootstrap, value: rpc.bootstrap },
    ...REQUIRED_CONTEXT_KEYS.map((key) => ({
      name: CONTEXT_ENVIRONMENT_KEYS[key],
      value: context[key],
    })),
  ];
  if (options.electronRuntime === true) {
    env.push({ name: "ELECTRON_RUN_AS_NODE", value: "1" });
  }
  return {
    name: LOCAL_AGENT_BROWSER_MCP_NAME,
    command,
    args: [bridgePath],
    env,
  };
}

function assertAllowedAction(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} is unsupported`);
}

function normalizeToolArguments(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
}

function validateToolArguments(name, input) {
  const args = normalizeToolArguments(input);
  if (name === "browser_click") return { ...args, action: "click" };
  if (name === "browser_type") return { ...args, action: "type" };
  if (name === "browser_dom_action") {
    assertAllowedAction(args.action, DOM_ACTIONS, "browser DOM action");
  }
  if (name === "browser_locator_action") {
    assertAllowedAction(args.action, LOCATOR_ACTIONS, "browser locator action");
    if (!args.selector && !args.css && !args.role && !args.testId && !args.text && !args.label && !args.placeholder) {
      throw new TypeError("browser locator selector is required");
    }
  }
  if (name === "browser_navigate_history") {
    assertAllowedAction(args.direction, ["back", "forward"], "browser history direction");
  }
  if (name === "browser_screenshot" && args.format !== undefined) {
    assertAllowedAction(args.format, ["jpeg", "png"], "browser screenshot format");
  }
  if (name === "browser_export_content" && args.type !== undefined) {
    assertAllowedAction(args.type, ["text", "markdown", "html"], "browser export type");
  }
  if (name === "browser_mark_tab" && args.deliverable !== true && args.handoff !== true) {
    throw new TypeError("browser_mark_tab requires deliverable or handoff");
  }
  return args;
}

function sanitizeBrowserInfo(result, toolNames) {
  const source = result && typeof result === "object" ? result : {};
  return {
    protocolVersion: Number(source.protocolVersion) || 1,
    backend: "in-app",
    browserId: String(source.browserId ?? "in-app"),
    capabilities: [...MCP_BROWSER_CAPABILITIES],
    tools: [...toolNames],
  };
}

function toMcpContent(result) {
  if (result && typeof result === "object" && typeof result.image === "string") {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/i.exec(result.image);
    if (match) {
      const { image: _image, ...metadata } = result;
      return [
        { type: "image", data: match[2], mimeType: `image/${match[1].toLowerCase()}` },
        { type: "text", text: JSON.stringify(metadata) },
      ];
    }
  }
  return [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? null) }];
}

export function createLocalAgentBrowserMcpToolHandler(options = {}) {
  if (typeof options.request !== "function") throw new TypeError("browser MCP request transport is required");
  const definitions = options.definitions ?? createLocalAgentBrowserMcpToolDefinitions();
  const definitionNames = new Set(definitions.map((tool) => tool.name));
  return {
    definitions,
    async call(name, input) {
      if (typeof name !== "string" || !definitionNames.has(name) || !TOOL_METHODS[name]) {
        throw new Error(`Unknown browser MCP tool: ${name}`);
      }
      const params = validateToolArguments(name, input);
      const rawResult = await options.request(TOOL_METHODS[name], params);
      const result = name === "browser_get_info"
        ? sanitizeBrowserInfo(rawResult, definitionNames)
        : rawResult;
      return {
        content: toMcpContent(result),
        structuredContent: result && typeof result === "object" ? result : { value: result ?? null },
      };
    },
  };
}

export function browserMcpEnvironmentKeys() {
  return {
    rpc: { ...RPC_ENVIRONMENT_KEYS },
    context: { ...CONTEXT_ENVIRONMENT_KEYS },
  };
}
