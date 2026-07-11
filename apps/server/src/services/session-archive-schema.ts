import type { SqliteDatabase } from "../core/sqlite.js";
import { stringField } from "./session-archive-sql.js";

export function initializeArchiveDb(db: SqliteDatabase) {
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

export function ensureArchiveSchemaColumns(db: SqliteDatabase) {
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

export function tableColumnNames(db: SqliteDatabase, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => stringField(row, "name")));
}

export function addColumnIfMissing(db: SqliteDatabase, table: string, columns: Set<string>, name: string, definition: string) {
  if (columns.has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

export function repairEpochArchiveTimestamps(db: SqliteDatabase) {
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
