import type { SqliteDatabase } from "../core/sqlite.js";
import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsActivityResponse,
  SessionArchiveAnalyticsBatchResponse,
  SessionArchiveAnalyticsHeatmapResponse,
  SessionArchiveAnalyticsHourOfWeekResponse,
  SessionArchiveAnalyticsProjectsResponse,
  SessionArchiveAnalyticsSessionShapeResponse,
  SessionArchiveAnalyticsSignalSessionsResponse,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSkillsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveMessage,
  SessionArchiveSession,
  SessionArchiveTrendsTermsResponse,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveActivityReportInput,
  SessionArchiveTrendsTermsInput,
  SessionArchiveUsageFilterInput,
} from "./session-archive-types.js";
import {
  normalizeLimit,
  parseTimestamp,
  parseToolCalls,
  roundCost,
  sessionFromRow,
  stringField,
} from "./session-archive-sql.js";
import {
  type UsageRow,
  sessionCost,
  usageDate,
} from "./session-archive-usage-math.js";
import {
  type AnalyticsActivityBucket,
  type AnalyticsMessageRow,
  type AnalyticsToolCallRow,
  type ActivityAggregate,
  activityAggregateEntries,
  addActivityAggregate,
  agentCountEntries,
  aggregateQualitySignals,
  analyticsMessageFromRow,
  averageNullable,
  buildActivityBuckets,
  categoryCountsWithPct,
  complexityLabel,
  countBy,
  countTrendTerm,
  dailyTrend,
  distribution,
  emptyAnalyticsActivityBucket,
  groupBy,
  heatmapLevel,
  heatmapLevels,
  matchesSignal,
  metricValue,
  nonEmptyString,
  numberSort,
  parseTrendTerms,
  percentile,
  projectCountEntries,
  resolveActivityRange,
  roundMetric,
  sessionDate,
  sessionDurationMs,
  sessionOverlapsRange,
  signalGroup,
  signalTrend,
  topMapEntry,
  trendBucketForDate,
  trendBuckets,
  velocityForSession,
  velocityOverview,
} from "./session-archive-analytics-math.js";
import {
  ANALYTICS_CACHE_TTL_MS,
  analyticsCacheScopeKey,
  shouldServeAnalyticsCache,
} from "./analytics-cache-policy.js";

export type SessionArchiveAnalyticsApi = {
  getAnalyticsSummary: () => SessionArchiveAnalyticsSummary;
  getAnalyticsActivity: () => SessionArchiveAnalyticsActivityResponse;
  getAnalyticsHeatmap: (metric?: string) => SessionArchiveAnalyticsHeatmapResponse;
  getAnalyticsProjects: () => SessionArchiveAnalyticsProjectsResponse;
  getAnalyticsHourOfWeek: () => SessionArchiveAnalyticsHourOfWeekResponse;
  getAnalyticsSessionShape: () => SessionArchiveAnalyticsSessionShapeResponse;
  getAnalyticsVelocity: () => SessionArchiveAnalyticsVelocityResponse;
  getAnalyticsTools: () => SessionArchiveAnalyticsToolsResponse;
  getAnalyticsSkills: () => SessionArchiveAnalyticsSkillsResponse;
  getAnalyticsTopSessions: (metric?: string, limit?: number) => SessionArchiveAnalyticsTopSessionsResponse;
  getAnalyticsSignals: () => SessionArchiveAnalyticsSignalsResponse;
  getAnalyticsSignalSessions: (signal: string, limit?: number) => SessionArchiveAnalyticsSignalSessionsResponse;
  getAnalyticsBatch: () => SessionArchiveAnalyticsBatchResponse;
  getActivityReport: (input: SessionArchiveActivityReportInput) => SessionArchiveActivityReport;
  getTrendsTerms: (input: SessionArchiveTrendsTermsInput) => SessionArchiveTrendsTermsResponse;
};

