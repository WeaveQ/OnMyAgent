import type { SqliteDatabase } from "../core/sqlite.js";
import type {
  SessionArchiveSession,
  SessionArchiveSessionUsage,
  SessionArchiveTopUsageSession,
  SessionArchiveUsageComparison,
  SessionArchiveUsageSummaryResponse,
  SessionArchiveUsageTotals,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveUsageComparisonInput,
  SessionArchiveUsageFilterInput,
  SessionArchiveUsageTopSessionsInput,
} from "./session-archive-types.js";
import {
  dateOnly,
  numberField,
  parseDateOnly,
  stringField,
} from "./session-archive-sql.js";
import { roundCost } from "./session-archive-sql.js";
import {
  type UsageBucket,
  type UsageRow,
  addUsage,
  emptyUsageTotals,
  foldAgentTotals,
  foldModelTotals,
  foldProjectTotals,
  rowUsage,
  usageBucketToDailyEntry,
  usageDate,
  usageRowFromRow,
  usageSessionCounts,
} from "./session-archive-usage-math.js";

export type SessionArchiveUsageApi = {
  getUsage: (sessionId: string) => SessionArchiveSessionUsage | null;
  getUsageSummary: (input: SessionArchiveUsageFilterInput) => SessionArchiveUsageSummaryResponse;
  getUsageComparison: (input: SessionArchiveUsageComparisonInput) => SessionArchiveUsageComparison;
  getTopUsageSessions: (input: SessionArchiveUsageTopSessionsInput) => SessionArchiveTopUsageSession[];
  usageRows: (input: SessionArchiveUsageFilterInput) => UsageRow[];
};

export function createSessionArchiveUsageApi(input: {
  db: SqliteDatabase;
  getSession: (sessionId: string) => SessionArchiveSession | null;
}): SessionArchiveUsageApi {
  const { db, getSession } = input;

function getUsage(sessionId: string): SessionArchiveSessionUsage | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const rows = db.prepare(`
    SELECT m.session_id, m.timestamp, m.model, m.token_usage_json, m.context_tokens, m.output_tokens,
           m.has_context_tokens, m.has_output_tokens,
           s.project, s.machine, s.agent, s.display_name, s.first_message, s.started_at,
           s.user_message_count, s.is_automated
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE m.session_id = ?
    ORDER BY m.timestamp ASC, m.ordinal ASC
  `).all(sessionId).map(usageRowFromRow);
  const models = new Set<string>();
  let hasTokenData = Boolean(session.has_total_output_tokens || session.has_peak_context_tokens);
  let cost = 0;
  const unpricedModels = new Set<string>();
  for (const row of rows) {
    if (row.model) models.add(row.model);
    const usage = rowUsage(row);
    if (usage.hasUsage) {
      hasTokenData = true;
      cost = roundCost(cost + usage.cost);
      if (row.model && usage.cost === 0 && !usage.priced) unpricedModels.add(row.model);
    }
  }
  return {
    session_id: session.id,
    agent: session.agent,
    project: session.project,
    total_output_tokens: session.total_output_tokens,
    peak_context_tokens: session.peak_context_tokens,
    has_token_data: hasTokenData,
    cost_usd: cost,
    has_cost: cost > 0,
    models: Array.from(models).sort(),
    unpriced_models: Array.from(unpricedModels).sort(),
    server_running: true,
  };
}

