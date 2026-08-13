// @ts-check

/**
 * Provider capability normalization and execution preflight.
 *
 * This module accepts the live Personal agent metadata shape (or a small
 * wrapper containing it) and returns a bounded, intentionally lossy record.
 * It never forwards raw metadata: paths, commands, environment values,
 * credentials, provider errors, and arbitrary adapter fields are excluded.
 */

const UNKNOWN = "unknown";
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const MAX_MODELS = 100;
const MAX_WARNINGS = 12;
const MAX_SNAPSHOT_WARNING_LENGTH = 400;

/**
 * Task Center owns the delegation control plane.  These are the only
 * provider adapters with a built-in, task-scoped hard switch for native
 * subagents:
 *
 * - Codex: CODEX_CONFIG features.multi_agent(_v2)=false
 * - Claude: ACP disallowedTools Agent/Task
 * - OpenCode: OPENCODE_CONFIG_CONTENT tools.task=false
 *
 * Keep this contract list deliberately secret-free.  Provider metadata may
 * advertise arbitrary capabilities, but it cannot prove an adapter-level
 * isolation switch for an unsupported provider.
 */
const TASK_NATIVE_DELEGATION_ISOLATION_CONTRACTS = Object.freeze({
  codex: Object.freeze({
    strategy: "codex-task-features",
    controls: Object.freeze(["features.multi_agent=false", "features.multi_agent_v2=false"]),
  }),
  claude: Object.freeze({
    strategy: "claude-acp-disallowed-tools",
    controls: Object.freeze(["disallowedTools:Agent", "disallowedTools:Task"]),
  }),
  opencode: Object.freeze({
    strategy: "opencode-task-tool",
    controls: Object.freeze(["tools.task=false"]),
  }),
});

/** @typedef {true | false | "unknown"} TriState */

/**
 * @typedef {Object} ProviderCapabilitySelection
 * @property {string | null} agentId
 * @property {string | null} provider
 * @property {string | null} model
 * @property {TriState} taskMcp
 * @property {TriState} requireTaskMcp
 * @property {TriState} requireModelOverride
 * @property {TriState} fullAllow
 * @property {TriState} requireFullAllow
 */

/**
 * @typedef {Object} ProviderCapabilityRecord
 * @property {number} schemaVersion
 * @property {{id: string | null, name: string | null, status: string}} agent
 * @property {string | null} provider
 * @property {{id: string | null, name: string | null}} providerInfo
 * @property {ProviderCapabilitySelection} requested
 * @property {{agentId: string | null, provider: string | null, model: string | null, modelResolution: string}} effective
 * @property {{revision: string | null, source: string | null, freshness: string, stale: boolean, observedAt: number | null, ageMs: number | null, warning: string | null, models: Array<{id: string, label: string, aliases: string[]}>}} catalog
 * @property {{mcp: TriState, tools: TriState, modelOverride: TriState, approval: TriState, fullAllow: TriState, contextUsage: TriState, nativeCompact: TriState, nativeResume: TriState, streaming: TriState, nativeDelegationIsolated: TriState}} supports
 * @property {{mcp: TriState, tools: TriState, modelOverride: TriState, approval: TriState, fullAllow: TriState, contextUsage: TriState, nativeCompact: TriState, nativeResume: TriState, streaming: TriState, nativeDelegationIsolated: TriState}} capabilities
 * @property {TriState} nativeDelegationIsolated
 * @property {{ok: boolean, status: string, reasons: string[], reasonCodes: string[]}} preflight
 * @property {boolean} ok
 * @property {boolean} blocked
 * @property {string[]} reasons
 * @property {string[]} reasonCodes
 * @property {string[]} warnings
 * @property {string | null} agentId
 * @property {string | null} requestedModel
 * @property {string | null} effectiveModel
 */

