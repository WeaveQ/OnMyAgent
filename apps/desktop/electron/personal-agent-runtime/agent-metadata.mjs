import { PERSONAL_LOCAL_AGENT_PROVIDERS, personalLocalAgentConnectionMode } from "./provider-registry.mjs";

const ACP_SESSION_CAPABILITY = Object.freeze({});

// Stable Local Agent status model used by the management UI.
const FIVE_STATE_STATUSES = new Set(["online", "needs_auth", "offline", "missing", "unknown"]);

export function normalizeAgentStatus(agent) {
  const raw = String(agent?.status ?? "").trim();
  // Authoritative explicit states pass straight through.
  if (raw === "online" || raw === "needs_auth" || raw === "missing") return raw;
  const code = String(agent?.errorInfo?.code ?? "").trim();
  const capability = agent?.capability && typeof agent.capability === "object" ? agent.capability : null;
  const errorText = String(agent?.error ?? agent?.errorInfo?.message ?? "").toLowerCase();
  // Missing binary / not installed wins over a generic offline/error status.
  if (code === "missing_binary" || capability?.installed === false || /not found|no such file|command not found|未配置|命令不可用|not installed/.test(errorText)) {
    return "missing";
  }
  // Authentication / login required.
  if (code === "auth_required" || capability?.authenticated === false || /auth|login|unauthorized|forbidden|api key|credential|认证|登录|未授权/.test(errorText)) {
    return "needs_auth";
  }
  if (raw === "offline" || raw === "error") return "offline";
  if (raw === "unknown") return "unknown";
  if (!raw) return "unknown";
  return "offline";
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function envList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = String(item.name ?? item.key ?? "").trim();
      if (!name) return null;
      return {
        name,
        value: String(item.value ?? ""),
        description: item.description ? String(item.description) : undefined,
      };
    })
    .filter(Boolean);
}

function optionLabel(option) {
  const id = String(option?.id ?? "").trim();
  const label = String(option?.label ?? id).trim();
  if (!id) return null;
  return { id, label };
}

function normalizeCapability(agent) {
  const capability = agent?.capability && typeof agent.capability === "object" ? agent.capability : {};
  return {
    installed: Boolean(capability.installed),
    authenticated: capability.authenticated === true || capability.authenticated === false ? capability.authenticated : "unknown",
    minVersionOk: capability.minVersionOk !== false,
    supportsStreaming: Boolean(capability.supportsStreaming),
    supportsResume: Boolean(capability.supportsResume),
    supportsModelOverride: Boolean(capability.supportsModelOverride),
    supportsPermissionAutoApprove: Boolean(capability.supportsPermissionAutoApprove),
    supportsApproval: Boolean(capability.supportsApproval),
    supportsAcp: Boolean(capability.supportsAcp),
    targetKind: capability.targetKind ?? "command",
    smokePrompt: capability.smokePrompt ?? "",
    warning: capability.warning ?? null,
  };
}


// Mirror AionCore's `derive_models_from_config_options`: some CLIs (notably
// claude-agent-acp) never publish `available_models` on session/update but do
// expose a `model` select inside `config_options`. When that happens, expand
// the select options into a proper models catalog so the UI's model dropdown
// gets the same choices AionUi surfaces.
function deriveModelsFromConfigOptions(configOptions) {
  if (!Array.isArray(configOptions) || !configOptions.length) return [];
  const select = configOptions.find((option) => {
    if (!option || typeof option !== "object") return false;
    const type = String(option.type ?? option.kind ?? "").toLowerCase();
    if (type && type !== "select") return false;
    const category = String(option.category ?? "").toLowerCase();
    const id = String(option.id ?? option.name ?? "").toLowerCase();
    return category === "model" || id === "model" || id === "models";
  });
  if (!select) return [];
  const rawOptions = Array.isArray(select.options) ? select.options : [];
  const flattened = rawOptions.flatMap((entry) => {
    if (Array.isArray(entry?.options)) return entry.options;
    return [entry];
  });
  return flattened
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        const id = String(entry ?? "").trim();
        return id ? { id, label: id } : null;
      }
      const id = String(entry.value ?? entry.id ?? "").trim();
      if (!id) return null;
      const label = String(entry.label ?? entry.name ?? id).trim() || id;
      return { id, label };
    })
    .filter(Boolean);
}

function mergeModelCatalogs(...lists) {
  const seen = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      const label = String(item.label ?? item.name ?? id).trim() || id;
      seen.set(id, { id, label });
    }
  }
  return [...seen.values()];
}

function sessionCapabilities(capability) {
  return {
    fork: null,
    resume: capability.supportsResume ? ACP_SESSION_CAPABILITY : null,
    list: null,
    close: ACP_SESSION_CAPABILITY,
  };
}

function availableModels(agent, capability) {
  if (!capability.supportsModelOverride) return [];
  return Array.isArray(agent?.modelOptions) ? agent.modelOptions.map(optionLabel).filter(Boolean) : [];
}

function availableCommands(agent) {
  const commands = Array.isArray(agent?.availableCommands) ? agent.availableCommands : [];
  return commands.filter((item) => item && typeof item === "object");
}

