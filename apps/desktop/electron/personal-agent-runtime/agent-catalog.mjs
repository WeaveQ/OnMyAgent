// Agent catalog for the personal-agent runtime.
//
// Owns listAgents (built-in + custom + extension + discoverable), custom agent
// CRUD, metadata/ACP wrappers, and the ACP config-options surface. The runtime
// passes in the closure-bound dependencies (legacy layer, stores, session
// caches) so this file stays independent of the big createPersonalAgentRuntime
// factory.

import {
  normalizeAgentStatus,
  personalAgentAvailableMetadataList,
  personalAgentMetadataList,
} from "./agent-metadata.mjs";
import {
  discoverableAgentDrafts,
  mergeCatalogNativeSkillDirs,
} from "./detect-local-agents.mjs";
import { probeAcpCommand } from "./acp-probe.mjs";
import {
  createCustomAgent,
  deleteCustomAgent,
  listCustomAgents,
  updateCustomAgent,
} from "./custom-agent-store.mjs";
import { adapterToCustomAgent, loadExtensions, setExtensionEnabled } from "./extension-registry.mjs";
import { readAgentHandshakeCache } from "./agent-handshake-cache.mjs";
import { readSession } from "./session-store.mjs";
import { listAgentProcesses } from "./process-registry.mjs";
import {
  personalAgentCapability,
  personalLocalAgentConnectionMode,
} from "./provider-registry.mjs";

/**
 * @param {object} deps
 * @param {object} deps.legacy
 * @param {string[]} deps.bundledExtensionRoots
 */