/**
 * @typedef {Object} ProviderCapabilityOptions
 * @property {number | (() => number)} [now]
 * @property {number} [staleAfterMs]
 */

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} [max] */
function safeText(value, max = 240) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** @param {unknown} value @returns {string | null} */
function safeCatalogText(value) {
  const text = safeText(value, 120);
  if (!text || /https?:\/\/|bearer|authorization|api[_-]?key|secret|token|password/i.test(text) || /[\\/]|\.\./.test(text)) return null;
  return text;
}

/** @param {unknown} value @returns {TriState} */
function triState(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "yes" || text === "supported") return true;
    if (text === "false" || text === "no" || text === "unsupported") return false;
  }
  return UNKNOWN;
}

/** @param {unknown[]} values @returns {TriState} */
function firstTriState(values) {
  for (const value of values) {
    const result = triState(value);
    if (result !== UNKNOWN) return result;
  }
  return UNKNOWN;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return isRecord(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {Record<string, unknown>} root @param {string[]} path */
function atPath(root, path) {
  let current = /** @type {unknown} */ (root);
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = record(current)[key];
  }
  return current;
}

/** @param {unknown} value @returns {string | null} */
function modelText(value) {
  if (typeof value === "string" || typeof value === "number") return safeText(value);
  if (!isRecord(value)) return null;
  const object = record(value);
  return safeText(object.id ?? object.value ?? object.modelId ?? object.model_id ?? object.name ?? object.label);
}

/** @param {unknown} value @returns {string} */
function modelKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_:-]+/g, "");
}

/** @param {unknown} value @returns {string} */
function providerKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Return the adapter-proven isolation state used by Task Center.  This does
 * not trust provider-reported metadata: only the three built-in contracts
 * above can prove hard native-delegation isolation.
 *
 * @param {unknown} provider
 * @returns {TriState}
 */
export function nativeDelegationIsolationForProvider(provider) {
  return Object.prototype.hasOwnProperty.call(TASK_NATIVE_DELEGATION_ISOLATION_CONTRACTS, providerKey(provider))
    ? true
    : UNKNOWN;
}

/** @param {unknown} provider @returns {boolean} */
export function isTaskProviderNativeDelegationIsolated(provider) {
  return nativeDelegationIsolationForProvider(provider) === true;
}

/**
 * @param {unknown} value
 * @returns {{id: string, label: string, aliases: string[]} | null}
 */
