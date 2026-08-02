// Context window fallback + normalization for Local Agent runtime.
// Prefer runtime total → catalog contextWindow → static model table → default 200k.

const MODEL_CONTEXT_LIMITS = Object.freeze({
  // Gemini
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-3-pro-preview": 1_048_576,
  "gemini-3-flash-preview": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-flash-lite": 1_048_576,
  "gemini-2.0-flash": 1_048_576,
  "gemini-2.0-flash-lite": 1_048_576,
  "gemini-1.5-pro": 2_097_152,
  "gemini-1.5-flash": 1_048_576,
  // OpenAI / Codex
  "gpt-5.1": 400_000,
  "gpt-5.1-chat": 128_000,
  "gpt-5": 400_000,
  "gpt-5-chat": 128_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  o1: 200_000,
  "o1-preview": 128_000,
  "o1-mini": 128_000,
  o3: 200_000,
  "o3-mini": 200_000,
  "codex-mini-latest": 200_000,
  // Anthropic / Claude Code
  "claude-opus-4.5": 200_000,
  "claude-haiku-4.5": 200_000,
  "claude-sonnet-4.5": 1_000_000,
  "claude-opus-4.1": 200_000,
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 1_000_000,
  "claude-3.7-sonnet": 200_000,
  "claude-3.5-haiku": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-haiku": 200_000,
});

export const DEFAULT_CONTEXT_LIMIT = 200_000;

export const CONTEXT_USAGE_BUCKET_IDS = Object.freeze([
  "system",
  "tools",
  "messages",
  "connectors",
  "skills",
  "other",
]);

const BUCKET_ALIASES = Object.freeze({
  system: "system",
  system_prompt: "system",
  systemprompt: "system",
  tools: "tools",
  tool: "tools",
  subagent: "tools",
  subagents: "tools",
  tools_and_subagents: "tools",
  messages: "messages",
  message: "messages",
  conversation: "messages",
  chat: "messages",
  connectors: "connectors",
  connector: "connectors",
  mcp: "connectors",
  skills: "skills",
  skill: "skills",
  other: "other",
  unknown: "other",
});

/**
 * @param {string | null | undefined} modelName
 * @returns {number}
 */
export function lookupModelContextLimit(modelName) {
  if (!modelName || typeof modelName !== "string") return DEFAULT_CONTEXT_LIMIT;
  const lower = modelName.toLowerCase();
  if (MODEL_CONTEXT_LIMITS[lower]) return MODEL_CONTEXT_LIMITS[lower];
  let bestKey = "";
  let bestLimit = DEFAULT_CONTEXT_LIMIT;
  for (const key of Object.keys(MODEL_CONTEXT_LIMITS)) {
    if (lower.includes(key) && key.length > bestKey.length) {
      bestKey = key;
      bestLimit = MODEL_CONTEXT_LIMITS[key];
    }
  }
  return bestLimit;
}

/**
 * Resolve context window total.
 * Order: runtime total → catalog contextWindow → model table → default 200k.
 *
 * @param {{
 *   runtimeTotal?: unknown,
 *   modelId?: string | null,
 *   catalogContextWindow?: unknown,
 * }} input
 * @returns {{ total: number, source: "runtime" | "catalog" | "table" | "default" }}
 */
export function resolveContextTotal(input = {}) {
  const runtime = Number(input.runtimeTotal);
  if (Number.isFinite(runtime) && runtime > 0) {
    return { total: Math.round(runtime), source: "runtime" };
  }
  const catalog = Number(input.catalogContextWindow);
  if (Number.isFinite(catalog) && catalog > 0) {
    return { total: Math.round(catalog), source: "catalog" };
  }
  const modelId =
    typeof input.modelId === "string" && input.modelId.trim()
      ? input.modelId.trim()
      : null;
  if (modelId) {
    const table = lookupModelContextLimit(modelId);
    if (table !== DEFAULT_CONTEXT_LIMIT || MODEL_CONTEXT_LIMITS[modelId.toLowerCase()]) {
      return { total: table, source: "table" };
    }
    // Fuzzy match hit still returns table source when limit differs from pure default
    // without a model id would be default — with model id, table lookup is the path.
    return { total: table, source: table === DEFAULT_CONTEXT_LIMIT ? "default" : "table" };
  }
  return { total: DEFAULT_CONTEXT_LIMIT, source: "default" };
}