export function createSessionArchiveAnalyticsApi(input: {
  db: SqliteDatabase;
  /** Stable scope (typically archive dbPath) so caches never cross workspaces. */
  cacheScope?: string;
  listAllMessages: (sessionId: string) => SessionArchiveMessage[];
  usageRows: (input: SessionArchiveUsageFilterInput) => UsageRow[];
}): SessionArchiveAnalyticsApi {
  const { db, listAllMessages, usageRows } = input;
  const scopeKey = analyticsCacheScopeKey({
    dbPath: input.cacheScope?.trim() || "default",
  });

// TTL cache for analytics data — scoped by cacheScope/dbPath, never shared across archives.
const _analyticsCache = {
  scopeKey: null as string | null,
  sessions: null as SessionArchiveSession[] | null,
  messages: null as AnalyticsMessageRow[] | null,
  toolCalls: null as AnalyticsToolCallRow[] | null,
  _timestamp: 0,
  isHit() {
    return shouldServeAnalyticsCache({
      scopeKey,
      cachedScopeKey: this.scopeKey,
      cachedAtMs: this._timestamp,
      nowMs: Date.now(),
      ttlMs: ANALYTICS_CACHE_TTL_MS,
    });
  },
  reset() {
    this.scopeKey = null;
    this.sessions = null;
    this.messages = null;
    this.toolCalls = null;
    this._timestamp = 0;
  },
  _touch() {
    this.scopeKey = scopeKey;
    this._timestamp = Date.now();
  },
};

function analyticsSessions(): SessionArchiveSession[] {
  if (_analyticsCache.sessions && _analyticsCache.isHit()) return _analyticsCache.sessions;
  _analyticsCache.sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE deleted_at IS NULL
    ORDER BY COALESCE(started_at, ended_at, created_at) ASC, id ASC
  `).all().map(sessionFromRow);
  _analyticsCache._touch();
  return _analyticsCache.sessions;
}

function analyticsMessages(): AnalyticsMessageRow[] {
  if (_analyticsCache.messages && _analyticsCache.isHit()) return _analyticsCache.messages;
  _analyticsCache.messages = db.prepare(`
    SELECT m.session_id, m.role, m.timestamp, m.has_thinking, m.content_length, m.tool_calls_json,
           s.agent, s.project
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.deleted_at IS NULL AND m.is_system = 0
    ORDER BY m.timestamp ASC, m.session_id ASC, m.ordinal ASC
  `).all().map(analyticsMessageFromRow);
  _analyticsCache._touch();
  return _analyticsCache.messages;
}

function toolCallRows(): AnalyticsToolCallRow[] {
  if (_analyticsCache.toolCalls && _analyticsCache.isHit()) return _analyticsCache.toolCalls;
  const rows: AnalyticsToolCallRow[] = [];
  for (const message of analyticsMessages()) {
    for (const call of parseToolCalls(message.tool_calls_json)) {
      rows.push({
        session_id: message.session_id,
        agent: message.agent,
        project: message.project,
        timestamp: message.timestamp,
        tool_name: call.tool_name,
        category: call.category || "Other",
        skill_name: call.skill_name ?? "",
      });
    }
  }
  _analyticsCache.toolCalls = rows;
  _analyticsCache._touch();
  return rows;
}

function toolCallRowsBySession(): Map<string, AnalyticsToolCallRow[]> {
  return groupBy(toolCallRows(), (row) => row.session_id);
}


// NOTE: Analytics cache is per-module-load. For long-running processes,
// consider adding a TTL or explicit per-request reset.
function getAnalyticsSummary(): SessionArchiveAnalyticsSummary {
  const sessions = analyticsSessions();
  const messages = analyticsMessages();
  const messageCounts = sessions.map((session) => session.message_count).sort(numberSort);
  const projectCounts = new Map<string, number>();
  const activeDays = new Set<string>();
  const agents: SessionArchiveAnalyticsSummary["agents"] = {};
  for (const session of sessions) {
    projectCounts.set(session.project, (projectCounts.get(session.project) ?? 0) + 1);
    const day = sessionDate(session);
    if (day) activeDays.add(day);
    const current = agents[session.agent] ?? { sessions: 0, messages: 0 };
    current.sessions += 1;
    current.messages += session.message_count;
    agents[session.agent] = current;
  }
  const mostActiveProject = topMapEntry(projectCounts)?.[0] ?? "";
  const topProjectSessions = topMapEntry(projectCounts)?.[1] ?? 0;
  return {
    total_sessions: sessions.length,
    total_messages: messages.length,
    total_output_tokens: sessions.reduce((sum, session) => sum + session.total_output_tokens, 0),
    token_reporting_sessions: sessions.filter((session) => session.has_total_output_tokens || session.total_output_tokens > 0).length,
    active_projects: projectCounts.size,
    active_days: activeDays.size,
    avg_messages: sessions.length > 0 ? roundMetric(messageCounts.reduce((sum, count) => sum + count, 0) / sessions.length) : 0,
    median_messages: percentile(messageCounts, 0.5),
    p90_messages: percentile(messageCounts, 0.9),
    most_active_project: mostActiveProject,
    concentration: sessions.length > 0 ? roundMetric(topProjectSessions / sessions.length) : 0,
    agents,
  };
}

function getAnalyticsActivity(): SessionArchiveAnalyticsActivityResponse {
  const sessionCounts = new Map<string, Set<string>>();
  for (const session of analyticsSessions()) {
    const day = sessionDate(session);
    if (!day) continue;
    const bucket = sessionCounts.get(day) ?? new Set<string>();
    bucket.add(session.id);
    sessionCounts.set(day, bucket);
  }
  const buckets = new Map<string, AnalyticsActivityBucket>();
  for (const message of analyticsMessages()) {
    const day = usageDate(message.timestamp);
    if (!day) continue;
    const bucket = buckets.get(day) ?? emptyAnalyticsActivityBucket();
    bucket.messages += 1;
    if (message.role === "user") bucket.user_messages += 1;
    if (message.role === "assistant") bucket.assistant_messages += 1;
    bucket.tool_calls += parseToolCalls(message.tool_calls_json).length;
    if (message.has_thinking) bucket.thinking_messages += 1;
    bucket.by_agent[message.agent] = (bucket.by_agent[message.agent] ?? 0) + 1;
    buckets.set(day, bucket);
  }
  const dates = Array.from(new Set([...buckets.keys(), ...sessionCounts.keys()])).sort();
  return {
    granularity: "day",
    series: dates.map((date) => {
      const bucket = buckets.get(date) ?? emptyAnalyticsActivityBucket();
      return {
        date,
        sessions: sessionCounts.get(date)?.size ?? 0,
        messages: bucket.messages,
        user_messages: bucket.user_messages,
        assistant_messages: bucket.assistant_messages,
        tool_calls: bucket.tool_calls,
        thinking_messages: bucket.thinking_messages,
        by_agent: bucket.by_agent,
      };
    }),
  };
}

function getAnalyticsHeatmap(metric = "messages"): SessionArchiveAnalyticsHeatmapResponse {
  const activity = getAnalyticsActivity();
  const entriesBase = activity.series.map((entry) => ({
    date: entry.date,
    value: metric === "sessions" ? entry.sessions : metric === "tool_calls" ? entry.tool_calls : entry.messages,
  }));
  const levels = heatmapLevels(entriesBase.map((entry) => entry.value));
  return {
    metric,
    entries: entriesBase.map((entry) => ({ ...entry, level: heatmapLevel(entry.value, levels) })),
    levels,
    entries_from: entriesBase[0]?.date ?? "",
  };
}

function getAnalyticsProjects(): SessionArchiveAnalyticsProjectsResponse {
  const byProject = new Map<string, SessionArchiveSession[]>();
  for (const session of analyticsSessions()) {
    const list = byProject.get(session.project) ?? [];
    list.push(session);
    byProject.set(session.project, list);
  }
  return {
    projects: Array.from(byProject.entries()).map(([name, sessions]) => {
      const messageCounts = sessions.map((session) => session.message_count).sort(numberSort);
      const dates = sessions.map(sessionDate).filter(nonEmptyString).sort();
      const agents = countBy(sessions, (session) => session.agent);
      return {
        name,
        sessions: sessions.length,
        messages: sessions.reduce((sum, session) => sum + session.message_count, 0),
        first_session: dates[0] ?? "",
        last_session: dates[dates.length - 1] ?? "",
        avg_messages: sessions.length > 0 ? roundMetric(messageCounts.reduce((sum, count) => sum + count, 0) / sessions.length) : 0,
        median_messages: percentile(messageCounts, 0.5),
        agents,
        daily_trend: dailyTrend(sessions),
      };
    }).sort((left, right) => right.sessions - left.sessions || left.name.localeCompare(right.name)),
  };
}

function getAnalyticsHourOfWeek(): SessionArchiveAnalyticsHourOfWeekResponse {
  const cells = new Map<string, number>();
  for (const message of analyticsMessages()) {
    const timestamp = parseTimestamp(message.timestamp);
    if (!timestamp) continue;
    const key = `${timestamp.getUTCDay()}:${timestamp.getUTCHours()}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  return {
    cells: Array.from({ length: 7 * 24 }, (_, index) => {
      const day = Math.floor(index / 24);
      const hour = index % 24;
      return { day_of_week: day, hour, messages: cells.get(`${day}:${hour}`) ?? 0 };
    }),
  };
}

function getAnalyticsSessionShape(): SessionArchiveAnalyticsSessionShapeResponse {
  const sessions = analyticsSessions();
  const toolCallsBySession = toolCallRowsBySession();
  return {
    count: sessions.length,
    length_distribution: distribution(sessions.map((session) => session.message_count), [
      ["1-4", 1, 4], ["5-14", 5, 14], ["15-39", 15, 39], ["40+", 40, Number.POSITIVE_INFINITY],
    ]),
    duration_distribution: distribution(sessions.map((session) => Math.round(sessionDurationMs(session) / 60000)), [
      ["<5m", 0, 4], ["5-30m", 5, 30], ["30-120m", 31, 120], ["120m+", 121, Number.POSITIVE_INFINITY],
    ]),
    autonomy_distribution: distribution(sessions.map((session) => {
      const toolCalls = toolCallsBySession.get(session.id)?.length ?? 0;
      return session.user_message_count > 0 ? toolCalls / session.user_message_count : toolCalls;
    }), [["low", 0, 0.99], ["medium", 1, 2.99], ["high", 3, Number.POSITIVE_INFINITY]]),
  };
}

function getAnalyticsVelocity(): SessionArchiveAnalyticsVelocityResponse {
  const sessions = analyticsSessions();
  const messagesBySession = groupBy(analyticsMessages(), (message) => message.session_id);
  const summaries = sessions.map((session) => velocityForSession(session, messagesBySession.get(session.id) ?? []));
  const byAgent = Array.from(groupBy(summaries, (summary) => summary.agent).entries())
    .map(([label, items]) => ({ label, sessions: items.length, overview: velocityOverview(items) }))
    .sort((left, right) => right.sessions - left.sessions || left.label.localeCompare(right.label));
  const byComplexity = Array.from(groupBy(summaries, (summary) => complexityLabel(summary.messageCount)).entries())
    .map(([label, items]) => ({ label, sessions: items.length, overview: velocityOverview(items) }))
    .sort((left, right) => left.label.localeCompare(right.label));
  return { overall: velocityOverview(summaries), by_agent: byAgent, by_complexity: byComplexity };
}

function getAnalyticsTools(): SessionArchiveAnalyticsToolsResponse {
  const rows = toolCallRows();
  const byCategory = countBy(rows, (row) => row.category);
  const byAgentMap = groupBy(rows, (row) => row.agent);
  const trendMap = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const date = usageDate(row.timestamp);
    if (!date) continue;
    const current = trendMap.get(date) ?? {};
    current[row.category] = (current[row.category] ?? 0) + 1;
    trendMap.set(date, current);
  }
  return {
    total_calls: rows.length,
    by_category: categoryCountsWithPct(byCategory, rows.length),
    by_agent: Array.from(byAgentMap.entries()).map(([agent, items]) => ({
      agent,
      total: items.length,
      categories: categoryCountsWithPct(countBy(items, (row) => row.category), items.length),
    })).sort((left, right) => right.total - left.total || left.agent.localeCompare(right.agent)),
    trend: Array.from(trendMap.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, by_category]) => ({ date, by_category })),
  };
}