export function createAgentCatalog(deps) {
  const { legacy, bundledExtensionRoots } = deps;

  async function loadExtensionAdapters() {
    try {
      const { enabledAdapters } = await loadExtensions({ bundledRoots: bundledExtensionRoots });
      return enabledAdapters.map((adapter) => adapterToCustomAgent(adapter));
    } catch {
      return [];
    }
  }

  // Two-step ACP probe result → { status, error, step } for a CLI+ACP agent.
  // Entries whose binary exists but fail `initialize` (unsupported CLI) or
  // `session/new` (未登陆) do not surface as `online` in the 本地 picker.
  async function probeCliAcpAgent(command, acpArgs, workspaceRoot) {
    try {
      const probe = await probeAcpCommand({
        command,
        args: Array.isArray(acpArgs) ? acpArgs : [],
        cwd: workspaceRoot || process.cwd(),
        timeoutMs: 8_000,
      });
      if (probe.ok) return { status: "online", error: null, step: probe.step };
      if (probe.step === "needs_auth") return { status: "needs_auth", error: probe.error ?? "authentication required", step: probe.step };
      if (probe.step === "fail_cli") return { status: "missing", error: probe.error ?? null, step: probe.step };
      return { status: "offline", error: probe.error ?? "ACP handshake failed", step: probe.step };
    } catch (probeError) {
      const message = probeError instanceof Error ? probeError.message : String(probeError);
      return { status: "offline", error: message, step: "fail_acp" };
    }
  }

  // Resolve the discoverable catalog into agent cards for the management page.
  async function buildDiscoverableAgents(workspaceRoot, registeredAgents, includeModels) {
    const existingIds = new Set();
    for (const agent of Array.isArray(registeredAgents) ? registeredAgents : []) {
      if (agent?.id) existingIds.add(String(agent.id).toLowerCase());
      if (agent?.provider) existingIds.add(String(agent.provider).toLowerCase());
      const exe = String(agent?.executablePath ?? "").split(/[\\/]/).pop();
      if (exe) existingIds.add(exe.toLowerCase());
    }
    const drafts = discoverableAgentDrafts().filter(
      (draft) => !existingIds.has(String(draft.id).toLowerCase()),
    );
    return Promise.all(
      drafts.map(async (draft) => {
        let detected = null;
        try {
          detected = await legacy.detectAgent(
            {
              id: draft.id,
              name: draft.name,
              provider: "custom",
              executablePath: draft.executablePath,
              connectionType: "cli",
              supportsAcp: true,
              acpArgs: draft.acpArgs,
            },
            workspaceRoot,
            { includeModels },
          );
        } catch {
          detected = null;
        }
        const base = detected && typeof detected === "object" ? detected : {};
        // Not "online" is treated as not-installed: surface "missing" cleanly.
        const versionOk = base.status === "online";
        let effectiveStatus = versionOk ? "online" : "missing";
        let effectiveError = versionOk ? (base.error ?? null) : null;
        let acpProbeStep = null;
        if (versionOk) {
          const probeResult = await probeCliAcpAgent(draft.executablePath, draft.acpArgs, workspaceRoot);
          effectiveStatus = probeResult.status;
          effectiveError = probeResult.error;
          acpProbeStep = probeResult.step;
        }
        return {
          ...base,
          id: draft.id,
          name: draft.name,
          provider: "custom",
          connectionType: "cli",
          supportsAcp: true,
          acpArgs: draft.acpArgs,
          nativeSkillsDirs: draft.nativeSkillsDirs,
          discoverable: true,
          status: effectiveStatus,
          error: effectiveError,
          acpProbeStep,
        };
      }),
    );
  }

  // Merge handshake-advertised models into agent.modelOptions.
  function mergeHandshakeModelsIntoOptions(existingOptions, handshake) {
    const base = Array.isArray(existingOptions) ? existingOptions.filter((o) => o && typeof o.id === "string" && o.id.trim()) : [];
    const seen = new Set(base.map((o) => o.id.trim().toLowerCase()));
    const merged = [...base];
    const configOptions = Array.isArray(handshake?.config_options) ? handshake.config_options : [];
    for (const item of configOptions) {
      if (!item || typeof item !== "object") continue;
      const category = typeof item.category === "string" ? item.category : "";
      const itemId = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
      if (category !== "model" && !/model/i.test(itemId)) continue;
      const opts = Array.isArray(item.options) ? item.options : [];
      for (const opt of opts) {
        if (!opt || typeof opt !== "object") continue;
        const id = String(opt.value ?? opt.id ?? opt.name ?? "").trim();
        if (!id || seen.has(id.toLowerCase())) continue;
        seen.add(id.toLowerCase());
        merged.push({ id, label: String(opt.name ?? opt.label ?? opt.value ?? id).trim() || id });
      }
    }
    const availableModels = Array.isArray(handshake?.available_models) ? handshake.available_models : [];
    for (const item of availableModels) {
      if (item && typeof item === "object") {
        const id = String(item.id ?? item.modelId ?? item.model_id ?? item.name ?? "").trim();
        if (!id || seen.has(id.toLowerCase())) continue;
        seen.add(id.toLowerCase());
        merged.push({ id, label: String(item.label ?? item.name ?? item.displayName ?? id).trim() || id });
      } else if (typeof item === "string" && item.trim()) {
        const id = item.trim();
        if (!id || seen.has(id.toLowerCase())) continue;
        seen.add(id.toLowerCase());
        merged.push({ id, label: id });
      }
    }
    return merged;
  }

  async function listAgents(input = {}) {
    const result = await legacy.listAgents(input);
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const customAgentsRaw = workspaceRoot ? await listCustomAgents(workspaceRoot) : [];
    const customAgents = await Promise.all(customAgentsRaw.map(async (agent) => {
      const isCliAcp = agent?.connectionType === "cli" && agent?.supportsAcp !== false;
      let status = agent?.status === "offline" ? "offline" : "online";
      let error = agent?.error ?? null;
      let acpProbeStep = agent?.acpProbeStep ?? null;
      let version = agent?.version ?? null;
      if (agent?.executablePath) {
        try {
          const detected = await legacy.detectAgent(agent, workspaceRoot, { includeModels: false });
          if (detected && typeof detected === "object") {
            const detectedVersion = String(detected.version ?? "").trim();
            if (detectedVersion) version = detectedVersion.split("\n")[0].trim();
            if (!isCliAcp && detected.status) {
              status = detected.status;
              error = detected.error ?? null;
            }
          }
        } catch {
          // keep stored status / null version
        }
      }
      if (isCliAcp && agent?.executablePath) {
        const probeResult = await probeCliAcpAgent(agent.executablePath, agent.acpArgs, workspaceRoot);
        status = probeResult.status;
        error = probeResult.error;
        acpProbeStep = probeResult.step;
      }
      const capability = personalAgentCapability(agent.provider, status, { customAgent: agent });
      const connectionMode = personalLocalAgentConnectionMode(agent.provider, agent);
      const nativeSkillsDirs = mergeCatalogNativeSkillDirs(agent);
      return {
        ...agent,
        version,
        nativeSkillsDirs,
        capability,
        connectionMode,
        discoverable: false,
        status,
        error,
        acpProbeStep,
        agent_source: agent.agent_source ?? agent.agentSource ?? "custom",
      };
    }));
    const extensionAgents = await loadExtensionAdapters();
    const registeredAgents = [...(Array.isArray(result?.agents) ? result.agents : []), ...customAgents, ...extensionAgents];
    const discoverableAgents = input.includeDiscoverable
      ? await buildDiscoverableAgents(workspaceRoot, registeredAgents, input.includeModels !== false)
      : [];
    const agents = [...registeredAgents, ...discoverableAgents];
    const accessibleRoots = Array.isArray(input.accessibleWorkspaceRoots)
      ? input.accessibleWorkspaceRoots.map((r) => String(r ?? "").trim()).filter(Boolean)
      : [];
    const hydratedAgents = workspaceRoot
      ? await Promise.all(agents.map(async (agent) => {
          const provider = String(agent?.provider ?? "").trim();
          const agentId = String(agent?.id ?? provider).trim();
          if (!provider || !agentId) return agent;
          try {
            const candidateProviders = [provider];
            const backend = String(agent?.backend ?? "").trim();
            if (backend && !candidateProviders.includes(backend)) candidateProviders.push(backend);
            if (!candidateProviders.includes("opencode")) candidateProviders.push("opencode");
            const candidateRoots = [workspaceRoot, ...accessibleRoots.filter((r) => r !== workspaceRoot)];
            let stored = null;
            for (const root of candidateRoots) {
              for (const candidate of candidateProviders) {
                stored = await readSession(root, candidate, agentId);
                if (stored?.sessionMetadata && typeof stored.sessionMetadata === "object") break;
              }
              if (stored?.sessionMetadata && typeof stored.sessionMetadata === "object") break;
            }
            if (!stored?.sessionMetadata || typeof stored.sessionMetadata !== "object") {
              for (const candidate of candidateProviders) {
                const cached = await readAgentHandshakeCache(candidate, agentId);
                if (cached?.sessionMetadata && typeof cached.sessionMetadata === "object") {
                  stored = cached;
                  break;
                }
              }
            }
            const meta = stored?.sessionMetadata;
            if (!meta || typeof meta !== "object") return agent;
            const nextAvailableCommands = Array.isArray(meta.availableCommands) && meta.availableCommands.length
              ? meta.availableCommands
              : (Array.isArray(agent?.availableCommands) ? agent.availableCommands : []);
            const handshake = { ...(agent.handshake ?? {}) };
            if (Array.isArray(meta.configOptions) && meta.configOptions.length && !Array.isArray(handshake.config_options)) {
              handshake.config_options = meta.configOptions;
            }
            if (Array.isArray(meta.availableModels) && meta.availableModels.length && !(Array.isArray(handshake.available_models) && handshake.available_models.length)) {
              handshake.available_models = meta.availableModels;
            }
            if (meta.currentModelId && !handshake.current_model_id) {
              handshake.current_model_id = meta.currentModelId;
            }
            const hydratedModelOptions = mergeHandshakeModelsIntoOptions(agent.modelOptions, handshake);
            return { ...agent, handshake, sessionMetadata: meta, availableCommands: nextAvailableCommands, modelOptions: hydratedModelOptions };
          } catch {
            return agent;
          }
        }))
      : agents;
    const normalizedAgents = hydratedAgents.map((agent) => {
      const status = normalizeAgentStatus(agent);
      if (status === agent?.status) return agent;
      const installed = status === "online" || status === "offline" || status === "needs_auth";
      const capability =
        agent?.capability && typeof agent.capability === "object"
          ? { ...agent.capability, installed }
          : agent?.capability;
      return { ...agent, status, capability };
    });
    return {
      ...result,
      agents: normalizedAgents,
      metadata: personalAgentMetadataList(normalizedAgents),
    };
  }

  async function createAgent(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return createCustomAgent(workspaceRoot, input.agent ?? input);
  }

  async function updateAgent(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const id = String(input.id ?? input.agent?.id ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!id) throw new Error("agent id is required");
    return updateCustomAgent(workspaceRoot, id, input.agent ?? input);
  }

  async function deleteAgent(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const id = String(input.id ?? input.agentId ?? input.agent?.id ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!id) throw new Error("agent id is required");
    return deleteCustomAgent(workspaceRoot, id);
  }

  async function listAgentMetadata(input = {}) {
    const result = await listAgents(input);
    return { agents: result.metadata };
  }

  async function listAvailableAgentMetadata(input = {}) {
    // Force includeDiscoverable so installed catalog binaries surface in 本地.
    const result = await listAgents({ ...input, includeDiscoverable: true });
    const agents = Array.isArray(result?.agents) ? result.agents : [];
    return { agents: personalAgentAvailableMetadataList(agents) };
  }

  async function acpHealth(input = {}) {
    const result = await listAgents(input);
    const agents = Array.isArray(result.metadata) ? result.metadata : [];
    return {
      ok: true,
      agents: agents.map((agent) => ({
        id: agent.id,
        backend: agent.backend,
        agent_type: agent.agent_type,
        available: agent.available,
        connectionMode: agent.connectionMode,
        error: agent.error ?? null,
      })),
    };
  }

  async function acpConfigOptions(input = {}) {
    const result = await listAgentMetadata(input);
    const agentId = String(input.agent?.id ?? input.agentId ?? "").trim();
    const provider = String(input.agent?.provider ?? input.provider ?? "").trim();
    const agent = result.agents.find((item) => item.id === agentId || item.backend === provider) ?? result.agents[0] ?? null;
    const availableModels = Array.isArray(agent?.handshake?.available_models) ? agent.handshake.available_models : [];
    const configOptions = Array.isArray(agent?.handshake?.config_options) ? agent.handshake.config_options : [];
    const availableCommands = Array.isArray(agent?.handshake?.available_commands) ? agent.handshake.available_commands : [];
    const supportsModelOverride = Boolean(agent?.handshake?.agent_capabilities?._meta?.supportsModelOverride);
    const supportsModeOverride = configOptions.some((option) => /mode/i.test(String(option?.id ?? option?.name ?? "")));
    return {
      configOptions,
      availableModels: supportsModelOverride ? availableModels : [],
      availableCommands,
      capabilities: {
        supportsConfigOptions: configOptions.length > 0,
        supportsModelOverride: supportsModelOverride && availableModels.length > 0,
        supportsModeOverride,
      },
      unsupportedReason: !agent
        ? "agent_not_found"
        : !configOptions.length && !(supportsModelOverride && availableModels.length)
          ? "provider_does_not_expose_config_options"
          : null,
    };
  }

  function listProcesses(input = {}) {
    return { processes: listAgentProcesses(input) };
  }

  return {
    listAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    listAgentMetadata,
    listAvailableAgentMetadata,
    acpHealth,
    acpConfigOptions,
    listProcesses,
    listExtensions: async () => loadExtensions({ bundledRoots: bundledExtensionRoots }),
    setExtensionEnabled: async (input = {}) => setExtensionEnabled(String(input.name ?? input.extensionName ?? "").trim(), input.enabled !== false),
  };
}
