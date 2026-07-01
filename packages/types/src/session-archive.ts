import { z } from "zod";

export const sessionArchiveAgentSchema = z.enum([
  "claude",
  "cowork",
  "codex",
  "copilot",
  "gemini",
  "mimocode",
  "opencode",
  "kilo",
  "openhands",
  "cursor",
  "iflow",
  "amp",
  "zencoder",
  "vscode-copilot",
  "visualstudio-copilot",
  "pi",
  "omp",
  "qwen",
  "commandcode",
  "deepseek-tui",
  "openclaw",
  "qclaw",
  "kimi",
  "claude-ai",
  "chatgpt",
  "kiro",
  "kiro-ide",
  "cortex",
  "hermes",
  "onmyagent",
  "forge",
  "piebald",
  "warp",
  "positron",
  "antigravity",
  "antigravity-cli",
  "vibe",
  "zed",
  "qwenpaw",
  "gptme",
  "shelley",
  "aider",
  "reasonix",
  "unknown",
]);

export type SessionArchiveAgent = z.infer<typeof sessionArchiveAgentSchema>;

export const sessionArchiveQualitySignalsSchema = z.object({
  version: z.number().int().nonnegative(),
  short_prompt_count: z.number().int().nonnegative(),
  unstructured_start: z.boolean(),
  missing_success_criteria_count: z.number().int().nonnegative(),
  missing_verification_count: z.number().int().nonnegative(),
  duplicate_prompt_count: z.number().int().nonnegative(),
  no_code_context_count: z.number().int().nonnegative(),
  runaway_tool_loop_count: z.number().int().nonnegative(),
});

export type SessionArchiveQualitySignals = z.infer<
  typeof sessionArchiveQualitySignalsSchema
>;

export const sessionArchiveSessionSchema = z.object({
  id: z.string().trim().min(1),
  project: z.string(),
  machine: z.string(),
  agent: z.string().trim().min(1),
  first_message: z.string().nullable(),
  display_name: z.string().nullable().optional(),
  session_name: z.string().nullable().optional(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  message_count: z.number().int().nonnegative(),
  user_message_count: z.number().int().nonnegative(),
  parent_session_id: z.string().optional(),
  relationship_type: z.string().optional(),
  deleted_at: z.string().nullable().optional(),
  termination_status: z.string().nullable().optional(),
  file_path: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
  file_mtime: z.number().optional(),
  file_inode: z.number().int().nonnegative().optional(),
  file_device: z.number().int().nonnegative().optional(),
  file_hash: z.string().optional(),
  local_modified_at: z.string().nullable().optional(),
  cwd: z.string().optional(),
  git_branch: z.string().optional(),
  source_session_id: z.string().optional(),
  source_version: z.string().optional(),
  parser_malformed_lines: z.number().int().nonnegative().optional(),
  is_truncated: z.boolean().optional(),
  secret_leak_count: z.number().int().nonnegative().optional(),
  secrets_rules_version: z.string().optional(),
  total_output_tokens: z.number().int().nonnegative(),
  peak_context_tokens: z.number().int().nonnegative(),
  has_total_output_tokens: z.boolean().optional(),
  has_peak_context_tokens: z.boolean().optional(),
  is_automated: z.boolean(),
  is_teammate: z.boolean().optional(),
  is_index_only: z.boolean().optional(),
  health_score: z.number().nullable().optional(),
  health_grade: z.string().nullable().optional(),
  outcome: z.string().optional(),
  outcome_confidence: z.string().optional(),
  ended_with_role: z.string().optional(),
  tool_failure_signal_count: z.number().int().nonnegative().optional(),
  tool_retry_count: z.number().int().nonnegative().optional(),
  edit_churn_count: z.number().int().nonnegative().optional(),
  consecutive_failure_max: z.number().int().nonnegative().optional(),
  final_failure_streak: z.number().int().nonnegative().optional(),
  compaction_count: z.number().int().nonnegative().optional(),
  mid_task_compaction_count: z.number().int().nonnegative().optional(),
  context_pressure_max: z.number().nullable().optional(),
  quality_signals: sessionArchiveQualitySignalsSchema.nullable().optional(),
  health_score_basis: z.array(z.string()).nullable().optional(),
  health_penalties: z.record(z.string(), z.number()).nullable().optional(),
  created_at: z.string(),
});

export type SessionArchiveSession = z.infer<typeof sessionArchiveSessionSchema>;

export const sessionArchiveSessionPageSchema = z.object({
  sessions: z.array(sessionArchiveSessionSchema),
  next_cursor: z.string().optional(),
  total: z.number().int().nonnegative(),
  agent_counts: z.array(z.object({ agent: z.string(), count: z.number().int().nonnegative() })).optional(),
});

export type SessionArchiveSessionPage = z.infer<
  typeof sessionArchiveSessionPageSchema
>;

export const sessionArchiveToolResultEventSchema = z.object({
  tool_use_id: z.string().optional(),
  agent_id: z.string().optional(),
  subagent_session_id: z.string().optional(),
  source: z.string(),
  status: z.string(),
  content: z.string(),
  content_length: z.number().int().nonnegative(),
  timestamp: z.string().optional(),
  event_index: z.number().int().nonnegative(),
});

export type SessionArchiveToolResultEvent = z.infer<
  typeof sessionArchiveToolResultEventSchema
>;

export const sessionArchiveToolCallSchema = z.object({
  tool_name: z.string(),
  category: z.string().optional(),
  tool_use_id: z.string().optional(),
  input_json: z.string().optional(),
  skill_name: z.string().optional(),
  result_content_length: z.number().int().nonnegative().optional(),
  result_content: z.string().optional(),
  subagent_session_id: z.string().optional(),
  result_events: z.array(sessionArchiveToolResultEventSchema).optional(),
});

export type SessionArchiveToolCall = z.infer<typeof sessionArchiveToolCallSchema>;

export const sessionArchiveMessageSchema = z.object({
  id: z.number().int().nonnegative(),
  session_id: z.string().trim().min(1),
  ordinal: z.number().int(),
  role: z.string(),
  content: z.string(),
  timestamp: z.string(),
  has_thinking: z.boolean(),
  thinking_text: z.string(),
  has_tool_use: z.boolean(),
  content_length: z.number().int().nonnegative(),
  model: z.string(),
  token_usage: z.record(z.string(), z.union([z.number(), z.boolean()])).nullable().optional(),
  context_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  has_context_tokens: z.boolean().optional(),
  has_output_tokens: z.boolean().optional(),
  tool_calls: z.array(sessionArchiveToolCallSchema).optional(),
  is_system: z.boolean(),
  is_compact_boundary: z.boolean().optional(),
  claude_message_id: z.string().optional(),
  claude_request_id: z.string().optional(),
  source_type: z.string().optional(),
  source_subtype: z.string().optional(),
  source_uuid: z.string().optional(),
  source_parent_uuid: z.string().optional(),
  is_sidechain: z.boolean().optional(),
});

export type SessionArchiveMessage = z.infer<typeof sessionArchiveMessageSchema>;

export const sessionArchiveUsageEventSchema = z.object({
  id: z.number().int().nonnegative().optional(),
  session_id: z.string().trim().min(1),
  message_ordinal: z.number().int().nonnegative().nullable().optional(),
  source: z.string().trim().min(1),
  model: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  reasoning_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().nullable().optional(),
  cost_status: z.string().optional(),
  cost_source: z.string().optional(),
  occurred_at: z.string().nullable().optional(),
  dedup_key: z.string().optional(),
});

export type SessionArchiveUsageEvent = z.infer<typeof sessionArchiveUsageEventSchema>;

export const sessionArchiveMessagesResponseSchema = z.object({
  messages: z.array(sessionArchiveMessageSchema),
  count: z.number().int().nonnegative(),
});

export type SessionArchiveMessagesResponse = z.infer<
  typeof sessionArchiveMessagesResponseSchema
>;

export const sessionArchiveSessionDetailSchema = z.object({
  item: sessionArchiveSessionSchema,
});

export type SessionArchiveSessionDetail = z.infer<
  typeof sessionArchiveSessionDetailSchema
>;

export const sessionArchiveToolCallListItemSchema = sessionArchiveToolCallSchema.extend({
  ordinal: z.number().int().nonnegative(),
  timestamp: z.string(),
  result_length: z.number().int().nonnegative(),
});

export type SessionArchiveToolCallListItem = z.infer<
  typeof sessionArchiveToolCallListItemSchema
>;

export const sessionArchiveToolCallListResponseSchema = z.object({
  tool_calls: z.array(sessionArchiveToolCallListItemSchema),
  count: z.number().int().nonnegative(),
});

export type SessionArchiveToolCallListResponse = z.infer<
  typeof sessionArchiveToolCallListResponseSchema
>;

export const sessionArchiveSessionActivityBucketSchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  user_count: z.number().int().nonnegative(),
  assistant_count: z.number().int().nonnegative(),
  first_ordinal: z.number().int().nonnegative().nullable(),
});

