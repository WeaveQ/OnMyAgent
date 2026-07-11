import type {
  SessionArchiveMessage,
  SessionArchiveUsageAgentBreakdown,
  SessionArchiveUsageEvent,
  SessionArchiveUsageModelBreakdown,
  SessionArchiveUsageProjectBreakdown,
  SessionArchiveUsageTotals,
} from "@onmyagent/types/session-archive";
import { sessionArchiveUsageEventSchema } from "@onmyagent/types/session-archive";
import {
  intToBool,
  intToOptionalBool,
  nullableNumberField,
  nullableStringField,
  numberField,
  objectField,
  parseJsonField,
  parseTimestamp,
  roundCost,
  stringField,
  tokenFloat,
  tokenNumber,
} from "./session-archive-sql.js";

export type UsageRow = {
  session_id: string;
  timestamp: string;
  model: string;
  token_usage: unknown;
  context_tokens: number;
  output_tokens: number;
  has_context_tokens: boolean;
  has_output_tokens: boolean;
  project: string;
  machine: string;
  agent: string;
  display_name: string;
  first_message: string;
  started_at: string | null;
  user_message_count: number;
  is_automated: boolean;
};

export type UsageAmount = SessionArchiveUsageTotals & {
  hasUsage: boolean;
  cost: number;
  priced: boolean;
};

export type UsagePricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheCreationPerMTok: number;
  cacheReadPerMTok: number;
};

