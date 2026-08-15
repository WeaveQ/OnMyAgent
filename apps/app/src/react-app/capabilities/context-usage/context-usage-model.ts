/**
 * Shared context-usage model for UI (mirrors desktop runtime semantics).
 * Total resolution: runtime → catalog → model table → 200k default.
 */

export const DEFAULT_CONTEXT_LIMIT = 200_000;

export const CONTEXT_USAGE_WARN_PERCENT = 70;
export const CONTEXT_USAGE_DANGER_PERCENT = 90;

export type ContextUsageSource =
  | "runtime"
  | "catalog"
  | "table"
  | "default"
  | "estimate";

export type ContextUsageBucketId =
  | "system"
  | "tools"
  | "messages"
  | "connectors"
  | "skills"
  | "other";

export type ContextUsageBreakdownItem = {
  id: ContextUsageBucketId;
  tokens: number;
};

export type ContextUsageSnapshot = {
  used: number;
  total: number;
  label?: string | null;
  totalSource?: ContextUsageSource | null;
  usedSource?: ContextUsageSource | null;
  breakdown?: ContextUsageBreakdownItem[] | null;
  breakdownSource?: ContextUsageSource | null;
  modelId?: string | null;
};

/** Display order and default colors for the segmented bar. */
export const CONTEXT_USAGE_BUCKET_ORDER: ContextUsageBucketId[] = [
  "system",
  "tools",
  "messages",
  "connectors",
  "skills",
  "other",
];

/** Always-visible legend rows (matches the reference card; `other` is overflow-only). */
export const CONTEXT_USAGE_VISIBLE_BUCKETS = [
  "system",
  "tools",
  "messages",
  "connectors",
  "skills",
] as const satisfies readonly ContextUsageBucketId[];

/**
 * Solid swatches for legend dots / bar segments.
 * Use as `backgroundColor` (not `bg-*` utilities): the Tailwind theme
 * overrides default emerald/amber/violet palettes, so those classes never emit.
 */
export const CONTEXT_USAGE_BUCKET_COLOR: Record<ContextUsageBucketId, string> = {
  system: "var(--grass-9)",
  tools: "var(--amber-9)",
  messages: "var(--violet-9)",
  connectors: "var(--sky-9)",
  skills: "var(--blue-9)",
  other: "var(--gray-9)",
};

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
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
  // ByteDance / Doubao (Seed series is 256k unless a specific row says otherwise)
  "doubao-seed-evolving": 256_000,
  "doubao-seed-code": 256_000,
  "doubao-seed-1.8": 256_000,
  "doubao-seed-1.6": 256_000,
  "doubao-seed": 256_000,
  "doubao-1.5-pro": 256_000,
  "doubao-1.5": 128_000,
  // DeepSeek
  "deepseek-v4": 128_000,
  "deepseek-v3": 128_000,
  "deepseek-r1": 128_000,
  "deepseek-chat": 128_000,
  "deepseek-reasoner": 128_000,
};

export function lookupModelContextLimit(modelName: string | null | undefined): number {
  if (!modelName || typeof modelName !== "string") return DEFAULT_CONTEXT_LIMIT;
  const lower = modelName.toLowerCase();
  if (MODEL_CONTEXT_LIMITS[lower]) return MODEL_CONTEXT_LIMITS[lower];
  let bestKey = "";
  let bestLimit = DEFAULT_CONTEXT_LIMIT;
  for (const key of Object.keys(MODEL_CONTEXT_LIMITS)) {
    if (lower.includes(key) && key.length > bestKey.length) {
      bestKey = key;
      bestLimit = MODEL_CONTEXT_LIMITS[key]!;
    }
  }
  return bestLimit;
}