function getAnalyticsSkills(): SessionArchiveAnalyticsSkillsResponse {
  const rows = toolCallRows().filter((row) => row.skill_name.trim());
  const bySkill = groupBy(rows, (row) => row.skill_name);
  const trendMap = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const date = usageDate(row.timestamp);
    if (!date) continue;
    const current = trendMap.get(date) ?? {};
    current[row.skill_name] = (current[row.skill_name] ?? 0) + 1;
    trendMap.set(date, current);
  }
  return {
    total_skill_calls: rows.length,
    distinct_skills: bySkill.size,
    by_skill: Array.from(bySkill.entries()).map(([skill_name, items]) => ({
      skill_name,
      call_count: items.length,
      session_count: new Set(items.map((item) => item.session_id)).size,
      agent_breakdown: agentCountEntries(countBy(items, (item) => item.agent)),
      project_breakdown: projectCountEntries(countBy(items, (item) => item.project)),
      last_used_at: items.map((item) => item.timestamp).sort().at(-1) ?? "",
      pct: rows.length > 0 ? roundMetric(items.length / rows.length) : 0,
    })).sort((left, right) => right.call_count - left.call_count || left.skill_name.localeCompare(right.skill_name)),
    trend: Array.from(trendMap.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, by_skill]) => ({ date, by_skill })),
  };
}