export const FALLBACK_USAGE_PRICING: Record<string, UsagePricing> = {
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cacheCreationPerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25, cacheCreationPerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25, cacheCreationPerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheCreationPerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50, cacheCreationPerMTok: 12.5, cacheReadPerMTok: 1 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5, cacheCreationPerMTok: 1.25, cacheReadPerMTok: 0.1 },
  "gpt-5.5": { inputPerMTok: 5, outputPerMTok: 30, cacheCreationPerMTok: 0, cacheReadPerMTok: 0.5 },
  "gpt-5.4": { inputPerMTok: 2.5, outputPerMTok: 15, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
  "gpt-5.2-codex": { inputPerMTok: 1.75, outputPerMTok: 14, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
  "gpt-5.3-codex": { inputPerMTok: 1.75, outputPerMTok: 14, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
  "gpt-5.4-mini": { inputPerMTok: 0.75, outputPerMTok: 4.5, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
  "gpt-5.4-nano": { inputPerMTok: 0.2, outputPerMTok: 1.25, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
  "gpt-5.1-codex-max": { inputPerMTok: 1.25, outputPerMTok: 10, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15, cacheCreationPerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-sonnet-4-5-20250514": { inputPerMTok: 3, outputPerMTok: 15, cacheCreationPerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-opus-4-20250514": { inputPerMTok: 15, outputPerMTok: 75, cacheCreationPerMTok: 18.75, cacheReadPerMTok: 1.5 },
  "claude-haiku-3-5-20241022": { inputPerMTok: 0.8, outputPerMTok: 4, cacheCreationPerMTok: 1, cacheReadPerMTok: 0.08 },
  "openrouter/owl-alpha": { inputPerMTok: 0, outputPerMTok: 0, cacheCreationPerMTok: 0, cacheReadPerMTok: 0 },
};

export type UsageBucket = {
  totals: SessionArchiveUsageTotals;
  models: Set<string>;
  byModel: Map<string, SessionArchiveUsageModelBreakdown>;
  byProject: Map<string, SessionArchiveUsageProjectBreakdown>;
  byAgent: Map<string, SessionArchiveUsageAgentBreakdown>;
};
export function usageRowFromRow(row: unknown): UsageRow {
  return {
    session_id: stringField(row, "session_id"),
    timestamp: stringField(row, "timestamp"),
    model: stringField(row, "model"),
    token_usage: parseJsonField(objectField(row, "token_usage_json")),
    context_tokens: numberField(row, "context_tokens"),
    output_tokens: numberField(row, "output_tokens"),
    has_context_tokens: intToBool(objectField(row, "has_context_tokens")),
    has_output_tokens: intToBool(objectField(row, "has_output_tokens")),
    project: stringField(row, "project"),
    machine: stringField(row, "machine"),
    agent: stringField(row, "agent"),
    display_name: stringField(row, "display_name"),
    first_message: stringField(row, "first_message"),
    started_at: nullableStringField(row, "started_at"),
    user_message_count: numberField(row, "user_message_count"),
    is_automated: intToBool(objectField(row, "is_automated")),
  };
}

export function usageEventFromRow(row: unknown): SessionArchiveUsageEvent {
  return sessionArchiveUsageEventSchema.parse({
    id: numberField(row, "id"),
    session_id: stringField(row, "session_id"),
    message_ordinal: nullableNumberField(row, "message_ordinal"),
    source: stringField(row, "source"),
    model: stringField(row, "model"),
    input_tokens: numberField(row, "input_tokens"),
    output_tokens: numberField(row, "output_tokens"),
    cache_creation_input_tokens: numberField(row, "cache_creation_input_tokens"),
    cache_read_input_tokens: numberField(row, "cache_read_input_tokens"),
    reasoning_tokens: numberField(row, "reasoning_tokens"),
    cost_usd: nullableNumberField(row, "cost_usd"),
    cost_status: stringField(row, "cost_status"),
    cost_source: stringField(row, "cost_source"),
    occurred_at: nullableStringField(row, "occurred_at"),
    dedup_key: stringField(row, "dedup_key"),
  });
}

export function usageEventsFromMessages(sessionId: string, messages: SessionArchiveMessage[]): SessionArchiveUsageEvent[] {
  return messages.flatMap((message) => {
    const usage = message.token_usage;
    if (!usage || !message.model || message.model === "<synthetic>") return [];
    const inputTokens = tokenNumber(usage, "input_tokens", "prompt_tokens", "inputTokens") ?? 0;
    const outputTokens = tokenNumber(usage, "output_tokens", "completion_tokens", "outputTokens") ?? 0;
    const cacheCreationInputTokens = tokenNumber(usage, "cache_creation_input_tokens", "cacheCreationInputTokens") ?? 0;
    const cacheReadInputTokens = tokenNumber(usage, "cache_read_input_tokens", "cacheReadInputTokens", "cached_tokens") ?? 0;
    const reasoningTokens = tokenNumber(usage, "reasoning_output_tokens", "reasoningOutputTokens") ?? 0;
    if (inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens + reasoningTokens === 0) return [];
    const cost = tokenFloat(usage, "cost_usd", "cost", "total_cost") ?? null;
    return [{
      session_id: sessionId,
      message_ordinal: message.ordinal,
      source: message.source_type || message.source_subtype || "message_token_usage",
      model: message.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      cache_read_input_tokens: cacheReadInputTokens,
      reasoning_tokens: reasoningTokens,
      cost_usd: cost,
      cost_status: cost === null ? "" : "actual",
      cost_source: cost === null ? "" : "token_usage",
      occurred_at: message.timestamp || null,
      dedup_key: message.source_uuid || `${message.ordinal}:${message.model}`,
    }];
  });
}

export function rowUsage(row: UsageRow): UsageAmount {
  const inputTokens = tokenNumber(row.token_usage, "input_tokens", "prompt_tokens", "inputTokens")
    ?? (row.has_context_tokens ? row.context_tokens : 0);
  const outputTokens = tokenNumber(row.token_usage, "output_tokens", "completion_tokens", "outputTokens")
    ?? (row.has_output_tokens ? row.output_tokens : 0);
  const reasoningOutputTokens = tokenNumber(row.token_usage, "reasoning_output_tokens", "reasoningOutputTokens") ?? 0;
  const billableOutputTokens = outputTokens + reasoningOutputTokens;
  const cacheCreationTokens = tokenNumber(row.token_usage, "cache_creation_input_tokens", "cacheCreationInputTokens") ?? 0;
  const cacheReadTokens = tokenNumber(row.token_usage, "cache_read_input_tokens", "cacheReadInputTokens", "cached_tokens") ?? 0;
  const explicitCost = tokenFloat(row.token_usage, "cost_usd", "cost", "total_cost") ?? 0;
  const pricedCost = explicitCost > 0 ? explicitCost : pricedUsageCost(row.model, {
    inputTokens,
    outputTokens: billableOutputTokens,
    cacheCreationTokens,
    cacheReadTokens,
  });
  return {
    inputTokens,
    outputTokens: billableOutputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalCost: roundCost(pricedCost),
    cacheSavings: 0,
    cost: roundCost(pricedCost),
    priced: explicitCost > 0 || pricedCost > 0 || Boolean(resolveUsagePricing(row.model)),
    hasUsage: inputTokens + billableOutputTokens + cacheCreationTokens + cacheReadTokens > 0 || explicitCost > 0,
  };
}

export function pricedUsageCost(model: string, usage: Pick<UsageAmount, "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens">): number {
  const pricing = resolveUsagePricing(model);
  if (!pricing) return 0;
  return (
    usage.inputTokens * pricing.inputPerMTok
    + usage.outputTokens * pricing.outputPerMTok
    + usage.cacheCreationTokens * pricing.cacheCreationPerMTok
    + usage.cacheReadTokens * pricing.cacheReadPerMTok
  ) / 1_000_000;
}

export function resolveUsagePricing(model: string): UsagePricing | null {
  const trimmed = model.trim();
  if (!trimmed) return null;
  const exact = FALLBACK_USAGE_PRICING[trimmed];
  if (exact) return exact;
  const normalized = trimmed.replace(/\./g, "-");
  const normalizedExact = FALLBACK_USAGE_PRICING[normalized];
  if (normalizedExact) return normalizedExact;
  const lower = trimmed.toLowerCase();
  for (const [key, pricing] of Object.entries(FALLBACK_USAGE_PRICING)) {
    if (key.toLowerCase() === lower || key.toLowerCase() === normalized.toLowerCase()) return pricing;
  }
  const candidates = canonicalModelCandidates(trimmed);
  for (const candidate of candidates) {
    for (const [key, pricing] of Object.entries(FALLBACK_USAGE_PRICING)) {
      if (canonicalModelName(key) === candidate) return pricing;
    }
  }
  return null;
}

export function canonicalModelCandidates(model: string): string[] {
  const values = [model, stripTrailingModelGroup(model), stripTrailingModelDate(stripTrailingModelGroup(model))];
  return Array.from(new Set(values.map(canonicalModelName).filter(Boolean)));
}

export function canonicalModelName(model: string): string {
  const unqualified = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return Array.from(unqualified.toLowerCase()).filter((char) => /[a-z0-9]/.test(char)).join("");
}

export function stripTrailingModelGroup(model: string): string {
  const trimmed = model.trimEnd();
  const last = trimmed.at(-1);
  if (last !== ")" && last !== "]") return model;
  const open = last === ")" ? "(" : "[";
  const index = trimmed.lastIndexOf(open);
  return index > 0 ? trimmed.slice(0, index).trimEnd() : model;
}

export function stripTrailingModelDate(model: string): string {
  const index = model.lastIndexOf("-");
  const suffix = index > 0 ? model.slice(index + 1) : "";
  return /^\d{8}$/.test(suffix) ? model.slice(0, index) : model;
}



export function emptyUsageTotals(): SessionArchiveUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalCost: 0,
    cacheSavings: 0,
  };
}

export function emptyUsageBucket(): UsageBucket {
  return {
    totals: emptyUsageTotals(),
    models: new Set(),
    byModel: new Map(),
    byProject: new Map(),
    byAgent: new Map(),
  };
}

export function addUsage(target: Map<string, UsageBucket>, key: string, usage: UsageAmount, row: UsageRow) {
  const bucket = target.get(key) ?? emptyUsageBucket();
  target.set(key, bucket);
  addTotals(bucket.totals, usage);
  if (row.model) bucket.models.add(row.model);
  addModelBreakdown(bucket.byModel, row.model || "unknown", usage);
  addProjectBreakdown(bucket.byProject, row.project, usage);
  addAgentBreakdown(bucket.byAgent, row.agent, usage);
}

export function addTotals(target: SessionArchiveUsageTotals, usage: UsageAmount) {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationTokens += usage.cacheCreationTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.totalCost = roundCost(target.totalCost + usage.cost);
  target.cacheSavings = roundCost(target.cacheSavings + usage.cacheSavings);
}

export function addModelBreakdown(target: Map<string, SessionArchiveUsageModelBreakdown>, modelName: string, usage: UsageAmount) {
  const current = target.get(modelName) ?? { modelName, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.cacheCreationTokens += usage.cacheCreationTokens;
  current.cacheReadTokens += usage.cacheReadTokens;
  current.cost = roundCost(current.cost + usage.cost);
  target.set(modelName, current);
}

export function addProjectBreakdown(target: Map<string, SessionArchiveUsageProjectBreakdown>, project: string, usage: UsageAmount) {
  const current = target.get(project) ?? { project, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.cacheCreationTokens += usage.cacheCreationTokens;
  current.cacheReadTokens += usage.cacheReadTokens;
  current.cost = roundCost(current.cost + usage.cost);
  target.set(project, current);
}

export function addAgentBreakdown(target: Map<string, SessionArchiveUsageAgentBreakdown>, agent: string, usage: UsageAmount) {
  const current = target.get(agent) ?? { agent, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.cacheCreationTokens += usage.cacheCreationTokens;
  current.cacheReadTokens += usage.cacheReadTokens;
  current.cost = roundCost(current.cost + usage.cost);
  target.set(agent, current);
}

export function usageBucketToDailyEntry(date: string, bucket: UsageBucket) {
  return {
    date,
    inputTokens: bucket.totals.inputTokens,
    outputTokens: bucket.totals.outputTokens,
    cacheCreationTokens: bucket.totals.cacheCreationTokens,
    cacheReadTokens: bucket.totals.cacheReadTokens,
    totalCost: bucket.totals.totalCost,
    modelsUsed: Array.from(bucket.models).sort(),
    modelBreakdowns: Array.from(bucket.byModel.values()).sort(usageCostSortByName("modelName")),
    projectBreakdowns: Array.from(bucket.byProject.values()).sort(usageCostSortByName("project")),
    agentBreakdowns: Array.from(bucket.byAgent.values()).sort(usageCostSortByName("agent")),
  };
}

export function foldProjectTotals(rows: SessionArchiveUsageProjectBreakdown[]): SessionArchiveUsageProjectBreakdown[] {
  const target = new Map<string, SessionArchiveUsageProjectBreakdown>();
  for (const row of rows) addProjectBreakdown(target, row.project, { ...row, totalCost: row.cost, cacheSavings: 0, cost: row.cost, hasUsage: true, priced: true });
  return Array.from(target.values()).sort(usageCostSortByName("project"));
}

export function foldAgentTotals(rows: SessionArchiveUsageAgentBreakdown[]): SessionArchiveUsageAgentBreakdown[] {
  const target = new Map<string, SessionArchiveUsageAgentBreakdown>();
  for (const row of rows) addAgentBreakdown(target, row.agent, { ...row, totalCost: row.cost, cacheSavings: 0, cost: row.cost, hasUsage: true, priced: true });
  return Array.from(target.values()).sort(usageCostSortByName("agent"));
}

export function foldModelTotals(rows: SessionArchiveUsageModelBreakdown[]) {
  const target = new Map<string, SessionArchiveUsageModelBreakdown>();
  for (const row of rows) addModelBreakdown(target, row.modelName, { ...row, totalCost: row.cost, cacheSavings: 0, cost: row.cost, hasUsage: true, priced: true });
  return Array.from(target.values())
    .map((row) => ({ model: row.modelName, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheCreationTokens: row.cacheCreationTokens, cacheReadTokens: row.cacheReadTokens, cost: row.cost }))
    .sort(usageCostSortByName("model"));
}

export function usageCostSortByName<Key extends string>(key: Key) {
  return <Row extends Record<Key, string> & { cost: number }>(left: Row, right: Row) => right.cost - left.cost || left[key].localeCompare(right[key]);
}

export function usageSessionCounts(seenSessions: Map<string, { project: string; agent: string }>) {
  const byProject: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const item of seenSessions.values()) {
    byProject[item.project] = (byProject[item.project] ?? 0) + 1;
    byAgent[item.agent] = (byAgent[item.agent] ?? 0) + 1;
  }
  return { total: seenSessions.size, byProject, byAgent };
}

export function usageDate(timestamp: string): string {
  const parsed = parseTimestamp(timestamp);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
}
export function sessionCost(messages: SessionArchiveMessage[]): number {
  return roundCost(messages.reduce((sum, message) => sum + messageUsageCost(message), 0));
}

export function messageUsageCost(message: SessionArchiveMessage): number {
  const explicitCost = tokenFloat(message.token_usage, "cost_usd", "cost", "total_cost") ?? 0;
  if (explicitCost > 0) return explicitCost;
  const inputTokens = tokenNumber(message.token_usage, "input_tokens", "prompt_tokens", "inputTokens")
    ?? (message.has_context_tokens ? message.context_tokens : 0);
  const outputTokens = tokenNumber(message.token_usage, "output_tokens", "completion_tokens", "outputTokens")
    ?? (message.has_output_tokens ? message.output_tokens : 0);
  const reasoningOutputTokens = tokenNumber(message.token_usage, "reasoning_output_tokens", "reasoningOutputTokens") ?? 0;
  return pricedUsageCost(message.model, {
    inputTokens,
    outputTokens: outputTokens + reasoningOutputTokens,
    cacheCreationTokens: tokenNumber(message.token_usage, "cache_creation_input_tokens", "cacheCreationInputTokens") ?? 0,
    cacheReadTokens: tokenNumber(message.token_usage, "cache_read_input_tokens", "cacheReadInputTokens", "cached_tokens") ?? 0,
  });
}