function getUsageSummary(input: SessionArchiveUsageFilterInput): SessionArchiveUsageSummaryResponse {
  const rows = usageRows(input);
  const daily = new Map<string, UsageBucket>();
  const seenSessions = new Map<string, { project: string; agent: string }>();
  for (const row of rows) {
    const usage = rowUsage(row);
    if (!usage.hasUsage) continue;
    const date = usageDate(row.timestamp);
    if (date < input.from || date > input.to) continue;
    seenSessions.set(row.session_id, { project: row.project, agent: row.agent });
    addUsage(daily, date, usage, row);
  }
  const dailyEntries = Array.from(daily.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bucket]) => usageBucketToDailyEntry(date, bucket));
  const totals = dailyEntries.reduce<SessionArchiveUsageTotals>((sum, entry) => ({
    inputTokens: sum.inputTokens + entry.inputTokens,
    outputTokens: sum.outputTokens + entry.outputTokens,
    cacheCreationTokens: sum.cacheCreationTokens + entry.cacheCreationTokens,
    cacheReadTokens: sum.cacheReadTokens + entry.cacheReadTokens,
    totalCost: roundCost(sum.totalCost + entry.totalCost),
    cacheSavings: roundCost(sum.cacheSavings),
  }), emptyUsageTotals());
  const projectTotals = foldProjectTotals(dailyEntries.flatMap((entry) => entry.projectBreakdowns ?? []));
  const modelTotals = foldModelTotals(dailyEntries.flatMap((entry) => entry.modelBreakdowns ?? []));
  const agentTotals = foldAgentTotals(dailyEntries.flatMap((entry) => entry.agentBreakdowns ?? []));
  return {
    from: input.from,
    to: input.to,
    totals,
    daily: dailyEntries,
    projectTotals,
    modelTotals,
    agentTotals,
    sessionCounts: usageSessionCounts(seenSessions),
    cacheStats: {
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      uncachedInputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      hitRate: totals.cacheReadTokens + totals.inputTokens > 0 ? totals.cacheReadTokens / (totals.cacheReadTokens + totals.inputTokens) : 0,
      savingsVsUncached: totals.cacheSavings,
    },
  };
}

function getUsageComparison(input: SessionArchiveUsageComparisonInput): SessionArchiveUsageComparison {
  const from = parseDateOnly(input.from) ?? new Date(`${input.from}T00:00:00Z`);
  const to = parseDateOnly(input.to) ?? new Date(`${input.to}T00:00:00Z`);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const priorTo = new Date(from.getTime() - 86400000);
  const priorFrom = new Date(priorTo.getTime() - (days - 1) * 86400000);
  const priorSummary = getUsageSummary({
    ...input,
    from: dateOnly(priorFrom),
    to: dateOnly(priorTo),
  });
  const priorTotalCost = priorSummary.totals.totalCost;
  return {
    priorFrom: dateOnly(priorFrom),
    priorTo: dateOnly(priorTo),
    priorTotalCost,
    deltaPct: priorTotalCost > 0 ? (input.currentCost - priorTotalCost) / priorTotalCost : 0,
  };
}

function getTopUsageSessions(input: SessionArchiveUsageTopSessionsInput): SessionArchiveTopUsageSession[] {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 20)));
  const totals = new Map<string, { session: UsageRow; totalTokens: number; cost: number }>();
  for (const row of usageRows(input)) {
    const usage = rowUsage(row);
    if (!usage.hasUsage) continue;
    const date = usageDate(row.timestamp);
    if (date < input.from || date > input.to) continue;
    const current = totals.get(row.session_id) ?? { session: row, totalTokens: 0, cost: 0 };
    current.totalTokens += usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
    current.cost = roundCost(current.cost + usage.cost);
    totals.set(row.session_id, current);
  }
  return Array.from(totals.entries())
    .map(([sessionId, value]) => ({
      sessionId,
      displayName: value.session.display_name || value.session.first_message || sessionId,
      agent: value.session.agent,
      project: value.session.project,
      startedAt: value.session.started_at ?? "",
      totalTokens: value.totalTokens,
      cost: value.cost,
    }))
    .sort((left, right) => right.cost - left.cost || right.totalTokens - left.totalTokens || left.sessionId.localeCompare(right.sessionId))
    .slice(0, limit);
}