export function personalAgentMetadataFromAgent(agent) {
  const provider = String(agent?.provider ?? "custom").trim() || "custom";
  const providerSpec = PERSONAL_LOCAL_AGENT_PROVIDERS[provider] ?? PERSONAL_LOCAL_AGENT_PROVIDERS.custom;
  const capability = normalizeCapability(agent);
  const models = availableModels(agent, capability);
  const commands = availableCommands(agent);
  const command = String(agent?.executablePath ?? providerSpec.executable ?? "").trim();
  const args = stringList(agent?.customArgs);
  const env = envList(agent?.env);
  const connectionMode = agent?.connectionMode ?? personalLocalAgentConnectionMode(provider, agent ?? null);
  const enabled = agent?.enabled !== false;
  const status = normalizeAgentStatus(agent);
  const available = enabled && status === "online";
  const sourceInfo = agent?.agent_source_info && typeof agent.agent_source_info === "object" ? agent.agent_source_info : {};
  const managedAcpTool = agent?.managedAcpTool && typeof agent.managedAcpTool === "object" ? agent.managedAcpTool : null;
  const agentCapabilities = {
    loadSession: capability.supportsResume,
    promptCapabilities: { image: false, audio: false, embeddedContext: true },
    mcpCapabilities: { stdio: false, http: false, sse: false },
    sessionCapabilities: sessionCapabilities(capability),
    _meta: {
      connectionMode,
      targetKind: capability.targetKind,
      supportsStreaming: capability.supportsStreaming,
      supportsApproval: capability.supportsApproval,
      supportsAcp: capability.supportsAcp,
      supportsPermissionAutoApprove: capability.supportsPermissionAutoApprove,
      supportsModelOverride: capability.supportsModelOverride,
      warning: capability.warning,
    },
  };

  return {
    id: String(agent?.id ?? provider).trim() || provider,
    name: String(agent?.name ?? providerSpec.name ?? provider).trim() || provider,
    backend: provider,
    agent_type: capability.supportsAcp && /\bACP\b/i.test(connectionMode) ? "acp" : "local-harness",
    agent_source: String(agent?.agent_source ?? agent?.source ?? "builtin").trim() || "builtin",
    agent_source_info: {
      binary_name: providerSpec.executable || command || provider,
      bridge_binary: String(sourceInfo.bridge_binary ?? managedAcpTool?.binPath ?? agent?.bridgeBinary ?? "").trim() || null,
      hub_package_id: String(sourceInfo.hub_package_id ?? managedAcpTool?.packageName ?? agent?.hubPackageId ?? "").trim() || null,
      package_version: String(sourceInfo.package_version ?? managedAcpTool?.version ?? agent?.packageVersion ?? "").trim() || null,
      install_root: String(sourceInfo.install_root ?? managedAcpTool?.root ?? agent?.installRoot ?? "").trim() || null,
      version: agent?.version ?? null,
    },
    enabled,
    available,
    command,
    args,
    env,
    native_skills_dirs: stringList(agent?.nativeSkillsDirs ?? agent?.native_skills_dirs),
    behavior_policy: {
      permission_mode: agent?.behaviorPolicy?.permissionMode ?? agent?.behavior_policy?.permission_mode ?? "ask",
      yolo_mode_id: agent?.behaviorPolicy?.yoloModeId ?? agent?.behavior_policy?.yolo_mode_id ?? null,
      auto_approve_readonly: Boolean(agent?.behaviorPolicy?.autoApproveReadonly ?? agent?.behavior_policy?.auto_approve_readonly),
    },
    connectionMode,
    status,
    error: agent?.error ?? null,
    handshake: (() => {
      const meta = agent?.handshake && typeof agent.handshake === "object" ? agent.handshake : {};
      const configOptions = Array.isArray(meta.config_options) ? meta.config_options : [];
      const sessionMeta = agent?.sessionMetadata && typeof agent.sessionMetadata === "object" ? agent.sessionMetadata : null;
      // Prefer live ACP session metadata when the bridge exposes models,
      // config options, modes, or commands.
      const mergedConfigOptions = sessionMeta?.configOptions && Array.isArray(sessionMeta.configOptions)
        ? sessionMeta.configOptions
        : configOptions;
      const liveModels = sessionMeta?.availableModels && Array.isArray(sessionMeta.availableModels)
        ? sessionMeta.availableModels.map((m) => ({ id: String(m.id ?? "").trim(), label: String(m.name ?? m.label ?? m.id ?? "").trim() })).filter((m) => m.id)
        : [];
      // Fall back to `config_options[model]` when the CLI does not publish a
      // dedicated `availableModels` payload (claude-agent-acp behavior).
      const derivedModels = deriveModelsFromConfigOptions(mergedConfigOptions);
      const mergedModels = mergeModelCatalogs(liveModels, derivedModels, models);
      const mergedModes = sessionMeta?.modes ?? meta.available_modes ?? null;
      const mergedCommands = sessionMeta?.availableCommands && Array.isArray(sessionMeta.availableCommands)
        ? sessionMeta.availableCommands
        : commands;
      return {
        agent_capabilities: agentCapabilities,
        auth_methods: [],
        config_options: mergedConfigOptions,
        available_modes: mergedModes,
        available_models: mergedModels,
        available_commands: mergedCommands,
        session_metadata: sessionMeta ?? null,
      };
    })(),
    capability,
  };
}

export function personalAgentMetadataList(agents) {
  return (Array.isArray(agents) ? agents : []).map((agent) => personalAgentMetadataFromAgent(agent));
}

export function personalAgentAvailableMetadataList(agents) {
  return personalAgentMetadataList(agents).filter((agent) => agent.enabled && agent.available);
}
