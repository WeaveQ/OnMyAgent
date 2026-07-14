import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveSession,
} from "@onmyagent/types/session-archive";
import type { SessionArchiveActivityReportInput } from "./session-archive-types.js";
import {
  dateOnly,
  durationBetween,
  intToBool,
  numberField,
  objectField,
  parseDateOnly,
  parseJsonField,
  parseTimestamp,
  parseToolCalls,
  roundCost,
  stringField,
} from "./session-archive-sql.js";
import { sessionCost, usageDate } from "./session-archive-usage-math.js";

export type AnalyticsMessageRow = {
  session_id: string;
  role: string;
  timestamp: string;
  has_thinking: boolean;
  content_length: number;
  tool_calls_json: unknown;
  agent: string;
  project: string;
};

export type AnalyticsToolCallRow = {
  session_id: string;
  agent: string;
  project: string;
  timestamp: string;
  tool_name: string;
  category: string;
  skill_name: string;
};

export type AnalyticsActivityBucket = {
  messages: number;
  user_messages: number;
  assistant_messages: number;
  tool_calls: number;
  thinking_messages: number;
  by_agent: Record<string, number>;
};

export type VelocitySessionSummary = {
  agent: string;
  messageCount: number;
  durationMin: number;
  contentLength: number;
  toolCalls: number;
  firstResponseSec: number;
  turnCyclesSec: number[];
};

export type VelocityOverview = SessionArchiveAnalyticsVelocityResponse["overall"];

export type TopAnalyticsSession = SessionArchiveAnalyticsTopSessionsResponse["sessions"][number];

export type ActivityRange = {
  timezone: string;
  start: Date;
  end: Date;
  bucketSeconds: number;
  bucketUnit: string;
};

export type ActivityAggregate = {
  key: string;
  agent_minutes: number;
  interactive_agent_minutes: number;
  automated_agent_minutes: number;
  cost: number;
  interactive_cost: number;
  automated_cost: number;
};

export type ParsedTrendTerm = {
  term: string;
  variants: string[];
};
export function analyticsMessageFromRow(row: unknown): AnalyticsMessageRow {
  return {
    session_id: stringField(row, "session_id"),
    role: stringField(row, "role"),
    timestamp: stringField(row, "timestamp"),
    has_thinking: intToBool(objectField(row, "has_thinking")),
    content_length: numberField(row, "content_length"),
    tool_calls_json: objectField(row, "tool_calls_json"),
    agent: stringField(row, "agent"),
    project: stringField(row, "project"),
  };
}

export function numberSort(left: number, right: number): number {
  return left - right;
}

export function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return roundMetric(values[index] ?? 0);
}

export function topMapEntry(map: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const entry of map.entries()) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0].localeCompare(best[0]) < 0)) {
      best = entry;
    }
  }
  return best;
}