function getAnalyticsTopSessions(metric = "messages", limitValue?: number): SessionArchiveAnalyticsTopSessionsResponse {
  const limit = normalizeLimit(limitValue);
  const sessions = analyticsSessions().map((session) => ({
    id: session.id,
    project: session.project,
    first_message: session.first_message,
    display_name: session.display_name,
    message_count: session.message_count,
    output_tokens: session.total_output_tokens,
    duration_min: roundMetric(sessionDurationMs(session) / 60000),
    started_at: session.started_at,
    ended_at: session.ended_at,
    termination_status: session.termination_status,
  })).sort((left, right) => metricValue(right, metric) - metricValue(left, metric) || left.id.localeCompare(right.id));
  return { metric, sessions: sessions.slice(0, limit) };
}

function getAnalyticsSignals(): SessionArchiveAnalyticsSignalsResponse {
  const sessions = analyticsSessions();
  const scored = sessions.filter((session) => typeof session.health_score === "number");
  const avgHealth = scored.length > 0 ? roundMetric(scored.reduce((sum, session) => sum + (session.health_score ?? 0), 0) / scored.length) : null;
  return {
    scored_sessions: scored.length,
    unscored_sessions: sessions.length - scored.length,
    grade_distribution: countBy(sessions, (session) => session.health_grade || "unknown"),
    avg_health_score: avgHealth,
    outcome_distribution: countBy(sessions, (session) => session.outcome || "unknown"),
    outcome_confidence_distribution: countBy(sessions, (session) => session.outcome_confidence || "unknown"),
    tool_health: {
      failure_sessions: sessions.filter((session) => (session.tool_failure_signal_count ?? 0) > 0).length,
      avg_retry_count: averageNullable(sessions.map((session) => session.tool_retry_count ?? null)),
      avg_consecutive_failure_max: averageNullable(sessions.map((session) => session.consecutive_failure_max ?? null)),
    },
    context_health: {
      compaction_sessions: sessions.filter((session) => (session.compaction_count ?? 0) > 0).length,
      avg_context_pressure_max: averageNullable(sessions.map((session) => session.context_pressure_max ?? null)),
    },
    quality_health: aggregateQualitySignals(sessions),
    trend: signalTrend(sessions),
    by_agent: signalGroup(sessions, (session) => session.agent, "agent"),
    by_project: signalGroup(sessions, (session) => session.project, "project"),
    calibration: { source: "archive_session_signals", calibrated: scored.length > 0 },
  };
}