export function resolveContextTotal(input: {
  runtimeTotal?: unknown;
  modelId?: string | null;
  catalogContextWindow?: unknown;
}): { total: number; source: ContextUsageSource } {
  const runtime = Number(input.runtimeTotal);
  if (Number.isFinite(runtime) && runtime > 0) {
    return { total: Math.round(runtime), source: "runtime" };
  }
  const catalog = Number(input.catalogContextWindow);
  if (Number.isFinite(catalog) && catalog > 0) {
    return { total: Math.round(catalog), source: "catalog" };
  }
  const modelId = input.modelId?.trim() || null;
  if (modelId) {
    const table = lookupModelContextLimit(modelId);
    const exact = MODEL_CONTEXT_LIMITS[modelId.toLowerCase()];
    if (exact != null) return { total: exact, source: "table" };
    // Fuzzy match: if we got a non-default or any table hit via includes
    for (const key of Object.keys(MODEL_CONTEXT_LIMITS)) {
      if (modelId.toLowerCase().includes(key)) {
        return { total: table, source: "table" };
      }
    }
    return { total: DEFAULT_CONTEXT_LIMIT, source: "default" };
  }
  return { total: DEFAULT_CONTEXT_LIMIT, source: "default" };
}

function asUsageSource(value: unknown): ContextUsageSource | null {
  if (
    value === "runtime" ||
    value === "catalog" ||
    value === "table" ||
    value === "default" ||
    value === "estimate"
  ) {
    return value;
  }
  return null;
}

function asBucketId(value: unknown): ContextUsageBucketId | null {
  if (typeof value !== "string") return null;
  return CONTEXT_USAGE_BUCKET_ORDER.includes(value as ContextUsageBucketId)
    ? (value as ContextUsageBucketId)
    : null;
}

/** Coerce loose usage shapes into a snapshot for the indicator. */
export function toContextUsageSnapshot(
  usage:
    | {
        used: number;
        total: number;
        label?: string | null;
        totalSource?: string | null;
        usedSource?: string | null;
        breakdown?: Array<{ id: string; tokens: number }> | null;
        breakdownSource?: string | null;
        modelId?: string | null;
      }
    | null
    | undefined,
): ContextUsageSnapshot | null {
  if (!usage) return null;
  if (!Number.isFinite(usage.used) || !Number.isFinite(usage.total) || usage.total <= 0) {
    return null;
  }
  const total = Math.round(usage.total);
  const used = Math.round(usage.used);
  const breakdown = Array.isArray(usage.breakdown)
    ? usage.breakdown
        .map((item) => {
          const id = asBucketId(item?.id);
          const tokens = Number(item?.tokens);
          if (!id || !Number.isFinite(tokens) || tokens < 0) return null;
          return { id, tokens: Math.round(tokens) };
        })
        .filter((item): item is ContextUsageBreakdownItem => item != null)
    : null;
  return {
    used,
    total,
    label: usage.label ?? null,
    totalSource: asUsageSource(usage.totalSource),
    usedSource: asUsageSource(usage.usedSource),
    breakdown: breakdown && breakdown.length > 0 ? breakdown : null,
    breakdownSource: asUsageSource(usage.breakdownSource),
    modelId: usage.modelId ?? null,
  };
}

export function contextUsageHasKnownLimit(usage: ContextUsageSnapshot): boolean {
  return (
    usage.totalSource === "runtime"
    || usage.totalSource === "catalog"
    || usage.totalSource === "table"
  );
}

export function contextUsageExceedsKnownLimit(usage: ContextUsageSnapshot): boolean {
  return contextUsageHasKnownLimit(usage) && usage.used > usage.total;
}

export function formatCompactTokens(value: number): string {
  if (value >= 10_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    // Reference card uses 1000.0K for a 1M window, not 1.0M.
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(value));
}

export function formatExactTokens(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

export function contextUsagePercent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** Share of total window for a bucket (matches reference UI). */
export function bucketPercentOfTotal(tokens: number, total: number): number {
  if (!Number.isFinite(tokens) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (tokens / total) * 100));
}

/** Reference card: 0%, 1%, 0.3%, 54.3%. Whole numbers stay integer. */
export function formatBucketPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  const rounded = Math.round(percent * 10) / 10;
  if (rounded <= 0) return "0%";
  if (Number.isInteger(rounded)) return `${rounded.toFixed(0)}%`;
  return `${rounded.toFixed(1)}%`;
}