/**
 * @param {unknown} raw
 * @returns {Array<{ id: string, tokens: number }> | null}
 */
export function normalizeContextUsageBreakdown(raw) {
  if (!raw) return null;
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "object"
      ? Object.entries(raw).map(([key, value]) =>
          value && typeof value === "object"
            ? { id: key, ...(value) }
            : { id: key, tokens: value },
        )
      : null;
  if (!items || items.length === 0) return null;

  /** @type {Map<string, number>} */
  const merged = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rawId = String(
      item.id ?? item.key ?? item.name ?? item.bucket ?? "",
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const id = BUCKET_ALIASES[rawId] ?? (CONTEXT_USAGE_BUCKET_IDS.includes(rawId) ? rawId : "other");
    const tokens = Number(item.tokens ?? item.used ?? item.count ?? item.value);
    if (!Number.isFinite(tokens) || tokens < 0) continue;
    merged.set(id, (merged.get(id) ?? 0) + Math.round(tokens));
  }
  if (merged.size === 0) return null;
  return CONTEXT_USAGE_BUCKET_IDS.filter((id) => merged.has(id)).map((id) => ({
    id,
    tokens: merged.get(id) ?? 0,
  }));
}

/**
 * Accept the raw JSON body carried on `acp_context_usage>` status text and
 * coerce it into a structured usage snapshot.
 *
 * @param {unknown} payload
 * @param {string | null | undefined} modelHint
 * @param {{ catalogContextWindow?: unknown }} [options]
 */
export function normalizeContextUsagePayload(payload, modelHint, options = {}) {
  if (!payload || typeof payload !== "object") return null;
  const body = /** @type {Record<string, unknown>} */ (payload);
  const usedCandidate =
    body.used ??
    body.usedTokens ??
    body.used_tokens ??
    body.total_tokens ??
    body.totalTokens ??
    body.tokens;
  const used = Number(usedCandidate);
  if (!Number.isFinite(used) || used < 0) return null;

  const totalCandidate =
    body.total ??
    body.contextWindow ??
    body.context_window ??
    body.limit ??
    body.max_tokens ??
    body.maxTokens ??
    body.size ??
    body.contextSize ??
    body.context_size;

  const resolved = resolveContextTotal({
    runtimeTotal: totalCandidate,
    modelId: modelHint,
    catalogContextWindow: options.catalogContextWindow,
  });
  let total = resolved.total;
  let totalSource = resolved.source;
  if (used > total) {
    total = Math.max(total, used);
    totalSource = "runtime";
  }

  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const breakdown = normalizeContextUsageBreakdown(
    body.breakdown ?? body.buckets ?? body.categories ?? body.parts,
  );

  return {
    used: Math.round(used),
    total: Math.round(total),
    label: rawLabel || null,
    totalSource,
    usedSource: "runtime",
    breakdown,
    breakdownSource: breakdown ? "runtime" : null,
    modelId: typeof modelHint === "string" && modelHint.trim() ? modelHint.trim() : null,
  };
}

/**
 * Extract a usage-like object from an ACP session/prompt result.
 * @param {unknown} result
 * @returns {{ used: number } | null}
 */
export function extractPromptUsageTotals(result) {
  if (!result || typeof result !== "object") return null;
  const root = /** @type {Record<string, any>} */ (result);
  const buckets = [
    root.usage,
    root?.result?.usage,
    root?.turn?.usage,
    root?.metrics?.usage,
    root?.stats,
  ];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    const total = Number(bucket.totalTokens ?? bucket.total_tokens ?? bucket.total);
    if (Number.isFinite(total) && total > 0) return { used: Math.round(total) };
  }
  return null;
}
