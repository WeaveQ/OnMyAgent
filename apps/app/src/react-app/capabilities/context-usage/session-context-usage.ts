/**
 * Session / task composer context occupancy.
 * Used ≈ last assistant prompt size (input + cache read); total via resolveContextTotal.
 * OpenCode does not report per-bucket occupancy, so the five-row card is estimated
 * from visible transcript / prompt / skills / MCP, then scaled to `used`.
 */
import {
  CONTEXT_USAGE_VISIBLE_BUCKETS,
  resolveContextTotal,
  toContextUsageSnapshot,
  type ContextUsageBreakdownItem,
  type ContextUsageSnapshot,
} from "./context-usage-model";

export type SessionTokenUsageLike = {
  input?: number | null;
  cacheRead?: number | null;
  total?: number | null;
} | null;

export type SessionContextEstimateSource = {
  messages?: ReadonlyArray<{
    role?: string;
    parts?: ReadonlyArray<unknown>;
  }> | null;
  skills?: ReadonlyArray<{
    name?: string;
    description?: string;
    descriptionZh?: string;
    descriptionEn?: string;
  }> | null;
  mcpServers?: ReadonlyArray<{
    name?: string;
  }> | null;
  systemPrompt?: string | null;
};

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

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x2e80) cjk += 1;
    else other += 1;
  }
  return Math.max(0, Math.round(cjk / 1.5 + other / 4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : "";
  } catch {
    return "";
  }
}

function classifyPart(part: unknown): { bucket: "messages" | "tools"; text: string } | null {
  if (!isRecord(part) || typeof part.type !== "string") return null;
  const type = part.type;
  if (type === "text" || type === "reasoning") {
    return typeof part.text === "string" && part.text
      ? { bucket: "messages", text: part.text }
      : null;
  }
  if (type === "file") {
    const name = typeof part.filename === "string" ? part.filename : "";
    const url = typeof part.url === "string" ? part.url : "";
    const text = typeof part.text === "string" ? part.text : "";
    const blob = [name, url, text].filter(Boolean).join("\n");
    return blob ? { bucket: "messages", text: blob } : null;
  }
  if (type === "tool" || type === "dynamic-tool" || type === "agent") {
    const bits = [
      typeof part.tool === "string" ? part.tool : "",
      typeof part.toolName === "string" ? part.toolName : "",
      typeof part.name === "string" ? part.name : "",
      stringifyUnknown(part.input),
      stringifyUnknown(part.output),
      typeof part.errorText === "string" ? part.errorText : "",
    ];
    const text = bits.filter(Boolean).join("\n");
    return text ? { bucket: "tools", text } : null;
  }
  return null;
}

function joinSkillText(skill: {
  name?: string;
  description?: string;
  descriptionZh?: string;
  descriptionEn?: string;
}): string {
  return [skill.name, skill.description, skill.descriptionZh, skill.descriptionEn]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("\n");
}

type VisibleBucketId = (typeof CONTEXT_USAGE_VISIBLE_BUCKETS)[number];
type VisibleBucketTotals = Record<VisibleBucketId, number>;

// Hidden prompt (OpenCode wrapper + tool schemas + skill files) is not in the
// transcript. Split that gap by what is present instead of dumping it on tools.
const REMAINDER_WEIGHT: VisibleBucketTotals = {
  system: 1,
  tools: 3,
  messages: 0,
  connectors: 1,
  skills: 1,
};

function remainderWeights(
  raw: VisibleBucketTotals,
  source: SessionContextEstimateSource | null | undefined,
): VisibleBucketTotals {
  return {
    system: raw.system > 0 ? 0 : REMAINDER_WEIGHT.system,
    tools: REMAINDER_WEIGHT.tools,
    messages: 0,
    connectors: (source?.mcpServers?.length ?? 0) > 0 ? REMAINDER_WEIGHT.connectors : 0,
    skills: (source?.skills?.length ?? 0) > 0 ? REMAINDER_WEIGHT.skills : 0,
  };
}