// Batch analytics endpoint: single request for all analytics data
// Leverages analytics cache so each dataset is computed only once
function getAnalyticsBatch(): SessionArchiveAnalyticsBatchResponse {
  return {
    summary: getAnalyticsSummary(),
    activity: getAnalyticsActivity(),
    heatmap: getAnalyticsHeatmap(),
    projects: getAnalyticsProjects(),
    hourOfWeek: getAnalyticsHourOfWeek(),
    sessionShape: getAnalyticsSessionShape(),
    velocity: getAnalyticsVelocity(),
    tools: getAnalyticsTools(),
    skills: getAnalyticsSkills(),
    topSessions: getAnalyticsTopSessions(),
    signals: getAnalyticsSignals(),
  };
}

function getAnalyticsSignalSessions(signal: string, limitValue?: number): SessionArchiveAnalyticsSignalSessionsResponse {
  const normalized = signal.trim() || "low_health";
  const limit = normalizeLimit(limitValue);
  return {
    signal: normalized,
    sessions: analyticsSessions()
      .filter((session) => matchesSignal(session, normalized))
      .sort((left, right) => (sessionDate(right) ?? "").localeCompare(sessionDate(left) ?? "") || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((session) => ({
        id: session.id,
        project: session.project,
        agent: session.agent,
        first_message: session.first_message,
        health_score: session.health_score ?? null,
        health_grade: session.health_grade ?? null,
        outcome: session.outcome ?? "",
        started_at: session.started_at,
      })),
  };
}

function getActivityReport(input: SessionArchiveActivityReportInput): SessionArchiveActivityReport {
  const range = resolveActivityRange(input);
  const sessions = analyticsSessions().filter((session) => {
    if (!sessionOverlapsRange(session, range)) return false;
    if (input.project && session.project !== input.project) return false;
    if (input.agent && session.agent !== input.agent) return false;
    if (input.machine && session.machine !== input.machine) return false;
    if (input.automation === "interactive" && session.is_automated) return false;
    if (input.automation === "automated" && !session.is_automated) return false;
    return true;
  });
  const buckets = buildActivityBuckets(sessions, range, input.bucket);
  const models = new Set<string>();
  const byProject = new Map<string, ActivityAggregate>();
  const byAgent = new Map<string, ActivityAggregate>();
  const byModel = new Map<string, ActivityAggregate>();
  const bySession = sessions.map((session) => {
    const messages = listAllMessages(session.id);
    const sessionModels = Array.from(new Set(messages.map((message) => message.model).filter(Boolean))).sort();
    for (const model of sessionModels) models.add(model);
    const minutes = roundMetric(sessionDurationMs(session) / 60000);
    const cost = sessionCost(messages);
    addActivityAggregate(byProject, session.project, session, minutes, cost);
    addActivityAggregate(byAgent, session.agent, session, minutes, cost);
    for (const model of sessionModels.length ? sessionModels : [""]) {
      addActivityAggregate(byModel, model || "unknown", session, minutes, cost);
    }
    return {
      session_id: session.id,
      title: session.display_name || session.first_message || session.id,
      project: session.project,
      agent: session.agent,
      primary_model: sessionModels[0] ?? "",
      models: sessionModels,
      is_automated: session.is_automated,
      first_active: session.started_at,
      last_active: session.ended_at,
      agent_minutes: minutes > 0 ? minutes : null,
      output_tokens: session.total_output_tokens,
      cost,
      timing_quality: session.started_at && session.ended_at ? "timed" : "untimed",
    };
  });
  const agentMinutes = bySession.reduce((sum, row) => sum + (row.agent_minutes ?? 0), 0);
  const interactiveRows = bySession.filter((row) => !row.is_automated);
  const automatedRows = bySession.filter((row) => row.is_automated);
  const peak = buckets.reduce<{ at: string | null; agents: number }>((best, bucket) => {
    if (bucket.max_agents > best.agents) return { at: bucket.start, agents: bucket.max_agents };
    return best;
  }, { at: null, agents: 0 });
  return {
    timezone: range.timezone,
    range_start: range.start.toISOString(),
    range_end: range.end.toISOString(),
    effective_end: range.end.toISOString(),
    as_of: new Date().toISOString(),
    partial: false,
    bucket_count: buckets.length,
    elapsed_bucket_count: buckets.length,
    bucket_seconds: range.bucketSeconds,
    bucket_unit: range.bucketUnit,
    peak,
    totals: {
      sessions: sessions.length,
      interactive_sessions: interactiveRows.length,
      automated_sessions: automatedRows.length,
      active_minutes: roundMetric(agentMinutes),
      idle_minutes: 0,
      agent_minutes: roundMetric(agentMinutes),
      interactive_agent_minutes: roundMetric(interactiveRows.reduce((sum, row) => sum + (row.agent_minutes ?? 0), 0)),
      automated_agent_minutes: roundMetric(automatedRows.reduce((sum, row) => sum + (row.agent_minutes ?? 0), 0)),
      output_tokens: sessions.reduce((sum, session) => sum + session.total_output_tokens, 0),
      cost: roundCost(bySession.reduce((sum, row) => sum + row.cost, 0)),
      interactive_cost: roundCost(interactiveRows.reduce((sum, row) => sum + row.cost, 0)),
      automated_cost: roundCost(automatedRows.reduce((sum, row) => sum + row.cost, 0)),
      distinct_projects: byProject.size,
      distinct_models: models.size,
      untimed_sessions: bySession.filter((row) => row.timing_quality === "untimed").length,
    },
    buckets,
    intervals: sessions.map((session) => ({ session_id: session.id, start: session.started_at ?? session.created_at, end: session.ended_at ?? session.started_at ?? session.created_at })),
    by_project: activityAggregateEntries(byProject),
    by_agent: activityAggregateEntries(byAgent),
    by_model: activityAggregateEntries(byModel),
    by_session: bySession.sort((left, right) => (right.agent_minutes ?? 0) - (left.agent_minutes ?? 0)),
  };
}

function getTrendsTerms(input: SessionArchiveTrendsTermsInput): SessionArchiveTrendsTermsResponse {
  const terms = parseTrendTerms(input.terms);
  const granularity = input.granularity ?? "week";
  const buckets = trendBuckets(input.from, input.to, granularity);
  const messageRows = usageRows(input).filter((row) => {
    const date = usageDate(row.timestamp);
    return date >= input.from && date <= input.to;
  });
  const bucketCounts = new Map<string, number>();
  const seriesCounts = terms.map(() => new Map<string, number>());
  for (const row of messageRows) {
    const date = usageDate(row.timestamp);
    const bucket = trendBucketForDate(date, granularity);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    const content = String(row.token_usage ?? "");
    const messageContent = db.prepare("SELECT content FROM messages WHERE session_id = ? AND timestamp = ? LIMIT 1").get(row.session_id, row.timestamp);
    const text = stringField(messageContent, "content") || content;
    terms.forEach((term, index) => {
      const count = countTrendTerm(text, term.variants);
      if (count > 0) seriesCounts[index]?.set(bucket, (seriesCounts[index]?.get(bucket) ?? 0) + count);
    });
  }
  return {
    granularity,
    from: input.from,
    to: input.to,
    message_count: messageRows.length,
    buckets: buckets.map((date) => ({ date, message_count: bucketCounts.get(date) ?? 0 })),
    series: terms.map((term, index) => ({
      term: term.term,
      variants: term.variants,
      total: Array.from(seriesCounts[index]?.values() ?? []).reduce((sum, count) => sum + count, 0),
      points: buckets.map((date) => ({ date, count: seriesCounts[index]?.get(date) ?? 0 })),
    })),
  };
}


  return {
    getAnalyticsSummary,
    getAnalyticsActivity,
    getAnalyticsHeatmap,
    getAnalyticsProjects,
    getAnalyticsHourOfWeek,
    getAnalyticsSessionShape,
    getAnalyticsVelocity,
    getAnalyticsTools,
    getAnalyticsSkills,
    getAnalyticsTopSessions,
    getAnalyticsSignals,
    getAnalyticsSignalSessions,
    getAnalyticsBatch,
    getActivityReport,
    getTrendsTerms,
  };
}
