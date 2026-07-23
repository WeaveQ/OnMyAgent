/**
 * Provider registry for Personal Local Agent.
 *
 * Extracted from main.mjs to centralize provider metadata.
 * Both main.mjs (legacy path) and the runtime kernel import from here.
 */

export const PERSONAL_LOCAL_AGENT_PROVIDERS = {
  opencode: {
    id: "opencode",
    name: "OpenCode CLI",
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
    name: "Claude Code CLI",
    executable: "claude",
    versionArgs: ["--version"],
    modelMode: "flag",
  },
  openclaw: {
    id: "openclaw",
    name: "OpenClaw CLI",
    executable: "openclaw",
    versionArgs: ["--version"],
    modelMode: "none",
  },
  hermes: {
    id: "hermes",
    name: "Hermes CLI",
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
    warning: "OpenCode exposes `opencode acp`; use the ACP adapter path for Local Agent sessions, not the SDK session path.",
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
    warning: "Codex uses the managed @agentclientprotocol/codex-acp bridge for Local Agent sessions; direct app-server is a fallback only.",
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
    warning: "Claude Code uses the managed @agentclientprotocol/claude-agent-acp bridge for Local Agent sessions; direct stream-json is a fallback only.",
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
    warning: "OpenClaw exposes `openclaw acp`; use the ACP bridge path for Local Agent sessions, not the Gateway JSON agent path.",
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
    { id: "opencode", name: "OpenCode CLI", provider: "opencode", executablePath: "opencode" },
    { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
    { id: "claude", name: "Claude Code CLI", provider: "claude", executablePath: "claude" },
    { id: "openclaw", name: "OpenClaw CLI", provider: "openclaw", executablePath: "openclaw" },
    { id: "hermes", name: "Hermes CLI", provider: "hermes", executablePath: "hermes" },
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
  const modelOptions = Array.isArray(input?.modelOptions)
    ? input.modelOptions
        .map((option) => {
          if (option && typeof option === "object") {
            const optId = String(option.id ?? option.value ?? option.name ?? "").trim();
            if (!optId) return null;
            const label = String(option.label ?? option.name ?? optId).trim() || optId;
            return { id: optId, label };
          }
          const optId = String(option ?? "").trim();
          return optId ? { id: optId, label: optId } : null;
        })
        .filter(Boolean)
    : [];
  const defaultModel = typeof input?.defaultModel === "string" && input.defaultModel.trim()
    ? input.defaultModel.trim()
    : null;
  const result = { id, name, provider, executablePath, model, customArgs, modelOptions, defaultModel };
  if (provider === "custom") {
    const connectionType = input?.connectionType === "cli" ? "cli" : "raw";
    const acpArgs = Array.isArray(input?.acpArgs)
      ? input.acpArgs.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    const supportsAcp = connectionType === "cli" ? input?.supportsAcp !== false : false;
    result.connectionType = connectionType;
    result.acpArgs = acpArgs;
    result.supportsAcp = supportsAcp;
    result.supportsStreaming = Boolean(input?.supportsStreaming);
    result.supportsResume = Boolean(input?.supportsResume);
    result.supportsApproval = Boolean(input?.supportsApproval);
    result.supportsModelOverride = Boolean(input?.supportsModelOverride);
    result.supportsPermissionAutoApprove = Boolean(input?.supportsPermissionAutoApprove);
    result.authRequired = Boolean(input?.authRequired);
    if (input?.env && typeof input.env === "object" && !Array.isArray(input.env)) result.env = input.env;
    if (typeof input?.description === "string") result.description = input.description;
  }
  return result;
}

export function personalAgentCapability(provider, status, extra = {}) {
  const base = PERSONAL_LOCAL_AGENT_CAPABILITIES[provider] ?? PERSONAL_LOCAL_AGENT_CAPABILITIES.custom;
  const customAgent = extra.customAgent && typeof extra.customAgent === "object" ? extra.customAgent : null;
  const customIsAcp = customAgent && customAgent.connectionType === "cli" && customAgent.supportsAcp !== false;
  const supportsAcp = extra.supportsAcp ?? (customIsAcp ? true : base.supportsAcp ?? false);
  const supportsStreaming = customAgent ? Boolean(customAgent.supportsStreaming) : base.supportsStreaming;
  const supportsResume = customAgent ? Boolean(customAgent.supportsResume) : base.supportsResume;
  const supportsModelOverride = customAgent ? Boolean(customAgent.supportsModelOverride) : base.supportsModelOverride;
  const supportsPermissionAutoApprove = customAgent ? Boolean(customAgent.supportsPermissionAutoApprove) : base.supportsPermissionAutoApprove;
  const supportsApproval = customAgent ? Boolean(customAgent.supportsApproval) : (base.supportsApproval ?? false);
  const authRequired = customAgent ? Boolean(customAgent.authRequired) : Boolean(extra.authRequired);
  // R1/R2: installed means the CLI is present — online, offline, or needs_auth.
  // Only missing/unknown mean "not installed".
  const installed =
    status === "online" || status === "offline" || status === "needs_auth";
  return {
    installed,
    authenticated: extra.authenticated ?? "unknown",
    minVersionOk: extra.minVersionOk ?? status === "online",
    supportsStreaming,
    supportsResume,
    supportsModelOverride,
    supportsPermissionAutoApprove,
    supportsApproval,
    supportsAcp,
    authRequired,
    targetKind: customAgent && customIsAcp ? "model" : base.targetKind,
    smokePrompt: base.smokePrompt,
    warning: extra.warning ?? base.warning,
  };
}

export function personalLocalAgentConnectionMode(provider, extra = null) {
  if (provider === "opencode") return "OpenCode ACP session";
  if (provider === "codex") return "Codex ACP session";
  if (provider === "claude") return "Claude Code ACP session";
  if (provider === "openclaw") return "OpenClaw ACP session";
  if (provider === "hermes") return "Hermes ACP session";
  // CLI ACP agents (the discoverable catalog like Gemini/Kimi/Goose and the
  // user's own custom agents) keep provider "custom" for the connection layer;
  // surface their real identity (agent name) in the connection mode instead of
  // the collapsed "Custom" marker, mirroring AionUi's per-agent backend label.
  if (provider === "custom" && extra && extra.connectionType === "cli" && extra.supportsAcp !== false) {
    const name = extra && typeof extra.name === "string" && extra.name.trim() ? extra.name.trim() : null;
    return `${name ?? "Custom"} ACP session`;
  }
  return "Custom command";
}
