import { createHmac, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import {
  sessionArchiveConfigUpdateSchema,
  sessionArchiveGenerateInsightRequestSchema,
  sessionArchiveMessageSchema,
  sessionArchivePinRequestSchema,
  sessionArchiveRenameSessionRequestSchema,
  sessionArchiveResumeSessionRequestSchema,
  sessionArchiveSessionSchema,
  sessionArchiveToolCallSchema,
  sessionArchiveUploadImportRequestSchema,
  sessionArchiveUsageEventSchema,
  sessionArchiveWorktreeMappingInputSchema,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveBackendsStatusResponse,
  SessionArchiveConfigSnapshot,
  SessionArchiveConfigUpdate,
  SessionArchiveContentSearchResponse,
  SessionArchiveDirectoryResponse,
  SessionArchiveExportResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveImportStats,
  SessionArchiveInsight,
  SessionArchiveInsightsResponse,
  SessionArchiveMessage,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinRequest,
  SessionArchivePinResponse,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveRenameSessionRequest,
  SessionArchiveResumeSessionRequest,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSecretFinding,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveSessionActivityResponse,
  SessionArchiveSessionPage,
  SessionArchiveSessionSearchResponse,
  SessionArchiveSessionTiming,
  SessionArchiveStats,
  SessionArchiveToolCall,
  SessionArchiveToolCallListItem,
  SessionArchiveToolCallListResponse,
  SessionArchiveUploadImportRequest,
  SessionArchiveUsageEvent,
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
import { createSessionArchiveAnalyticsApi } from "./session-archive-analytics.js";
import { initializeArchiveDb, repairEpochArchiveTimestamps } from "./session-archive-schema.js";
import {
  appendSubstringMatches,
  boolToInt,
  buildDeterministicInsight,
  contentSearchRowSource,
  conversationMessages,
  createContentMatcher,
  durationBetween,
  importMessage,
  inputPreview,
  insightAggregateHash,
  insightFromRow,
  jsonOrNull,
  likePattern,
  matchesSystemVisibleContent,
  messageFromRow,
  normalizeLimit,
  normalizeOffset,
  nullableStringField,
  numberField,
  objectField,
  optionalNumberField,
  optionalStringField,
  parseJsonArray,
  parseOptionalJsonField,
  parseTimestamp,
  parseToolCalls,
  pinnedMessageFromRow,
  pinsQuery,
  prepareFtsQuery,
  previewSecret,
  primaryCategoryForCalls,
  redactDuckDbConfigUpdate,
  redactPostgresConfigUpdate,
  renderSessionHtml,
  renderSessionMarkdown,
  resumeCommandForSession,
  safeFilename,
  searchResultFromRow,
  secretFindingFromRow,
  secretFindingsForMessage,
  sessionFromRow,
  sessionListCursorSecret,
  shellQuote,
  shortHash,
  skippedFileFromRow,
  snapInterval,
  snippetAround,
  sourceFileFromRow,
  sqliteLastInsertRowId,
  sqliteLastInsertRowid,
  sqliteRunChanges,
  stringArrayFromUnknown,
  stringField,
  stringFromUnknown,
  systemPrefixSql,
  worktreeMappingFromRow,
} from "./session-archive-sql.js";
import type {
  SessionArchiveContentSearchInput,
  SessionArchiveInsightFilterInput,
  SessionArchiveListCursor,
  SessionArchiveMessagesInput,
  SessionArchiveSearchInput,
  SessionArchiveSecretFindingsInput,
  SessionArchiveSessionListInput,
  SessionArchiveSessionSearchInput,
  SessionArchiveSessionSearchMatch,
  SessionArchiveSkippedFileState,
  SessionArchiveSourceFileState,
  SessionArchiveStore,
  SessionArchiveTrashList,
} from "./session-archive-types.js";
import { createSessionArchiveUsageApi } from "./session-archive-usage.js";
import {
  usageEventFromRow,
  usageEventsFromMessages,
} from "./session-archive-usage-math.js";

export type {
  SessionArchiveActivityReportInput,
  SessionArchiveContentSearchInput,
  SessionArchiveInsightFilterInput,
  SessionArchiveMessagesInput,
  SessionArchiveSearchInput,
  SessionArchiveSecretFindingsInput,
  SessionArchiveSessionListInput,
  SessionArchiveSessionSearchInput,
  SessionArchiveSkippedFileState,
  SessionArchiveSourceFileState,
  SessionArchiveStore,
  SessionArchiveTrashList,
  SessionArchiveTrendsTermsInput,
  SessionArchiveUsageComparisonInput,
  SessionArchiveUsageFilterInput,
  SessionArchiveUsageTopSessionsInput,
} from "./session-archive-types.js";

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

  const usageApi = createSessionArchiveUsageApi({ db, getSession });
  const analyticsApi = createSessionArchiveAnalyticsApi({
    db,
    listAllMessages,
    usageRows: usageApi.usageRows,
  });

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
    const activity = analyticsApi.getActivityReport({ preset: "custom", from: `${parsed.date_from}T00:00:00Z`, to: `${parsed.date_to}T23:59:59Z`, project: project ?? undefined, automation: parsed.automated_scope === "automated" ? "automated" : parsed.automated_scope === "human" ? "interactive" : "all" });
    const summary = analyticsApi.getAnalyticsSummary();
    const tools = analyticsApi.getAnalyticsTools();
    const signals = analyticsApi.getAnalyticsSignals();
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
    getUsage: usageApi.getUsage,
    getUsageSummary: usageApi.getUsageSummary,
    getUsageComparison: usageApi.getUsageComparison,
    getTopUsageSessions: usageApi.getTopUsageSessions,
    getAnalyticsSummary: analyticsApi.getAnalyticsSummary,
    getAnalyticsActivity: analyticsApi.getAnalyticsActivity,
    getAnalyticsHeatmap: analyticsApi.getAnalyticsHeatmap,
    getAnalyticsProjects: analyticsApi.getAnalyticsProjects,
    getAnalyticsHourOfWeek: analyticsApi.getAnalyticsHourOfWeek,
    getAnalyticsSessionShape: analyticsApi.getAnalyticsSessionShape,
    getAnalyticsVelocity: analyticsApi.getAnalyticsVelocity,
    getAnalyticsTools: analyticsApi.getAnalyticsTools,
    getAnalyticsSkills: analyticsApi.getAnalyticsSkills,
    getAnalyticsTopSessions: analyticsApi.getAnalyticsTopSessions,
    getAnalyticsSignals: analyticsApi.getAnalyticsSignals,
    getAnalyticsSignalSessions: analyticsApi.getAnalyticsSignalSessions,
    getAnalyticsBatch: analyticsApi.getAnalyticsBatch,
    getActivityReport: analyticsApi.getActivityReport,
    getTrendsTerms: analyticsApi.getTrendsTerms,
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
