import {
  sessionArchiveGenerateInsightRequestSchema,
  sessionArchiveMessageSchema,
  sessionArchivePinRequestSchema,
  sessionArchiveRenameSessionRequestSchema,
  sessionArchiveSessionSchema,
  sessionArchiveToolCallSchema,
  sessionArchiveUploadImportRequestSchema,
  sessionArchiveUsageEventSchema,
  sessionArchiveWorktreeMappingInputSchema,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveImportStats,
  SessionArchiveInsight,
  SessionArchiveMessage,
  SessionArchivePinRequest,
  SessionArchivePinResponse,
  SessionArchiveRenameSessionRequest,
  SessionArchiveSecretFinding,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveUploadImportRequest,
  SessionArchiveUsageEvent,
  SessionArchiveWorktreeMapping,
  SessionArchiveWorktreeMappingInput,
} from "@onmyagent/types/session-archive";

import type { SqliteDatabase } from "../core/sqlite.js";
import {
  SESSION_ARCHIVE_SECRETS_RULES_VERSION,
} from "./session-archive-secrets.js";
import {
  boolToInt,
  buildDeterministicInsight,
  conversationMessages,
  importMessage,
  insightAggregateHash,
  jsonOrNull,
  numberField,
  objectField,
  parseJsonArray,
  safeFilename,
  secretFindingsForMessage,
  shortHash,
  sqliteLastInsertRowId,
  sqliteLastInsertRowid,
  sqliteRunChanges,
  stringField,
  stringFromUnknown,
  worktreeMappingFromRow,
} from "./session-archive-sql.js";
import type {
  SessionArchiveActivityReportInput,
  SessionArchiveSkippedFileState,
  SessionArchiveSourceFileState,
} from "./session-archive-types.js";
import { usageEventsFromMessages } from "./session-archive-usage-math.js";

export type SessionArchiveWriteApi = {
  upsertSession: (session: SessionArchiveSession) => void;
  replaceSessionMessages: (sessionId: string, messages: SessionArchiveMessage[]) => void;
  replaceSessionUsageEvents: (sessionId: string, events: SessionArchiveUsageEvent[]) => void;
  upsertSourceFile: (state: SessionArchiveSourceFileState) => void;
  upsertSkippedFile: (state: SessionArchiveSkippedFileState) => void;
  deleteSkippedFile: (path: string) => void;
  deleteInsight: (id: number) => boolean;
  generateInsight: (input: SessionArchiveGenerateInsightRequest) => SessionArchiveInsight;
  starSession: (sessionId: string) => boolean;
  unstarSession: (sessionId: string) => void;
  bulkStarSessions: (sessionIds: string[]) => void;
  pinMessage: (sessionId: string, messageId: number, input?: SessionArchivePinRequest) => SessionArchivePinResponse | null;
  unpinMessage: (sessionId: string, messageId: number) => void;
  renameSession: (sessionId: string, input: SessionArchiveRenameSessionRequest) => SessionArchiveSession | null;
  trashSession: (sessionId: string) => boolean;
  restoreSession: (sessionId: string) => boolean;
  permanentlyDeleteSession: (sessionId: string) => boolean;
  emptyTrash: () => number;
  importUploadedExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  importClaudeAiExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  importChatGptExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  upsertWorktreeMapping: (input: SessionArchiveWorktreeMappingInput) => SessionArchiveWorktreeMapping;
  deleteWorktreeMapping: (id: string) => boolean;
  applyWorktreeMappings: () => { updated: number; mappings: SessionArchiveWorktreeMapping[] };
  scanSecrets: () => SessionArchiveSecretScanSummary;
};

/**
 * Write/mutate session archive methods — extracted from createSessionArchiveStore
 * to keep session-archive.ts under the file-size ratchet.
 */
export function createSessionArchiveWriteApi(input: {
  db: SqliteDatabase;
  getSession: (sessionId: string) => SessionArchiveSession | null;
  getSessionIncludingDeleted: (sessionId: string) => SessionArchiveSession | null;
  sessionExists: (sessionId: string) => boolean;
  isSessionExcluded: (sessionId: string) => boolean;
  listAllMessages: (sessionId: string) => SessionArchiveMessage[];
  getInsight: (id: number) => SessionArchiveInsight | null;
  listWorktreeMappings: () => SessionArchiveWorktreeMapping[];
  getActivityReport: (input: SessionArchiveActivityReportInput) => SessionArchiveActivityReport;
  getAnalyticsSummary: () => SessionArchiveAnalyticsSummary;
  getAnalyticsTools: () => SessionArchiveAnalyticsToolsResponse;
  getAnalyticsSignals: () => SessionArchiveAnalyticsSignalsResponse;
}): SessionArchiveWriteApi {
  const {
    db,
    getSession,
    getSessionIncludingDeleted,
    sessionExists,
    isSessionExcluded,
    listAllMessages,
    getInsight,
    listWorktreeMappings,
    getActivityReport,
    getAnalyticsSummary,
    getAnalyticsTools,
    getAnalyticsSignals,
  } = input;

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


  return {
    upsertSession,
    replaceSessionMessages,
    replaceSessionUsageEvents,
    upsertSourceFile,
    upsertSkippedFile,
    deleteSkippedFile,
    deleteInsight,
    generateInsight,
    starSession,
    unstarSession,
    bulkStarSessions,
    pinMessage,
    unpinMessage,
    renameSession,
    trashSession,
    restoreSession,
    permanentlyDeleteSession,
    emptyTrash,
    importUploadedExport,
    importClaudeAiExport,
    importChatGptExport,
    upsertWorktreeMapping,
    deleteWorktreeMapping,
    applyWorktreeMappings,
    scanSecrets,
  };
}