function allocateRemainder(
  leftover: number,
  raw: VisibleBucketTotals,
  source: SessionContextEstimateSource | null | undefined,
): VisibleBucketTotals {
  if (leftover <= 0) return raw;
  const weights = remainderWeights(raw, source);
  const payable = CONTEXT_USAGE_VISIBLE_BUCKETS.filter((id) => weights[id] > 0);
  const weightSum = payable.reduce((total, id) => total + weights[id], 0);
  if (weightSum <= 0) {
    return { ...raw, tools: raw.tools + leftover };
  }
  const next = { ...raw };
  let allocated = 0;
  payable.forEach((id, index) => {
    const share =
      index === payable.length - 1
        ? leftover - allocated
        : Math.round((weights[id] / weightSum) * leftover);
    next[id] += Math.max(0, share);
    allocated += Math.max(0, share);
  });
  return next;
}

function scaleBreakdownToUsed(
  used: number,
  raw: VisibleBucketTotals,
): ContextUsageBreakdownItem[] {
  const ids = CONTEXT_USAGE_VISIBLE_BUCKETS;
  const sum = ids.reduce((total, id) => total + raw[id], 0);
  if (used <= 0) {
    return ids.map((id) => ({ id, tokens: 0 }));
  }
  if (sum <= 0) {
    return ids.map((id) => ({ id, tokens: id === "messages" ? used : 0 }));
  }
  if (sum === used) {
    return ids.map((id) => ({ id, tokens: raw[id] }));
  }
  if (sum > used) {
    let allocated = 0;
    return ids.map((id, index) => {
      if (index === ids.length - 1) {
        return { id, tokens: Math.max(0, used - allocated) };
      }
      const tokens = Math.round((raw[id] / sum) * used);
      allocated += tokens;
      return { id, tokens };
    });
  }
  return ids.map((id) => ({ id, tokens: raw[id] }));
}

/**
 * Estimate the five-row card from what the renderer can see.
 * Bucket sum always equals `used` when used > 0, so the legend cannot stay all-zero.
 */
export function estimateSessionContextBreakdown(
  used: number,
  source: SessionContextEstimateSource | null | undefined,
): ContextUsageBreakdownItem[] | null {
  if (!Number.isFinite(used) || used <= 0) return null;
  if (!source) {
    return scaleBreakdownToUsed(Math.round(used), {
      system: 0,
      tools: 0,
      messages: Math.round(used),
      connectors: 0,
      skills: 0,
    });
  }
  const raw: VisibleBucketTotals = {
    system: estimateTokensFromText(source?.systemPrompt ?? ""),
    tools: 0,
    messages: 0,
    connectors: estimateTokensFromText(
      (source?.mcpServers ?? []).map((server) => server.name ?? "").join("\n"),
    ),
    skills: estimateTokensFromText(
      (source?.skills ?? []).map((skill) => joinSkillText(skill)).join("\n"),
    ),
  };
  for (const message of source?.messages ?? []) {
    for (const part of message.parts ?? []) {
      const classified = classifyPart(part);
      if (!classified) continue;
      raw[classified.bucket] += estimateTokensFromText(classified.text);
    }
  }
  const roundedUsed = Math.round(used);
  const visible = CONTEXT_USAGE_VISIBLE_BUCKETS.reduce((total, id) => total + raw[id], 0);
  const allocated =
    visible < roundedUsed ? allocateRemainder(roundedUsed - visible, raw, source) : raw;
  return scaleBreakdownToUsed(roundedUsed, allocated);
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
  breakdown?: ContextUsageBreakdownItem[] | null;
  estimateFrom?: SessionContextEstimateSource | null;
}): ContextUsageSnapshot {
  const { total, source } = resolveContextTotal({
    modelId: input.modelId,
    catalogContextWindow: input.catalogContextWindow,
  });
  const hasUsed =
    typeof input.usedTokens === "number" && Number.isFinite(input.usedTokens);
  const used = hasUsed ? Math.max(0, Math.round(input.usedTokens as number)) : 0;
  const breakdown =
    input.breakdown && input.breakdown.length > 0
      ? input.breakdown
      : estimateSessionContextBreakdown(used, input.estimateFrom ?? null);
  return (
    toContextUsageSnapshot({
      used,
      total,
      totalSource: source,
      usedSource: hasUsed ? "runtime" : "estimate",
      breakdown,
      breakdownSource: input.breakdown?.length ? "runtime" : breakdown ? "estimate" : null,
      modelId: input.modelId ?? null,
    }) ?? {
      used,
      total,
      totalSource: source,
      usedSource: hasUsed ? "runtime" : "estimate",
      breakdown,
      breakdownSource: input.breakdown?.length ? "runtime" : breakdown ? "estimate" : null,
      modelId: input.modelId ?? null,
    }
  );
}