export function sessionDate(session: SessionArchiveSession): string | null {
  const raw = session.started_at ?? session.ended_at ?? session.created_at;
  const parsed = parseTimestamp(raw);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

export function nonEmptyString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

export function emptyAnalyticsActivityBucket(): AnalyticsActivityBucket {
  return { messages: 0, user_messages: 0, assistant_messages: 0, tool_calls: 0, thinking_messages: 0, by_agent: {} };
}

export function heatmapLevels(values: number[]): { l1: number; l2: number; l3: number; l4: number } {
  const sorted = values.filter((value) => value > 0).sort(numberSort);
  return {
    l1: Math.max(1, percentile(sorted, 0.25)),
    l2: Math.max(1, percentile(sorted, 0.5)),
    l3: Math.max(1, percentile(sorted, 0.75)),
    l4: Math.max(1, percentile(sorted, 1)),
  };
}

export function heatmapLevel(value: number, levels: { l1: number; l2: number; l3: number; l4: number }): number {
  if (value <= 0) return 0;
  if (value <= levels.l1) return 1;
  if (value <= levels.l2) return 2;
  if (value <= levels.l3) return 3;
  return 4;
}

export function countBy<Item>(items: Item[], key: (item: Item) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const value = key(item) || "unknown";
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

export function groupBy<Item>(items: Item[], key: (item: Item) => string): Map<string, Item[]> {
  const result = new Map<string, Item[]>();
  for (const item of items) {
    const value = key(item) || "unknown";
    const list = result.get(value) ?? [];
    list.push(item);
    result.set(value, list);
  }
  return result;
}

export function dailyTrend(sessions: SessionArchiveSession[]): number {
  const counts = countBy(sessions, (session) => sessionDate(session) ?? "");
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length < 2) return 0;
  const first = entries[0]?.[1] ?? 0;
  const last = entries[entries.length - 1]?.[1] ?? 0;
  return first > 0 ? roundMetric((last - first) / first) : last > 0 ? 1 : 0;
}

export function sessionDurationMs(session: SessionArchiveSession): number {
  return Math.max(0, durationBetween(session.started_at ?? undefined, session.ended_at ?? session.started_at ?? undefined) ?? 0);
}

export function distribution(values: number[], buckets: Array<[string, number, number]>): Array<{ label: string; count: number }> {
  return buckets.map(([label, min, max]) => ({
    label,
    count: values.filter((value) => value >= min && value <= max).length,
  }));
}

export function velocityForSession(session: SessionArchiveSession, messages: AnalyticsMessageRow[]): VelocitySessionSummary {
  const timestamps = messages.map((message) => parseTimestamp(message.timestamp)).filter((date): date is Date => date !== null).sort((left, right) => left.getTime() - right.getTime());
  const firstUser = messages.find((message) => message.role === "user");
  const firstAssistant = messages.find((message) => message.role === "assistant");
  const firstResponse = firstUser && firstAssistant ? Math.max(0, (parseTimestamp(firstAssistant.timestamp)?.getTime() ?? 0) - (parseTimestamp(firstUser.timestamp)?.getTime() ?? 0)) / 1000 : 0;
  const cycles: number[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const current = timestamps[index];
    const previous = timestamps[index - 1];
    if (!current || !previous) continue;
    cycles.push(Math.max(0, (current.getTime() - previous.getTime()) / 1000));
  }
  const durationMin = Math.max(1 / 60, sessionDurationMs(session) / 60000);
  return {
    agent: session.agent,
    messageCount: messages.length,
    durationMin,
    contentLength: messages.reduce((sum, message) => sum + message.content_length, 0),
    toolCalls: messages.reduce((sum, message) => sum + parseToolCalls(message.tool_calls_json).length, 0),
    firstResponseSec: roundMetric(firstResponse),
    turnCyclesSec: cycles,
  };
}

export function velocityOverview(items: VelocitySessionSummary[]): VelocityOverview {
  const cycles = items.flatMap((item) => item.turnCyclesSec).sort(numberSort);
  const firstResponses = items.map((item) => item.firstResponseSec).filter((value) => value > 0).sort(numberSort);
  const totalActiveMin = items.reduce((sum, item) => sum + item.durationMin, 0);
  return {
    turn_cycle_sec: { p50: percentile(cycles, 0.5), p90: percentile(cycles, 0.9) },
    first_response_sec: { p50: percentile(firstResponses, 0.5), p90: percentile(firstResponses, 0.9) },
    msgs_per_active_min: totalActiveMin > 0 ? roundMetric(items.reduce((sum, item) => sum + item.messageCount, 0) / totalActiveMin) : 0,
    chars_per_active_min: totalActiveMin > 0 ? roundMetric(items.reduce((sum, item) => sum + item.contentLength, 0) / totalActiveMin) : 0,
    tool_calls_per_active_min: totalActiveMin > 0 ? roundMetric(items.reduce((sum, item) => sum + item.toolCalls, 0) / totalActiveMin) : 0,
  };
}

export function complexityLabel(messageCount: number): string {
  if (messageCount < 5) return "small";
  if (messageCount < 20) return "medium";
  return "large";
}

export function categoryCountsWithPct(counts: Record<string, number>, total: number): Array<{ category: string; count: number; pct: number }> {
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count, pct: total > 0 ? roundMetric(count / total) : 0 }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

export function agentCountEntries(counts: Record<string, number>): Array<{ agent: string; count: number }> {
  return Object.entries(counts)
    .map(([agent, count]) => ({ agent, count }))
    .sort((left, right) => right.count - left.count || left.agent.localeCompare(right.agent));
}

export function projectCountEntries(counts: Record<string, number>): Array<{ project: string; count: number }> {
  return Object.entries(counts)
    .map(([project, count]) => ({ project, count }))
    .sort((left, right) => right.count - left.count || left.project.localeCompare(right.project));
}

export function metricValue(session: TopAnalyticsSession, metric: string): number {
  if (metric === "duration" || metric === "duration_min") return session.duration_min;
  if (metric === "tokens" || metric === "output_tokens") return session.output_tokens;
  return session.message_count;
}

export function averageNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length > 0 ? roundMetric(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
}

export function aggregateQualitySignals(sessions: SessionArchiveSession[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const session of sessions) {
    const signals = session.quality_signals;
    if (!signals) continue;
    result.short_prompt_count = (result.short_prompt_count ?? 0) + signals.short_prompt_count;
    result.missing_success_criteria_count = (result.missing_success_criteria_count ?? 0) + signals.missing_success_criteria_count;
    result.missing_verification_count = (result.missing_verification_count ?? 0) + signals.missing_verification_count;
    result.duplicate_prompt_count = (result.duplicate_prompt_count ?? 0) + signals.duplicate_prompt_count;
    result.no_code_context_count = (result.no_code_context_count ?? 0) + signals.no_code_context_count;
    result.runaway_tool_loop_count = (result.runaway_tool_loop_count ?? 0) + signals.runaway_tool_loop_count;
  }
  return result;
}

export function signalTrend(sessions: SessionArchiveSession[]): Array<Record<string, unknown>> {
  return Array.from(groupBy(sessions, (session) => sessionDate(session) ?? "unknown").entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => ({
      date,
      sessions: items.length,
      avg_health_score: averageNullable(items.map((session) => session.health_score ?? null)),
      tool_failures: items.reduce((sum, session) => sum + (session.tool_failure_signal_count ?? 0), 0),
    }));
}

export function signalGroup(sessions: SessionArchiveSession[], key: (session: SessionArchiveSession) => string, labelKey: string): Array<Record<string, unknown>> {
  return Array.from(groupBy(sessions, key).entries())
    .map(([label, items]) => ({
      [labelKey]: label,
      sessions: items.length,
      avg_health_score: averageNullable(items.map((session) => session.health_score ?? null)),
      low_health_sessions: items.filter((session) => (session.health_score ?? 1) < 0.6).length,
    }))
    .sort((left, right) => Number(right.sessions ?? 0) - Number(left.sessions ?? 0) || String(left[labelKey] ?? "").localeCompare(String(right[labelKey] ?? "")));
}

export function matchesSignal(session: SessionArchiveSession, signal: string): boolean {
  if (signal === "tool_failure") return (session.tool_failure_signal_count ?? 0) > 0;
  if (signal === "compaction") return (session.compaction_count ?? 0) > 0;
  if (signal === "missing_verification") return (session.quality_signals?.missing_verification_count ?? 0) > 0;
  if (signal === "unscored") return typeof session.health_score !== "number";
  return (session.health_score ?? 1) < 0.6 || ["D", "F", "low", "poor"].includes(session.health_grade ?? "");
}

export function resolveActivityRange(input: SessionArchiveActivityReportInput): ActivityRange {
  const timezone = input.timezone || "UTC";
  const now = new Date();
  let start: Date;
  let end: Date;
  if (input.preset === "custom" && input.from && input.to) {
    start = parseTimestamp(input.from) ?? new Date(`${input.from}T00:00:00Z`);
    end = parseTimestamp(input.to) ?? new Date(`${input.to}T23:59:59Z`);
  } else {
    const anchor = input.date && parseDateOnly(input.date) ? new Date(`${input.date}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (input.preset === "month") {
      start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
    } else if (input.preset === "week") {
      const day = anchor.getUTCDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      start = new Date(anchor.getTime() + mondayOffset * 86400000);
      end = new Date(start.getTime() + 7 * 86400000);
    } else {
      start = anchor;
      end = new Date(anchor.getTime() + 86400000);
    }
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    end = new Date(start.getTime() + 86400000);
  }
  const bucket = input.bucket ?? defaultActivityBucket(start, end);
  return { timezone, start, end, bucketSeconds: bucketSeconds(bucket), bucketUnit: bucket };
}

export function defaultActivityBucket(start: Date, end: Date): "5m" | "15m" | "1h" | "1d" | "1w" {
  const days = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  if (days > 90) return "1w";
  if (days > 14) return "1d";
  if (days > 2) return "1h";
  return "15m";
}

export function bucketSeconds(bucket: "5m" | "15m" | "1h" | "1d" | "1w"): number {
  if (bucket === "5m") return 300;
  if (bucket === "15m") return 900;
  if (bucket === "1h") return 3600;
  if (bucket === "1w") return 604800;
  return 86400;
}

export function sessionOverlapsRange(session: SessionArchiveSession, range: ActivityRange): boolean {
  const start = parseTimestamp(session.started_at ?? session.created_at);
  const end = parseTimestamp(session.ended_at ?? session.started_at ?? session.created_at);
  if (!start || !end) return false;
  return start < range.end && end >= range.start;
}

export function buildActivityBuckets(sessions: SessionArchiveSession[], range: ActivityRange, _bucket?: string): SessionArchiveActivityReport["buckets"] {
  const bucketCount = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / (range.bucketSeconds * 1000)));
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(range.start.getTime() + index * range.bucketSeconds * 1000);
    const end = new Date(Math.min(range.end.getTime(), start.getTime() + range.bucketSeconds * 1000));
    const active = sessions.filter((session) => sessionOverlapsRange(session, { ...range, start, end }));
    const automated = active.filter((session) => session.is_automated);
    const cost = active.reduce((sum, session) => sum + sessionCost([]), 0);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      agent_minutes: roundMetric(active.reduce((sum, session) => sum + Math.min(sessionDurationMs(session) / 60000, range.bucketSeconds / 60), 0)),
      max_agents: active.length,
      interactive_at_peak: active.length - automated.length,
      automated_at_peak: automated.length,
      output_tokens: active.reduce((sum, session) => sum + session.total_output_tokens, 0),
      cost: roundCost(cost),
    };
  });
}

export function addActivityAggregate(target: Map<string, ActivityAggregate>, key: string, session: SessionArchiveSession, minutes: number, cost: number) {
  const current = target.get(key) ?? { key, agent_minutes: 0, interactive_agent_minutes: 0, automated_agent_minutes: 0, cost: 0, interactive_cost: 0, automated_cost: 0 };
  current.agent_minutes = roundMetric(current.agent_minutes + minutes);
  current.cost = roundCost(current.cost + cost);
  if (session.is_automated) {
    current.automated_agent_minutes = roundMetric(current.automated_agent_minutes + minutes);
    current.automated_cost = roundCost(current.automated_cost + cost);
  } else {
    current.interactive_agent_minutes = roundMetric(current.interactive_agent_minutes + minutes);
    current.interactive_cost = roundCost(current.interactive_cost + cost);
  }
  target.set(key, current);
}

export function activityAggregateEntries(target: Map<string, ActivityAggregate>): SessionArchiveActivityReport["by_project"] {
  return Array.from(target.values())
    .sort((left, right) => right.agent_minutes - left.agent_minutes || left.key.localeCompare(right.key));
}
export function parseTrendTerms(values: string[]): ParsedTrendTerm[] {
  return values.slice(0, 12).map((value) => value.split("|").map((part) => part.trim()).filter(Boolean)).filter((variants) => variants.length > 0).map((variants) => ({ term: variants[0] ?? "", variants: Array.from(new Set(variants)).slice(0, 8) }));
}

export function trendBuckets(from: string, to: string, granularity: "day" | "week" | "month"): string[] {
  const start = parseDateOnly(from) ?? new Date(`${from}T00:00:00Z`);
  const end = parseDateOnly(to) ?? new Date(`${to}T00:00:00Z`);
  const buckets: string[] = [];
  for (let cursor = trendBucketStart(start, granularity); cursor <= end; cursor = nextTrendBucket(cursor, granularity)) {
    buckets.push(dateOnly(cursor));
  }
  return buckets.length > 0 ? buckets : [from];
}

export function trendBucketForDate(date: string, granularity: "day" | "week" | "month"): string {
  const parsed = parseDateOnly(date) ?? new Date(`${date}T00:00:00Z`);
  return dateOnly(trendBucketStart(parsed, granularity));
}

export function trendBucketStart(date: Date, granularity: "day" | "week" | "month"): Date {
  if (granularity === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (granularity === "week") {
    const day = date.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + mondayOffset));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function nextTrendBucket(date: Date, granularity: "day" | "week" | "month"): Date {
  if (granularity === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return new Date(date.getTime() + (granularity === "week" ? 7 : 1) * 86400000);
}

export function countTrendTerm(text: string, variants: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const variant of variants) {
    const needle = variant.toLowerCase();
    if (!needle) continue;
    let offset = 0;
    while (offset < lower.length) {
      const index = lower.indexOf(needle, offset);
      if (index < 0) break;
      count += 1;
      offset = index + needle.length;
    }
  }
  return count;
}
