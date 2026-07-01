import { createHmac, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import {
  sessionArchiveConfigUpdateSchema,
  sessionArchiveGenerateInsightRequestSchema,
  sessionArchiveInsightSchema,
  sessionArchiveMessageSchema,
  sessionArchivePinRequestSchema,
  sessionArchiveRenameSessionRequestSchema,
  sessionArchiveResumeSessionRequestSchema,
  sessionArchiveSessionSchema,
  sessionArchiveToolCallSchema,
  sessionArchiveUsageEventSchema,
  sessionArchiveUploadImportRequestSchema,
  sessionArchiveWorktreeMappingInputSchema,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsActivityResponse,
  SessionArchiveAnalyticsHeatmapResponse,
  SessionArchiveAnalyticsHourOfWeekResponse,
  SessionArchiveAnalyticsProjectsResponse,
  SessionArchiveAnalyticsSessionShapeResponse,
  SessionArchiveAnalyticsSignalSessionsResponse,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSkillsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsBatchResponse,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveStats,
  SessionArchiveBackendsStatusResponse,
  SessionArchiveConfigSnapshot,
  SessionArchiveConfigUpdate,
  SessionArchiveContentSearchResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveInsight,
  SessionArchiveInsightsResponse,
  SessionArchiveImportStats,
  SessionArchiveDirectoryResponse,
  SessionArchiveExportResponse,
  SessionArchiveSessionActivityResponse,
  SessionArchiveMessage,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinRequest,
  SessionArchivePinResponse,
  SessionArchivePinnedMessage,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveRenameSessionRequest,
  SessionArchiveResumeSessionRequest,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSecretConfidence,
  SessionArchiveSecretFinding,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveSessionPage,
  SessionArchiveSessionSearchResponse,
  SessionArchiveSessionTiming,
  SessionArchiveSessionUsage,
  SessionArchiveTopUsageSession,
  SessionArchiveToolCall,
  SessionArchiveToolCallListItem,
  SessionArchiveToolCallListResponse,
  SessionArchiveTrendsTermsResponse,
  SessionArchiveUsageAgentBreakdown,
  SessionArchiveUsageComparison,
  SessionArchiveUsageEvent,
  SessionArchiveUsageModelBreakdown,
  SessionArchiveUsageProjectBreakdown,
  SessionArchiveUsageSummaryResponse,
  SessionArchiveUsageTotals,
  SessionArchiveUploadImportRequest,
  SessionArchiveWorktreeMapping,
  SessionArchiveWorktreeMappingInput,
} from "@onmyagent/types/session-archive";

import { Database, type SqliteDatabase } from "../core/sqlite.js";
import { ensureDir } from "../core/utils.js";
import { sessionArchiveRegistry, resolveSessionArchiveSourceRoots } from "./session-archive-registry.js";
import {
  SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS,
  SESSION_ARCHIVE_SECRETS_RULES_VERSION,
  scanSessionArchiveSecrets,
} from "./session-archive-secrets.js";

export type SessionArchiveStore = {
  dbPath: string;
  close: () => void;
  upsertSession: (session: SessionArchiveSession) => void;
  replaceSessionMessages: (sessionId: string, messages: SessionArchiveMessage[]) => void;
  replaceSessionUsageEvents: (sessionId: string, events: SessionArchiveUsageEvent[]) => void;
  listUsageEvents: (sessionId: string) => SessionArchiveUsageEvent[];
  getSourceFile: (path: string) => SessionArchiveSourceFileState | null;
  upsertSourceFile: (state: SessionArchiveSourceFileState) => void;
  getSkippedFile: (path: string) => SessionArchiveSkippedFileState | null;
  upsertSkippedFile: (state: SessionArchiveSkippedFileState) => void;
  deleteSkippedFile: (path: string) => void;
  listSessions: (input?: SessionArchiveSessionListInput) => SessionArchiveSessionPage;
  getSession: (sessionId: string) => SessionArchiveSession | null;
  getSessionIncludingDeleted: (sessionId: string) => SessionArchiveSession | null;
  isSessionExcluded: (sessionId: string) => boolean;
  listMessages: (sessionId: string, input?: SessionArchiveMessagesInput) => SessionArchiveMessagesResponse;
  listToolCalls: (sessionId: string) => SessionArchiveToolCallListResponse;
  listChildren: (sessionId: string) => SessionArchiveSession[];
  getActivity: (sessionId: string) => SessionArchiveSessionActivityResponse | null;
  getTiming: (sessionId: string) => SessionArchiveSessionTiming | null;
  getUsage: (sessionId: string) => SessionArchiveSessionUsage | null;
  getUsageSummary: (input: SessionArchiveUsageFilterInput) => SessionArchiveUsageSummaryResponse;
  getUsageComparison: (input: SessionArchiveUsageComparisonInput) => SessionArchiveUsageComparison;
  getTopUsageSessions: (input: SessionArchiveUsageTopSessionsInput) => SessionArchiveTopUsageSession[];
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
  listInsights: (input?: SessionArchiveInsightFilterInput) => SessionArchiveInsightsResponse;
  getInsight: (id: number) => SessionArchiveInsight | null;
  deleteInsight: (id: number) => boolean;
  generateInsight: (input: SessionArchiveGenerateInsightRequest) => SessionArchiveInsight;
  starSession: (sessionId: string) => boolean;
  unstarSession: (sessionId: string) => void;
  listStarredSessions: () => string[];
  bulkStarSessions: (sessionIds: string[]) => void;
  pinMessage: (sessionId: string, messageId: number, input?: SessionArchivePinRequest) => SessionArchivePinResponse | null;
  unpinMessage: (sessionId: string, messageId: number) => void;
  listPins: (project?: string) => SessionArchivePinsResponse;
  listSessionPins: (sessionId: string) => SessionArchivePinsResponse;
  renameSession: (sessionId: string, input: SessionArchiveRenameSessionRequest) => SessionArchiveSession | null;
  trashSession: (sessionId: string) => boolean;
  restoreSession: (sessionId: string) => boolean;
  permanentlyDeleteSession: (sessionId: string) => boolean;
  listTrash: () => SessionArchiveTrashList;
  emptyTrash: () => number;
  getSessionDirectory: (sessionId: string) => SessionArchiveDirectoryResponse | null;
  openSessionDirectory: (sessionId: string) => SessionArchiveOpenSessionResponse | null;
  resumeSession: (sessionId: string, input?: SessionArchiveResumeSessionRequest) => SessionArchiveResumeSessionResponse | null;
  exportSessionHtml: (sessionId: string) => SessionArchiveExportResponse | null;
  exportSessionMarkdown: (sessionId: string) => SessionArchiveExportResponse | null;
  publishSession: (sessionId: string) => SessionArchivePublishResponse | null;
  importUploadedExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  importClaudeAiExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  importChatGptExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  getConfigSnapshot: () => SessionArchiveConfigSnapshot;
  updateConfig: (input: SessionArchiveConfigUpdate) => SessionArchiveConfigSnapshot;
  getBackendsStatus: () => SessionArchiveBackendsStatusResponse;
  upsertWorktreeMapping: (input: SessionArchiveWorktreeMappingInput) => SessionArchiveWorktreeMapping;
  deleteWorktreeMapping: (id: string) => boolean;
  applyWorktreeMappings: () => { updated: number; mappings: SessionArchiveWorktreeMapping[] };
  scanSecrets: () => SessionArchiveSecretScanSummary;
  listSecretFindings: (input?: SessionArchiveSecretFindingsInput) => SessionArchiveSecretFindingsResponse;
  searchSession: (input: SessionArchiveSessionSearchInput) => SessionArchiveSessionSearchResponse;
  searchContent: (input: SessionArchiveContentSearchInput) => SessionArchiveContentSearchResponse;
  search: (input: SessionArchiveSearchInput) => SessionArchiveSearchResponse;
  stats: () => SessionArchiveStats;
};

export type SessionArchiveSourceFileState = {
  path: string;
  agent: string;
  session_id: string;
  size: number;
  mtime: number;
  hash: string;
  synced_at: string;
};

export type SessionArchiveSkippedFileState = {
  path: string;
  agent: string;
  size: number;
  mtime: number;
  hash: string;
  reason: string;
  skipped_at: string;
};

export type SessionArchiveSessionListInput = {
  start?: number;
  cursor?: string;
  limit?: number;
  search?: string;
  agent?: string;
  project?: string;
  excludeProject?: string;
  machine?: string;
  date?: string;
  from?: string;
  to?: string;
  activeSince?: string;
  minMessages?: number;
  maxMessages?: number;
  minUserMessages?: number;
  includeOneShot?: boolean;
  includeAutomated?: boolean;
  automated?: "all" | "human" | "automated";
  includeChildren?: boolean;
  includeOrphans?: boolean;
  outcome?: string[];
  healthGrade?: string[];
  minToolFailures?: number;
  hasSecret?: boolean;
  starred?: boolean;
  termination?: "all" | "clean" | "unclean" | "truncated" | "tool_call_pending";
};

export type SessionArchiveMessagesInput = {
  limit?: number;
  direction?: "asc" | "desc";
  from?: number;
};

export type SessionArchiveSearchInput = {
  query: string;
  cursor?: number;
  limit?: number;
  sort?: "relevance" | "recency";
} & Omit<SessionArchiveSessionListInput, "search" | "start" | "cursor" | "limit">;

export type SessionArchiveSessionSearchInput = {
  sessionId: string;
  query: string;
};

type SessionArchiveSessionSearchMatch = {
  ordinal: number;
  source: "message" | "tool_result";
  match_start: number;
  match_end: number;
  snippet: string;
};

export type SessionArchiveContentSearchInput = {
  pattern: string;
  mode?: "substring" | "regex" | "fts";
  sources?: string[];
  excludeSystem?: boolean;
  cursor?: number;
  limit?: number;
  project?: string;
  agent?: string;
};

export type SessionArchiveUsageFilterInput = {
  from: string;
  to: string;
  agent?: string;
  project?: string;
  machine?: string;
  model?: string;
  excludeProject?: string;
  excludeAgent?: string;
  excludeModel?: string;
  minUserMessages?: number;
  includeOneShot?: boolean;
  includeAutomated?: boolean;
  activeSince?: string;
};

export type SessionArchiveUsageComparisonInput = SessionArchiveUsageFilterInput & {
  currentCost: number;
};

export type SessionArchiveUsageTopSessionsInput = SessionArchiveUsageFilterInput & {
  limit?: number;
};

export type SessionArchiveActivityReportInput = {
  preset?: "day" | "week" | "month" | "custom";
  date?: string;
  from?: string;
  to?: string;
  timezone?: string;
  bucket?: "5m" | "15m" | "1h" | "1d" | "1w";
  project?: string;
  agent?: string;
  machine?: string;
  automation?: "all" | "interactive" | "automated";
};

export type SessionArchiveTrendsTermsInput = SessionArchiveUsageFilterInput & {
  terms: string[];
  granularity?: "day" | "week" | "month";
};

export type SessionArchiveSecretFindingsInput = {
  from?: string;
  to?: string;
  project?: string;
  agent?: string;
  rule?: string;
  confidence?: SessionArchiveSecretConfidence;
  limit?: number;
  cursor?: number;
};

export type SessionArchiveInsightFilterInput = {
  type?: string;
  project?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type SessionArchiveTrashList = { sessions: SessionArchiveSession[] };

type SessionArchiveListCursor = {
  activity: string;
  id: string;
  total: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

export async function openSessionArchiveStore(input: {
  dbPath: string;
  readOnly?: boolean;
}): Promise<SessionArchiveStore> {
  if (!input.readOnly) {
    await ensureDir(dirname(input.dbPath));
  }
  const db = input.readOnly
    ? new Database(input.dbPath, { readonly: true })
    : new Database(input.dbPath);
  if (!input.readOnly) {
    initializeArchiveDb(db);
    repairEpochArchiveTimestamps(db);
  }
  return createSessionArchiveStore(input.dbPath, db);
}

export function createSessionArchiveStore(
  dbPath: string,
  db: SqliteDatabase,
): SessionArchiveStore {
  const upsertSessionStatement = db.prepare(`
    INSERT INTO sessions (
      id, project, machine, agent, first_message, display_name, session_name, started_at, ended_at,
      message_count, user_message_count, parent_session_id, relationship_type,
      deleted_at, termination_status, file_path, file_size, file_mtime,
      file_inode, file_device, file_hash, local_modified_at, cwd, git_branch,
      source_session_id, source_version, parser_malformed_lines, is_truncated,
      secret_leak_count, secrets_rules_version,
      total_output_tokens, peak_context_tokens, has_total_output_tokens,
      has_peak_context_tokens, is_automated, is_teammate, is_index_only,
      health_score, health_grade, outcome, outcome_confidence, ended_with_role,
      tool_failure_signal_count, tool_retry_count, edit_churn_count,
      consecutive_failure_max, final_failure_streak, compaction_count,
      mid_task_compaction_count, context_pressure_max, quality_signals_json,
      health_score_basis_json, health_penalties_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project = excluded.project,
      machine = excluded.machine,
      agent = excluded.agent,
      first_message = excluded.first_message,
      display_name = excluded.display_name,
      session_name = excluded.session_name,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      message_count = excluded.message_count,
      user_message_count = excluded.user_message_count,
      parent_session_id = excluded.parent_session_id,
      relationship_type = excluded.relationship_type,
      deleted_at = excluded.deleted_at,
      termination_status = excluded.termination_status,
      file_path = excluded.file_path,
      file_size = excluded.file_size,
      file_mtime = excluded.file_mtime,
      file_inode = excluded.file_inode,
      file_device = excluded.file_device,
      file_hash = excluded.file_hash,
      local_modified_at = excluded.local_modified_at,
      cwd = excluded.cwd,
      git_branch = excluded.git_branch,
      source_session_id = excluded.source_session_id,
      source_version = excluded.source_version,
      parser_malformed_lines = excluded.parser_malformed_lines,
      is_truncated = excluded.is_truncated,
      secret_leak_count = CASE
        WHEN excluded.secret_leak_count != 0 OR excluded.secrets_rules_version != '' THEN excluded.secret_leak_count
        ELSE sessions.secret_leak_count
      END,
      secrets_rules_version = CASE
        WHEN excluded.secret_leak_count != 0 OR excluded.secrets_rules_version != '' THEN excluded.secrets_rules_version
        ELSE sessions.secrets_rules_version
      END,
      total_output_tokens = excluded.total_output_tokens,
      peak_context_tokens = excluded.peak_context_tokens,
      has_total_output_tokens = excluded.has_total_output_tokens,
      has_peak_context_tokens = excluded.has_peak_context_tokens,
      is_automated = excluded.is_automated,
      is_teammate = excluded.is_teammate,
      is_index_only = excluded.is_index_only,
      health_score = excluded.health_score,
      health_grade = excluded.health_grade,
      outcome = excluded.outcome,
      outcome_confidence = excluded.outcome_confidence,
      ended_with_role = excluded.ended_with_role,
      tool_failure_signal_count = excluded.tool_failure_signal_count,
      tool_retry_count = excluded.tool_retry_count,
      edit_churn_count = excluded.edit_churn_count,
      consecutive_failure_max = excluded.consecutive_failure_max,
      final_failure_streak = excluded.final_failure_streak,
      compaction_count = excluded.compaction_count,
      mid_task_compaction_count = excluded.mid_task_compaction_count,
      context_pressure_max = excluded.context_pressure_max,
      quality_signals_json = excluded.quality_signals_json,
      health_score_basis_json = excluded.health_score_basis_json,
      health_penalties_json = excluded.health_penalties_json,
      created_at = excluded.created_at
  `);
  const insertMessageStatement = db.prepare(`
    INSERT INTO messages (
      session_id, ordinal, role, content, timestamp, has_thinking,
      thinking_text, has_tool_use, content_length, model, token_usage_json,
      context_tokens, output_tokens, has_context_tokens, has_output_tokens,
      tool_calls_json, is_system, is_compact_boundary, claude_message_id,
      claude_request_id, source_type, source_subtype, source_uuid,
      source_parent_uuid, is_sidechain
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertUsageEventStatement = db.prepare(`
    INSERT INTO usage_events (
      session_id, message_ordinal, source, model,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
      reasoning_tokens, cost_usd, cost_status, cost_source, occurred_at, dedup_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertToolCallStatement = db.prepare(`
    INSERT INTO tool_calls (
      message_id, session_id, message_ordinal, call_index, tool_name, category,
      tool_use_id, input_json, skill_name, result_content_length,
      result_content, subagent_session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertToolResultEventStatement = db.prepare(`
    INSERT INTO tool_result_events (
      session_id, tool_call_message_ordinal, call_index, tool_use_id,
      agent_id, subagent_session_id, source, status, content,
      content_length, timestamp, event_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getSourceFileStatement = db.prepare("SELECT * FROM source_files WHERE path = ?");
  const upsertSourceFileStatement = db.prepare(`
    INSERT INTO source_files (path, agent, session_id, size, mtime, hash, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      agent = excluded.agent,
      session_id = excluded.session_id,
      size = excluded.size,
      mtime = excluded.mtime,
      hash = excluded.hash,
      synced_at = excluded.synced_at
  `);
  const getSkippedFileStatement = db.prepare("SELECT * FROM skipped_files WHERE path = ?");
  const upsertSkippedFileStatement = db.prepare(`
    INSERT INTO skipped_files (path, agent, size, mtime, hash, reason, skipped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      agent = excluded.agent,
      size = excluded.size,
      mtime = excluded.mtime,
      hash = excluded.hash,
      reason = excluded.reason,
      skipped_at = excluded.skipped_at
  `);
  const deleteSkippedFileStatement = db.prepare("DELETE FROM skipped_files WHERE path = ?");
  const insertInsightStatement = db.prepare(`
    INSERT INTO insights (
      type, date_from, date_to, project, agent, model, prompt, content,
      kind, schema_version, template_id, template_version, aggregate_hash,
      cache_key, cache_status, provenance_json, structured_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const starSessionStatement = db.prepare(`
    INSERT INTO starred_sessions (session_id, created_at)
    VALUES (?, ?)
    ON CONFLICT(session_id) DO UPDATE SET created_at = starred_sessions.created_at
  `);

  function upsertSession(session: SessionArchiveSession) {
    const parsed = sessionArchiveSessionSchema.parse(session);
    upsertSessionStatement.run(
      parsed.id,
      parsed.project,
      parsed.machine,
      parsed.agent,
      parsed.first_message,
      parsed.display_name ?? null,
      parsed.session_name ?? null,
      parsed.started_at,
      parsed.ended_at,
      parsed.message_count,
      parsed.user_message_count,
      parsed.parent_session_id ?? null,
      parsed.relationship_type ?? null,
      parsed.deleted_at ?? null,
      parsed.termination_status ?? null,
      parsed.file_path ?? null,
      parsed.file_size ?? null,
      parsed.file_mtime ?? null,
      parsed.file_inode ?? null,
      parsed.file_device ?? null,
      parsed.file_hash ?? null,
      parsed.local_modified_at ?? null,
      parsed.cwd ?? "",
      parsed.git_branch ?? "",
      parsed.source_session_id ?? "",
      parsed.source_version ?? "",
      parsed.parser_malformed_lines ?? 0,
      boolToInt(parsed.is_truncated) ?? 0,
      parsed.secret_leak_count ?? 0,
      parsed.secrets_rules_version ?? "",
      parsed.total_output_tokens,
      parsed.peak_context_tokens,
      boolToInt(parsed.has_total_output_tokens),
      boolToInt(parsed.has_peak_context_tokens),
      boolToInt(parsed.is_automated),
      boolToInt(parsed.is_teammate),
      boolToInt(parsed.is_index_only),
      parsed.health_score ?? null,
      parsed.health_grade ?? null,
      parsed.outcome ?? null,
      parsed.outcome_confidence ?? null,
      parsed.ended_with_role ?? null,
      parsed.tool_failure_signal_count ?? null,
      parsed.tool_retry_count ?? null,
      parsed.edit_churn_count ?? null,
      parsed.consecutive_failure_max ?? null,
      parsed.final_failure_streak ?? null,
      parsed.compaction_count ?? null,
      parsed.mid_task_compaction_count ?? null,
      parsed.context_pressure_max ?? null,
      jsonOrNull(parsed.quality_signals),
      jsonOrNull(parsed.health_score_basis),
      jsonOrNull(parsed.health_penalties),
      parsed.created_at,
    );
  }

  function replaceSessionMessages(sessionId: string, messages: SessionArchiveMessage[]) {
    db.transaction((items: SessionArchiveMessage[]) => {
      db.prepare("DELETE FROM tool_result_events WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM secret_findings WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
      for (const message of items) {
        const parsed = sessionArchiveMessageSchema.parse(message);
        if (parsed.session_id !== sessionId) {
          throw new Error("message session_id does not match target session");
        }
        const insertResult = insertMessageStatement.run(
          parsed.session_id,
          parsed.ordinal,
          parsed.role,
          parsed.content,
          parsed.timestamp,
          boolToInt(parsed.has_thinking),
          parsed.thinking_text,
          boolToInt(parsed.has_tool_use),
          parsed.content_length,
          parsed.model,
          jsonOrNull(parsed.token_usage),
          parsed.context_tokens,
          parsed.output_tokens,
          boolToInt(parsed.has_context_tokens),
          boolToInt(parsed.has_output_tokens),
          jsonOrNull(parsed.tool_calls),
          boolToInt(parsed.is_system),
          boolToInt(parsed.is_compact_boundary),
          parsed.claude_message_id ?? "",
          parsed.claude_request_id ?? "",
          parsed.source_type ?? "",
          parsed.source_subtype ?? null,
          parsed.source_uuid ?? "",
          parsed.source_parent_uuid ?? "",
          boolToInt(parsed.is_sidechain) ?? 0,
        );
        const messageRowId = sqliteLastInsertRowId(insertResult);
        for (const [index, call] of (parsed.tool_calls ?? []).entries()) {
          const toolCall = sessionArchiveToolCallSchema.parse(call);
          insertToolCallStatement.run(
            messageRowId,
            parsed.session_id,
            parsed.ordinal,
            index,
            toolCall.tool_name,
            toolCall.category ?? "Other",
            toolCall.tool_use_id ?? null,
            toolCall.input_json ?? null,
            toolCall.skill_name ?? null,
            toolCall.result_content_length ?? toolCall.result_content?.length ?? null,
            toolCall.result_content ?? null,
            toolCall.subagent_session_id ?? null,
          );
          for (const event of toolCall.result_events ?? []) {
            insertToolResultEventStatement.run(
              parsed.session_id,
              parsed.ordinal,
              index,
              event.tool_use_id ?? toolCall.tool_use_id ?? null,
              event.agent_id ?? null,
              event.subagent_session_id ?? toolCall.subagent_session_id ?? null,
              event.source,
              event.status,
              event.content,
              event.content_length,
              event.timestamp ?? null,
              event.event_index,
            );
          }
        }
      }
      db.prepare(`
        UPDATE sessions
        SET message_count = ?,
            user_message_count = ?,
            secret_leak_count = 0,
            secrets_rules_version = ''
        WHERE id = ?
      `).run(
        items.filter((message) => !message.is_system).length,
        items.filter((message) => message.role === "user" && !message.is_system).length,
        sessionId,
      );
    })(messages);
  }

  function replaceSessionUsageEvents(sessionId: string, events: SessionArchiveUsageEvent[]) {
    db.transaction((items: SessionArchiveUsageEvent[]) => {
      db.prepare("DELETE FROM usage_events WHERE session_id = ?").run(sessionId);
      for (const event of items) {
        const parsed = sessionArchiveUsageEventSchema.parse({ ...event, session_id: event.session_id || sessionId });
        if (parsed.session_id !== sessionId) {
          throw new Error("usage event session_id does not match target session");
        }
        insertUsageEventStatement.run(
          parsed.session_id,
          parsed.message_ordinal ?? null,
          parsed.source,
          parsed.model,
          parsed.input_tokens,
          parsed.output_tokens,
          parsed.cache_creation_input_tokens ?? 0,
          parsed.cache_read_input_tokens ?? 0,
          parsed.reasoning_tokens ?? 0,
          parsed.cost_usd ?? null,
          parsed.cost_status ?? "",
          parsed.cost_source ?? "",
          parsed.occurred_at ?? null,
          parsed.dedup_key ?? "",
        );
      }
    })(events);
  }

  function listUsageEvents(sessionId: string): SessionArchiveUsageEvent[] {
    return db.prepare(`
      SELECT * FROM usage_events
      WHERE session_id = ?
      ORDER BY COALESCE(occurred_at, ''), id ASC
    `).all(sessionId).map(usageEventFromRow);
  }

  function getSourceFile(path: string): SessionArchiveSourceFileState | null {
    const row = getSourceFileStatement.get(path);
    return row ? sourceFileFromRow(row) : null;
  }

  function upsertSourceFile(state: SessionArchiveSourceFileState) {
    upsertSourceFileStatement.run(
      state.path,
      state.agent,
      state.session_id,
      state.size,
      state.mtime,
      state.hash,
      state.synced_at,
    );
  }

  function getSkippedFile(path: string): SessionArchiveSkippedFileState | null {
    const row = getSkippedFileStatement.get(path);
    return row ? skippedFileFromRow(row) : null;
  }

  function upsertSkippedFile(state: SessionArchiveSkippedFileState) {
    upsertSkippedFileStatement.run(
      state.path,
      state.agent,
      state.size,
      state.mtime,
      state.hash,
      state.reason,
      state.skipped_at,
    );
  }

  function deleteSkippedFile(path: string) {
    deleteSkippedFileStatement.run(path);
  }

  function listSessions(input: SessionArchiveSessionListInput = {}): SessionArchiveSessionPage {
    const limit = normalizeLimit(input.limit);
    const { where, args } = sessionListWhere(input);
    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM sessions ${where}`).get(...args);
    const total = numberField(totalRow, "total");
    const cursor = input.cursor ? decodeSessionListCursor(input.cursor) : null;
    const cursorClause = cursor ? " AND (COALESCE(ended_at, started_at, created_at) < ? OR (COALESCE(ended_at, started_at, created_at) = ? AND id > ?))" : "";
    const cursorArgs = cursor ? [cursor.activity, cursor.activity, cursor.id] : [];
    const legacyOffset = input.cursor ? 0 : normalizeOffset(input.start);
    const rows = db.prepare(`
      SELECT * FROM sessions
      ${where}${cursorClause}
      ORDER BY COALESCE(ended_at, started_at, created_at) DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...args, ...cursorArgs, limit + 1, legacyOffset);
    const sessions = rows.slice(0, limit).map(sessionFromRow);
    const next = rows.length > limit ? encodeSessionListCursor(sessions.at(-1), total) : undefined;
    return {
      sessions,
      ...(next ? { next_cursor: next } : {}),
      total,
      agent_counts: listSessionAgentCounts(input),
    };
  }

  function listSessionAgentCounts(input: SessionArchiveSessionListInput): Array<{ agent: string; count: number }> {
    const { where, args } = sessionListWhere({ ...input, agent: undefined });
    return db.prepare(`
      SELECT agent, COUNT(*) AS count
      FROM sessions
      ${where}
      GROUP BY agent
      ORDER BY agent ASC
    `).all(...args).map((row) => ({ agent: stringField(row, "agent"), count: numberField(row, "count") }));
  }

  function sessionListWhere(input: SessionArchiveSessionListInput): { where: string; args: Array<string | number> } {
    const clauses = ["deleted_at IS NULL"];
    const args: Array<string | number> = [];
    const search = String(input.search ?? "").trim();
    const agent = String(input.agent ?? "").trim();
    const project = String(input.project ?? "").trim();
    const excludeProject = String(input.excludeProject ?? "").trim();
    const machine = String(input.machine ?? "").trim();
    if (search) {
      clauses.push("(id LIKE ? ESCAPE '\\' OR project LIKE ? ESCAPE '\\' OR machine LIKE ? ESCAPE '\\' OR agent LIKE ? ESCAPE '\\' OR COALESCE(display_name, session_name, first_message, '') LIKE ? ESCAPE '\\')");
      args.push(...Array.from({ length: 5 }, () => likePattern(search)));
    }
    if (agent) {
      clauses.push("agent = ?");
      args.push(agent);
    }
    if (project) {
      clauses.push("project = ?");
      args.push(project);
    }
    if (excludeProject) {
      clauses.push("project != ?");
      args.push(excludeProject);
    }
    if (machine) {
      clauses.push("machine = ?");
      args.push(machine);
    }
    if (input.date) {
      clauses.push("date(COALESCE(NULLIF(started_at, ''), created_at)) = date(?)");
      args.push(input.date);
    }
    if (input.from) {
      clauses.push("date(COALESCE(NULLIF(started_at, ''), created_at)) >= date(?)");
      args.push(input.from);
    }
    if (input.to) {
      clauses.push("date(COALESCE(NULLIF(started_at, ''), created_at)) <= date(?)");
      args.push(input.to);
    }
    if (input.activeSince) {
      clauses.push("COALESCE(NULLIF(ended_at, ''), NULLIF(started_at, ''), created_at) >= ?");
      args.push(input.activeSince);
    }
    if (input.minMessages != null) {
      clauses.push("message_count >= ?");
      args.push(input.minMessages);
    }
    if (input.maxMessages != null) {
      clauses.push("message_count <= ?");
      args.push(input.maxMessages);
    }
    if (input.minUserMessages != null) {
      clauses.push("user_message_count >= ?");
      args.push(input.minUserMessages);
    }
    if (input.includeOneShot === false) {
      clauses.push("user_message_count > 1");
    }
    const automatedMode = input.automated ?? (input.includeAutomated === true ? "all" : undefined);
    if (automatedMode === "human") {
      clauses.push("is_automated = 0");
    } else if (automatedMode === "automated") {
      clauses.push("is_automated = 1");
    } else if (input.includeAutomated !== true) {
      clauses.push("is_automated = 0");
    }
    if (input.includeChildren !== true) {
      if (input.includeOrphans === true) {
        clauses.push("(parent_session_id IS NULL OR parent_session_id = '' OR parent_session_id NOT IN (SELECT id FROM sessions))");
      } else {
        clauses.push("(parent_session_id IS NULL OR parent_session_id = '')");
      }
    }
    addInClause("COALESCE(outcome, '')", input.outcome);
    addInClause("COALESCE(health_grade, '')", input.healthGrade);
    if (input.minToolFailures != null) {
      clauses.push("COALESCE(tool_failure_signal_count, 0) >= ?");
      args.push(input.minToolFailures);
    }
    if (input.hasSecret === true) {
      clauses.push(`secret_leak_count > 0 AND secrets_rules_version IN (${SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS.map(() => "?").join(", ")})`);
      args.push(...SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS);
    }
    if (input.starred === true) {
      clauses.push("EXISTS (SELECT 1 FROM starred_sessions ss WHERE ss.session_id = sessions.id)");
    }
    if (input.termination && input.termination !== "all") {
      if (input.termination === "clean") {
        clauses.push("COALESCE(termination_status, '') = 'clean'");
      } else if (input.termination === "unclean") {
        clauses.push("COALESCE(termination_status, '') IN ('tool_call_pending', 'truncated')");
      } else {
        clauses.push("COALESCE(termination_status, '') = ?");
        args.push(input.termination);
      }
    }
    return { where: `WHERE ${clauses.join(" AND ")}`, args };

    function addInClause(column: string, values: string[] | undefined) {
      const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
      if (!normalized.length) return;
      clauses.push(`${column} IN (${normalized.map(() => "?").join(", ")})`);
      args.push(...normalized);
    }
  }

  function encodeSessionListCursor(session: SessionArchiveSession | undefined, total: number): string | undefined {
    if (!session) return undefined;
    const payload = JSON.stringify({
      activity: session.ended_at || session.started_at || session.created_at,
      id: session.id,
      total,
    } satisfies SessionArchiveListCursor);
    const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
    const signature = createHmac("sha256", sessionListCursorSecret(dbPath)).update(encodedPayload).digest("base64url");
    return `${encodedPayload}.${signature}`;
  }

  function decodeSessionListCursor(value: string): SessionArchiveListCursor {
    const parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error("invalid session archive list cursor");
    }
    const expected = createHmac("sha256", sessionListCursorSecret(dbPath)).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("invalid session archive list cursor signature");
    }
    const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<SessionArchiveListCursor>;
    if (typeof decoded.activity !== "string" || typeof decoded.id !== "string" || typeof decoded.total !== "number") {
      throw new Error("invalid session archive list cursor payload");
    }
    return { activity: decoded.activity, id: decoded.id, total: decoded.total };
  }

  function getSession(sessionId: string): SessionArchiveSession | null {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(sessionId);
    return row ? sessionFromRow(row) : null;
  }

  function getSessionIncludingDeleted(sessionId: string): SessionArchiveSession | null {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    return row ? sessionFromRow(row) : null;
  }

  function sessionExists(sessionId: string): boolean {
    return Boolean(db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId));
  }

  function isSessionExcluded(sessionId: string): boolean {
    return Boolean(db.prepare("SELECT id FROM excluded_sessions WHERE id = ?").get(sessionId));
  }

  function listMessages(sessionId: string, input: SessionArchiveMessagesInput = {}): SessionArchiveMessagesResponse {
    const limit = normalizeLimit(input.limit);
    const direction = input.direction === "desc" ? "desc" : "asc";
    const comparator = direction === "desc" ? "<=" : ">=";
    const order = direction === "desc" ? "DESC" : "ASC";
    const args: unknown[] = [sessionId];
    let ordinalFilter = "";
    if (input.from !== undefined) {
      ordinalFilter = `AND ordinal ${comparator} ?`;
      args.push(normalizeOffset(input.from));
    }
    args.push(limit);
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE session_id = ? AND is_system = 0
      ${ordinalFilter}
      ORDER BY ordinal ${order}, id ${order}
      LIMIT ?
    `).all(...args);
    return { messages: rows.map(messageFromRow), count: rows.length };
  }

  function listAllMessages(sessionId: string): SessionArchiveMessage[] {
    return db.prepare(`
      SELECT * FROM messages
      WHERE session_id = ?
      ORDER BY ordinal ASC, id ASC
    `).all(sessionId).map(messageFromRow);
  }

  function listVisibleMessages(sessionId: string): SessionArchiveMessage[] {
    return db.prepare(`
      SELECT * FROM messages
      WHERE session_id = ? AND is_system = 0
      ORDER BY ordinal ASC, id ASC
    `).all(sessionId).map(messageFromRow);
  }

  function listToolCalls(sessionId: string): SessionArchiveToolCallListResponse {
    const normalizedRows = db.prepare(`
      SELECT message_ordinal, tool_name, category, tool_use_id, input_json,
             skill_name, result_content_length, result_content, subagent_session_id,
             messages.timestamp
      FROM tool_calls
      JOIN messages ON messages.id = tool_calls.message_id
      WHERE tool_calls.session_id = ?
      ORDER BY message_ordinal ASC, call_index ASC, tool_calls.id ASC
    `).all(sessionId);
    if (normalizedRows.length > 0) {
      const toolCalls = normalizedRows.map((row) => {
        const call = sessionArchiveToolCallSchema.parse({
          tool_name: stringField(row, "tool_name"),
          category: optionalStringField(row, "category"),
          tool_use_id: optionalStringField(row, "tool_use_id"),
          input_json: optionalStringField(row, "input_json"),
          skill_name: optionalStringField(row, "skill_name"),
          result_content_length: optionalNumberField(row, "result_content_length"),
          result_content: optionalStringField(row, "result_content"),
          subagent_session_id: optionalStringField(row, "subagent_session_id"),
        });
        return {
          ...call,
          ordinal: numberField(row, "message_ordinal"),
          timestamp: stringField(row, "timestamp"),
          result_length: call.result_content_length ?? call.result_content?.length ?? 0,
        };
      });
      return { tool_calls: toolCalls, count: toolCalls.length };
    }
    const rows = db.prepare(`
      SELECT ordinal, timestamp, tool_calls_json
      FROM messages
      WHERE session_id = ? AND tool_calls_json IS NOT NULL AND tool_calls_json != ''
      ORDER BY ordinal ASC, id ASC
    `).all(sessionId);
    const toolCalls: SessionArchiveToolCallListItem[] = [];
    for (const row of rows) {
      const calls = parseToolCalls(objectField(row, "tool_calls_json"));
      for (const call of calls) {
        toolCalls.push({
          ...call,
          ordinal: numberField(row, "ordinal"),
          timestamp: stringField(row, "timestamp"),
          result_length: call.result_content_length ?? call.result_content?.length ?? 0,
        });
      }
    }
    return { tool_calls: toolCalls, count: toolCalls.length };
  }

  function listChildren(sessionId: string): SessionArchiveSession[] {
    return db.prepare(`
      SELECT * FROM sessions
      WHERE parent_session_id = ? AND deleted_at IS NULL
      ORDER BY COALESCE(started_at, created_at) ASC, id ASC
    `).all(sessionId).map(sessionFromRow);
  }

  function getActivity(sessionId: string): SessionArchiveSessionActivityResponse | null {
    if (!getSession(sessionId)) return null;
    const totalRow = db.prepare("SELECT COUNT(*) AS total FROM messages WHERE session_id = ?").get(sessionId);
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE session_id = ? AND is_system = 0 AND timestamp != ''
      ORDER BY timestamp ASC, ordinal ASC
    `).all(sessionId).map(messageFromRow).filter((message) => parseTimestamp(message.timestamp) !== null);
    if (rows.length === 0) {
      return { buckets: [], interval_seconds: 0, total_messages: numberField(totalRow, "total") };
    }
    const first = parseTimestamp(rows[0]?.timestamp ?? "");
    const last = parseTimestamp(rows[rows.length - 1]?.timestamp ?? "");
    if (!first || !last) {
      return { buckets: [], interval_seconds: 0, total_messages: numberField(totalRow, "total") };
    }
    const intervalSeconds = snapInterval(Math.max(0, Math.floor((last.getTime() - first.getTime()) / 1000)));
    const anchorMs = Math.floor(first.getTime() / 1000) * 1000;
    const buckets = new Map<number, { user_count: number; assistant_count: number; first_ordinal: number | null }>();
    for (const message of rows) {
      const timestamp = parseTimestamp(message.timestamp);
      if (!timestamp) continue;
      const index = Math.floor((timestamp.getTime() - anchorMs) / (intervalSeconds * 1000));
      const current = buckets.get(index) ?? { user_count: 0, assistant_count: 0, first_ordinal: null };
      if (message.role === "user") current.user_count += 1;
      if (message.role === "assistant") current.assistant_count += 1;
      current.first_ordinal = current.first_ordinal === null ? message.ordinal : Math.min(current.first_ordinal, message.ordinal);
      buckets.set(index, current);
    }
    const maxIndex = Math.max(...buckets.keys());
    return {
      buckets: Array.from({ length: maxIndex + 1 }, (_, index) => {
        const startMs = anchorMs + index * intervalSeconds * 1000;
        const bucket = buckets.get(index);
        return {
          start_time: new Date(startMs).toISOString(),
          end_time: new Date(startMs + intervalSeconds * 1000).toISOString(),
          user_count: bucket?.user_count ?? 0,
          assistant_count: bucket?.assistant_count ?? 0,
          first_ordinal: bucket?.first_ordinal ?? null,
        };
      }),
      interval_seconds: intervalSeconds,
      total_messages: numberField(totalRow, "total"),
    };
  }

  function getTiming(sessionId: string): SessionArchiveSessionTiming | null {
    const session = getSession(sessionId);
    if (!session) return null;
    const messages = listAllMessages(sessionId);
    const subagentDuration = (subagentSessionId: string): number | null => {
      const child = getSession(subagentSessionId);
      return child ? durationBetween(child.started_at ?? undefined, child.ended_at ?? new Date().toISOString()) : null;
    };
    const callsByOrdinal = new Map<number, SessionArchiveToolCallListItem[]>();
    for (const call of listToolCalls(sessionId).tool_calls) {
      const current = callsByOrdinal.get(call.ordinal) ?? [];
      current.push(call);
      callsByOrdinal.set(call.ordinal, current);
    }
    let toolDurationMs = 0;
    let toolCallCount = 0;
    let subagentCount = 0;
    let slowestCall: SessionArchiveSessionTiming["slowest_call"] = null;
    const byCategory = new Map<string, { duration_ms: number; call_count: number }>();
    const turns: SessionArchiveSessionTiming["turns"] = [];
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message.has_tool_use) continue;
      const calls = callsByOrdinal.get(message.ordinal) ?? [];
      const nextMessage = messages[index + 1];
      const duration = durationBetween(message.timestamp, nextMessage?.timestamp ?? session.ended_at ?? undefined);
      const turnDuration = duration !== null && duration >= 0 ? duration : null;
      const mappedCalls = calls.map((call) => {
        const callDuration = call.subagent_session_id ? subagentDuration(call.subagent_session_id) : calls.length <= 1 ? turnDuration : null;
        const mapped = {
          tool_use_id: call.tool_use_id ?? "",
          tool_name: call.tool_name,
          category: call.category ?? "Other",
          skill_name: call.skill_name,
          subagent_session_id: call.subagent_session_id,
          duration_ms: callDuration,
          is_parallel: calls.length > 1,
          input_preview: inputPreview(call),
        };
        if (mapped.subagent_session_id) subagentCount += 1;
        if (mapped.duration_ms !== null && (!slowestCall || mapped.duration_ms > (slowestCall.duration_ms ?? 0))) {
          slowestCall = mapped;
        }
        return mapped;
      });
      toolCallCount += mappedCalls.length;
      if (turnDuration !== null) toolDurationMs += turnDuration;
      const primaryCategory = primaryCategoryForCalls(mappedCalls);
      if (turnDuration !== null && turnDuration > 0) {
        const total = byCategory.get(primaryCategory) ?? { duration_ms: 0, call_count: 0 };
        total.duration_ms += turnDuration;
        total.call_count += mappedCalls.length;
        byCategory.set(primaryCategory, total);
      }
      turns.push({
        message_id: message.id,
        ordinal: message.ordinal,
        started_at: message.timestamp,
        duration_ms: turnDuration,
        primary_category: primaryCategory,
        calls: mappedCalls,
      });
    }
    return {
      session_id: sessionId,
      total_duration_ms: Math.max(0, durationBetween(session.started_at ?? undefined, session.ended_at ?? new Date().toISOString()) ?? 0),
      tool_duration_ms: toolDurationMs,
      turn_count: turns.length,
      tool_call_count: toolCallCount,
      subagent_count: subagentCount,
      slowest_call: slowestCall,
      by_category: Array.from(byCategory.entries())
        .map(([category, total]) => ({ category, ...total }))
        .sort((left, right) => right.duration_ms - left.duration_ms),
      turns,
      running: !session.ended_at,
    };
  }

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

  function listInsights(input: SessionArchiveInsightFilterInput = {}): SessionArchiveInsightsResponse {
    const rows = db.prepare(`
      SELECT * FROM insights
      WHERE (? = '' OR type = ?)
        AND (? = '' OR project = ?)
        AND (? = '' OR date_from >= ?)
        AND (? = '' OR date_to <= ?)
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    `).all(input.type ?? "", input.type ?? "", input.project ?? "", input.project ?? "", input.dateFrom ?? "", input.dateFrom ?? "", input.dateTo ?? "", input.dateTo ?? "");
    return { insights: rows.map(insightFromRow) };
  }

  function getInsight(id: number): SessionArchiveInsight | null {
    const row = db.prepare("SELECT * FROM insights WHERE id = ?").get(Math.floor(id));
    return row ? insightFromRow(row) : null;
  }

  function deleteInsight(id: number): boolean {
    const result = db.prepare("DELETE FROM insights WHERE id = ?").run(Math.floor(id));
    return sqliteRunChanges(result) > 0;
  }

  function generateInsight(input: SessionArchiveGenerateInsightRequest): SessionArchiveInsight {
    const parsed = sessionArchiveGenerateInsightRequestSchema.parse(input);
    const project = parsed.project?.trim() || null;
    const agent = parsed.agent?.trim() || "studio-local";
    const activity = getActivityReport({ preset: "custom", from: `${parsed.date_from}T00:00:00Z`, to: `${parsed.date_to}T23:59:59Z`, project: project ?? undefined, automation: parsed.automated_scope === "automated" ? "automated" : parsed.automated_scope === "human" ? "interactive" : "all" });
    const summary = getAnalyticsSummary();
    const tools = getAnalyticsTools();
    const signals = getAnalyticsSignals();
    const content = buildDeterministicInsight({ input: parsed, activity, summary, tools, signals });
    const createdAt = new Date().toISOString();
    const aggregateHash = insightAggregateHash(parsed, activity);
    const result = insertInsightStatement.run(
      parsed.type,
      parsed.date_from,
      parsed.date_to,
      project,
      agent,
      null,
      parsed.prompt ?? null,
      content,
      parsed.kind ?? "",
      parsed.type === "llm_canned" ? "llm_insight.v1" : "studio_deterministic.v1",
      parsed.kind ?? "activity_summary",
      "1",
      aggregateHash,
      `${parsed.type}:${parsed.kind ?? ""}:${parsed.date_from}:${parsed.date_to}:${project ?? ""}`,
      parsed.force_refresh ? "fresh" : "hit",
      JSON.stringify({ source: "studio_session_archive", llm_opt_in: parsed.llm_opt_in === true }),
      JSON.stringify({ totals: activity.totals, summary: { sessions: summary.total_sessions, messages: summary.total_messages }, signals: { scored_sessions: signals.scored_sessions } }),
      createdAt,
    );
    const insight = getInsight(sqliteLastInsertRowid(result));
    if (!insight) throw new Error("generated insight was not saved");
    return insight;
  }

  function starSession(sessionId: string): boolean {
    if (!sessionExists(sessionId)) return false;
    starSessionStatement.run(sessionId, new Date().toISOString());
    return true;
  }

  function unstarSession(sessionId: string) {
    db.prepare("DELETE FROM starred_sessions WHERE session_id = ?").run(sessionId);
  }

  function listStarredSessions(): string[] {
    return db.prepare(`
      SELECT starred_sessions.session_id
      FROM starred_sessions
      INNER JOIN sessions ON sessions.id = starred_sessions.session_id
      WHERE sessions.deleted_at IS NULL
      ORDER BY starred_sessions.created_at DESC, starred_sessions.session_id ASC
    `).all().map((row) => stringField(row, "session_id"));
  }

  function bulkStarSessions(sessionIds: string[]) {
    db.transaction((ids: string[]) => {
      for (const sessionId of ids.map((id) => id.trim()).filter(Boolean)) {
        starSession(sessionId);
      }
    })(sessionIds);
  }

  function pinMessage(sessionId: string, messageId: number, input: SessionArchivePinRequest = {}): SessionArchivePinResponse | null {
    const parsed = sessionArchivePinRequestSchema.parse(input);
    const message = db.prepare(`
      SELECT id, ordinal, role, content
      FROM messages
      WHERE session_id = ? AND ordinal = ?
      LIMIT 1
    `).get(sessionId, messageId);
    if (!message || !sessionExists(sessionId)) return null;
    db.prepare(`
      INSERT INTO pinned_messages (session_id, message_id, note, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, message_id) DO UPDATE SET
        note = excluded.note,
        created_at = pinned_messages.created_at
    `).run(sessionId, messageId, parsed.note ?? null, new Date().toISOString());
    const row = db.prepare("SELECT id FROM pinned_messages WHERE session_id = ? AND message_id = ?").get(sessionId, messageId);
    return { id: numberField(row, "id") };
  }

  function unpinMessage(sessionId: string, messageId: number) {
    db.prepare("DELETE FROM pinned_messages WHERE session_id = ? AND message_id = ?").run(sessionId, messageId);
  }

  function listPins(project?: string): SessionArchivePinsResponse {
    const trimmedProject = project?.trim();
    const rows = trimmedProject
      ? db.prepare(pinsQuery("AND sessions.project = ?")).all(trimmedProject)
      : db.prepare(pinsQuery("")).all();
    return { pins: rows.map(pinnedMessageFromRow) };
  }

  function listSessionPins(sessionId: string): SessionArchivePinsResponse {
    const rows = db.prepare(pinsQuery("AND pinned_messages.session_id = ?")).all(sessionId);
    return { pins: rows.map(pinnedMessageFromRow) };
  }

  function renameSession(sessionId: string, input: SessionArchiveRenameSessionRequest): SessionArchiveSession | null {
    const parsed = sessionArchiveRenameSessionRequestSchema.parse(input);
    const result = db.prepare("UPDATE sessions SET display_name = ? WHERE id = ? AND deleted_at IS NULL").run(parsed.name, sessionId);
    if (sqliteRunChanges(result) === 0) return null;
    return getSession(sessionId);
  }

  function trashSession(sessionId: string): boolean {
    const result = db.prepare(`
      UPDATE sessions
      SET deleted_at = COALESCE(deleted_at, ?)
      WHERE id = ? AND deleted_at IS NULL
    `).run(new Date().toISOString(), sessionId);
    return sqliteRunChanges(result) > 0;
  }

  function restoreSession(sessionId: string): boolean {
    const result = db.prepare("UPDATE sessions SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL").run(sessionId);
    return sqliteRunChanges(result) > 0;
  }

  function permanentlyDeleteSession(sessionId: string): boolean {
    const exists = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
    if (!exists) return false;
    db.transaction((id: string) => {
      db.prepare("INSERT OR IGNORE INTO excluded_sessions (id, created_at) VALUES (?, ?)").run(id, new Date().toISOString());
      db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    })(sessionId);
    return true;
  }

  function listTrash(): SessionArchiveTrashList {
    return {
      sessions: db.prepare(`
        SELECT * FROM sessions
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC, id ASC
      `).all().map(sessionFromRow),
    };
  }

  function emptyTrash(): number {
    const rows = db.prepare("SELECT id FROM sessions WHERE deleted_at IS NOT NULL").all();
    db.transaction((items: unknown[]) => {
      const now = new Date().toISOString();
      for (const row of items) {
        db.prepare("INSERT OR IGNORE INTO excluded_sessions (id, created_at) VALUES (?, ?)").run(stringField(row, "id"), now);
      }
      db.prepare("DELETE FROM sessions WHERE deleted_at IS NOT NULL").run();
    })(rows);
    return rows.length;
  }

  function getSessionDirectory(sessionId: string): SessionArchiveDirectoryResponse | null {
    const session = getSessionIncludingDeleted(sessionId);
    if (!session) return null;
    const directory = session.file_path ? dirname(session.file_path) : session.project;
    return { directory, exists: directory ? existsSync(directory) : false };
  }

  function openSessionDirectory(sessionId: string): SessionArchiveOpenSessionResponse | null {
    const directory = getSessionDirectory(sessionId);
    if (!directory) return null;
    return {
      ok: true,
      directory: directory.directory,
      command: directory.directory ? `open ${shellQuote(directory.directory)}` : undefined,
      launched: false,
    };
  }

  function resumeSession(sessionId: string, input: SessionArchiveResumeSessionRequest = {}): SessionArchiveResumeSessionResponse | null {
    const session = getSessionIncludingDeleted(sessionId);
    if (!session) return null;
    const parsed = sessionArchiveResumeSessionRequestSchema.parse(input);
    const command = resumeCommandForSession(session, parsed);
    const cwd = getSessionDirectory(sessionId)?.directory || session.project;
    return {
      launched: false,
      command,
      ...(cwd ? { cwd } : {}),
      ...(parsed.command_only ? {} : { terminal: "command-only" }),
    };
  }

  function exportSessionHtml(sessionId: string): SessionArchiveExportResponse | null {
    const session = getSessionIncludingDeleted(sessionId);
    if (!session) return null;
    return {
      filename: `${safeFilename(session.id)}.html`,
      content_type: "text/html; charset=utf-8",
      content: renderSessionHtml(session, listVisibleMessages(session.id)),
    };
  }

  function exportSessionMarkdown(sessionId: string): SessionArchiveExportResponse | null {
    const session = getSessionIncludingDeleted(sessionId);
    if (!session) return null;
    return {
      filename: `${safeFilename(session.id)}.md`,
      content_type: "text/markdown; charset=utf-8",
      content: renderSessionMarkdown(session, listVisibleMessages(session.id)),
    };
  }

  function publishSession(sessionId: string): SessionArchivePublishResponse | null {
    const exported = exportSessionMarkdown(sessionId);
    if (!exported) return null;
    return {
      ok: false,
      requires_remote: true,
      message: "GitHub Gist publishing requires user-configured credentials and is not executed by the local archive server.",
      filename: exported.filename,
    };
  }

  function importUploadedExport(input: SessionArchiveUploadImportRequest): SessionArchiveImportStats {
    const parsed = sessionArchiveUploadImportRequestSchema.parse(input);
    const lines = parsed.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const codexImport = parsed.agent === "codex" ? parseUploadedCodexJsonl(parsed, lines) : null;
    if (codexImport) return writeImportedSession(codexImport);
    const messages: SessionArchiveMessage[] = [];
    let errors = 0;
    let sessionId = `${parsed.agent ?? "upload"}:${safeFilename(parsed.filename)}:${shortHash(parsed.content)}`;
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        if (value && typeof value === "object") {
          const role = stringFromUnknown(Reflect.get(value, "role")) || stringFromUnknown(Reflect.get(value, "type")) || "message";
          const content = stringFromUnknown(Reflect.get(value, "content")) || JSON.stringify(value);
          if (stringFromUnknown(Reflect.get(value, "session_id"))) sessionId = stringFromUnknown(Reflect.get(value, "session_id"));
          messages.push(importMessage(sessionId, messages.length, role, content, stringFromUnknown(Reflect.get(value, "timestamp"))));
        }
      } catch {
        errors += 1;
      }
    }
    if (messages.length === 0 && parsed.content.trim()) {
      messages.push(importMessage(sessionId, 0, "user", parsed.content.trim(), undefined));
    }
    return writeImportedSession({
      sessionId,
      agent: parsed.agent ?? "unknown",
      project: parsed.project ?? parsed.filename,
      firstMessage: messages[0]?.content ?? parsed.filename,
      messages,
      errors,
    });
  }

  function parseUploadedCodexJsonl(
    parsed: SessionArchiveUploadImportRequest,
    lines: string[],
  ): { sessionId: string; agent: string; project: string; firstMessage: string; messages: SessionArchiveMessage[]; errors: number } | null {
    const rows: unknown[] = [];
    let errors = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row);
      } catch {
        errors += 1;
      }
    }
    if (!rows.some((row) => ["session_meta", "turn_context", "response_item", "event_msg"].includes(stringField(row, "type")))) return null;
    let rawId = safeFilename(parsed.filename) || shortHash(parsed.content);
    let model = "";
    const messages: SessionArchiveMessage[] = [];
    for (const row of rows) {
      const type = stringField(row, "type");
      const payload = objectRecord(objectField(row, "payload"));
      if (type === "session_meta") {
        rawId = stringField(payload, "id") || rawId;
        model = stringField(payload, "model") || model;
        continue;
      }
      if (type === "turn_context") {
        model = stringField(payload, "model") || model;
        continue;
      }
      if (type === "event_msg") {
        const usage = uploadedCodexTokenUsage(payload);
        if (!usage) continue;
        messages.push(importMessage(`codex:${rawId}`, messages.length, "system", "Token usage", stringField(row, "timestamp"), {
          model,
          tokenUsage: usage,
          isSystem: true,
          sourceSubtype: "token_count",
        }));
        continue;
      }
      if (type !== "response_item") continue;
      if (stringField(payload, "type") === "model_info") {
        model = stringField(payload, "model") || model;
        continue;
      }
      const role = stringField(payload, "role");
      if (role !== "user" && role !== "assistant") continue;
      const content = uploadedCodexContent(objectField(payload, "content"));
      if (!content) continue;
      messages.push(importMessage(`codex:${rawId}`, messages.length, role, content, stringField(row, "timestamp"), { model }));
    }
    if (messages.length === 0) return null;
    const visibleMessages = messages.filter((message) => !message.is_system);
    const first = visibleMessages.find((message) => message.role === "user" && message.content.trim()) ?? visibleMessages[0] ?? messages[0];
    return {
      sessionId: `codex:${rawId}`,
      agent: "codex",
      project: parsed.project ?? parsed.filename,
      firstMessage: first?.content ?? parsed.filename,
      messages,
      errors,
    };
  }

  function uploadedCodexTokenUsage(payload: unknown): Record<string, number> | null {
    if (stringField(payload, "type") !== "token_count") return null;
    const info = objectRecord(objectField(payload, "info"));
    const usage = objectRecord(objectField(info, "last_token_usage"));
    const normalized = numberRecord({
      input_tokens: objectField(usage, "input_tokens"),
      cache_read_input_tokens: objectField(usage, "cached_input_tokens"),
      cached_tokens: objectField(usage, "cached_input_tokens"),
      output_tokens: objectField(usage, "output_tokens"),
      reasoning_output_tokens: objectField(usage, "reasoning_output_tokens"),
      total_tokens: objectField(usage, "total_tokens"),
    });
    return normalized && Object.keys(normalized).length > 0 ? normalized : null;
  }

  function uploadedCodexContent(value: unknown): string {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) {
      if (!value || typeof value !== "object") return "";
      return stringField(value, "text") || stringField(value, "content") || "";
    }
    return value.map((part) => {
      if (!part || typeof part !== "object") return "";
      return stringField(part, "text") || stringField(part, "content");
    }).filter(Boolean).join("\n");
  }

  function numberRecord(value: Record<string, unknown>): Record<string, number> | null {
    const entries = Object.entries(value).flatMap(([key, entry]) => {
      if (typeof entry === "number" && Number.isFinite(entry)) return [[key, entry] as const];
      if (typeof entry === "string" && Number.isFinite(Number(entry))) return [[key, Number(entry)] as const];
      return [];
    });
    return entries.length ? Object.fromEntries(entries) : null;
  }

  function objectRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
  }

  function importClaudeAiExport(input: SessionArchiveUploadImportRequest): SessionArchiveImportStats {
    const parsed = sessionArchiveUploadImportRequestSchema.parse({ ...input, agent: input.agent ?? "claude-ai" });
    const data = parseJsonArray(parsed.content);
    if (!data) return importUploadedExport(parsed);
    return importConversationArray({ agent: "claude-ai", project: parsed.project ?? parsed.filename, conversations: data });
  }

  function importChatGptExport(input: SessionArchiveUploadImportRequest): SessionArchiveImportStats {
    const parsed = sessionArchiveUploadImportRequestSchema.parse({ ...input, agent: input.agent ?? "chatgpt" });
    const data = parseJsonArray(parsed.content);
    if (!data) return importUploadedExport(parsed);
    return importConversationArray({ agent: "chatgpt", project: parsed.project ?? parsed.filename, conversations: data });
  }

  function getConfigSnapshot(): SessionArchiveConfigSnapshot {
    const config = readArchiveConfig();
    const resolvedRoots = resolveSessionArchiveSourceRoots({ config, includeMissing: true });
    const dirsByAgent = new Map<string, { dirs: string[]; configured: boolean; source: "default" | "config" | "env" }>();
    for (const root of resolvedRoots) {
      const current = dirsByAgent.get(root.agent) ?? { dirs: [], configured: false, source: root.source };
      current.dirs.push(root.root);
      current.configured = current.configured || root.configured;
      current.source = root.source;
      dirsByAgent.set(root.agent, current);
    }
    return {
      agent_dirs: sessionArchiveRegistry.map((entry) => {
        const resolved = dirsByAgent.get(entry.agent) ?? { dirs: [], configured: false, source: "default" as const };
        return {
          agent: entry.agent,
          display_name: entry.displayName,
          dirs: resolved.dirs,
          configured: resolved.configured,
          source: resolved.source,
        };
      }),
      terminal: terminalConfigFromConfig(config),
      github: githubConfigFromConfig(config),
      worktree_mappings: listWorktreeMappings(),
      remote: remoteConfigFromConfig(config),
      postgres: postgresConfigFromConfig(config),
      duckdb: duckDbConfigFromConfig(config),
      backends: backendsStatusFromConfig(config).backends,
    };
  }

  function updateConfig(input: SessionArchiveConfigUpdate): SessionArchiveConfigSnapshot {
    const parsed = sessionArchiveConfigUpdateSchema.parse(input);
    const current = readArchiveConfig();
    const next = { ...current };
    if (parsed.agent_dirs) {
      for (const item of parsed.agent_dirs) {
        const entry = sessionArchiveRegistry.find((candidate) => candidate.agent === item.agent);
        if (entry?.configKey) Reflect.set(next, entry.configKey, item.dirs);
      }
    }
    if (parsed.terminal) Reflect.set(next, "terminal", parsed.terminal);
    if (parsed.github_token !== undefined) {
      Reflect.set(next, "github_token_preview", previewSecret(parsed.github_token));
      Reflect.set(next, "github_token_configured", parsed.github_token.trim().length > 0);
    }
    if (parsed.remote) Reflect.set(next, "remote", parsed.remote);
    if (parsed.postgres) Reflect.set(next, "postgres", redactPostgresConfigUpdate(parsed.postgres));
    if (parsed.duckdb) Reflect.set(next, "duckdb", redactDuckDbConfigUpdate(parsed.duckdb));
    writeArchiveConfig(next);
    return getConfigSnapshot();
  }

  function getBackendsStatus(): SessionArchiveBackendsStatusResponse {
    return backendsStatusFromConfig(readArchiveConfig());
  }

  function upsertWorktreeMapping(input: SessionArchiveWorktreeMappingInput): SessionArchiveWorktreeMapping {
    const parsed = sessionArchiveWorktreeMappingInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = parsed.id?.trim() || `mapping-${shortHash(`${parsed.path_prefix}:${parsed.project}:${now}`)}`;
    db.prepare(`
      INSERT INTO worktree_mappings (id, path_prefix, project, enabled, machine, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path_prefix = excluded.path_prefix,
        project = excluded.project,
        enabled = excluded.enabled,
        machine = excluded.machine,
        updated_at = excluded.updated_at
    `).run(id, parsed.path_prefix, parsed.project, parsed.enabled === false ? 0 : 1, parsed.machine ?? "", now, now);
    const row = db.prepare("SELECT * FROM worktree_mappings WHERE id = ?").get(id);
    return worktreeMappingFromRow(row);
  }

  function deleteWorktreeMapping(id: string): boolean {
    const result = db.prepare("DELETE FROM worktree_mappings WHERE id = ?").run(id);
    return sqliteRunChanges(result) > 0;
  }

  function applyWorktreeMappings(): { updated: number; mappings: SessionArchiveWorktreeMapping[] } {
    const mappings = listWorktreeMappings().filter((mapping) => mapping.enabled);
    let updated = 0;
    for (const mapping of mappings) {
      const result = db.prepare(`
        UPDATE sessions
        SET project = ?
        WHERE project LIKE ? ESCAPE '\\'
          AND (? = '' OR machine = ?)
      `).run(mapping.project, `${mapping.path_prefix.replace(/[\\%_]/g, (part) => `\\${part}`)}%`, mapping.machine, mapping.machine);
      updated += sqliteRunChanges(result);
    }
    return { updated, mappings };
  }

  function scanSecrets(): SessionArchiveSecretScanSummary {
    const sessions = db.prepare("SELECT id FROM sessions WHERE deleted_at IS NULL ORDER BY id ASC").all().map((row) => stringField(row, "id"));
    const summary: SessionArchiveSecretScanSummary = {
      scanned: 0,
      with_secrets: 0,
      total_findings: 0,
      definite_findings: 0,
      candidate_findings: 0,
      rules_version: SESSION_ARCHIVE_SECRETS_RULES_VERSION,
    };
    const now = new Date().toISOString();
    const write = db.transaction((sessionId: string) => {
      db.prepare("DELETE FROM secret_findings WHERE session_id = ?").run(sessionId);
      const messages = listAllMessages(sessionId);
      let sessionFindings = 0;
      let definiteFindings = 0;
      for (const message of messages) {
        const findings = secretFindingsForMessage(message, now);
        sessionFindings += findings.length;
        definiteFindings += findings.filter((finding) => finding.confidence === "definite").length;
        for (const finding of findings) insertSecretFinding(finding);
      }
      db.prepare("UPDATE sessions SET secret_leak_count = ?, secrets_rules_version = ? WHERE id = ?")
        .run(definiteFindings, SESSION_ARCHIVE_SECRETS_RULES_VERSION, sessionId);
      return { total: sessionFindings, definite: definiteFindings };
    });
    for (const sessionId of sessions) {
      summary.scanned += 1;
      const count = write(sessionId);
      if (count.definite > 0) summary.with_secrets += 1;
    }
    const counts = db.prepare(`
      SELECT confidence, COUNT(*) AS count
      FROM secret_findings
      GROUP BY confidence
    `).all();
    for (const row of counts) {
      const count = numberField(row, "count");
      if (stringField(row, "confidence") === "candidate") summary.candidate_findings = count;
      if (stringField(row, "confidence") === "definite") summary.definite_findings = count;
    }
    summary.total_findings = summary.definite_findings + summary.candidate_findings;
    return summary;
  }

  function listSecretFindings(input: SessionArchiveSecretFindingsInput = {}): SessionArchiveSecretFindingsResponse {
    const limit = normalizeLimit(input.limit);
    const cursor = input.cursor ?? 0;
    const clauses = ["s.deleted_at IS NULL"];
    const params: Array<string | number> = [];
    if (input.project) {
      clauses.push("s.project = ?");
      params.push(input.project);
    }
    if (input.agent) {
      clauses.push("s.agent = ?");
      params.push(input.agent);
    }
    if (input.from) {
      clauses.push("date(COALESCE(NULLIF(s.started_at, ''), s.created_at)) >= date(?)");
      params.push(input.from);
    }
    if (input.to) {
      clauses.push("date(COALESCE(NULLIF(s.started_at, ''), s.created_at)) <= date(?)");
      params.push(input.to);
    }
    if (input.rule) {
      clauses.push("sf.rule = ?");
      params.push(input.rule);
    }
    const confidence = input.confidence ?? "definite";
    if (confidence !== "all") {
      clauses.push("sf.confidence = ?");
      params.push(confidence);
    }
    clauses.push(`sf.rules_version IN (${SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS.map(() => "?").join(", ")})`);
    params.push(...SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS);
    params.push(limit + 1, cursor);
    const rows = db.prepare(`
      SELECT sf.*, s.project, s.agent, s.display_name
      FROM secret_findings sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY sf.id ASC
      LIMIT ? OFFSET ?
    `).all(...params).map(secretFindingFromRow);
    const page = rows.slice(0, limit);
    return { findings: page, next: rows.length > limit ? cursor + limit : 0 };
  }

  function insertSecretFinding(finding: Omit<SessionArchiveSecretFinding, "id" | "project" | "agent" | "display_name">) {
    db.prepare(`
      INSERT INTO secret_findings (
        session_id, rule, confidence, location_kind, message_ordinal, call_index,
        event_index, match_start, match_end, match_index, redacted_match, rules_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      finding.session_id,
      finding.rule,
      finding.confidence,
      finding.location_kind,
      finding.message_ordinal,
      finding.call_index,
      finding.event_index ?? null,
      finding.match_start,
      finding.match_end,
      finding.match_index ?? 0,
      finding.redacted_match,
      finding.rules_version ?? SESSION_ARCHIVE_SECRETS_RULES_VERSION,
      finding.created_at,
    );
  }

  function writeImportedSession(input: {
    sessionId: string;
    agent: string;
    project: string;
    firstMessage: string;
    messages: SessionArchiveMessage[];
    errors: number;
  }): SessionArchiveImportStats {
    if (input.messages.length === 0) return { imported: 0, updated: 0, skipped: 1, errors: input.errors };
    if (isSessionExcluded(input.sessionId)) return { imported: 0, updated: 0, skipped: 1, errors: input.errors };
    const existing = getSessionIncludingDeleted(input.sessionId);
    const visibleMessages = input.messages.filter((message) => !message.is_system);
    const firstMessage = visibleMessages[0] ?? input.messages[0];
    const lastMessage = visibleMessages[visibleMessages.length - 1] ?? input.messages[input.messages.length - 1];
    upsertSession({
      id: input.sessionId,
      project: input.project,
      machine: "imported",
      agent: input.agent,
      first_message: input.firstMessage,
      started_at: firstMessage?.timestamp ?? new Date().toISOString(),
      ended_at: lastMessage?.timestamp ?? null,
      message_count: visibleMessages.length,
      user_message_count: visibleMessages.filter((message) => message.role === "user").length,
      total_output_tokens: input.messages.reduce((sum, message) => sum + message.output_tokens, 0),
      peak_context_tokens: input.messages.reduce((max, message) => Math.max(max, message.context_tokens), 0),
      is_automated: false,
      created_at: new Date().toISOString(),
    });
    replaceSessionMessages(input.sessionId, input.messages);
    replaceSessionUsageEvents(input.sessionId, usageEventsFromMessages(input.sessionId, input.messages));
    return { imported: existing ? 0 : 1, updated: existing ? 1 : 0, skipped: 0, errors: input.errors };
  }

  function importConversationArray(input: { agent: string; project: string; conversations: unknown[] }): SessionArchiveImportStats {
    return input.conversations.reduce<SessionArchiveImportStats>((stats, conversation, index) => {
      const object = conversation && typeof conversation === "object" ? conversation : {};
      const id = stringFromUnknown(Reflect.get(object, "uuid"))
        || stringFromUnknown(Reflect.get(object, "id"))
        || `${input.agent}:${index}:${shortHash(JSON.stringify(conversation))}`;
      const sessionId = `${input.agent}:${id}`;
      const title = stringFromUnknown(Reflect.get(object, "name")) || stringFromUnknown(Reflect.get(object, "title")) || id;
      const messages = conversationMessages(conversation, sessionId);
      const result = writeImportedSession({
        sessionId,
        agent: input.agent,
        project: input.project,
        firstMessage: title,
        messages,
        errors: messages.length === 0 ? 1 : 0,
      });
      return {
        imported: stats.imported + result.imported,
        updated: stats.updated + result.updated,
        skipped: stats.skipped + result.skipped,
        errors: stats.errors + result.errors,
      };
    }, { imported: 0, updated: 0, skipped: 0, errors: 0 });
  }

  function readArchiveConfig(): Record<string, unknown> {
    const row = db.prepare("SELECT value_json FROM archive_config WHERE key = 'settings'").get();
    const parsed = parseOptionalJsonField(objectField(row, "value_json"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  }

  function writeArchiveConfig(value: Record<string, unknown>) {
    db.prepare(`
      INSERT INTO archive_config (key, value_json, updated_at)
      VALUES ('settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(value), new Date().toISOString());
  }

  function terminalConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["terminal"] {
    const terminal = Reflect.get(config, "terminal");
    const source = terminal && typeof terminal === "object" ? terminal : {};
    const mode = stringFromUnknown(Reflect.get(source, "mode"));
    return {
      mode: mode === "custom" || mode === "clipboard" ? mode : "auto" as const,
      custom_bin: stringFromUnknown(Reflect.get(source, "custom_bin")) || undefined,
      custom_args: stringFromUnknown(Reflect.get(source, "custom_args")) || undefined,
    };
  }

  function githubConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["github"] {
    return {
      configured: Reflect.get(config, "github_token_configured") === true,
      token_preview: stringFromUnknown(Reflect.get(config, "github_token_preview")) || undefined,
    };
  }

  function remoteConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["remote"] {
    const remote = Reflect.get(config, "remote");
    const source = remote && typeof remote === "object" ? remote : {};
    return {
      public_url: stringFromUnknown(Reflect.get(source, "public_url")) || undefined,
      public_origins: stringArrayFromUnknown(Reflect.get(source, "public_origins")),
      require_auth: Reflect.get(source, "require_auth") === true,
      auth_configured: Reflect.get(source, "auth_token_configured") === true,
      remote_hosts: [],
    };
  }

  function postgresConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["postgres"] {
    const postgres = Reflect.get(config, "postgres");
    const source = postgres && typeof postgres === "object" ? postgres : {};
    const urlPreview = stringFromUnknown(Reflect.get(source, "url_preview"));
    return {
      url_configured: Reflect.get(source, "url_configured") === true || Boolean(urlPreview),
      url_preview: urlPreview || undefined,
      schema: stringFromUnknown(Reflect.get(source, "schema")) || undefined,
      machine_name: stringFromUnknown(Reflect.get(source, "machine_name")) || undefined,
      allow_insecure: Reflect.get(source, "allow_insecure") === true,
      projects: stringArrayFromUnknown(Reflect.get(source, "projects")),
      exclude_projects: stringArrayFromUnknown(Reflect.get(source, "exclude_projects")),
      watch: Reflect.get(source, "watch") === true,
    };
  }

  function duckDbConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["duckdb"] {
    const duckdb = Reflect.get(config, "duckdb");
    const source = duckdb && typeof duckdb === "object" ? duckdb : {};
    const urlPreview = stringFromUnknown(Reflect.get(source, "url_preview"));
    return {
      path: stringFromUnknown(Reflect.get(source, "path")) || undefined,
      url_configured: Reflect.get(source, "url_configured") === true || Boolean(urlPreview),
      url_preview: urlPreview || undefined,
      token_configured: Reflect.get(source, "token_configured") === true,
      machine_name: stringFromUnknown(Reflect.get(source, "machine_name")) || undefined,
      allow_insecure: Reflect.get(source, "allow_insecure") === true,
      projects: stringArrayFromUnknown(Reflect.get(source, "projects")),
      exclude_projects: stringArrayFromUnknown(Reflect.get(source, "exclude_projects")),
    };
  }

  function backendsStatusFromConfig(config: Record<string, unknown>): SessionArchiveBackendsStatusResponse {
    const postgres = postgresConfigFromConfig(config);
    const duckdb = duckDbConfigFromConfig(config);
    return {
      backends: [
        {
          backend: "postgres",
          configured: postgres.url_configured,
          mode: postgres.watch ? "push" : "serve",
          read_only_serve: true,
          capabilities: ["push", "watch", "read_only_serve", "status"],
          status: "blocked",
          blocker: "Studio records PostgreSQL parity configuration, but this TypeScript migration does not include a PostgreSQL driver or user-approved DSN connection in the current environment.",
        },
        {
          backend: "duckdb",
          configured: Boolean(duckdb.path || duckdb.url_configured),
          mode: duckdb.url_configured ? "quack" : "mirror",
          read_only_serve: true,
          capabilities: ["push", "status", "read_only_serve", "quack"],
          status: "blocked",
          blocker: "Studio records DuckDB/Quack parity configuration, but this TypeScript migration does not include a DuckDB runtime/driver or user-approved remote Quack connection in the current environment.",
        },
      ],
    };
  }

  function listWorktreeMappings(): SessionArchiveWorktreeMapping[] {
    return db.prepare("SELECT * FROM worktree_mappings ORDER BY updated_at DESC, id ASC").all().map(worktreeMappingFromRow);
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

  // TTL cache for analytics data to avoid repeated full-table scans
  // Cache is shared across requests within TTL window for better performance
  const ANALYTICS_CACHE_TTL_MS = 30 * 1000; // 30 seconds
  const _analyticsCache = {
    sessions: null as SessionArchiveSession[] | null,
    messages: null as AnalyticsMessageRow[] | null,
    toolCalls: null as AnalyticsToolCallRow[] | null,
    _timestamp: 0,
    _isExpired() {
      return Date.now() - this._timestamp > ANALYTICS_CACHE_TTL_MS;
    },
    reset() {
      this.sessions = null;
      this.messages = null;
      this.toolCalls = null;
      this._timestamp = 0;
    },
    _touch() {
      this._timestamp = Date.now();
    }
  };

  function analyticsSessions(): SessionArchiveSession[] {
    if (_analyticsCache.sessions && !_analyticsCache._isExpired()) return _analyticsCache.sessions;
    _analyticsCache.sessions = db.prepare(`
      SELECT * FROM sessions
      WHERE deleted_at IS NULL
      ORDER BY COALESCE(started_at, ended_at, created_at) ASC, id ASC
    `).all().map(sessionFromRow);
    return _analyticsCache.sessions;
  }

  function analyticsMessages(): AnalyticsMessageRow[] {
    if (_analyticsCache.messages && !_analyticsCache._isExpired()) return _analyticsCache.messages;
    _analyticsCache.messages = db.prepare(`
      SELECT m.session_id, m.role, m.timestamp, m.has_thinking, m.content_length, m.tool_calls_json,
             s.agent, s.project
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE s.deleted_at IS NULL AND m.is_system = 0
      ORDER BY m.timestamp ASC, m.session_id ASC, m.ordinal ASC
    `).all().map(analyticsMessageFromRow);
    return _analyticsCache.messages;
  }

  function toolCallRows(): AnalyticsToolCallRow[] {
    if (_analyticsCache.toolCalls && !_analyticsCache._isExpired()) return _analyticsCache.toolCalls;
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
    return rows;
  }

  function toolCallRowsBySession(): Map<string, AnalyticsToolCallRow[]> {
    return groupBy(toolCallRows(), (row) => row.session_id);
  }

  function searchSession(input: SessionArchiveSessionSearchInput): SessionArchiveSessionSearchResponse {
    const query = String(input.query ?? "").trim();
    if (!query) return { ordinals: [] };
    const matches: SessionArchiveSessionSearchMatch[] = [];
    const messageRows = db.prepare(`
      SELECT ordinal, role, content
      FROM messages
      WHERE session_id = ? AND is_system = 0
      ORDER BY ordinal ASC
    `).all(input.sessionId);
    for (const row of messageRows) {
      if (!matchesSystemVisibleContent(stringField(row, "content"), stringField(row, "role"))) continue;
      appendSubstringMatches(matches, {
        ordinal: numberField(row, "ordinal"),
        source: "message",
        content: stringField(row, "content"),
        query,
      });
    }
    const toolResultRows = db.prepare(`
      SELECT tool_call_message_ordinal AS ordinal, content
      FROM tool_result_events
      WHERE session_id = ?
      ORDER BY tool_call_message_ordinal ASC, call_index ASC, event_index ASC, id ASC
    `).all(input.sessionId);
    for (const row of toolResultRows) {
      appendSubstringMatches(matches, {
        ordinal: numberField(row, "ordinal"),
        source: "tool_result",
        content: stringField(row, "content"),
        query,
      });
    }
    const ordinals = Array.from(new Set(matches.map((match) => match.ordinal))).sort((left, right) => left - right);
    return { ordinals, matches };
  }

  function searchContent(input: SessionArchiveContentSearchInput): SessionArchiveContentSearchResponse {
    const pattern = String(input.pattern ?? "").trim();
    if (!pattern) return { matches: [] };
    const mode = input.mode ?? "substring";
    const sources = input.sources?.length ? input.sources : ["messages", "tool_input", "tool_result"];
    for (const source of sources) {
      if (source !== "messages" && source !== "tool_input" && source !== "tool_result") {
        throw new Error(`unknown content search source: ${source}`);
      }
    }
    if (mode === "fts") {
      const response = search({ query: pattern, cursor: input.cursor, limit: input.limit, project: input.project });
      return {
        matches: response.results.map((result) => ({
          session_id: result.session_id,
          ordinal: result.ordinal,
          role: "",
          source: "message",
          snippet: result.snippet,
        })),
        ...(response.next ? { next_cursor: response.next } : {}),
      };
    }
    const limit = normalizeLimit(input.limit);
    const cursor = normalizeOffset(input.cursor);
    const messageRows = sources.includes("messages") ? db.prepare(`
      SELECT m.session_id, m.ordinal, m.role, m.content
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE s.deleted_at IS NULL
        AND (? = '' OR s.project = ?)
        AND (? = '' OR s.agent = ?)
        AND (? = 0 OR m.is_system = 0)
      ORDER BY m.session_id ASC, m.ordinal ASC
    `).all(input.project ?? "", input.project ?? "", input.agent ?? "", input.agent ?? "", input.excludeSystem ? 1 : 0) : [];
    const toolInputRows = sources.includes("tool_input") ? db.prepare(`
      SELECT tc.session_id,
             tc.message_ordinal AS ordinal,
             'tool_input' AS role,
             tc.input_json AS content
      FROM tool_calls tc
      JOIN sessions s ON s.id = tc.session_id
      WHERE s.deleted_at IS NULL
        AND (? = '' OR s.project = ?)
        AND (? = '' OR s.agent = ?)
      ORDER BY tc.session_id ASC, tc.message_ordinal ASC, tc.call_index ASC, tc.id ASC
    `).all(input.project ?? "", input.project ?? "", input.agent ?? "", input.agent ?? "") : [];
    const toolResultRows = sources.includes("tool_result") ? db.prepare(`
      SELECT tre.session_id,
             tre.tool_call_message_ordinal AS ordinal,
             'tool_result' AS role,
             tre.content
      FROM tool_result_events tre
      JOIN sessions s ON s.id = tre.session_id
      WHERE s.deleted_at IS NULL
        AND (? = '' OR s.project = ?)
        AND (? = '' OR s.agent = ?)
      ORDER BY tre.session_id ASC, tre.tool_call_message_ordinal ASC, tre.call_index ASC, tre.event_index ASC
    `).all(input.project ?? "", input.project ?? "", input.agent ?? "", input.agent ?? "") : [];
    const rows = [...messageRows, ...toolInputRows, ...toolResultRows];
    const matcher = createContentMatcher(pattern, mode);
    const matches = rows
      .filter((row) => matcher(stringField(row, "content")))
      .slice(cursor, cursor + limit + 1);
    const page = matches.slice(0, limit);
    return {
      matches: page.map((row) => ({
        session_id: stringField(row, "session_id"),
        ordinal: numberField(row, "ordinal"),
        role: stringField(row, "role"),
        source: contentSearchRowSource(stringField(row, "role")),
        snippet: snippetAround(stringField(row, "content"), pattern),
      })),
      ...(matches.length > limit ? { next_cursor: cursor + limit } : {}),
    };
  }

  function search(input: SessionArchiveSearchInput): SessionArchiveSearchResponse {
    const query = String(input.query ?? "").trim();
    if (!query) return { query, results: [], count: 0, next: 0 };
    const ftsQuery = prepareFtsQuery(query);
    const limit = normalizeLimit(input.limit);
    const cursor = normalizeOffset(input.cursor);
    const { query: _query, cursor: _cursor, limit: _limit, sort: _sort, ...filters } = input;
    const { where, args: filterArgs } = sessionListWhere({ ...filters, includeChildren: input.includeChildren ?? true, includeAutomated: input.includeAutomated ?? true });
    const like = likePattern(query);
    const orderBy = input.sort === "recency"
      ? "session_ended_at DESC, session_id ASC"
      : "rank ASC, match_pos ASC, session_ended_at DESC, session_id ASC";
    const rows = db.prepare(`
      SELECT session_id, project, agent, name, ordinal, session_ended_at, snippet, rank
      FROM (
        SELECT session_id, project, agent, name, ordinal, session_ended_at, snippet, rank, match_pos
        FROM (
          SELECT m.session_id,
                 s.project,
                 s.agent,
                 COALESCE(s.display_name, s.session_name, s.first_message, '') AS name,
                 m.ordinal,
                 COALESCE(s.ended_at, s.started_at, s.created_at) AS session_ended_at,
                 m.content AS snippet,
                 rank AS rank,
                 instr(LOWER(m.content), LOWER(?)) AS match_pos,
                 ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY rank ASC, m.ordinal ASC, m.id ASC) AS rn
          FROM messages_fts
          JOIN messages m ON m.id = messages_fts.rowid
          JOIN sessions s ON s.id = m.session_id
          WHERE messages_fts MATCH ? AND m.is_system = 0 AND ${systemPrefixSql("m.content", "m.role")} AND s.id IN (SELECT id FROM sessions ${where})
        )
        WHERE rn = 1
        UNION ALL
        SELECT s.id AS session_id,
               s.project,
               s.agent,
               COALESCE(s.display_name, s.session_name, s.first_message, '') AS name,
               -1 AS ordinal,
               COALESCE(s.ended_at, s.started_at, s.created_at) AS session_ended_at,
               CASE
                 WHEN COALESCE(s.display_name, s.session_name, '') LIKE ? ESCAPE '\\' THEN COALESCE(s.display_name, s.session_name, '')
                 ELSE COALESCE(s.first_message, '')
               END AS snippet,
               0 AS rank,
               0 AS match_pos
        FROM sessions s
        WHERE (COALESCE(s.display_name, s.session_name, '') LIKE ? ESCAPE '\\' OR COALESCE(s.first_message, '') LIKE ? ESCAPE '\\')
          AND s.id IN (SELECT id FROM sessions ${where})
          AND s.id NOT IN (
            SELECT m.session_id
            FROM messages_fts
            JOIN messages m ON m.id = messages_fts.rowid
            JOIN sessions s2 ON s2.id = m.session_id
            WHERE messages_fts MATCH ? AND m.is_system = 0 AND ${systemPrefixSql("m.content", "m.role")} AND s2.id IN (SELECT id FROM sessions ${where})
          )
      )
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(
      query,
      ftsQuery,
      ...filterArgs,
      like,
      like,
      like,
      ...filterArgs,
      ftsQuery,
      ...filterArgs,
      limit + 1,
      cursor,
    );
    const page = rows.slice(0, limit).map(searchResultFromRow);
    return {
      query,
      results: page,
      count: page.length,
      next: rows.length > limit ? cursor + limit : 0,
    };
  }

  function stats(): SessionArchiveStats {
    const row = db.prepare(`
      SELECT COUNT(*) AS session_count,
             COALESCE(SUM(message_count), 0) AS message_count,
             COUNT(DISTINCT project) AS project_count,
             COUNT(DISTINCT machine) AS machine_count,
             MIN(started_at) AS earliest_session
      FROM sessions
      WHERE deleted_at IS NULL
    `).get();
    return {
      session_count: numberField(row, "session_count"),
      message_count: numberField(row, "message_count"),
      project_count: numberField(row, "project_count"),
      machine_count: numberField(row, "machine_count"),
      earliest_session: nullableStringField(row, "earliest_session"),
    };
  }

  return {
    dbPath,
    close: () => db.close(),
    upsertSession,
    replaceSessionMessages,
    replaceSessionUsageEvents,
    listUsageEvents,
    getSourceFile,
    upsertSourceFile,
    getSkippedFile,
    upsertSkippedFile,
    deleteSkippedFile,
    listSessions,
    getSession,
    getSessionIncludingDeleted,
    isSessionExcluded,
    listMessages,
    listToolCalls,
    listChildren,
    getActivity,
    getTiming,
    getUsage,
    getUsageSummary,
    getUsageComparison,
    getTopUsageSessions,
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
    listInsights,
    getInsight,
    deleteInsight,
    generateInsight,
    starSession,
    unstarSession,
    listStarredSessions,
    bulkStarSessions,
    pinMessage,
    unpinMessage,
    listPins,
    listSessionPins,
    renameSession,
    trashSession,
    restoreSession,
    permanentlyDeleteSession,
    listTrash,
    emptyTrash,
    getSessionDirectory,
    openSessionDirectory,
    resumeSession,
    exportSessionHtml,
    exportSessionMarkdown,
    publishSession,
    importUploadedExport,
    importClaudeAiExport,
    importChatGptExport,
    getConfigSnapshot,
    updateConfig,
    getBackendsStatus,
    upsertWorktreeMapping,
    deleteWorktreeMapping,
    applyWorktreeMappings,
    scanSecrets,
    listSecretFindings,
    searchSession,
    searchContent,
    search,
    stats,
  };
}

function initializeArchiveDb(db: SqliteDatabase) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      machine TEXT NOT NULL,
      agent TEXT NOT NULL,
      first_message TEXT,
      display_name TEXT,
      session_name TEXT,
      started_at TEXT,
      ended_at TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      user_message_count INTEGER NOT NULL DEFAULT 0,
      parent_session_id TEXT,
      relationship_type TEXT,
      deleted_at TEXT,
      termination_status TEXT,
      file_path TEXT,
      file_size INTEGER,
      file_mtime REAL,
      file_inode INTEGER,
      file_device INTEGER,
      file_hash TEXT,
      local_modified_at TEXT,
      cwd TEXT NOT NULL DEFAULT '',
      git_branch TEXT NOT NULL DEFAULT '',
      source_session_id TEXT NOT NULL DEFAULT '',
      source_version TEXT NOT NULL DEFAULT '',
      parser_malformed_lines INTEGER NOT NULL DEFAULT 0,
      is_truncated INTEGER NOT NULL DEFAULT 0,
      secret_leak_count INTEGER NOT NULL DEFAULT 0,
      secrets_rules_version TEXT NOT NULL DEFAULT '',
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      peak_context_tokens INTEGER NOT NULL DEFAULT 0,
      has_total_output_tokens INTEGER,
      has_peak_context_tokens INTEGER,
      is_automated INTEGER NOT NULL DEFAULT 0,
      is_teammate INTEGER,
      is_index_only INTEGER,
      health_score REAL,
      health_grade TEXT,
      outcome TEXT,
      outcome_confidence TEXT,
      ended_with_role TEXT,
      tool_failure_signal_count INTEGER,
      tool_retry_count INTEGER,
      edit_churn_count INTEGER,
      consecutive_failure_max INTEGER,
      final_failure_streak INTEGER,
      compaction_count INTEGER,
      mid_task_compaction_count INTEGER,
      context_pressure_max REAL,
      quality_signals_json TEXT,
      health_score_basis_json TEXT,
      health_penalties_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      has_thinking INTEGER NOT NULL DEFAULT 0,
      thinking_text TEXT NOT NULL DEFAULT '',
      has_tool_use INTEGER NOT NULL DEFAULT 0,
      content_length INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      token_usage_json TEXT,
      context_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      has_context_tokens INTEGER,
      has_output_tokens INTEGER,
      tool_calls_json TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_compact_boundary INTEGER,
      claude_message_id TEXT NOT NULL DEFAULT '',
      claude_request_id TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      source_subtype TEXT,
      source_uuid TEXT NOT NULL DEFAULT '',
      source_parent_uuid TEXT NOT NULL DEFAULT '',
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      UNIQUE(session_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS source_files (
      path TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      session_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      hash TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skipped_files (
      path TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      skipped_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS excluded_sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_ordinal INTEGER,
      source TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      cost_status TEXT NOT NULL DEFAULT '',
      cost_source TEXT NOT NULL DEFAULT '',
      occurred_at TEXT,
      dedup_key TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_ordinal INTEGER NOT NULL,
      call_index INTEGER NOT NULL DEFAULT 0,
      tool_name TEXT NOT NULL,
      category TEXT NOT NULL,
      tool_use_id TEXT,
      input_json TEXT,
      skill_name TEXT,
      result_content_length INTEGER,
      result_content TEXT,
      subagent_session_id TEXT
    );
    CREATE TABLE IF NOT EXISTS tool_result_events (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_call_message_ordinal INTEGER NOT NULL,
      call_index INTEGER NOT NULL DEFAULT 0,
      tool_use_id TEXT,
      agent_id TEXT,
      subagent_session_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      content TEXT NOT NULL,
      content_length INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT,
      event_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      project TEXT,
      agent TEXT NOT NULL,
      model TEXT,
      prompt TEXT,
      content TEXT NOT NULL,
      kind TEXT,
      schema_version TEXT,
      template_id TEXT,
      template_version TEXT,
      aggregate_hash TEXT,
      cache_key TEXT,
      cache_status TEXT,
      provenance_json TEXT,
      structured_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS starred_sessions (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS archive_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worktree_mappings (
      id TEXT PRIMARY KEY,
      path_prefix TEXT NOT NULL,
      project TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      machine TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secret_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      rule TEXT NOT NULL,
      confidence TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      message_ordinal INTEGER NOT NULL,
      call_index INTEGER,
      event_index INTEGER,
      match_start INTEGER NOT NULL,
      match_end INTEGER NOT NULL,
      match_index INTEGER NOT NULL DEFAULT 0,
      redacted_match TEXT NOT NULL,
      rules_version TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  ensureArchiveSchemaColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_archive_source_files_agent
      ON source_files(agent);
    CREATE INDEX IF NOT EXISTS idx_session_archive_skipped_files_agent
      ON skipped_files(agent);
    CREATE INDEX IF NOT EXISTS idx_session_archive_excluded_sessions_created
      ON excluded_sessions(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_archive_usage_events_dedup
      ON usage_events(session_id, source, dedup_key)
      WHERE dedup_key != '';
    CREATE INDEX IF NOT EXISTS idx_session_archive_usage_events_session
      ON usage_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_usage_events_occurred
      ON usage_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_calls_session
      ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_calls_session_category
      ON tool_calls(session_id, category);
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_calls_message
      ON tool_calls(message_id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_calls_category
      ON tool_calls(category);
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_calls_skill
      ON tool_calls(skill_name)
      WHERE skill_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_calls_subagent
      ON tool_calls(subagent_session_id)
      WHERE subagent_session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_result_events_session
      ON tool_result_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_tool_result_events_call
      ON tool_result_events(session_id, tool_call_message_ordinal, call_index, event_index);
    CREATE INDEX IF NOT EXISTS idx_session_archive_insights_filter
      ON insights(type, project, date_from, date_to, created_at);
    CREATE INDEX IF NOT EXISTS idx_session_archive_pinned_messages_session
      ON pinned_messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_session_archive_worktree_mappings_enabled
      ON worktree_mappings(enabled, path_prefix);
    CREATE INDEX IF NOT EXISTS idx_session_archive_secret_findings_filter
      ON secret_findings(confidence, rule, session_id, id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_secret_findings_rules
      ON secret_findings(rules_version, confidence, session_id, id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_sessions_has_secret
      ON sessions(secret_leak_count, secrets_rules_version)
      WHERE secret_leak_count > 0;
    CREATE INDEX IF NOT EXISTS idx_session_archive_sessions_recent
      ON sessions(COALESCE(ended_at, started_at, created_at), id);
    CREATE INDEX IF NOT EXISTS idx_session_archive_sessions_project
      ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_session_archive_messages_session_ordinal
      ON messages(session_id, ordinal);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS session_archive_messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS session_archive_messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS session_archive_messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
}

function ensureArchiveSchemaColumns(db: SqliteDatabase) {
  const sessionColumns = tableColumnNames(db, "sessions");
  addColumnIfMissing(db, "sessions", sessionColumns, "session_name", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "file_inode", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "file_device", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "file_hash", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "local_modified_at", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "cwd", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "sessions", sessionColumns, "git_branch", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "sessions", sessionColumns, "source_session_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "sessions", sessionColumns, "source_version", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "sessions", sessionColumns, "parser_malformed_lines", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sessions", sessionColumns, "is_truncated", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sessions", sessionColumns, "secret_leak_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sessions", sessionColumns, "secrets_rules_version", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "sessions", sessionColumns, "total_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sessions", sessionColumns, "peak_context_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sessions", sessionColumns, "has_total_output_tokens", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "has_peak_context_tokens", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "is_automated", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "sessions", sessionColumns, "is_teammate", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "is_index_only", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "health_score", "REAL");
  addColumnIfMissing(db, "sessions", sessionColumns, "health_grade", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "outcome", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "outcome_confidence", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "ended_with_role", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "tool_failure_signal_count", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "tool_retry_count", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "edit_churn_count", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "consecutive_failure_max", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "final_failure_streak", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "compaction_count", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "mid_task_compaction_count", "INTEGER");
  addColumnIfMissing(db, "sessions", sessionColumns, "context_pressure_max", "REAL");
  addColumnIfMissing(db, "sessions", sessionColumns, "quality_signals_json", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "health_score_basis_json", "TEXT");
  addColumnIfMissing(db, "sessions", sessionColumns, "health_penalties_json", "TEXT");

  const messageColumns = tableColumnNames(db, "messages");
  addColumnIfMissing(db, "messages", messageColumns, "has_thinking", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "messages", messageColumns, "thinking_text", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "has_tool_use", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "messages", messageColumns, "content_length", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "messages", messageColumns, "model", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "token_usage_json", "TEXT");
  addColumnIfMissing(db, "messages", messageColumns, "context_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "messages", messageColumns, "output_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "messages", messageColumns, "has_context_tokens", "INTEGER");
  addColumnIfMissing(db, "messages", messageColumns, "has_output_tokens", "INTEGER");
  addColumnIfMissing(db, "messages", messageColumns, "tool_calls_json", "TEXT");
  addColumnIfMissing(db, "messages", messageColumns, "is_system", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "messages", messageColumns, "is_compact_boundary", "INTEGER");
  addColumnIfMissing(db, "messages", messageColumns, "claude_message_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "claude_request_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "source_type", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "source_subtype", "TEXT");
  addColumnIfMissing(db, "messages", messageColumns, "source_uuid", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "source_parent_uuid", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "messages", messageColumns, "is_sidechain", "INTEGER NOT NULL DEFAULT 0");

  const secretFindingColumns = tableColumnNames(db, "secret_findings");
  addColumnIfMissing(db, "secret_findings", secretFindingColumns, "event_index", "INTEGER");
  addColumnIfMissing(db, "secret_findings", secretFindingColumns, "match_index", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "secret_findings", secretFindingColumns, "rules_version", "TEXT NOT NULL DEFAULT ''");
}

function tableColumnNames(db: SqliteDatabase, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => stringField(row, "name")));
}

function addColumnIfMissing(db: SqliteDatabase, table: string, columns: Set<string>, name: string, definition: string) {
  if (columns.has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

function repairEpochArchiveTimestamps(db: SqliteDatabase) {
  db.exec(`
    UPDATE sessions
    SET
      started_at = COALESCE(NULLIF(started_at, '1970-01-01T00:00:00.000Z'), strftime('%Y-%m-%dT%H:%M:%fZ', source_files.mtime / 1000.0, 'unixepoch')),
      ended_at = COALESCE(NULLIF(ended_at, '1970-01-01T00:00:00.000Z'), strftime('%Y-%m-%dT%H:%M:%fZ', source_files.mtime / 1000.0, 'unixepoch')),
      created_at = CASE
        WHEN created_at = '1970-01-01T00:00:00.000Z' THEN strftime('%Y-%m-%dT%H:%M:%fZ', source_files.mtime / 1000.0, 'unixepoch')
        ELSE created_at
      END,
      file_mtime = CASE
        WHEN COALESCE(file_mtime, 0) <= 0 THEN source_files.mtime
        ELSE file_mtime
      END
    FROM source_files
    WHERE sessions.id = source_files.session_id
      AND source_files.mtime > 0
      AND (
        sessions.started_at = '1970-01-01T00:00:00.000Z'
        OR sessions.ended_at = '1970-01-01T00:00:00.000Z'
        OR sessions.created_at = '1970-01-01T00:00:00.000Z'
        OR COALESCE(sessions.file_mtime, 0) <= 0
      );
    UPDATE messages
    SET timestamp = COALESCE(NULLIF(sessions.started_at, ''), NULLIF(sessions.created_at, ''), messages.timestamp)
    FROM sessions
    WHERE messages.session_id = sessions.id
      AND messages.timestamp = '1970-01-01T00:00:00.000Z';
  `);
}

function sourceFileFromRow(row: unknown): SessionArchiveSourceFileState {
  return {
    path: stringField(row, "path"),
    agent: stringField(row, "agent"),
    session_id: stringField(row, "session_id"),
    size: numberField(row, "size"),
    mtime: numberField(row, "mtime"),
    hash: stringField(row, "hash"),
    synced_at: stringField(row, "synced_at"),
  };
}

function skippedFileFromRow(row: unknown): SessionArchiveSkippedFileState {
  return {
    path: stringField(row, "path"),
    agent: stringField(row, "agent"),
    size: numberField(row, "size"),
    mtime: numberField(row, "mtime"),
    hash: stringField(row, "hash"),
    reason: stringField(row, "reason"),
    skipped_at: stringField(row, "skipped_at"),
  };
}

function sqliteLastInsertRowId(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = Reflect.get(result, "lastInsertRowid");
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

function intToOptionalBool(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return Number(value) !== 0;
}

function intToBool(value: unknown): boolean {
  return Number(value) !== 0;
}

function jsonOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  return JSON.parse(value);
}

function parseOptionalJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  return JSON.parse(value);
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(value));
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return 0;
  return Math.floor(value);
}

function sessionListCursorSecret(dbPath: string): string {
  return `studio-session-archive-list-cursor-v1:${dbPath}`;
}

function systemPrefixSql(contentColumn: string, roleColumn: string): string {
  const prefixes = [
    "This session is being continued",
    "[Request interrupted",
    "<task-notification>",
    "<command-message>",
    "<command-name>",
    "<local-command-",
    "Stop hook feedback:",
  ];
  return `NOT (${roleColumn} = 'user' AND (${prefixes.map((prefix) => `substr(ltrim(${contentColumn}), 1, ${prefix.length}) = '${prefix.replace(/'/g, "''")}'`).join(" OR ")}))`;
}

function matchesSystemVisibleContent(content: string, role: string): boolean {
  if (role !== "user") return true;
  const trimmed = content.trimStart();
  return ![
    "This session is being continued",
    "[Request interrupted",
    "<task-notification>",
    "<command-message>",
    "<command-name>",
    "<local-command-",
    "Stop hook feedback:",
  ].some((prefix) => trimmed.startsWith(prefix));
}

function appendSubstringMatches(matches: SessionArchiveSessionSearchMatch[], input: {
  ordinal: number;
  source: "message" | "tool_result";
  content: string;
  query: string;
}) {
  const haystack = input.content.toLocaleLowerCase();
  const needle = input.query.toLocaleLowerCase();
  if (!needle) return;
  let start = haystack.indexOf(needle);
  while (start >= 0) {
    const end = start + input.query.length;
    matches.push({
      ordinal: input.ordinal,
      source: input.source,
      match_start: start,
      match_end: end,
      snippet: snippetAround(input.content, input.query),
    });
    start = haystack.indexOf(needle, Math.max(end, start + 1));
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (part) => `\\${part}`)}%`;
}

function prepareFtsQuery(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(" ");
}

function parseToolCalls(value: unknown): SessionArchiveToolCall[] {
  const parsed = parseOptionalJsonField(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => sessionArchiveToolCallSchema.parse(item));
}

type UsageRow = {
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

type UsageAmount = SessionArchiveUsageTotals & {
  hasUsage: boolean;
  cost: number;
  priced: boolean;
};

type UsagePricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheCreationPerMTok: number;
  cacheReadPerMTok: number;
};

const FALLBACK_USAGE_PRICING: Record<string, UsagePricing> = {
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

type UsageBucket = {
  totals: SessionArchiveUsageTotals;
  models: Set<string>;
  byModel: Map<string, SessionArchiveUsageModelBreakdown>;
  byProject: Map<string, SessionArchiveUsageProjectBreakdown>;
  byAgent: Map<string, SessionArchiveUsageAgentBreakdown>;
};

type AnalyticsMessageRow = {
  session_id: string;
  role: string;
  timestamp: string;
  has_thinking: boolean;
  content_length: number;
  tool_calls_json: unknown;
  agent: string;
  project: string;
};

type AnalyticsToolCallRow = {
  session_id: string;
  agent: string;
  project: string;
  timestamp: string;
  tool_name: string;
  category: string;
  skill_name: string;
};

type AnalyticsActivityBucket = {
  messages: number;
  user_messages: number;
  assistant_messages: number;
  tool_calls: number;
  thinking_messages: number;
  by_agent: Record<string, number>;
};

type VelocitySessionSummary = {
  agent: string;
  messageCount: number;
  durationMin: number;
  contentLength: number;
  toolCalls: number;
  firstResponseSec: number;
  turnCyclesSec: number[];
};

type VelocityOverview = SessionArchiveAnalyticsVelocityResponse["overall"];

type TopAnalyticsSession = SessionArchiveAnalyticsTopSessionsResponse["sessions"][number];

type ActivityRange = {
  timezone: string;
  start: Date;
  end: Date;
  bucketSeconds: number;
  bucketUnit: string;
};

type ActivityAggregate = {
  key: string;
  agent_minutes: number;
  interactive_agent_minutes: number;
  automated_agent_minutes: number;
  cost: number;
  interactive_cost: number;
  automated_cost: number;
};

type ParsedTrendTerm = {
  term: string;
  variants: string[];
};

function usageRowFromRow(row: unknown): UsageRow {
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

function usageEventFromRow(row: unknown): SessionArchiveUsageEvent {
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

function usageEventsFromMessages(sessionId: string, messages: SessionArchiveMessage[]): SessionArchiveUsageEvent[] {
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

function rowUsage(row: UsageRow): UsageAmount {
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

function pricedUsageCost(model: string, usage: Pick<UsageAmount, "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens">): number {
  const pricing = resolveUsagePricing(model);
  if (!pricing) return 0;
  return (
    usage.inputTokens * pricing.inputPerMTok
    + usage.outputTokens * pricing.outputPerMTok
    + usage.cacheCreationTokens * pricing.cacheCreationPerMTok
    + usage.cacheReadTokens * pricing.cacheReadPerMTok
  ) / 1_000_000;
}

function resolveUsagePricing(model: string): UsagePricing | null {
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

function canonicalModelCandidates(model: string): string[] {
  const values = [model, stripTrailingModelGroup(model), stripTrailingModelDate(stripTrailingModelGroup(model))];
  return Array.from(new Set(values.map(canonicalModelName).filter(Boolean)));
}

function canonicalModelName(model: string): string {
  const unqualified = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return Array.from(unqualified.toLowerCase()).filter((char) => /[a-z0-9]/.test(char)).join("");
}

function stripTrailingModelGroup(model: string): string {
  const trimmed = model.trimEnd();
  const last = trimmed.at(-1);
  if (last !== ")" && last !== "]") return model;
  const open = last === ")" ? "(" : "[";
  const index = trimmed.lastIndexOf(open);
  return index > 0 ? trimmed.slice(0, index).trimEnd() : model;
}

function stripTrailingModelDate(model: string): string {
  const index = model.lastIndexOf("-");
  const suffix = index > 0 ? model.slice(index + 1) : "";
  return /^\d{8}$/.test(suffix) ? model.slice(0, index) : model;
}

function tokenNumber(value: unknown, ...keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const raw = Reflect.get(value, key);
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    if (typeof raw === "string") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
  }
  return undefined;
}

function tokenFloat(value: unknown, ...keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const raw = Reflect.get(value, key);
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
    if (typeof raw === "string") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function emptyUsageTotals(): SessionArchiveUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalCost: 0,
    cacheSavings: 0,
  };
}

function emptyUsageBucket(): UsageBucket {
  return {
    totals: emptyUsageTotals(),
    models: new Set(),
    byModel: new Map(),
    byProject: new Map(),
    byAgent: new Map(),
  };
}

function addUsage(target: Map<string, UsageBucket>, key: string, usage: UsageAmount, row: UsageRow) {
  const bucket = target.get(key) ?? emptyUsageBucket();
  target.set(key, bucket);
  addTotals(bucket.totals, usage);
  if (row.model) bucket.models.add(row.model);
  addModelBreakdown(bucket.byModel, row.model || "unknown", usage);
  addProjectBreakdown(bucket.byProject, row.project, usage);
  addAgentBreakdown(bucket.byAgent, row.agent, usage);
}

function addTotals(target: SessionArchiveUsageTotals, usage: UsageAmount) {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationTokens += usage.cacheCreationTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.totalCost = roundCost(target.totalCost + usage.cost);
  target.cacheSavings = roundCost(target.cacheSavings + usage.cacheSavings);
}

function addModelBreakdown(target: Map<string, SessionArchiveUsageModelBreakdown>, modelName: string, usage: UsageAmount) {
  const current = target.get(modelName) ?? { modelName, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.cacheCreationTokens += usage.cacheCreationTokens;
  current.cacheReadTokens += usage.cacheReadTokens;
  current.cost = roundCost(current.cost + usage.cost);
  target.set(modelName, current);
}

function addProjectBreakdown(target: Map<string, SessionArchiveUsageProjectBreakdown>, project: string, usage: UsageAmount) {
  const current = target.get(project) ?? { project, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.cacheCreationTokens += usage.cacheCreationTokens;
  current.cacheReadTokens += usage.cacheReadTokens;
  current.cost = roundCost(current.cost + usage.cost);
  target.set(project, current);
}

function addAgentBreakdown(target: Map<string, SessionArchiveUsageAgentBreakdown>, agent: string, usage: UsageAmount) {
  const current = target.get(agent) ?? { agent, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.cacheCreationTokens += usage.cacheCreationTokens;
  current.cacheReadTokens += usage.cacheReadTokens;
  current.cost = roundCost(current.cost + usage.cost);
  target.set(agent, current);
}

function usageBucketToDailyEntry(date: string, bucket: UsageBucket) {
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

function foldProjectTotals(rows: SessionArchiveUsageProjectBreakdown[]): SessionArchiveUsageProjectBreakdown[] {
  const target = new Map<string, SessionArchiveUsageProjectBreakdown>();
  for (const row of rows) addProjectBreakdown(target, row.project, { ...row, totalCost: row.cost, cacheSavings: 0, cost: row.cost, hasUsage: true, priced: true });
  return Array.from(target.values()).sort(usageCostSortByName("project"));
}

function foldAgentTotals(rows: SessionArchiveUsageAgentBreakdown[]): SessionArchiveUsageAgentBreakdown[] {
  const target = new Map<string, SessionArchiveUsageAgentBreakdown>();
  for (const row of rows) addAgentBreakdown(target, row.agent, { ...row, totalCost: row.cost, cacheSavings: 0, cost: row.cost, hasUsage: true, priced: true });
  return Array.from(target.values()).sort(usageCostSortByName("agent"));
}

function foldModelTotals(rows: SessionArchiveUsageModelBreakdown[]) {
  const target = new Map<string, SessionArchiveUsageModelBreakdown>();
  for (const row of rows) addModelBreakdown(target, row.modelName, { ...row, totalCost: row.cost, cacheSavings: 0, cost: row.cost, hasUsage: true, priced: true });
  return Array.from(target.values())
    .map((row) => ({ model: row.modelName, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheCreationTokens: row.cacheCreationTokens, cacheReadTokens: row.cacheReadTokens, cost: row.cost }))
    .sort(usageCostSortByName("model"));
}

function usageCostSortByName<Key extends string>(key: Key) {
  return <Row extends Record<Key, string> & { cost: number }>(left: Row, right: Row) => right.cost - left.cost || left[key].localeCompare(right[key]);
}

function usageSessionCounts(seenSessions: Map<string, { project: string; agent: string }>) {
  const byProject: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const item of seenSessions.values()) {
    byProject[item.project] = (byProject[item.project] ?? 0) + 1;
    byAgent[item.agent] = (byAgent[item.agent] ?? 0) + 1;
  }
  return { total: seenSessions.size, byProject, byAgent };
}

function usageDate(timestamp: string): string {
  const parsed = parseTimestamp(timestamp);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
}

function analyticsMessageFromRow(row: unknown): AnalyticsMessageRow {
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

function numberSort(left: number, right: number): number {
  return left - right;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return roundMetric(values[index] ?? 0);
}

function topMapEntry(map: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const entry of map.entries()) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0].localeCompare(best[0]) < 0)) {
      best = entry;
    }
  }
  return best;
}

function sessionDate(session: SessionArchiveSession): string | null {
  const raw = session.started_at ?? session.ended_at ?? session.created_at;
  const parsed = parseTimestamp(raw);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function nonEmptyString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function emptyAnalyticsActivityBucket(): AnalyticsActivityBucket {
  return { messages: 0, user_messages: 0, assistant_messages: 0, tool_calls: 0, thinking_messages: 0, by_agent: {} };
}

function heatmapLevels(values: number[]): { l1: number; l2: number; l3: number; l4: number } {
  const sorted = values.filter((value) => value > 0).sort(numberSort);
  return {
    l1: Math.max(1, percentile(sorted, 0.25)),
    l2: Math.max(1, percentile(sorted, 0.5)),
    l3: Math.max(1, percentile(sorted, 0.75)),
    l4: Math.max(1, percentile(sorted, 1)),
  };
}

function heatmapLevel(value: number, levels: { l1: number; l2: number; l3: number; l4: number }): number {
  if (value <= 0) return 0;
  if (value <= levels.l1) return 1;
  if (value <= levels.l2) return 2;
  if (value <= levels.l3) return 3;
  return 4;
}

function countBy<Item>(items: Item[], key: (item: Item) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const value = key(item) || "unknown";
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function groupBy<Item>(items: Item[], key: (item: Item) => string): Map<string, Item[]> {
  const result = new Map<string, Item[]>();
  for (const item of items) {
    const value = key(item) || "unknown";
    const list = result.get(value) ?? [];
    list.push(item);
    result.set(value, list);
  }
  return result;
}

function dailyTrend(sessions: SessionArchiveSession[]): number {
  const counts = countBy(sessions, (session) => sessionDate(session) ?? "");
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length < 2) return 0;
  const first = entries[0]?.[1] ?? 0;
  const last = entries[entries.length - 1]?.[1] ?? 0;
  return first > 0 ? roundMetric((last - first) / first) : last > 0 ? 1 : 0;
}

function sessionDurationMs(session: SessionArchiveSession): number {
  return Math.max(0, durationBetween(session.started_at ?? undefined, session.ended_at ?? session.started_at ?? undefined) ?? 0);
}

function distribution(values: number[], buckets: Array<[string, number, number]>): Array<{ label: string; count: number }> {
  return buckets.map(([label, min, max]) => ({
    label,
    count: values.filter((value) => value >= min && value <= max).length,
  }));
}

function velocityForSession(session: SessionArchiveSession, messages: AnalyticsMessageRow[]): VelocitySessionSummary {
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

function velocityOverview(items: VelocitySessionSummary[]): VelocityOverview {
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

function complexityLabel(messageCount: number): string {
  if (messageCount < 5) return "small";
  if (messageCount < 20) return "medium";
  return "large";
}

function categoryCountsWithPct(counts: Record<string, number>, total: number): Array<{ category: string; count: number; pct: number }> {
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count, pct: total > 0 ? roundMetric(count / total) : 0 }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function agentCountEntries(counts: Record<string, number>): Array<{ agent: string; count: number }> {
  return Object.entries(counts)
    .map(([agent, count]) => ({ agent, count }))
    .sort((left, right) => right.count - left.count || left.agent.localeCompare(right.agent));
}

function projectCountEntries(counts: Record<string, number>): Array<{ project: string; count: number }> {
  return Object.entries(counts)
    .map(([project, count]) => ({ project, count }))
    .sort((left, right) => right.count - left.count || left.project.localeCompare(right.project));
}

function metricValue(session: TopAnalyticsSession, metric: string): number {
  if (metric === "duration" || metric === "duration_min") return session.duration_min;
  if (metric === "tokens" || metric === "output_tokens") return session.output_tokens;
  return session.message_count;
}

function averageNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length > 0 ? roundMetric(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
}

function aggregateQualitySignals(sessions: SessionArchiveSession[]): Record<string, number> {
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

function signalTrend(sessions: SessionArchiveSession[]): Array<Record<string, unknown>> {
  return Array.from(groupBy(sessions, (session) => sessionDate(session) ?? "unknown").entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => ({
      date,
      sessions: items.length,
      avg_health_score: averageNullable(items.map((session) => session.health_score ?? null)),
      tool_failures: items.reduce((sum, session) => sum + (session.tool_failure_signal_count ?? 0), 0),
    }));
}

function signalGroup(sessions: SessionArchiveSession[], key: (session: SessionArchiveSession) => string, labelKey: string): Array<Record<string, unknown>> {
  return Array.from(groupBy(sessions, key).entries())
    .map(([label, items]) => ({
      [labelKey]: label,
      sessions: items.length,
      avg_health_score: averageNullable(items.map((session) => session.health_score ?? null)),
      low_health_sessions: items.filter((session) => (session.health_score ?? 1) < 0.6).length,
    }))
    .sort((left, right) => Number(right.sessions ?? 0) - Number(left.sessions ?? 0) || String(left[labelKey] ?? "").localeCompare(String(right[labelKey] ?? "")));
}

function matchesSignal(session: SessionArchiveSession, signal: string): boolean {
  if (signal === "tool_failure") return (session.tool_failure_signal_count ?? 0) > 0;
  if (signal === "compaction") return (session.compaction_count ?? 0) > 0;
  if (signal === "missing_verification") return (session.quality_signals?.missing_verification_count ?? 0) > 0;
  if (signal === "unscored") return typeof session.health_score !== "number";
  return (session.health_score ?? 1) < 0.6 || ["D", "F", "low", "poor"].includes(session.health_grade ?? "");
}

function resolveActivityRange(input: SessionArchiveActivityReportInput): ActivityRange {
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

function defaultActivityBucket(start: Date, end: Date): "5m" | "15m" | "1h" | "1d" | "1w" {
  const days = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  if (days > 90) return "1w";
  if (days > 14) return "1d";
  if (days > 2) return "1h";
  return "15m";
}

function bucketSeconds(bucket: "5m" | "15m" | "1h" | "1d" | "1w"): number {
  if (bucket === "5m") return 300;
  if (bucket === "15m") return 900;
  if (bucket === "1h") return 3600;
  if (bucket === "1w") return 604800;
  return 86400;
}

function sessionOverlapsRange(session: SessionArchiveSession, range: ActivityRange): boolean {
  const start = parseTimestamp(session.started_at ?? session.created_at);
  const end = parseTimestamp(session.ended_at ?? session.started_at ?? session.created_at);
  if (!start || !end) return false;
  return start < range.end && end >= range.start;
}

function buildActivityBuckets(sessions: SessionArchiveSession[], range: ActivityRange, _bucket?: string): SessionArchiveActivityReport["buckets"] {
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

function addActivityAggregate(target: Map<string, ActivityAggregate>, key: string, session: SessionArchiveSession, minutes: number, cost: number) {
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

function activityAggregateEntries(target: Map<string, ActivityAggregate>): SessionArchiveActivityReport["by_project"] {
  return Array.from(target.values())
    .sort((left, right) => right.agent_minutes - left.agent_minutes || left.key.localeCompare(right.key));
}

function sessionCost(messages: SessionArchiveMessage[]): number {
  return roundCost(messages.reduce((sum, message) => sum + messageUsageCost(message), 0));
}

function messageUsageCost(message: SessionArchiveMessage): number {
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

function parseTrendTerms(values: string[]): ParsedTrendTerm[] {
  return values.slice(0, 12).map((value) => value.split("|").map((part) => part.trim()).filter(Boolean)).filter((variants) => variants.length > 0).map((variants) => ({ term: variants[0] ?? "", variants: Array.from(new Set(variants)).slice(0, 8) }));
}

function trendBuckets(from: string, to: string, granularity: "day" | "week" | "month"): string[] {
  const start = parseDateOnly(from) ?? new Date(`${from}T00:00:00Z`);
  const end = parseDateOnly(to) ?? new Date(`${to}T00:00:00Z`);
  const buckets: string[] = [];
  for (let cursor = trendBucketStart(start, granularity); cursor <= end; cursor = nextTrendBucket(cursor, granularity)) {
    buckets.push(dateOnly(cursor));
  }
  return buckets.length > 0 ? buckets : [from];
}

function trendBucketForDate(date: string, granularity: "day" | "week" | "month"): string {
  const parsed = parseDateOnly(date) ?? new Date(`${date}T00:00:00Z`);
  return dateOnly(trendBucketStart(parsed, granularity));
}

function trendBucketStart(date: Date, granularity: "day" | "week" | "month"): Date {
  if (granularity === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (granularity === "week") {
    const day = date.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + mondayOffset));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nextTrendBucket(date: Date, granularity: "day" | "week" | "month"): Date {
  if (granularity === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return new Date(date.getTime() + (granularity === "week" ? 7 : 1) * 86400000);
}

function countTrendTerm(text: string, variants: string[]): number {
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

function insightFromRow(row: unknown): SessionArchiveInsight {
  return sessionArchiveInsightSchema.parse({
    id: numberField(row, "id"),
    type: stringField(row, "type"),
    date_from: stringField(row, "date_from"),
    date_to: stringField(row, "date_to"),
    project: nullableStringField(row, "project"),
    agent: stringField(row, "agent"),
    model: nullableStringField(row, "model"),
    prompt: nullableStringField(row, "prompt"),
    content: stringField(row, "content"),
    kind: optionalStringField(row, "kind"),
    schema_version: optionalStringField(row, "schema_version"),
    template_id: optionalStringField(row, "template_id"),
    template_version: optionalStringField(row, "template_version"),
    aggregate_hash: optionalStringField(row, "aggregate_hash"),
    cache_key: optionalStringField(row, "cache_key"),
    cache_status: optionalStringField(row, "cache_status"),
    provenance_json: optionalStringField(row, "provenance_json"),
    structured_json: optionalStringField(row, "structured_json"),
    created_at: stringField(row, "created_at"),
  });
}

function buildDeterministicInsight(input: { input: SessionArchiveGenerateInsightRequest; activity: SessionArchiveActivityReport; summary: SessionArchiveAnalyticsSummary; tools: SessionArchiveAnalyticsToolsResponse; signals: SessionArchiveAnalyticsSignalsResponse }): string {
  const topTool = input.tools.by_category[0]?.category ?? "none";
  return [
    `# ${input.input.type} insight`,
    `Range: ${input.input.date_from} to ${input.input.date_to}`,
    `Sessions: ${input.activity.totals.sessions}`,
    `Messages: ${input.summary.total_messages}`,
    `Active projects: ${input.summary.active_projects}`,
    `Output tokens: ${input.activity.totals.output_tokens}`,
    `Top tool category: ${topTool}`,
    `Scored sessions: ${input.signals.scored_sessions}`,
    input.input.prompt ? `Prompt: ${input.input.prompt}` : "Prompt: default archive summary",
  ].join("\n");
}

function insightAggregateHash(input: SessionArchiveGenerateInsightRequest, activity: SessionArchiveActivityReport): string {
  return `${input.type}:${input.date_from}:${input.date_to}:${activity.totals.sessions}:${activity.totals.output_tokens}`;
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function pinsQuery(extraWhere: string): string {
  return `
    SELECT pinned_messages.id,
           pinned_messages.session_id,
           pinned_messages.message_id,
           pinned_messages.note,
           pinned_messages.created_at,
           messages.ordinal,
           messages.role,
           messages.content,
           sessions.project,
           sessions.agent
    FROM pinned_messages
    INNER JOIN sessions ON sessions.id = pinned_messages.session_id
    INNER JOIN messages ON messages.session_id = pinned_messages.session_id
      AND messages.ordinal = pinned_messages.message_id
    WHERE sessions.deleted_at IS NULL
      ${extraWhere}
    ORDER BY pinned_messages.created_at DESC, pinned_messages.id DESC
  `;
}

function pinnedMessageFromRow(row: unknown): SessionArchivePinnedMessage {
  return {
    id: numberField(row, "id"),
    session_id: stringField(row, "session_id"),
    message_id: numberField(row, "message_id"),
    ordinal: numberField(row, "ordinal"),
    role: stringField(row, "role"),
    content: stringField(row, "content"),
    project: stringField(row, "project"),
    agent: stringField(row, "agent"),
    note: nullableStringField(row, "note"),
    created_at: stringField(row, "created_at"),
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value) && !value.startsWith("-")) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resumeCommandForSession(session: SessionArchiveSession, input: SessionArchiveResumeSessionRequest): string {
  const quotedId = shellQuote(session.id);
  const base = session.agent === "claude"
    ? `claude --resume ${quotedId}`
    : session.agent === "codex"
      ? `codex resume ${quotedId}`
      : session.agent === "opencode"
        ? `opencode --session ${quotedId}`
        : `${session.agent} resume ${quotedId}`;
  const fork = input.fork_session ? " --fork" : "";
  const skip = input.skip_permissions ? " --dangerously-skip-permissions" : "";
  return `${base}${fork}${skip}`;
}

function safeFilename(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "session-archive-session";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSessionHtml(session: SessionArchiveSession, messages: SessionArchiveMessage[]): string {
  const title = escapeHtml(session.display_name || session.first_message || session.id);
  const rows = messages.map((message) => `
    <article class="message ${escapeHtml(message.role)}">
      <header><strong>${escapeHtml(message.role)}</strong><span>${escapeHtml(message.timestamp)}</span></header>
      <pre>${escapeHtml(message.content)}</pre>
    </article>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f7f8;color:#1f2328;line-height:1.5}main{max-width:920px;margin:0 auto;padding:24px}h1{font-size:20px;margin:0 0 4px}.meta{color:#667085;font-size:13px;margin-bottom:18px}.message{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px;margin:12px 0}.message header{display:flex;justify-content:space-between;gap:12px;color:#667085;font-size:12px}.message pre{white-space:pre-wrap;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:10px 0 0}
</style>
</head>
<body><main><h1>${title}</h1><div class="meta">${escapeHtml(session.agent)} / ${escapeHtml(session.project)} / ${escapeHtml(session.started_at ?? "")}</div>${rows}</main></body>
</html>`;
}

function renderSessionMarkdown(session: SessionArchiveSession, messages: SessionArchiveMessage[]): string {
  const title = session.display_name || session.first_message || session.id;
  const lines = [
    `# Session: ${title}`,
    "",
    `- ID: ${session.id}`,
    `- Agent: ${session.agent}`,
    `- Project: ${session.project}`,
    `- Started: ${session.started_at ?? ""}`,
    `- Ended: ${session.ended_at ?? ""}`,
    "",
  ];
  for (const message of messages) {
    lines.push(`## ${message.role} @ ${message.timestamp}`, "", message.content, "");
  }
  return lines.join("\n");
}

function importMessage(
  sessionId: string,
  ordinal: number,
  role: string,
  content: string,
  timestamp?: string,
  options: { model?: string; tokenUsage?: Record<string, number>; isSystem?: boolean; sourceSubtype?: string } = {},
): SessionArchiveMessage {
  const outputTokens = tokenNumber(options.tokenUsage, "output_tokens", "completion_tokens", "outputTokens") ?? 0;
  const contextTokens = tokenNumber(options.tokenUsage, "input_tokens", "prompt_tokens", "inputTokens") ?? 0;
  return {
    id: importMessageId(sessionId, ordinal),
    session_id: sessionId,
    ordinal,
    role: role || "message",
    content,
    timestamp: timestamp || new Date().toISOString(),
    has_thinking: false,
    thinking_text: "",
    has_tool_use: false,
    content_length: content.length,
    model: options.model ?? "",
    ...(options.tokenUsage ? { token_usage: options.tokenUsage } : {}),
    context_tokens: contextTokens,
    output_tokens: outputTokens,
    has_context_tokens: contextTokens > 0,
    has_output_tokens: outputTokens > 0,
    is_system: options.isSystem ?? false,
    ...(options.sourceSubtype ? { source_subtype: options.sourceSubtype } : {}),
  };
}

function importMessageId(sessionId: string, ordinal: number): number {
  const prefix = Number.parseInt(shortHash(sessionId).slice(0, 10), 16);
  return prefix * 1000 + ordinal + 1;
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringFromUnknown).filter(Boolean).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringFromUnknown).map((item) => item.trim()).filter(Boolean);
}

function redactPostgresConfigUpdate(input: NonNullable<SessionArchiveConfigUpdate["postgres"]>): Record<string, unknown> {
  return {
    url_configured: input.url !== undefined ? input.url.trim().length > 0 : undefined,
    url_preview: input.url !== undefined ? previewDatabaseUrl(input.url) : undefined,
    schema: input.schema?.trim() || undefined,
    machine_name: input.machine_name?.trim() || undefined,
    allow_insecure: input.allow_insecure === true,
    projects: input.projects ?? [],
    exclude_projects: input.exclude_projects ?? [],
    watch: input.watch === true,
  };
}

function redactDuckDbConfigUpdate(input: NonNullable<SessionArchiveConfigUpdate["duckdb"]>): Record<string, unknown> {
  return {
    path: input.path?.trim() || undefined,
    url_configured: input.url !== undefined ? input.url.trim().length > 0 : undefined,
    url_preview: input.url !== undefined ? previewDatabaseUrl(input.url) : undefined,
    token_configured: input.token_configured === true,
    machine_name: input.machine_name?.trim() || undefined,
    allow_insecure: input.allow_insecure === true,
    projects: input.projects ?? [],
    exclude_projects: input.exclude_projects ?? [],
  };
}

function previewDatabaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.password) parsed.password = "[REDACTED_SECRET]";
    if (parsed.username) parsed.username = `${parsed.username.slice(0, 2)}...`;
    return parsed.toString();
  } catch {
    return previewSecret(trimmed);
  }
}

function worktreeMappingFromRow(row: unknown): SessionArchiveWorktreeMapping {
  return {
    id: stringField(row, "id"),
    path_prefix: stringField(row, "path_prefix"),
    project: stringField(row, "project"),
    enabled: intToBool(objectField(row, "enabled")),
    machine: stringField(row, "machine"),
    created_at: stringField(row, "created_at"),
    updated_at: stringField(row, "updated_at"),
  };
}

function secretFindingsForMessage(message: SessionArchiveMessage, createdAt: string): Array<Omit<SessionArchiveSecretFinding, "id" | "project" | "agent" | "display_name">> {
  const findings: Array<Omit<SessionArchiveSecretFinding, "id" | "project" | "agent" | "display_name">> = [];
  for (const match of scanSessionArchiveSecrets(message.content)) {
    findings.push({
      session_id: message.session_id,
      rule: match.rule,
      confidence: match.confidence,
      location_kind: "message",
      message_ordinal: message.ordinal,
      call_index: null,
      event_index: null,
      match_start: match.start,
      match_end: match.end,
      match_index: match.index,
      redacted_match: match.redacted,
      rules_version: SESSION_ARCHIVE_SECRETS_RULES_VERSION,
      created_at: createdAt,
    });
  }
  (message.tool_calls ?? []).forEach((call, index) => {
    const inputText = call.input_json ?? "";
    for (const match of scanSessionArchiveSecrets(inputText)) {
      findings.push({
        session_id: message.session_id,
        rule: match.rule,
        confidence: match.confidence,
        location_kind: "tool_input",
        message_ordinal: message.ordinal,
        call_index: index,
        event_index: null,
        match_start: match.start,
        match_end: match.end,
        match_index: match.index,
        redacted_match: match.redacted,
        rules_version: SESSION_ARCHIVE_SECRETS_RULES_VERSION,
        created_at: createdAt,
      });
    }
    if (call.result_content) {
      for (const match of scanSessionArchiveSecrets(call.result_content)) {
        findings.push({
          session_id: message.session_id,
          rule: match.rule,
          confidence: match.confidence,
          location_kind: "tool_result",
          message_ordinal: message.ordinal,
          call_index: index,
          event_index: null,
          match_start: match.start,
          match_end: match.end,
          match_index: match.index,
          redacted_match: match.redacted,
          rules_version: SESSION_ARCHIVE_SECRETS_RULES_VERSION,
          created_at: createdAt,
        });
      }
    }
    for (const event of call.result_events ?? []) {
      for (const match of scanSessionArchiveSecrets(event.content)) {
        findings.push({
          session_id: message.session_id,
          rule: match.rule,
          confidence: match.confidence,
          location_kind: "tool_result_event",
          message_ordinal: message.ordinal,
          call_index: index,
          event_index: event.event_index,
          match_start: match.start,
          match_end: match.end,
          match_index: match.index,
          redacted_match: match.redacted,
          rules_version: SESSION_ARCHIVE_SECRETS_RULES_VERSION,
          created_at: createdAt,
        });
      }
    }
  });
  return findings;
}

function secretFindingFromRow(row: unknown): SessionArchiveSecretFinding {
  return {
    id: numberField(row, "id"),
    session_id: stringField(row, "session_id"),
    project: stringField(row, "project"),
    agent: stringField(row, "agent"),
    display_name: nullableStringField(row, "display_name"),
    rule: stringField(row, "rule"),
    confidence: stringField(row, "confidence") === "candidate" ? "candidate" : "definite",
    location_kind: secretLocationKind(stringField(row, "location_kind")),
    message_ordinal: numberField(row, "message_ordinal"),
    call_index: nullableNumberField(row, "call_index"),
    event_index: nullableNumberField(row, "event_index"),
    match_start: numberField(row, "match_start"),
    match_end: numberField(row, "match_end"),
    match_index: numberField(row, "match_index"),
    redacted_match: stringField(row, "redacted_match"),
    rules_version: stringField(row, "rules_version"),
    created_at: stringField(row, "created_at"),
  };
}

function secretLocationKind(value: string): SessionArchiveSecretFinding["location_kind"] {
  if (value === "tool_input" || value === "tool_result" || value === "tool_result_event") return value;
  return "message";
}

function parseJsonArray(content: string): unknown[] | null {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const conversations = Reflect.get(parsed, "conversations");
      if (Array.isArray(conversations)) return conversations;
    }
  } catch {
    return null;
  }
  return null;
}

function conversationMessages(conversation: unknown, sessionId: string): SessionArchiveMessage[] {
  if (!conversation || typeof conversation !== "object") return [];
  const rawMessages = Reflect.get(conversation, "messages") ?? Reflect.get(conversation, "mapping") ?? Reflect.get(conversation, "items");
  if (Array.isArray(rawMessages)) {
    return rawMessages.map((item, index) => importMessage(
      sessionId,
      index,
      stringFromUnknown(Reflect.get(Object(item), "role")) || stringFromUnknown(Reflect.get(Object(item), "author")) || "message",
      stringFromUnknown(Reflect.get(Object(item), "content")) || stringFromUnknown(Reflect.get(Object(item), "text")) || JSON.stringify(item),
      stringFromUnknown(Reflect.get(Object(item), "timestamp")) || stringFromUnknown(Reflect.get(Object(item), "create_time")),
    ));
  }
  if (rawMessages && typeof rawMessages === "object") {
    return Object.values(rawMessages).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const message = Reflect.get(item, "message") ?? item;
      if (!message || typeof message !== "object") return [];
      return [importMessage(
        sessionId,
        index,
        stringFromUnknown(Reflect.get(message, "role")) || stringFromUnknown(Reflect.get(Reflect.get(message, "author") ?? {}, "role")) || "message",
        stringFromUnknown(Reflect.get(message, "content")) || stringFromUnknown(Reflect.get(Reflect.get(message, "content") ?? {}, "parts")) || JSON.stringify(message),
        stringFromUnknown(Reflect.get(message, "create_time")),
      )];
    });
  }
  return [];
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function previewSecret(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 8) return "[REDACTED_SECRET]";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function roundCost(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function parseTimestamp(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function durationBetween(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const startDate = parseTimestamp(start);
  const endDate = parseTimestamp(end);
  if (!startDate || !endDate) return null;
  return Math.round(endDate.getTime() - startDate.getTime());
}

function snapInterval(durationSec: number): number {
  const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200];
  if (durationSec <= 0) return steps[0] ?? 60;
  const target = durationSec / 30;
  let best = steps[0] ?? 60;
  let bestDistance = Math.abs(best - target);
  for (const step of steps) {
    const distance = Math.abs(step - target);
    if (distance < bestDistance || (distance === bestDistance && step > best)) {
      best = step;
      bestDistance = distance;
    }
  }
  if (Math.floor(durationSec / best) + 1 > 50) {
    best = Math.ceil(durationSec / 49);
  }
  return best;
}

function inputPreview(call: SessionArchiveToolCall): string {
  const input = call.input_json;
  if (!input) return "";
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== "object") return "";
    for (const key of ["file_path", "path", "pattern", "query", "command", "cmd", "description"]) {
      const value = Reflect.get(parsed, key);
      if (typeof value === "string" && value.trim()) {
        return value.split("\n")[0]?.slice(0, 160) ?? "";
      }
    }
  } catch {
    return "";
  }
  return "";
}

function primaryCategoryForCalls(calls: SessionArchiveSessionTiming["turns"][number]["calls"]): string {
  if (calls.length === 0) return "Mixed";
  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.category, (counts.get(call.category) ?? 0) + 1);
  }
  let best = "Mixed";
  let bestCount = 0;
  for (const [category, count] of counts.entries()) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return bestCount * 2 > calls.length ? best : "Mixed";
}

function createContentMatcher(pattern: string, mode: "substring" | "regex" | "fts"): (content: string) => boolean {
  if (mode === "regex") {
    const regexp = new RegExp(pattern, "i");
    return (content) => regexp.test(content);
  }
  const lower = pattern.toLowerCase();
  return (content) => content.toLowerCase().includes(lower);
}

function contentSearchRowSource(role: string): "message" | "tool_input" | "tool_result" {
  if (role === "tool_input") return "tool_input";
  if (role === "tool_result") return "tool_result";
  return "message";
}

function snippetAround(content: string, pattern: string): string {
  const index = content.toLowerCase().indexOf(pattern.toLowerCase());
  if (index < 0) return content.slice(0, 180);
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + pattern.length + 120);
  return content.slice(start, end);
}

function objectField(row: unknown, key: string): unknown {
  if (!row || typeof row !== "object") return undefined;
  return Reflect.get(row, key);
}

function sqliteRunChanges(value: unknown): number {
  const raw = objectField(value, "changes");
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function sqliteLastInsertRowid(value: unknown): number {
  const raw = objectField(value, "lastInsertRowid");
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  return 0;
}

function stringField(row: unknown, key: string): string {
  return String(objectField(row, key) ?? "");
}

function nullableStringField(row: unknown, key: string): string | null {
  const value = objectField(row, key);
  return value === null || value === undefined ? null : String(value);
}

function optionalStringField(row: unknown, key: string): string | undefined {
  const value = objectField(row, key);
  return value === null || value === undefined ? undefined : String(value);
}

function numberField(row: unknown, key: string): number {
  const value = Number(objectField(row, key) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function optionalNumberField(row: unknown, key: string): number | undefined {
  const value = objectField(row, key);
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function nullableNumberField(row: unknown, key: string): number | null {
  const value = objectField(row, key);
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sessionFromRow(row: unknown): SessionArchiveSession {
  return sessionArchiveSessionSchema.parse({
    id: stringField(row, "id"),
    project: stringField(row, "project"),
    machine: stringField(row, "machine"),
    agent: stringField(row, "agent"),
    first_message: nullableStringField(row, "first_message"),
    display_name: nullableStringField(row, "display_name"),
    session_name: nullableStringField(row, "session_name"),
    started_at: nullableStringField(row, "started_at"),
    ended_at: nullableStringField(row, "ended_at"),
    message_count: numberField(row, "message_count"),
    user_message_count: numberField(row, "user_message_count"),
    parent_session_id: optionalStringField(row, "parent_session_id"),
    relationship_type: optionalStringField(row, "relationship_type"),
    deleted_at: nullableStringField(row, "deleted_at"),
    termination_status: nullableStringField(row, "termination_status"),
    file_path: optionalStringField(row, "file_path"),
    file_size: optionalNumberField(row, "file_size"),
    file_mtime: optionalNumberField(row, "file_mtime"),
    file_inode: optionalNumberField(row, "file_inode"),
    file_device: optionalNumberField(row, "file_device"),
    file_hash: optionalStringField(row, "file_hash"),
    local_modified_at: nullableStringField(row, "local_modified_at"),
    cwd: optionalStringField(row, "cwd"),
    git_branch: optionalStringField(row, "git_branch"),
    source_session_id: optionalStringField(row, "source_session_id"),
    source_version: optionalStringField(row, "source_version"),
    parser_malformed_lines: optionalNumberField(row, "parser_malformed_lines"),
    is_truncated: intToOptionalBool(objectField(row, "is_truncated")),
    secret_leak_count: optionalNumberField(row, "secret_leak_count"),
    secrets_rules_version: optionalStringField(row, "secrets_rules_version"),
    total_output_tokens: numberField(row, "total_output_tokens"),
    peak_context_tokens: numberField(row, "peak_context_tokens"),
    has_total_output_tokens: intToOptionalBool(objectField(row, "has_total_output_tokens")),
    has_peak_context_tokens: intToOptionalBool(objectField(row, "has_peak_context_tokens")),
    is_automated: intToBool(objectField(row, "is_automated")),
    is_teammate: intToOptionalBool(objectField(row, "is_teammate")),
    is_index_only: intToOptionalBool(objectField(row, "is_index_only")),
    health_score: nullableNumberField(row, "health_score"),
    health_grade: nullableStringField(row, "health_grade"),
    outcome: optionalStringField(row, "outcome"),
    outcome_confidence: optionalStringField(row, "outcome_confidence"),
    ended_with_role: optionalStringField(row, "ended_with_role"),
    tool_failure_signal_count: optionalNumberField(row, "tool_failure_signal_count"),
    tool_retry_count: optionalNumberField(row, "tool_retry_count"),
    edit_churn_count: optionalNumberField(row, "edit_churn_count"),
    consecutive_failure_max: optionalNumberField(row, "consecutive_failure_max"),
    final_failure_streak: optionalNumberField(row, "final_failure_streak"),
    compaction_count: optionalNumberField(row, "compaction_count"),
    mid_task_compaction_count: optionalNumberField(row, "mid_task_compaction_count"),
    context_pressure_max: nullableNumberField(row, "context_pressure_max"),
    quality_signals: parseJsonField(objectField(row, "quality_signals_json")),
    health_score_basis: parseJsonField(objectField(row, "health_score_basis_json")),
    health_penalties: parseJsonField(objectField(row, "health_penalties_json")),
    created_at: stringField(row, "created_at"),
  });
}

function messageFromRow(row: unknown): SessionArchiveMessage {
  return sessionArchiveMessageSchema.parse({
    id: numberField(row, "id"),
    session_id: stringField(row, "session_id"),
    ordinal: numberField(row, "ordinal"),
    role: stringField(row, "role"),
    content: stringField(row, "content"),
    timestamp: stringField(row, "timestamp"),
    has_thinking: intToBool(objectField(row, "has_thinking")),
    thinking_text: stringField(row, "thinking_text"),
    has_tool_use: intToBool(objectField(row, "has_tool_use")),
    content_length: numberField(row, "content_length"),
    model: stringField(row, "model"),
    token_usage: parseJsonField(objectField(row, "token_usage_json")),
    context_tokens: numberField(row, "context_tokens"),
    output_tokens: numberField(row, "output_tokens"),
    has_context_tokens: intToOptionalBool(objectField(row, "has_context_tokens")),
    has_output_tokens: intToOptionalBool(objectField(row, "has_output_tokens")),
    tool_calls: parseOptionalJsonField(objectField(row, "tool_calls_json")),
    is_system: intToBool(objectField(row, "is_system")),
    is_compact_boundary: intToOptionalBool(objectField(row, "is_compact_boundary")),
    claude_message_id: optionalStringField(row, "claude_message_id"),
    claude_request_id: optionalStringField(row, "claude_request_id"),
    source_type: optionalStringField(row, "source_type"),
    source_subtype: optionalStringField(row, "source_subtype"),
    source_uuid: optionalStringField(row, "source_uuid"),
    source_parent_uuid: optionalStringField(row, "source_parent_uuid"),
    is_sidechain: intToOptionalBool(objectField(row, "is_sidechain")),
  });
}

function searchResultFromRow(row: unknown) {
  return {
    session_id: stringField(row, "session_id"),
    project: stringField(row, "project"),
    agent: stringField(row, "agent"),
    name: stringField(row, "name"),
    ordinal: numberField(row, "ordinal"),
    session_ended_at: stringField(row, "session_ended_at"),
    snippet: stringField(row, "snippet"),
    rank: numberField(row, "rank"),
  };
}