export type SessionArchiveSessionActivityBucket = z.infer<
  typeof sessionArchiveSessionActivityBucketSchema
>;

export const sessionArchiveSessionActivityResponseSchema = z.object({
  buckets: z.array(sessionArchiveSessionActivityBucketSchema),
  interval_seconds: z.number().int().nonnegative(),
  total_messages: z.number().int().nonnegative(),
});

export type SessionArchiveSessionActivityResponse = z.infer<
  typeof sessionArchiveSessionActivityResponseSchema
>;

export const sessionArchiveCallTimingSchema = z.object({
  tool_use_id: z.string(),
  tool_name: z.string(),
  category: z.string(),
  skill_name: z.string().optional(),
  subagent_session_id: z.string().optional(),
  duration_ms: z.number().int().nonnegative().nullable(),
  is_parallel: z.boolean(),
  input_preview: z.string(),
});

export type SessionArchiveCallTiming = z.infer<typeof sessionArchiveCallTimingSchema>;

export const sessionArchiveCategoryTimingSchema = z.object({
  category: z.string(),
  duration_ms: z.number().int().nonnegative(),
  call_count: z.number().int().nonnegative(),
});

export type SessionArchiveCategoryTiming = z.infer<
  typeof sessionArchiveCategoryTimingSchema
>;

export const sessionArchiveTurnTimingSchema = z.object({
  message_id: z.number().int().nonnegative(),
  ordinal: z.number().int().nonnegative(),
  started_at: z.string(),
  duration_ms: z.number().int().nonnegative().nullable(),
  primary_category: z.string(),
  calls: z.array(sessionArchiveCallTimingSchema),
});

export type SessionArchiveTurnTiming = z.infer<typeof sessionArchiveTurnTimingSchema>;

export const sessionArchiveSessionTimingSchema = z.object({
  session_id: z.string(),
  total_duration_ms: z.number().int().nonnegative(),
  tool_duration_ms: z.number().int().nonnegative(),
  turn_count: z.number().int().nonnegative(),
  tool_call_count: z.number().int().nonnegative(),
  subagent_count: z.number().int().nonnegative(),
  slowest_call: sessionArchiveCallTimingSchema.nullable(),
  by_category: z.array(sessionArchiveCategoryTimingSchema),
  turns: z.array(sessionArchiveTurnTimingSchema),
  running: z.boolean(),
});

export type SessionArchiveSessionTiming = z.infer<
  typeof sessionArchiveSessionTimingSchema
>;

export const sessionArchiveSessionUsageSchema = z.object({
  session_id: z.string(),
  agent: z.string(),
  project: z.string(),
  total_output_tokens: z.number().int().nonnegative(),
  peak_context_tokens: z.number().int().nonnegative(),
  has_token_data: z.boolean(),
  cost_usd: z.number().nonnegative(),
  has_cost: z.boolean(),
  ai_credits: z.number().nonnegative().optional(),
  models: z.array(z.string()),
  unpriced_models: z.array(z.string()),
  server_running: z.boolean(),
});

export type SessionArchiveSessionUsage = z.infer<
  typeof sessionArchiveSessionUsageSchema
>;

export const sessionArchiveUsageTotalsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  copilotAICredits: z.number().nonnegative().optional(),
  cacheSavings: z.number(),
});

export type SessionArchiveUsageTotals = z.infer<
  typeof sessionArchiveUsageTotalsSchema
>;

export const sessionArchiveUsageModelBreakdownSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

export type SessionArchiveUsageModelBreakdown = z.infer<
  typeof sessionArchiveUsageModelBreakdownSchema
>;

export const sessionArchiveUsageProjectBreakdownSchema = z.object({
  project: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

export type SessionArchiveUsageProjectBreakdown = z.infer<
  typeof sessionArchiveUsageProjectBreakdownSchema
>;

export const sessionArchiveUsageAgentBreakdownSchema = z.object({
  agent: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

export type SessionArchiveUsageAgentBreakdown = z.infer<
  typeof sessionArchiveUsageAgentBreakdownSchema
>;

export const sessionArchiveDailyUsageEntrySchema = z.object({
  date: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(sessionArchiveUsageModelBreakdownSchema).optional(),
  projectBreakdowns: z.array(sessionArchiveUsageProjectBreakdownSchema).optional(),
  agentBreakdowns: z.array(sessionArchiveUsageAgentBreakdownSchema).optional(),
});

export type SessionArchiveDailyUsageEntry = z.infer<
  typeof sessionArchiveDailyUsageEntrySchema
>;

export const sessionArchiveUsageSessionCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  byProject: z.record(z.string(), z.number().int().nonnegative()),
  byAgent: z.record(z.string(), z.number().int().nonnegative()),
});

export type SessionArchiveUsageSessionCounts = z.infer<
  typeof sessionArchiveUsageSessionCountsSchema
>;

export const sessionArchiveUsageCacheStatsSchema = z.object({
  cacheReadTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  hitRate: z.number().nonnegative(),
  savingsVsUncached: z.number(),
});

export type SessionArchiveUsageCacheStats = z.infer<
  typeof sessionArchiveUsageCacheStatsSchema
>;

export const sessionArchiveUsageComparisonSchema = z.object({
  priorFrom: z.string(),
  priorTo: z.string(),
  priorTotalCost: z.number().nonnegative(),
  deltaPct: z.number(),
});

export type SessionArchiveUsageComparison = z.infer<
  typeof sessionArchiveUsageComparisonSchema
>;

export const sessionArchiveUsageSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: sessionArchiveUsageTotalsSchema,
  daily: z.array(sessionArchiveDailyUsageEntrySchema),
  projectTotals: z.array(sessionArchiveUsageProjectBreakdownSchema),
  modelTotals: z.array(z.object({
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
  })),
  agentTotals: z.array(sessionArchiveUsageAgentBreakdownSchema),
  sessionCounts: sessionArchiveUsageSessionCountsSchema,
  cacheStats: sessionArchiveUsageCacheStatsSchema,
  comparison: sessionArchiveUsageComparisonSchema.optional(),
});

export type SessionArchiveUsageSummaryResponse = z.infer<
  typeof sessionArchiveUsageSummaryResponseSchema
>;

export const sessionArchiveTopUsageSessionSchema = z.object({
  sessionId: z.string(),
  displayName: z.string(),
  agent: z.string(),
  project: z.string(),
  startedAt: z.string(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

export type SessionArchiveTopUsageSession = z.infer<
  typeof sessionArchiveTopUsageSessionSchema
>;

export const sessionArchiveAnalyticsSummarySchema = z.object({
  total_sessions: z.number().int().nonnegative(),
  total_messages: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  token_reporting_sessions: z.number().int().nonnegative(),
  active_projects: z.number().int().nonnegative(),
  active_days: z.number().int().nonnegative(),
  avg_messages: z.number().nonnegative(),
  median_messages: z.number().nonnegative(),
  p90_messages: z.number().nonnegative(),
  most_active_project: z.string(),
  concentration: z.number().nonnegative(),
  agents: z.record(z.string(), z.object({
    sessions: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  })),
});

export type SessionArchiveAnalyticsSummary = z.infer<
  typeof sessionArchiveAnalyticsSummarySchema
>;

export const sessionArchiveAnalyticsActivityEntrySchema = z.object({
  date: z.string(),
  sessions: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  user_messages: z.number().int().nonnegative(),
  assistant_messages: z.number().int().nonnegative(),
  tool_calls: z.number().int().nonnegative(),
  thinking_messages: z.number().int().nonnegative(),
  by_agent: z.record(z.string(), z.number().int().nonnegative()),
});

export type SessionArchiveAnalyticsActivityEntry = z.infer<
  typeof sessionArchiveAnalyticsActivityEntrySchema
>;

export const sessionArchiveAnalyticsActivityResponseSchema = z.object({
  granularity: z.string(),
  series: z.array(sessionArchiveAnalyticsActivityEntrySchema),
});

export type SessionArchiveAnalyticsActivityResponse = z.infer<
  typeof sessionArchiveAnalyticsActivityResponseSchema
>;

export const sessionArchiveAnalyticsHeatmapResponseSchema = z.object({
  metric: z.string(),
  entries: z.array(z.object({
    date: z.string(),
    value: z.number().int().nonnegative(),
    level: z.number().int().nonnegative(),
  })),
  levels: z.object({
    l1: z.number().int().nonnegative(),
    l2: z.number().int().nonnegative(),
    l3: z.number().int().nonnegative(),
    l4: z.number().int().nonnegative(),
  }),
  entries_from: z.string(),
});

export type SessionArchiveAnalyticsHeatmapResponse = z.infer<
  typeof sessionArchiveAnalyticsHeatmapResponseSchema
>;

export const sessionArchiveAnalyticsProjectsResponseSchema = z.object({
  projects: z.array(z.object({
    name: z.string(),
    sessions: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    first_session: z.string(),
    last_session: z.string(),
    avg_messages: z.number().nonnegative(),
    median_messages: z.number().nonnegative(),
    agents: z.record(z.string(), z.number().int().nonnegative()),
    daily_trend: z.number(),
  })),
});

export type SessionArchiveAnalyticsProjectsResponse = z.infer<
  typeof sessionArchiveAnalyticsProjectsResponseSchema
>;

export const sessionArchiveAnalyticsHourOfWeekResponseSchema = z.object({
  cells: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    messages: z.number().int().nonnegative(),
  })),
});

