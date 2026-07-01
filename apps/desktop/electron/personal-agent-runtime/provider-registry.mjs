/**
 * Provider registry for Personal Local Agent.
 *
 * Extracted from main.mjs to centralize provider metadata.
 * Both main.mjs (legacy path) and the runtime kernel import from here.
 */

export const PERSONAL_LOCAL_AGENT_PROVIDERS = {
  opencode: {
    id: "opencode",
    name: "OpenCode",
    executable: "opencode",
    versionArgs: ["--version"],
    modelMode: "flag",
  },
  codex: {
    id: "codex",
    name: "Codex CLI",
    executable: "codex",
    versionArgs: ["--version"],
    modelMode: "flag",
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    executable: "claude",
    versionArgs: ["--version"],
    modelMode: "flag",
  },
  openclaw: {
    id: "openclaw",
    name: "OpenClaw",
    executable: "openclaw",
    versionArgs: ["--version"],
    modelMode: "none",
  },
  hermes: {
    id: "hermes",
    name: "Hermes",
    executable: "hermes",
    versionArgs: ["--version"],
    modelMode: "flag",
  },
  custom: {
    id: "custom",
    name: "Custom Agent",
    executable: "",
    versionArgs: ["--version"],
    modelMode: "none",
  },
};

export const PERSONAL_LOCAL_AGENT_CAPABILITIES = {
  opencode: {
    supportsAcp: true,
    supportsApproval: true,
    supportsStreaming: false,
    supportsResume: true,
    supportsModelOverride: true,
    supportsPermissionAutoApprove: true,
    targetKind: "model",
    smokePrompt: "OpenCode 本地 Agent 健康检查：请只回复 OPENCODE_LOCAL_AGENT_OK。",
    warning: "OpenCode exposes `opencode acp`; ACP parity requires the ACP adapter path, not the SDK session path.",
  },
  codex: {
    supportsAcp: true,
    supportsApproval: true,
    supportsStreaming: true,
    supportsResume: true,
    supportsModelOverride: true,
    supportsPermissionAutoApprove: true,
    targetKind: "model",
    smokePrompt: "Codex 本地 Agent 健康检查：请只回复 CODEX_LOCAL_AGENT_OK。",
    warning: "Codex uses the managed @agentclientprotocol/codex-acp bridge for ACP parity; direct app-server is a fallback only.",
  },
  claude: {
    supportsAcp: true,
    supportsApproval: true,
    supportsStreaming: true,
    supportsResume: true,
    supportsModelOverride: true,
    supportsPermissionAutoApprove: true,
    targetKind: "model",
    smokePrompt: "Claude Code 本地 Agent 健康检查：请只回复 CLAUDE_LOCAL_AGENT_OK。",
    warning: "Claude Code uses the managed @agentclientprotocol/claude-agent-acp bridge for ACP parity; direct stream-json is a fallback only.",
  },
  openclaw: {
    supportsAcp: true,
    supportsApproval: false,
    supportsStreaming: true,
    supportsResume: true,
    supportsModelOverride: true,
    supportsPermissionAutoApprove: true,
    targetKind: "agent",
    smokePrompt: "OpenClaw 本地 Agent 健康检查：请只回复 OPENCLAW_AGENT_OK。",
    warning: "OpenClaw exposes `openclaw acp`; ACP parity requires the ACP bridge path, not the Gateway JSON agent path.",
  },
  hermes: {
    supportsAcp: true,
    supportsApproval: true,
    supportsStreaming: true,
    supportsResume: false,
    supportsModelOverride: true,
    supportsPermissionAutoApprove: true,
    targetKind: "model",
    smokePrompt: "Hermes ACP 本地 Agent 健康检查：请只回复 HERMES_ACP_OK。",
    warning: "Hermes ACP resume 暂不稳定，Studio 当前每轮使用新会话。",
  },
  custom: {
    supportsAcp: false,
    supportsApproval: false,
    supportsStreaming: false,
    supportsResume: false,
    supportsModelOverride: false,
    supportsPermissionAutoApprove: false,
    targetKind: "command",
    smokePrompt: "自定义本地 Agent 健康检查：请只回复 CUSTOM_AGENT_OK。",
    warning: null,
  },
};

export function isPersonalLocalAgentProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PERSONAL_LOCAL_AGENT_PROVIDERS, provider);
}

export function defaultPersonalLocalAgents() {
  return [
    { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
    { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
    { id: "claude", name: "Claude Code", provider: "claude", executablePath: "claude" },
    { id: "openclaw", name: "OpenClaw", provider: "openclaw", executablePath: "openclaw" },
    { id: "hermes", name: "Hermes", provider: "hermes", executablePath: "hermes" },
  ];
}

export function normalizePersonalLocalAgent(input) {
  const inputProvider = String(input?.provider ?? "opencode").trim();
  const provider = isPersonalLocalAgentProvider(inputProvider) ? inputProvider : "opencode";
  const providerSpec = PERSONAL_LOCAL_AGENT_PROVIDERS[provider] ?? PERSONAL_LOCAL_AGENT_PROVIDERS.opencode;
  const id = String(input?.id ?? provider).trim() || provider;
  const name = String(input?.name ?? providerSpec.name).trim();
  const executablePath = String(input?.executablePath ?? providerSpec.executable ?? "").trim();
  const model = typeof input?.model === "string" && input.model.trim() ? input.model.trim() : null;
  const customArgs = Array.isArray(input?.customArgs)
    ? input.customArgs.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return { id, name, provider, executablePath, model, customArgs };
}

export function personalAgentCapability(provider, status, extra = {}) {
  const base = PERSONAL_LOCAL_AGENT_CAPABILITIES[provider] ?? PERSONAL_LOCAL_AGENT_CAPABILITIES.custom;
  return {
    installed: status === "online",
    authenticated: extra.authenticated ?? "unknown",
    minVersionOk: extra.minVersionOk ?? status === "online",
    supportsStreaming: base.supportsStreaming,
    supportsResume: base.supportsResume,
    supportsModelOverride: base.supportsModelOverride,
    supportsPermissionAutoApprove: base.supportsPermissionAutoApprove,
    supportsApproval: base.supportsApproval ?? false,
    supportsAcp: extra.supportsAcp ?? base.supportsAcp ?? false,
    targetKind: base.targetKind,
    smokePrompt: base.smokePrompt,
    warning: extra.warning ?? base.warning,
  };
}

export function personalLocalAgentConnectionMode(provider) {
  if (provider === "opencode") return "OpenCode ACP session";
  if (provider === "codex") return "Codex ACP session";
  if (provider === "claude") return "Claude Code ACP session";
  if (provider === "openclaw") return "OpenClaw ACP session";
  if (provider === "hermes") return "Hermes ACP session";
  return "Custom command";
}
