// Context window fallback + normalization for Local Agent runtime.
// Aligns with AionUi's MODEL_CONTEXT_LIMITS strategy: prefer usage.total from
// the CLI when present, otherwise look up the model in a static table, and
// finally fall back to a conservative default.

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
  "o1": 200_000,
  "o1-preview": 128_000,
  "o1-mini": 128_000,
  "o3": 200_000,
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

// Accept the raw JSON body carried on `acp_context_usage>` status text and
// coerce it into a { used, total, label } tuple. `total` falls back to the
// model's context window when the CLI only reports used/total_tokens.
export function normalizeContextUsagePayload(payload, modelHint) {
  if (!payload || typeof payload !== "object") return null;
  const usedCandidate = payload.used ?? payload.usedTokens ?? payload.used_tokens ?? payload.total_tokens ?? payload.totalTokens ?? payload.tokens;
  const totalCandidate = payload.total ?? payload.contextWindow ?? payload.context_window ?? payload.limit ?? payload.max_tokens ?? payload.maxTokens ?? payload.size ?? payload.contextSize ?? payload.context_size;
  const used = Number(usedCandidate);
  if (!Number.isFinite(used) || used < 0) return null;
  let total = Number(totalCandidate);
  if (!Number.isFinite(total) || total <= 0) total = lookupModelContextLimit(modelHint);
  if (used > total) total = Math.max(total, used);
  const rawLabel = typeof payload.label === "string" ? payload.label.trim() : "";
  return { used: Math.round(used), total: Math.round(total), label: rawLabel || null };
}

// Extract a usage-like object from an ACP session/prompt result. Different
// CLIs surface totals under different fields; we normalize aggressively.
export function extractPromptUsageTotals(result) {
  if (!result || typeof result !== "object") return null;
  const buckets = [result.usage, result?.result?.usage, result?.turn?.usage, result?.metrics?.usage, result?.stats];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    const total = Number(bucket.totalTokens ?? bucket.total_tokens ?? bucket.total);
    if (Number.isFinite(total) && total > 0) return { used: Math.round(total) };
  }
  return null;
}