export type SessionArchiveAnalyticsHourOfWeekResponse = z.infer<
  typeof sessionArchiveAnalyticsHourOfWeekResponseSchema
>;

export const sessionArchiveAnalyticsSessionShapeResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  length_distribution: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
  duration_distribution: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
  autonomy_distribution: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
});

export type SessionArchiveAnalyticsSessionShapeResponse = z.infer<
  typeof sessionArchiveAnalyticsSessionShapeResponseSchema
>;

const sessionArchiveVelocityOverviewSchema = z.object({
  turn_cycle_sec: z.object({ p50: z.number().nonnegative(), p90: z.number().nonnegative() }),
  first_response_sec: z.object({ p50: z.number().nonnegative(), p90: z.number().nonnegative() }),
  msgs_per_active_min: z.number().nonnegative(),
  chars_per_active_min: z.number().nonnegative(),
  tool_calls_per_active_min: z.number().nonnegative(),
});

export const sessionArchiveAnalyticsVelocityResponseSchema = z.object({
  overall: sessionArchiveVelocityOverviewSchema,
  by_agent: z.array(z.object({
    label: z.string(),
    sessions: z.number().int().nonnegative(),
    overview: sessionArchiveVelocityOverviewSchema,
  })),
  by_complexity: z.array(z.object({
    label: z.string(),
    sessions: z.number().int().nonnegative(),
    overview: sessionArchiveVelocityOverviewSchema,
  })),
});

export type SessionArchiveAnalyticsVelocityResponse = z.infer<
  typeof sessionArchiveAnalyticsVelocityResponseSchema
>;

export const sessionArchiveAnalyticsToolsResponseSchema = z.object({
  total_calls: z.number().int().nonnegative(),
  by_category: z.array(z.object({ category: z.string(), count: z.number().int().nonnegative(), pct: z.number().nonnegative() })),
  by_agent: z.array(z.object({
    agent: z.string(),
    total: z.number().int().nonnegative(),
    categories: z.array(z.object({ category: z.string(), count: z.number().int().nonnegative(), pct: z.number().nonnegative() })),
  })),
  trend: z.array(z.object({ date: z.string(), by_category: z.record(z.string(), z.number().int().nonnegative()) })),
});

export type SessionArchiveAnalyticsToolsResponse = z.infer<
  typeof sessionArchiveAnalyticsToolsResponseSchema
>;

export const sessionArchiveAnalyticsSkillsResponseSchema = z.object({
  total_skill_calls: z.number().int().nonnegative(),
  distinct_skills: z.number().int().nonnegative(),
  by_skill: z.array(z.object({
    skill_name: z.string(),
    call_count: z.number().int().nonnegative(),
    session_count: z.number().int().nonnegative(),
    agent_breakdown: z.array(z.object({ agent: z.string(), count: z.number().int().nonnegative() })),
    project_breakdown: z.array(z.object({ project: z.string(), count: z.number().int().nonnegative() })),
    last_used_at: z.string(),
    pct: z.number().nonnegative(),
  })),
  trend: z.array(z.object({ date: z.string(), by_skill: z.record(z.string(), z.number().int().nonnegative()) })),
});

export type SessionArchiveAnalyticsSkillsResponse = z.infer<
  typeof sessionArchiveAnalyticsSkillsResponseSchema
>;