function normalizeModel(value) {
  const text = modelText(value);
  if (!text) return null;
  const object = record(value);
  const aliases = [];
  const rawAliases = Array.isArray(object.aliases) ? object.aliases : Array.isArray(object.alias) ? object.alias : [];
  for (const alias of rawAliases) {
    const normalized = safeText(alias);
    if (normalized && modelKey(normalized) !== modelKey(text) && !aliases.includes(normalized)) aliases.push(normalized);
  }
  const label = safeText(object.label ?? object.displayName ?? object.name) ?? text;
  return { id: text, label, aliases: aliases.slice(0, 12) };
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {Array<{id: string, label: string, aliases: string[]}>}
 */
function collectModels(metadata) {
  const handshake = record(metadata.handshake);
  const session = record(metadata.sessionMetadata ?? handshake.session_metadata);
  const configOptions = [
    ...(Array.isArray(handshake.config_options) ? handshake.config_options : []),
    ...(Array.isArray(session.configOptions) ? session.configOptions : []),
  ];
  const raw = [];
  const appendModels = (value) => {
    if (Array.isArray(value)) {
      raw.push(...value);
      return;
    }
    if (!isRecord(value)) return;
    for (const [id, model] of Object.entries(value)) {
      raw.push(isRecord(model) ? { ...model, id: model.id ?? id } : id);
    }
  };
  appendModels(metadata.modelOptions);
  appendModels(metadata.models);
  appendModels(metadata.availableModels);
  appendModels(handshake.available_models);
  appendModels(session.availableModels);
  for (const option of configOptions) {
    const item = record(option);
    const category = String(item.category ?? "").toLowerCase();
    const id = String(item.id ?? item.name ?? "").toLowerCase();
    if (category !== "model" && id !== "model" && id !== "models" && !id.includes("model")) continue;
    if (Array.isArray(item.options)) raw.push(...item.options);
  }
  const seen = new Set();
  const models = [];
  for (const candidate of raw) {
    const normalized = normalizeModel(candidate);
    if (!normalized) continue;
    const key = modelKey(normalized.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    models.push(normalized);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

/** @param {Record<string, unknown>} metadata @param {Record<string, unknown>} selection */
function currentModelFor(metadata, selection) {
  const candidates = [
    selection.model,
    selection.modelId,
    selection.requestedModel,
    metadata.model,
    metadata.defaultModel,
    metadata.currentModelId,
    metadata.current_model_id,
    atPath(record(metadata.handshake), ["current_model_id"]),
    atPath(record(metadata.sessionMetadata), ["currentModelId"]),
    atPath(record(record(metadata.handshake).session_metadata), ["currentModelId"]),
  ];
  return candidates.map(modelText).find(Boolean) ?? null;
}

/** @param {Record<string, unknown>} metadata @param {Record<string, unknown>} selection */
function selectionFrom(metadata, selection) {
  const agentObject = record(selection.agent);
  const providerObject = record(selection.provider);
  const agentSelectionId = typeof selection.agent === "string" ? selection.agent : null;
  const agentId = safeText(selection.agentId ?? selection.agent_id ?? agentSelectionId ?? agentObject.id ?? metadata.id ?? metadata.agentId ?? metadata.agent_id);
  const provider = safeText(selection.providerId ?? selection.provider_id ?? (typeof selection.provider === "string" ? selection.provider : null) ?? providerObject.id ?? selection.backend ?? agentObject.provider ?? metadata.provider ?? metadata.backend);
  const model = modelText(selection.model ?? selection.modelId ?? selection.model_id ?? selection.requestedModel);
  return {
    agentId,
    provider,
    model,
    taskMcp: firstTriState([selection.taskMcp, selection.task_mcp, selection.requireTaskMcp === false ? undefined : selection.mcp]),
    requireTaskMcp: firstTriState([selection.requireTaskMcp, selection.require_task_mcp]),
    requireModelOverride: firstTriState([selection.requireModelOverride, selection.requiredModelOverride, selection.modelOverrideRequired, selection.model_override_required]),
    fullAllow: firstTriState([selection.fullAllow, selection.full_allow, selection.permissionMode === "full-allow" ? true : undefined]),
    requireFullAllow: firstTriState([selection.requireFullAllow, selection.requiredFullAllow, selection.fullAllowRequired]),
  };
}

/** @param {unknown} input */
function metadataRoot(input) {
  const root = record(input);
  const candidates = [root.liveMetadata, root.agentMetadata, root.metadata, root.agent, root.personalMetadata, root];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const object = record(candidate);
    if (Array.isArray(object.agents)) return object.agents;
    if (Object.keys(object).length > 0 && (object.id || object.provider || object.backend || object.status || object.capability || object.handshake)) return object;
  }
  return null;
}

/** @param {unknown} root @param {ProviderCapabilitySelection} selection */
function selectAgent(root, selection) {
  const list = Array.isArray(root) ? root.filter(isRecord).map(record) : [];
  if (list.length > 0) {
    const requestedId = modelKey(selection.agentId);
    const requestedProvider = modelKey(selection.provider);
    return list.find((agent) => requestedId && modelKey(agent.id ?? agent.agentId) === requestedId)
      ?? list.find((agent) => requestedProvider && modelKey(agent.provider ?? agent.backend) === requestedProvider)
      ?? (selection.agentId || selection.provider ? null : list[0]);
  }
  if (!isRecord(root)) return null;
  const agent = record(root);
  const id = modelKey(agent.id ?? agent.agentId);
  const provider = modelKey(agent.provider ?? agent.backend);
  if (selection.agentId && id && id !== modelKey(selection.agentId)) return null;
  if (selection.provider && provider && provider !== modelKey(selection.provider)) return null;
  return agent;
}

/** @param {Record<string, unknown>} metadata @returns {string} */
function agentStatus(metadata) {
  const raw = String(metadata.status ?? metadata.availability ?? metadata.health ?? "").trim().toLowerCase().replaceAll("-", "_");
  const errorCode = String(record(metadata.errorInfo).code ?? metadata.error_code ?? "").trim().toLowerCase();
  if (firstTriState([metadata.enabled, atPath(record(metadata.capability), ["installed"])]) === false) return "missing";
  if (errorCode === "missing_binary") return "missing";
  if (errorCode === "auth_required") return "needs_auth";
  if (["needs_auth", "unauthenticated", "not_authenticated", "auth_required"].includes(raw)) return "needs_auth";
  if (["offline", "missing", "missing_binary", "error"].includes(raw)) return raw === "missing_binary" || raw === "error" ? "offline" : raw;
  if (["online", "unknown"].includes(raw)) return raw;
  const authenticated = firstTriState([
    metadata.authenticated,
    atPath(record(metadata.capability), ["authenticated"]),
    atPath(record(metadata.health), ["authenticated"]),
  ]);
  if (authenticated === false) return "needs_auth";
  return UNKNOWN;
}

/** @param {Record<string, unknown>} metadata @returns {TriState} */
function authenticatedState(metadata) {
  return firstTriState([
    metadata.authenticated,
    atPath(record(metadata.capability), ["authenticated"]),
    atPath(record(metadata.health), ["authenticated"]),
  ]);
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {{mcp: TriState, tools: TriState, modelOverride: TriState, approval: TriState, fullAllow: TriState, contextUsage: TriState, nativeCompact: TriState, nativeResume: TriState, streaming: TriState}}
 */
function capabilityStates(metadata) {
  const capability = record(metadata.capability);
  const handshake = record(metadata.handshake);
  const agentCaps = record(handshake.agent_capabilities);
  const metaCaps = record(agentCaps._meta);
  const session = record(metadata.sessionMetadata ?? handshake.session_metadata);
  const mcp = record(metaCaps.mcpCapabilities ?? agentCaps.mcpCapabilities ?? handshake.mcpCapabilities ?? metadata.mcpCapabilities);
  const availableCommands = [
    ...(Array.isArray(metadata.availableCommands) ? metadata.availableCommands : []),
    ...(Array.isArray(handshake.available_commands) ? handshake.available_commands : []),
    ...(Array.isArray(session.availableCommands) ? session.availableCommands : []),
  ];
  const modelCatalog = collectModels(metadata);
  const configOptions = Array.isArray(handshake.config_options) ? handshake.config_options : [];
  const modelConfigOption = configOptions.some((item) => /model/i.test(String(record(item).id ?? record(item).name ?? record(item).category ?? "")));
  const mcpDirect = firstTriState([
    metadata.supportsTaskMcp,
    metadata.taskMcpSupported,
    capability.supportsTaskMcp,
    metadata.supportsMcp,
    metadata.supportsMCP,
    metadata.mcp,
    metadata.taskMcp,
    capability.supportsMcp,
    capability.supportsMCP,
    metaCaps.supportsMcp,
    agentCaps.supportsMcp,
  ]);
  const adapterIsAcp = firstTriState([capability.supportsAcp, metaCaps.supportsAcp]);
  const mcpParts = [mcp.stdio, mcp.http, mcp.sse, mcp.tools];
  const mcpDerived = mcpDirect !== UNKNOWN
    ? mcpDirect
    : adapterIsAcp === true
      ? true
    : mcpParts.some((item) => item === true)
      ? true
      : mcpParts.some((item) => item === false) && mcpParts.every((item) => item === false || item === undefined)
        ? false
        : UNKNOWN;
  const tools = firstTriState([
    metadata.supportsTools,
    metadata.supportsToolCalls,
    metadata.tools,
    capability.supportsTools,
    capability.supportsToolCalls,
    capability.tools,
    metaCaps.supportsTools,
    mcp.tools,
  ]) !== UNKNOWN
    ? firstTriState([metadata.supportsTools, metadata.supportsToolCalls, metadata.tools, capability.supportsTools, capability.supportsToolCalls, capability.tools, metaCaps.supportsTools, mcp.tools])
    : availableCommands.length > 0 ? true : UNKNOWN;
  const modelOverride = firstTriState([
    metadata.supportsModelOverride,
    metadata.modelOverride,
    capability.supportsModelOverride,
    metaCaps.supportsModelOverride,
    agentCaps.supportsModelOverride,
  ]) !== UNKNOWN
    ? firstTriState([metadata.supportsModelOverride, metadata.modelOverride, capability.supportsModelOverride, capability.modelOverride, metaCaps.supportsModelOverride, agentCaps.supportsModelOverride])
    : modelCatalog.length > 0 || modelConfigOption ? true : UNKNOWN;
  const approval = firstTriState([
    metadata.supportsApproval,
    metadata.approval,
    capability.supportsApproval,
    capability.approval,
    metaCaps.supportsApproval,
    agentCaps.supportsApproval,
  ]);
  const fullAllow = firstTriState([
    metadata.supportsFullAllow,
    metadata.fullAllow,
    capability.supportsFullAllow,
    capability.fullAllow,
    metadata.supportsPermissionAutoApprove,
    capability.supportsPermissionAutoApprove,
    metaCaps.supportsPermissionAutoApprove,
    agentCaps.supportsPermissionAutoApprove,
  ]);
  const contextUsage = firstTriState([
    metadata.supportsContextUsage,
    metadata.contextUsageSupported,
    capability.supportsContextUsage,
    capability.contextUsage,
    metaCaps.supportsContextUsage,
  ]) !== UNKNOWN
    ? firstTriState([metadata.supportsContextUsage, metadata.contextUsageSupported, capability.supportsContextUsage, capability.contextUsage, metaCaps.supportsContextUsage])
    : isRecord(metadata.contextUsage) || isRecord(metadata.context_usage) || isRecord(capability.contextUsage) || isRecord(session.contextUsage) || isRecord(session.context_usage) || metadata.contextWindow !== undefined || metadata.context_window !== undefined || capability.contextWindow !== undefined
      ? true
      : UNKNOWN;
  const nativeCompact = firstTriState([
    metadata.nativeCompact,
    metadata.supportsNativeCompact,
    metadata.supportsCompact,
    capability.nativeCompact,
    capability.supportsNativeCompact,
    capability.supportsCompact,
    metaCaps.nativeCompact,
    metaCaps.supportsNativeCompact,
    metaCaps.supportsCompact,
    agentCaps.nativeCompact,
    agentCaps.supportsCompact,
    agentCaps.compact,
    atPath(record(agentCaps.sessionCapabilities), ["compact"]),
  ]) !== UNKNOWN
    ? firstTriState([metadata.nativeCompact, metadata.supportsNativeCompact, metadata.supportsCompact, capability.nativeCompact, capability.supportsNativeCompact, capability.supportsCompact, metaCaps.nativeCompact, metaCaps.supportsNativeCompact, metaCaps.supportsCompact, agentCaps.nativeCompact, agentCaps.supportsCompact, agentCaps.compact, atPath(record(agentCaps.sessionCapabilities), ["compact"])])
    : UNKNOWN;
  const nativeResume = firstTriState([
    metadata.nativeResume,
    metadata.supportsNativeResume,
    capability.nativeResume,
    capability.supportsNativeResume,
    metadata.supportsResume,
    capability.supportsResume,
    agentCaps.loadSession,
    metaCaps.supportsResume,
    atPath(record(agentCaps.sessionCapabilities), ["resume"]),
  ]) !== UNKNOWN
    ? firstTriState([metadata.nativeResume, metadata.supportsNativeResume, capability.nativeResume, capability.supportsNativeResume, metadata.supportsResume, capability.supportsResume, agentCaps.loadSession, metaCaps.supportsResume, atPath(record(agentCaps.sessionCapabilities), ["resume"])])
    : isRecord(record(agentCaps.sessionCapabilities).resume) ? true : UNKNOWN;
  const streaming = firstTriState([
    metadata.streaming,
    metadata.supportsStreaming,
    capability.streaming,
    capability.supportsStreaming,
    metaCaps.supportsStreaming,
    agentCaps.supportsStreaming,
  ]);
  return { mcp: mcpDerived, tools, modelOverride, approval, fullAllow, contextUsage, nativeCompact, nativeResume, streaming };
}

/** @param {unknown} value @returns {number | null} */
function timestampValue(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {Record<string, unknown>} metadata @param {Record<string, unknown>} selection @param {ProviderCapabilityOptions} options */
function catalogInfo(metadata, selection, options) {
  const handshake = record(metadata.handshake);
  const catalog = record(metadata.catalog ?? metadata.modelCatalog ?? handshake.catalog);
  const revision = safeText(catalog.revision ?? metadata.catalogRevision ?? metadata.catalog_revision ?? handshake.catalogRevision ?? selection.catalogRevision);
  const source = safeCatalogText(catalog.source ?? metadata.catalogSource ?? metadata.catalog_source ?? selection.catalogSource);
  const observedAt = [
    catalog.updatedAt,
    catalog.fetchedAt,
    catalog.observedAt,
    metadata.catalogUpdatedAt,
    metadata.catalogFetchedAt,
    metadata.lastCheckedAt,
    selection.catalogUpdatedAt,
  ].map(timestampValue).find((value) => value !== null) ?? null;
  const now = typeof options.now === "function" ? options.now() : options.now ?? Date.now();
  const nowMs = timestampValue(now) ?? Date.now();
  const ageMs = observedAt === null ? null : Math.max(0, nowMs - observedAt);
  const staleAfterMs = Number(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const freshness = observedAt === null
    ? UNKNOWN
    : Number.isFinite(staleAfterMs) && staleAfterMs >= 0 && ageMs !== null && ageMs > staleAfterMs ? "stale" : "fresh";
  const warning = freshness === "stale" ? "Provider capability catalog is stale; refresh before relying on optional capabilities." : null;
  return { revision, source, freshness, stale: freshness === "stale", observedAt, ageMs, warning, models: collectModels(metadata) };
}

/** @param {Record<string, unknown>} metadata @param {ProviderCapabilitySelection} requested @param {Array<{id: string, label: string, aliases: string[]}>} models */
function effectiveModel(metadata, requested, models) {
  const requestedModel = requested.model;
  const current = currentModelFor(metadata, record(requested));
  const candidate = requestedModel ?? current;
  if (!candidate && models.length === 1) return { model: models[0].id, resolution: "catalog" };
  if (!candidate) return { model: null, resolution: "none" };
  const key = modelKey(candidate);
  const match = models.find((model) => [model.id, model.label, ...model.aliases].some((value) => modelKey(value) === key));
  if (match) return { model: match.id, resolution: requestedModel ? "catalog" : "current" };
  if (models.length === 0) return { model: candidate, resolution: requestedModel ? "requested" : "current" };
  return { model: null, resolution: "unavailable" };
}

/** @param {Record<string, unknown>} input */
function inputSelection(input) {
  const nested = input.selection ?? input.requested ?? input.request ?? input.profile;
  return isRecord(nested) ? record(nested) : input;
}

/**
 * Normalize live Personal metadata and a requested provider/model selection.
 * The return value is safe to persist in a Task Center diagnostic record.
 *
 * @param {Record<string, unknown>} [input]
 * @param {ProviderCapabilityOptions} [options]
 * @returns {ProviderCapabilityRecord}
 */
export function normalizeProviderCapabilities(input = {}, options = {}) {
  const selectionInput = inputSelection(input);
  const root = metadataRoot(input);
  const provisional = selectionFrom({}, selectionInput);
  const metadata = selectAgent(root, provisional) ?? {};
  const requested = selectionFrom(metadata, selectionInput);
  const agentId = safeText(metadata.id ?? metadata.agentId ?? metadata.agent_id) ?? requested.agentId;
  const provider = safeText(metadata.provider ?? metadata.backend) ?? requested.provider;
  const status = agentStatus(metadata);
  const models = collectModels(metadata);
  const effective = effectiveModel(metadata, requested, models);
  const providerName = safeText(metadata.providerName ?? metadata.backendName ?? metadata.provider_label ?? metadata.name);
  const catalog = catalogInfo(metadata, selectionInput, options);
  const nativeDelegationIsolated = nativeDelegationIsolationForProvider(provider ?? requested.provider);
  const supports = { ...capabilityStates(metadata), nativeDelegationIsolated };
  const warnings = catalog.warning ? [catalog.warning] : [];
  /** @type {string[]} */
  const reasonCodes = [];
  if (!agentId || !metadata || Object.keys(metadata).length === 0) reasonCodes.push("agent_missing");
  else if (status === "missing") reasonCodes.push("agent_missing");
  else if (status === "offline") reasonCodes.push("agent_offline");
  if (status === "needs_auth" || authenticatedState(metadata) === false) reasonCodes.push("agent_unauthenticated");
  if (!effective.model) reasonCodes.push(effective.resolution === "unavailable" ? "model_unavailable" : "model_missing");
  if (supports.mcp === false || requested.taskMcp === false) reasonCodes.push("task_mcp_unsupported");
  if ((provider || requested.provider) && nativeDelegationIsolated !== true) reasonCodes.push("native_delegation_isolation_unsupported");
  const requiresModelOverride = requested.requireModelOverride === true || Boolean(requested.model);
  if (requiresModelOverride && supports.modelOverride === false) reasonCodes.push("model_override_unsupported");
  const requiresFullAllow = requested.requireFullAllow === true || requested.fullAllow === true;
  if (requiresFullAllow && supports.fullAllow === false) reasonCodes.push("full_allow_unsupported");
  const uniqueReasonCodes = [...new Set(reasonCodes)];
  const reasons = uniqueReasonCodes.map((code) => ({
    agent_missing: "The selected Personal agent is missing or unavailable.",
    agent_offline: "The selected Personal agent is offline.",
    agent_unauthenticated: "The selected Personal agent is not authenticated.",
    model_missing: "A concrete model is required before execution.",
    model_unavailable: "The requested model is not present in the live provider catalog.",
    task_mcp_unsupported: "The provider explicitly does not support the Task Center MCP surface.",
    native_delegation_isolation_unsupported: "Task Center requires a provider adapter with hard native delegation isolation; use Codex, Claude, or OpenCode.",
    model_override_unsupported: "The provider explicitly does not support the required model override.",
    full_allow_unsupported: "The provider explicitly does not support the requested full-allow mode.",
  })[code] ?? "Provider selection failed preflight.");
  const ok = uniqueReasonCodes.length === 0;
  const recordValue = /** @type {ProviderCapabilityRecord} */ ({
    schemaVersion: 1,
    agent: { id: agentId, name: safeText(metadata.name), status },
    provider,
    providerInfo: { id: provider, name: providerName },
    requested,
    effective: { agentId, provider, model: effective.model, modelResolution: effective.resolution },
    catalog,
    supports,
    capabilities: supports,
    preflight: { ok, status: ok ? "ready" : "blocked", reasons, reasonCodes: uniqueReasonCodes },
    ok,
    blocked: !ok,
    reasons,
    reasonCodes: uniqueReasonCodes,
    warnings: warnings.slice(0, MAX_WARNINGS),
    agentId,
    requestedModel: requested.model,
    effectiveModel: effective.model,
    nativeDelegationIsolated,
  });
  return recordValue;
}

/** Alias for callers that use the shorter canonical-record name. */
export const normalizeProviderCapabilityRecord = normalizeProviderCapabilities;

/** Singular alias for small call sites. */
export const normalizeProviderCapability = normalizeProviderCapabilities;

/**
 * Project the live capability record into the small immutable shape that is
 * safe to freeze with a Task Center selection/profile. Never copy catalog
 * models, paths, commands, or arbitrary adapter metadata into the snapshot.
 * @param {ProviderCapabilityRecord | Record<string, unknown> | null | undefined} value
 */
export function providerCapabilitySnapshot(value = {}) {
  const source = record(value);
  const requested = record(source.requested);
  const effective = record(source.effective);
  const catalog = record(source.catalog);
  const supports = record(source.supports ?? source.capabilities);
  const warningValues = [
    ...(Array.isArray(source.warnings) ? source.warnings : []),
    catalog.warning,
  ];
  const warnings = [...new Set(warningValues
    .map((item) => safeText(item, MAX_SNAPSHOT_WARNING_LENGTH))
    .filter((item) => item && !/https?:\/\/|bearer|authorization|api[_-]?key|secret|token|password/i.test(item)))]
    .slice(0, MAX_WARNINGS);
  return {
    schemaVersion: 1,
    requestedModel: modelText(requested.model ?? source.requestedModel),
    effectiveModel: modelText(effective.model ?? source.effectiveModel),
    modelResolution: ["catalog", "current", "requested", "none", "unavailable"].includes(String(effective.modelResolution ?? source.modelResolution))
      ? (effective.modelResolution ?? source.modelResolution)
      : "unknown",
    catalogRevision: safeCatalogText(catalog.revision ?? source.catalogRevision),
    catalogFreshness: ["fresh", "stale"].includes(String(catalog.freshness)) ? catalog.freshness : "unknown",
    catalogObservedAt: (() => {
      const observedAt = timestampValue(catalog.observedAt ?? source.catalogObservedAt);
      return observedAt === null ? null : Math.max(0, Math.trunc(observedAt));
    })(),
    supports: {
      taskMcp: firstTriState([supports.mcp, supports.taskMcp]),
      tools: firstTriState([supports.tools]),
      modelOverride: firstTriState([supports.modelOverride]),
      approval: firstTriState([supports.approval]),
      fullAllow: firstTriState([supports.fullAllow]),
      context: firstTriState([supports.contextUsage, supports.context]),
      nativeCompact: firstTriState([supports.nativeCompact]),
      nativeResume: firstTriState([supports.nativeResume]),
      streaming: firstTriState([supports.streaming]),
      nativeDelegationIsolated: firstTriState([supports.nativeDelegationIsolated, source.nativeDelegationIsolated]),
    },
    nativeDelegationIsolated: firstTriState([source.nativeDelegationIsolated, supports.nativeDelegationIsolated]),
    warnings,
  };
}

export const capabilitySnapshotFromRecord = providerCapabilitySnapshot;

/** Alias for the preflight-focused call site; the canonical record remains attached. */
export function preflightProviderSelection(input = {}, options = {}) {
  return normalizeProviderCapabilities(input, options);
}

/** Return only the preflight result for callers that already persist the record. */
export function preflightProviderCapabilities(input = {}, options = {}) {
  return normalizeProviderCapabilities(input, options).preflight;
}
