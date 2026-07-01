import { PERSONAL_LOCAL_AGENT_PROVIDERS, personalLocalAgentConnectionMode } from "./provider-registry.mjs";

const ACP_SESSION_CAPABILITY = Object.freeze({});

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
  const connectionMode = agent?.connectionMode ?? personalLocalAgentConnectionMode(provider);
  const enabled = agent?.enabled !== false;
  const available = enabled && agent?.status === "online";
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
    status: agent?.status ?? "offline",
    error: agent?.error ?? null,
    handshake: {
      agent_capabilities: agentCapabilities,
      auth_methods: [],
      config_options: [],
      available_modes: null,
      available_models: models,
      available_commands: commands,
    },
    capability,
  };
}

export function personalAgentMetadataList(agents) {
  return (Array.isArray(agents) ? agents : []).map((agent) => personalAgentMetadataFromAgent(agent));
}

export function personalAgentAvailableMetadataList(agents) {
  return personalAgentMetadataList(agents).filter((agent) => agent.enabled && agent.available);
}