export const sessionArchiveAnalyticsTopSessionsResponseSchema = z.object({
  metric: z.string(),
  sessions: z.array(z.object({
    id: z.string(),
    project: z.string(),
    first_message: z.string().nullable(),
    display_name: z.string().nullable().optional(),
    message_count: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    duration_min: z.number().nonnegative(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    termination_status: z.string().nullable().optional(),
  })),
});

export type SessionArchiveAnalyticsTopSessionsResponse = z.infer<
  typeof sessionArchiveAnalyticsTopSessionsResponseSchema
>;

export const sessionArchiveAnalyticsSignalsResponseSchema = z.object({
  scored_sessions: z.number().int().nonnegative(),
  unscored_sessions: z.number().int().nonnegative(),
  grade_distribution: z.record(z.string(), z.number().int().nonnegative()),
  avg_health_score: z.number().nullable(),
  outcome_distribution: z.record(z.string(), z.number().int().nonnegative()),
  outcome_confidence_distribution: z.record(z.string(), z.number().int().nonnegative()),
  tool_health: z.record(z.string(), z.union([z.number(), z.null()])),
  context_health: z.record(z.string(), z.union([z.number(), z.null()])),
  quality_health: z.record(z.string(), z.unknown()),
  trend: z.array(z.record(z.string(), z.unknown())),
  by_agent: z.array(z.record(z.string(), z.unknown())),
  by_project: z.array(z.record(z.string(), z.unknown())),
  calibration: z.record(z.string(), z.unknown()),
});

export type SessionArchiveAnalyticsSignalsResponse = z.infer<
  typeof sessionArchiveAnalyticsSignalsResponseSchema
>;

export const sessionArchiveAnalyticsSignalSessionsResponseSchema = z.object({
  signal: z.string(),
  sessions: z.array(z.record(z.string(), z.unknown())),
});

export type SessionArchiveAnalyticsSignalSessionsResponse = z.infer<
  typeof sessionArchiveAnalyticsSignalSessionsResponseSchema
>;

// Batch analytics response - single request for all analytics data
export interface SessionArchiveAnalyticsBatchResponse {
  summary: SessionArchiveAnalyticsSummary;
  activity: SessionArchiveAnalyticsActivityResponse;
  heatmap: SessionArchiveAnalyticsHeatmapResponse;
  projects: SessionArchiveAnalyticsProjectsResponse;
  hourOfWeek: SessionArchiveAnalyticsHourOfWeekResponse;
  sessionShape: SessionArchiveAnalyticsSessionShapeResponse;
  velocity: SessionArchiveAnalyticsVelocityResponse;
  tools: SessionArchiveAnalyticsToolsResponse;
  skills: SessionArchiveAnalyticsSkillsResponse;
  topSessions: SessionArchiveAnalyticsTopSessionsResponse;
  signals: SessionArchiveAnalyticsSignalsResponse;
}



export const sessionArchiveActivityBucketSchema = z.object({
  start: z.string(),
  end: z.string(),
  agent_minutes: z.number().nonnegative(),
  max_agents: z.number().int().nonnegative(),
  interactive_at_peak: z.number().int().nonnegative(),
  automated_at_peak: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

export const sessionArchiveActivityTotalsSchema = z.object({
  sessions: z.number().int().nonnegative(),
  interactive_sessions: z.number().int().nonnegative(),
  automated_sessions: z.number().int().nonnegative(),
  active_minutes: z.number().nonnegative(),
  idle_minutes: z.number().nonnegative(),
  agent_minutes: z.number().nonnegative(),
  interactive_agent_minutes: z.number().nonnegative(),
  automated_agent_minutes: z.number().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  interactive_cost: z.number().nonnegative(),
  automated_cost: z.number().nonnegative(),
  distinct_projects: z.number().int().nonnegative(),
  distinct_models: z.number().int().nonnegative(),
  untimed_sessions: z.number().int().nonnegative(),
});

export const sessionArchiveActivityKeyMinutesSchema = z.object({
  key: z.string(),
  agent_minutes: z.number().nonnegative(),
  interactive_agent_minutes: z.number().nonnegative(),
  automated_agent_minutes: z.number().nonnegative(),
  cost: z.number().nonnegative(),
  interactive_cost: z.number().nonnegative(),
  automated_cost: z.number().nonnegative(),
});

export const sessionArchiveActivitySessionRowSchema = z.object({
  session_id: z.string(),
  title: z.string(),
  project: z.string(),
  agent: z.string(),
  primary_model: z.string(),
  models: z.array(z.string()),
  is_automated: z.boolean(),
  first_active: z.string().nullable(),
  last_active: z.string().nullable(),
  agent_minutes: z.number().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  timing_quality: z.string(),
});

export const sessionArchiveActivityReportSchema = z.object({
  timezone: z.string(),
  range_start: z.string(),
  range_end: z.string(),
  effective_end: z.string(),
  as_of: z.string().nullable(),
  partial: z.boolean(),
  bucket_count: z.number().int().nonnegative(),
  elapsed_bucket_count: z.number().int().nonnegative(),
  bucket_seconds: z.number().int().nonnegative(),
  bucket_unit: z.string(),
  peak: z.object({ at: z.string().nullable(), agents: z.number().int().nonnegative() }),
  totals: sessionArchiveActivityTotalsSchema,
  buckets: z.array(sessionArchiveActivityBucketSchema),
  intervals: z.array(z.object({ session_id: z.string(), start: z.string(), end: z.string() })),
  by_project: z.array(sessionArchiveActivityKeyMinutesSchema),
  by_agent: z.array(sessionArchiveActivityKeyMinutesSchema),
  by_model: z.array(sessionArchiveActivityKeyMinutesSchema),
  by_session: z.array(sessionArchiveActivitySessionRowSchema),
});

export type SessionArchiveActivityReport = z.infer<typeof sessionArchiveActivityReportSchema>;

export const sessionArchiveTrendsTermsResponseSchema = z.object({
  granularity: z.string(),
  from: z.string(),
  to: z.string(),
  message_count: z.number().int().nonnegative(),
  buckets: z.array(z.object({ date: z.string(), message_count: z.number().int().nonnegative() })),
  series: z.array(z.object({
    term: z.string(),
    variants: z.array(z.string()),
    total: z.number().int().nonnegative(),
    points: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })),
  })),
});

export type SessionArchiveTrendsTermsResponse = z.infer<typeof sessionArchiveTrendsTermsResponseSchema>;

export const sessionArchiveInsightTypeSchema = z.enum(["daily_activity", "agent_analysis", "llm_canned"]);
export const sessionArchiveInsightSchema = z.object({
  id: z.number().int().nonnegative(),
  type: sessionArchiveInsightTypeSchema,
  date_from: z.string(),
  date_to: z.string(),
  project: z.string().nullable(),
  agent: z.string(),
  model: z.string().nullable(),
  prompt: z.string().nullable(),
  content: z.string(),
  kind: z.string().optional(),
  schema_version: z.string().optional(),
  template_id: z.string().optional(),
  template_version: z.string().optional(),
  aggregate_hash: z.string().optional(),
  cache_key: z.string().optional(),
  cache_status: z.string().optional(),
  provenance_json: z.string().optional(),
  structured_json: z.string().optional(),
  created_at: z.string(),
});

export type SessionArchiveInsight = z.infer<typeof sessionArchiveInsightSchema>;

export const sessionArchiveInsightsResponseSchema = z.object({ insights: z.array(sessionArchiveInsightSchema) });
export type SessionArchiveInsightsResponse = z.infer<typeof sessionArchiveInsightsResponseSchema>;

export const sessionArchiveGenerateInsightRequestSchema = z.object({
  type: sessionArchiveInsightTypeSchema,
  date_from: z.string(),
  date_to: z.string(),
  project: z.string().optional(),
  prompt: z.string().optional(),
  agent: z.string().optional(),
  timezone: z.string().optional(),
  kind: z.string().optional(),
  llm_opt_in: z.boolean().optional(),
  force_refresh: z.boolean().optional(),
  automated_scope: z.string().optional(),
});

export type SessionArchiveGenerateInsightRequest = z.infer<typeof sessionArchiveGenerateInsightRequestSchema>;

export const sessionArchiveStarredResponseSchema = z.object({
  session_ids: z.array(z.string()),
});

export type SessionArchiveStarredResponse = z.infer<typeof sessionArchiveStarredResponseSchema>;

export const sessionArchiveBulkStarRequestSchema = z.object({
  session_ids: z.array(z.string().trim().min(1)),
});

export type SessionArchiveBulkStarRequest = z.infer<typeof sessionArchiveBulkStarRequestSchema>;