function usageRows(input: SessionArchiveUsageFilterInput): UsageRow[] {
  const eventRows = db.prepare(`
    SELECT ue.session_id,
           COALESCE(ue.occurred_at, s.ended_at, s.started_at, s.created_at) AS timestamp,
           ue.model,
           json_object(
             'input_tokens', ue.input_tokens,
             'output_tokens', ue.output_tokens,
             'cache_creation_input_tokens', ue.cache_creation_input_tokens,
             'cache_read_input_tokens', ue.cache_read_input_tokens,
             'reasoning_output_tokens', ue.reasoning_tokens,
             'cost_usd', COALESCE(ue.cost_usd, 0)
           ) AS token_usage_json,
           ue.input_tokens + ue.cache_creation_input_tokens + ue.cache_read_input_tokens AS context_tokens,
           ue.output_tokens AS output_tokens,
           1 AS has_context_tokens,
           1 AS has_output_tokens,
           s.project, s.machine, s.agent, s.display_name, s.first_message, s.started_at,
           s.user_message_count, s.is_automated
    FROM usage_events ue
    JOIN sessions s ON s.id = ue.session_id
    WHERE s.deleted_at IS NULL
      AND (? = '' OR s.agent = ?)
      AND (? = '' OR s.project = ?)
      AND (? = '' OR s.machine = ?)
      AND (? = '' OR ue.model = ?)
      AND (? = '' OR s.project != ?)
      AND (? = '' OR s.agent != ?)
      AND (? = '' OR ue.model != ?)
      AND (? = 0 OR s.user_message_count >= ?)
      AND (? = 1 OR s.user_message_count > 1)
      AND (? = 1 OR s.is_automated = 0)
      AND (? = '' OR COALESCE(s.ended_at, s.started_at, s.created_at) >= ?)
  `).all(
    input.agent ?? "", input.agent ?? "",
    input.project ?? "", input.project ?? "",
    input.machine ?? "", input.machine ?? "",
    input.model ?? "", input.model ?? "",
    input.excludeProject ?? "", input.excludeProject ?? "",
    input.excludeAgent ?? "", input.excludeAgent ?? "",
    input.excludeModel ?? "", input.excludeModel ?? "",
    input.minUserMessages ?? 0, input.minUserMessages ?? 0,
    input.includeOneShot === false ? 0 : 1,
    input.includeAutomated ? 1 : 0,
    input.activeSince ?? "", input.activeSince ?? "",
  );
  const messageRows = db.prepare(`
    SELECT m.session_id, m.timestamp, m.model, m.token_usage_json, m.context_tokens, m.output_tokens,
           m.has_context_tokens, m.has_output_tokens,
           s.project, s.machine, s.agent, s.display_name, s.first_message, s.started_at,
           s.user_message_count, s.is_automated
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.deleted_at IS NULL
      AND (? = '' OR s.agent = ?)
      AND (? = '' OR s.project = ?)
      AND (? = '' OR s.machine = ?)
      AND (? = '' OR m.model = ?)
      AND (? = '' OR s.project != ?)
      AND (? = '' OR s.agent != ?)
      AND (? = '' OR m.model != ?)
      AND (? = 0 OR s.user_message_count >= ?)
      AND (? = 1 OR s.user_message_count > 1)
      AND (? = 1 OR s.is_automated = 0)
      AND (? = '' OR COALESCE(s.ended_at, s.started_at, s.created_at) >= ?)
      AND NOT EXISTS (SELECT 1 FROM usage_events ue WHERE ue.session_id = m.session_id)
    ORDER BY m.timestamp ASC, m.session_id ASC, m.ordinal ASC
  `).all(
    input.agent ?? "", input.agent ?? "",
    input.project ?? "", input.project ?? "",
    input.machine ?? "", input.machine ?? "",
    input.model ?? "", input.model ?? "",
    input.excludeProject ?? "", input.excludeProject ?? "",
    input.excludeAgent ?? "", input.excludeAgent ?? "",
    input.excludeModel ?? "", input.excludeModel ?? "",
    input.minUserMessages ?? 0, input.minUserMessages ?? 0,
    input.includeOneShot === false ? 0 : 1,
    input.includeAutomated ? 1 : 0,
    input.activeSince ?? "", input.activeSince ?? "",
  );
  return [...eventRows, ...messageRows]
    .map(usageRowFromRow)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.session_id.localeCompare(right.session_id));
}


  return {
    getUsage,
    getUsageSummary,
    getUsageComparison,
    getTopUsageSessions,
    usageRows,
  };
}
