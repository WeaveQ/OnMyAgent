/**
 * Session / task composer context occupancy.
 * Used ≈ last assistant prompt size (input + cache read); total via resolveContextTotal.
 */
import {
  resolveContextTotal,
  toContextUsageSnapshot,
  type ContextUsageSnapshot,
} from "./context-usage-model";

export type SessionTokenUsageLike = {
  input?: number | null;
  cacheRead?: number | null;
  total?: number | null;
} | null;

/** Prompt-side tokens for the last completed assistant turn (context occupancy). */
export function estimateContextUsedFromTokens(
  tokens: SessionTokenUsageLike,
): number | null {
  if (!tokens) return null;
  const input = tokens.input;
  const cacheRead = tokens.cacheRead;
  if (
    (typeof input === "number" && Number.isFinite(input)) ||
    (typeof cacheRead === "number" && Number.isFinite(cacheRead))
  ) {
    return Math.max(0, Math.round((input ?? 0) + (cacheRead ?? 0)));
  }
  return null;
}

/**
 * Build a snapshot for the session composer ring.
 * Always returns a snapshot when a total can be resolved (default 200k),
 * so empty / new chats still show 0% occupancy.
 */
export function buildSessionContextUsage(input: {
  modelId?: string | null;
  catalogContextWindow?: unknown;
  usedTokens?: number | null;
}): ContextUsageSnapshot {
  const { total, source } = resolveContextTotal({
    modelId: input.modelId,
    catalogContextWindow: input.catalogContextWindow,
  });
  const hasUsed =
    typeof input.usedTokens === "number" && Number.isFinite(input.usedTokens);
  const used = hasUsed ? Math.max(0, Math.round(input.usedTokens as number)) : 0;
  return (
    toContextUsageSnapshot({
      used,
      total,
      totalSource: source,
      usedSource: hasUsed ? "runtime" : "estimate",
      modelId: input.modelId ?? null,
    }) ?? {
      used,
      total,
      totalSource: source,
      usedSource: hasUsed ? "runtime" : "estimate",
      modelId: input.modelId ?? null,
    }
  );
}