export const sessionArchivePinnedMessageSchema = z.object({
  id: z.number().int().nonnegative(),
  session_id: z.string(),
  message_id: z.number().int().nonnegative(),
  ordinal: z.number().int().nonnegative(),
  role: z.string(),
  content: z.string(),
  project: z.string(),
  agent: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
});

export type SessionArchivePinnedMessage = z.infer<typeof sessionArchivePinnedMessageSchema>;

export const sessionArchivePinsResponseSchema = z.object({
  pins: z.array(sessionArchivePinnedMessageSchema),
});

export type SessionArchivePinsResponse = z.infer<typeof sessionArchivePinsResponseSchema>;

export const sessionArchivePinRequestSchema = z.object({
  note: z.string().optional(),
});

export type SessionArchivePinRequest = z.infer<typeof sessionArchivePinRequestSchema>;

export const sessionArchivePinResponseSchema = z.object({ id: z.number().int().nonnegative() });
export type SessionArchivePinResponse = z.infer<typeof sessionArchivePinResponseSchema>;

export const sessionArchiveRenameSessionRequestSchema = z.object({
  name: z.string().trim().min(1),
});

export type SessionArchiveRenameSessionRequest = z.infer<typeof sessionArchiveRenameSessionRequestSchema>;

export const sessionArchiveTrashResponseSchema = z.object({ sessions: z.array(sessionArchiveSessionSchema) });
export type SessionArchiveTrashResponse = z.infer<typeof sessionArchiveTrashResponseSchema>;

export const sessionArchiveDirectoryResponseSchema = z.object({
  directory: z.string(),
  exists: z.boolean(),
});

export type SessionArchiveDirectoryResponse = z.infer<typeof sessionArchiveDirectoryResponseSchema>;

export const sessionArchiveOpenSessionResponseSchema = z.object({
  ok: z.boolean(),
  directory: z.string(),
  command: z.string().optional(),
  launched: z.boolean(),
});

export type SessionArchiveOpenSessionResponse = z.infer<typeof sessionArchiveOpenSessionResponseSchema>;

export const sessionArchiveResumeSessionRequestSchema = z.object({
  skip_permissions: z.boolean().optional(),
  fork_session: z.boolean().optional(),
  command_only: z.boolean().optional(),
  opener_id: z.string().optional(),
});

export type SessionArchiveResumeSessionRequest = z.infer<typeof sessionArchiveResumeSessionRequestSchema>;

export const sessionArchiveResumeSessionResponseSchema = z.object({
  launched: z.boolean(),
  terminal: z.string().optional(),
  command: z.string(),
  cwd: z.string().optional(),
  error: z.string().optional(),
});

export type SessionArchiveResumeSessionResponse = z.infer<typeof sessionArchiveResumeSessionResponseSchema>;

export const sessionArchiveExportResponseSchema = z.object({
  filename: z.string(),
  content_type: z.string(),
  content: z.string(),
});

export type SessionArchiveExportResponse = z.infer<typeof sessionArchiveExportResponseSchema>;

export const sessionArchivePublishResponseSchema = z.object({
  ok: z.boolean(),
  requires_remote: z.boolean(),
  url: z.string().optional(),
  message: z.string(),
  filename: z.string(),
});

export type SessionArchivePublishResponse = z.infer<typeof sessionArchivePublishResponseSchema>;

export const sessionArchiveImportStatsSchema = z.object({
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});

export type SessionArchiveImportStats = z.infer<typeof sessionArchiveImportStatsSchema>;

export const sessionArchiveUploadImportRequestSchema = z.object({
  filename: z.string().trim().min(1),
  content: z.string(),
  agent: z.string().optional(),
  project: z.string().optional(),
});

export type SessionArchiveUploadImportRequest = z.infer<typeof sessionArchiveUploadImportRequestSchema>;

export const sessionArchiveTerminalConfigSchema = z.object({
  mode: z.enum(["auto", "custom", "clipboard"]),
  custom_bin: z.string().optional(),
  custom_args: z.string().optional(),
});

export type SessionArchiveTerminalConfig = z.infer<typeof sessionArchiveTerminalConfigSchema>;

export const sessionArchiveGithubConfigSchema = z.object({
  configured: z.boolean(),
  token_preview: z.string().optional(),
});

export type SessionArchiveGithubConfig = z.infer<typeof sessionArchiveGithubConfigSchema>;

export const sessionArchiveAgentDirSettingSchema = z.object({
  agent: sessionArchiveAgentSchema,
  display_name: z.string(),
  dirs: z.array(z.string()),
  configured: z.boolean(),
  source: z.enum(["default", "config", "env"]),
});

export type SessionArchiveAgentDirSetting = z.infer<typeof sessionArchiveAgentDirSettingSchema>;

export const sessionArchiveWorktreeMappingSchema = z.object({
  id: z.string(),
  path_prefix: z.string(),
  project: z.string(),
  enabled: z.boolean(),
  machine: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type SessionArchiveWorktreeMapping = z.infer<typeof sessionArchiveWorktreeMappingSchema>;

export const sessionArchiveRemoteConfigSchema = z.object({
  public_url: z.string().optional(),
  public_origins: z.array(z.string()),
  require_auth: z.boolean(),
  auth_configured: z.boolean(),
  remote_hosts: z.array(z.object({ host: z.string(), user: z.string().optional(), port: z.number().int().nonnegative().optional() })),
});

export type SessionArchiveRemoteConfig = z.infer<typeof sessionArchiveRemoteConfigSchema>;

export const sessionArchivePostgresConfigSchema = z.object({
  url_configured: z.boolean(),
  url_preview: z.string().optional(),
  schema: z.string().optional(),
  machine_name: z.string().optional(),
  allow_insecure: z.boolean(),
  projects: z.array(z.string()),
  exclude_projects: z.array(z.string()),
  watch: z.boolean(),
});

export type SessionArchivePostgresConfig = z.infer<typeof sessionArchivePostgresConfigSchema>;

export const sessionArchiveDuckDbConfigSchema = z.object({
  path: z.string().optional(),
  url_configured: z.boolean(),
  url_preview: z.string().optional(),
  token_configured: z.boolean(),
  machine_name: z.string().optional(),
  allow_insecure: z.boolean(),
  projects: z.array(z.string()),
  exclude_projects: z.array(z.string()),
});

export type SessionArchiveDuckDbConfig = z.infer<typeof sessionArchiveDuckDbConfigSchema>;

export const sessionArchiveBackendStatusSchema = z.object({
  backend: z.enum(["postgres", "duckdb"]),
  configured: z.boolean(),
  mode: z.enum(["push", "serve", "mirror", "quack"]),
  read_only_serve: z.boolean(),
  capabilities: z.array(z.string()),
  status: z.enum(["available", "blocked"]),
  blocker: z.string().optional(),
});

export type SessionArchiveBackendStatus = z.infer<typeof sessionArchiveBackendStatusSchema>;

export const sessionArchiveBackendsStatusResponseSchema = z.object({
  backends: z.array(sessionArchiveBackendStatusSchema),
});

export type SessionArchiveBackendsStatusResponse = z.infer<typeof sessionArchiveBackendsStatusResponseSchema>;

export const sessionArchiveLifecycleStatusSchema = z.object({
  healthy: z.boolean(),
  version: z.string(),
  mode: z.enum(["studio-native"]),
  uptime_ms: z.number().int().nonnegative(),
  runtime_root: z.string(),
  db_path: z.string(),
  db_exists: z.boolean(),
  db_bytes: z.number().int().nonnegative(),
  stats: z.object({
    session_count: z.number().int().nonnegative(),
    message_count: z.number().int().nonnegative(),
    project_count: z.number().int().nonnegative(),
    machine_count: z.number().int().nonnegative(),
    earliest_session: z.string().nullable(),
  }),
  update: z.object({
    supported: z.boolean(),
    update_available: z.boolean(),
    current_version: z.string(),
    latest_version: z.string().optional(),
    blocker: z.string().optional(),
  }),
  logs: z.object({
    root: z.string(),
    files: z.array(z.object({ name: z.string(), path: z.string(), bytes: z.number().int().nonnegative(), modified_at: z.string().nullable() })),
  }),
});

export type SessionArchiveLifecycleStatus = z.infer<typeof sessionArchiveLifecycleStatusSchema>;

export const sessionArchiveConfigSnapshotSchema = z.object({
  agent_dirs: z.array(sessionArchiveAgentDirSettingSchema),
  terminal: sessionArchiveTerminalConfigSchema,
  github: sessionArchiveGithubConfigSchema,
  worktree_mappings: z.array(sessionArchiveWorktreeMappingSchema),
  remote: sessionArchiveRemoteConfigSchema,
  postgres: sessionArchivePostgresConfigSchema,
  duckdb: sessionArchiveDuckDbConfigSchema,
  backends: z.array(sessionArchiveBackendStatusSchema),
});

export type SessionArchiveConfigSnapshot = z.infer<typeof sessionArchiveConfigSnapshotSchema>;

export const sessionArchiveConfigUpdateSchema = z.object({
  agent_dirs: z.array(z.object({ agent: sessionArchiveAgentSchema, dirs: z.array(z.string()) })).optional(),
  terminal: sessionArchiveTerminalConfigSchema.optional(),
  github_token: z.string().optional(),
  remote: z.object({
    public_url: z.string().optional(),
    public_origins: z.array(z.string()).optional(),
    require_auth: z.boolean().optional(),
    auth_token_configured: z.boolean().optional(),
  }).optional(),
  postgres: z.object({
    url: z.string().optional(),
    schema: z.string().optional(),
    machine_name: z.string().optional(),
    allow_insecure: z.boolean().optional(),
    projects: z.array(z.string()).optional(),
    exclude_projects: z.array(z.string()).optional(),
    watch: z.boolean().optional(),
  }).optional(),
  duckdb: z.object({
    path: z.string().optional(),
    url: z.string().optional(),
    token_configured: z.boolean().optional(),
    machine_name: z.string().optional(),
    allow_insecure: z.boolean().optional(),
    projects: z.array(z.string()).optional(),
    exclude_projects: z.array(z.string()).optional(),
  }).optional(),
});

export type SessionArchiveConfigUpdate = z.infer<typeof sessionArchiveConfigUpdateSchema>;

export const sessionArchiveWorktreeMappingInputSchema = z.object({
  id: z.string().optional(),
  path_prefix: z.string().trim().min(1),
  project: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  machine: z.string().optional(),
});

export type SessionArchiveWorktreeMappingInput = z.infer<typeof sessionArchiveWorktreeMappingInputSchema>;

export const sessionArchiveWorktreeMappingsResponseSchema = z.object({
  mappings: z.array(sessionArchiveWorktreeMappingSchema),
});

export type SessionArchiveWorktreeMappingsResponse = z.infer<typeof sessionArchiveWorktreeMappingsResponseSchema>;

export const sessionArchiveApplyWorktreeMappingsResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
  mappings: z.array(sessionArchiveWorktreeMappingSchema),
});

export type SessionArchiveApplyWorktreeMappingsResponse = z.infer<typeof sessionArchiveApplyWorktreeMappingsResponseSchema>;

export const sessionArchiveSecretConfidenceSchema = z.enum(["definite", "candidate", "all"]);

export type SessionArchiveSecretConfidence = z.infer<typeof sessionArchiveSecretConfidenceSchema>;

export const sessionArchiveSecretFindingSchema = z.object({
  id: z.number().int().nonnegative(),
  session_id: z.string(),
  project: z.string(),
  agent: z.string(),
  display_name: z.string().nullable(),
  rule: z.string(),
  confidence: z.enum(["definite", "candidate"]),
  location_kind: z.enum(["message", "tool_input", "tool_result", "tool_result_event"]),
  message_ordinal: z.number().int().nonnegative(),
  call_index: z.number().int().nonnegative().nullable(),
  event_index: z.number().int().nonnegative().nullable().optional(),
  match_start: z.number().int().nonnegative(),
  match_end: z.number().int().nonnegative(),
  match_index: z.number().int().nonnegative().optional(),
  redacted_match: z.string(),
  rules_version: z.string().optional(),
  created_at: z.string(),
});

export type SessionArchiveSecretFinding = z.infer<typeof sessionArchiveSecretFindingSchema>;

export const sessionArchiveSecretFindingsResponseSchema = z.object({
  findings: z.array(sessionArchiveSecretFindingSchema),
  next: z.number().int().nonnegative(),
});

export type SessionArchiveSecretFindingsResponse = z.infer<typeof sessionArchiveSecretFindingsResponseSchema>;

export const sessionArchiveSecretScanSummarySchema = z.object({
  scanned: z.number().int().nonnegative(),
  with_secrets: z.number().int().nonnegative(),
  total_findings: z.number().int().nonnegative(),
  definite_findings: z.number().int().nonnegative(),
  candidate_findings: z.number().int().nonnegative(),
  rules_version: z.string(),
});

export type SessionArchiveSecretScanSummary = z.infer<typeof sessionArchiveSecretScanSummarySchema>;

export const sessionArchiveSessionSearchResponseSchema = z.object({
  ordinals: z.array(z.number().int().nonnegative()),
  matches: z.array(z.object({
    ordinal: z.number().int().nonnegative(),
    source: z.enum(["message", "tool_result"]),
    match_start: z.number().int().nonnegative(),
    match_end: z.number().int().nonnegative(),
    snippet: z.string(),
  })).optional(),
});

export type SessionArchiveSessionSearchResponse = z.infer<
  typeof sessionArchiveSessionSearchResponseSchema
>;

export const sessionArchiveContentSearchMatchSchema = z.object({
  session_id: z.string(),
  ordinal: z.number().int().nonnegative(),
  role: z.string(),
  source: z.string(),
  snippet: z.string(),
});

export type SessionArchiveContentSearchMatch = z.infer<
  typeof sessionArchiveContentSearchMatchSchema
>;

export const sessionArchiveContentSearchResponseSchema = z.object({
  matches: z.array(sessionArchiveContentSearchMatchSchema),
  next_cursor: z.number().int().nonnegative().optional(),
});

export type SessionArchiveContentSearchResponse = z.infer<
  typeof sessionArchiveContentSearchResponseSchema
>;

export const sessionArchiveSearchResultSchema = z.object({
  session_id: z.string().trim().min(1),
  project: z.string(),
  agent: z.string(),
  name: z.string(),
  ordinal: z.number().int().nonnegative(),
  session_ended_at: z.string(),
  snippet: z.string(),
  rank: z.number(),
});

export type SessionArchiveSearchResult = z.infer<
  typeof sessionArchiveSearchResultSchema
>;

export const sessionArchiveSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(sessionArchiveSearchResultSchema),
  count: z.number().int().nonnegative(),
  next: z.number().int().nonnegative(),
});

export type SessionArchiveSearchResponse = z.infer<
  typeof sessionArchiveSearchResponseSchema
>;

export const sessionArchiveSyncProgressSchema = z.object({
  phase: z.string(),
  current_project: z.string().optional(),
  projects_total: z.number().int().nonnegative(),
  projects_done: z.number().int().nonnegative(),
  sessions_total: z.number().int().nonnegative(),
  sessions_done: z.number().int().nonnegative(),
  messages_indexed: z.number().int().nonnegative(),
});

export type SessionArchiveSyncProgress = z.infer<
  typeof sessionArchiveSyncProgressSchema
>;

export const sessionArchiveSyncStatsSchema = z.object({
  total_sessions: z.number().int().nonnegative(),
  discovered_sessions: z.number().int().nonnegative().optional(),
  recent_limit: z.number().int().positive().optional(),
  omitted_sessions: z.number().int().nonnegative().optional(),
  synced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  orphaned_copied: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).optional(),
  aborted: z.boolean().optional(),
});

export type SessionArchiveSyncStats = z.infer<typeof sessionArchiveSyncStatsSchema>;

export const sessionArchiveSyncStatusSchema = z.object({
  ok: z.boolean().optional(),
  status: z.enum(["idle", "running", "completed", "failed"]),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  last_sync: z.string().nullable().optional(),
  progress: sessionArchiveSyncProgressSchema.nullable().optional(),
  stats: sessionArchiveSyncStatsSchema.nullable(),
  error: z.string().nullable().optional(),
  dbPath: z.string().optional(),
});

export type SessionArchiveSyncStatus = z.infer<typeof sessionArchiveSyncStatusSchema>;

export const sessionArchiveSyncResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(["running", "completed", "failed"]).optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  progress: sessionArchiveSyncProgressSchema.nullable().optional(),
  stats: sessionArchiveSyncStatsSchema.nullable(),
  error: z.string().nullable().optional(),
  dbPath: z.string(),
});

export type SessionArchiveSyncResult = z.infer<typeof sessionArchiveSyncResultSchema>;

export const sessionArchiveAgentInfoSchema = z.object({
  name: z.string(),
  session_count: z.number().int().nonnegative(),
});

export type SessionArchiveAgentInfo = z.infer<
  typeof sessionArchiveAgentInfoSchema
>;

export const sessionArchiveStatsSchema = z.object({
  session_count: z.number().int().nonnegative(),
  message_count: z.number().int().nonnegative(),
  project_count: z.number().int().nonnegative(),
  machine_count: z.number().int().nonnegative(),
  earliest_session: z.string().nullable(),
});

export type SessionArchiveStats = z.infer<
  typeof sessionArchiveStatsSchema
>;

export const sessionArchiveSourceSchema = z.object({
  agent: sessionArchiveAgentSchema,
  displayName: z.string().optional(),
  envVar: z.string().optional(),
  configKey: z.string().optional(),
  idPrefix: z.string(),
  defaultDirs: z.array(z.string()),
  watchSubdirs: z.array(z.string()).optional(),
  shallowWatch: z.boolean().optional(),
  fileBased: z.boolean().optional(),
  enabled: z.boolean(),
});

export type SessionArchiveSource = z.infer<
  typeof sessionArchiveSourceSchema
>;
