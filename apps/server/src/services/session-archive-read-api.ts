import { createHmac, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import {
  sessionArchiveResumeSessionRequestSchema,
  sessionArchiveToolCallSchema,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveDirectoryResponse,
  SessionArchiveExportResponse,
  SessionArchiveInsight,
  SessionArchiveInsightsResponse,
  SessionArchiveMessage,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveResumeSessionRequest,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSession,
  SessionArchiveSessionActivityResponse,
  SessionArchiveSessionPage,
  SessionArchiveSessionTiming,
  SessionArchiveToolCallListItem,
  SessionArchiveToolCallListResponse,
  SessionArchiveUsageEvent,
  SessionArchiveWorktreeMapping,
} from "@onmyagent/types/session-archive";

import type { SqliteDatabase } from "../core/sqlite.js";
import {
  SESSION_ARCHIVE_ACTIVE_SECRETS_RULES_VERSIONS,
} from "./session-archive-secrets.js";
import {
  durationBetween,
  inputPreview,
  insightFromRow,
  likePattern,
  messageFromRow,
  normalizeLimit,
  normalizeOffset,
  numberField,
  objectField,
  optionalNumberField,
  optionalStringField,
  parseTimestamp,
  parseToolCalls,
  pinnedMessageFromRow,
  pinsQuery,
  primaryCategoryForCalls,
  renderSessionHtml,
  renderSessionMarkdown,
  resumeCommandForSession,
  safeFilename,
  secretFindingFromRow,
  sessionFromRow,
  sessionListCursorSecret,
  shellQuote,
  skippedFileFromRow,
  snapInterval,
  sourceFileFromRow,
  stringField,
  worktreeMappingFromRow,
} from "./session-archive-sql.js";
import { usageEventFromRow } from "./session-archive-usage-math.js";
import type {
  SessionArchiveInsightFilterInput,
  SessionArchiveListCursor,
  SessionArchiveMessagesInput,
  SessionArchiveSecretFindingsInput,
  SessionArchiveSessionListInput,
  SessionArchiveSkippedFileState,
  SessionArchiveSourceFileState,
  SessionArchiveTrashList,
} from "./session-archive-types.js";

export type SessionArchiveReadApi = {
  listUsageEvents: (sessionId: string) => SessionArchiveUsageEvent[];
  getSourceFile: (path: string) => SessionArchiveSourceFileState | null;
  getSkippedFile: (path: string) => SessionArchiveSkippedFileState | null;
  listSessions: (input?: SessionArchiveSessionListInput) => SessionArchiveSessionPage;
  sessionListWhere: (
    input: SessionArchiveSessionListInput,
  ) => { where: string; args: Array<string | number> };
  getSession: (sessionId: string) => SessionArchiveSession | null;
  getSessionIncludingDeleted: (sessionId: string) => SessionArchiveSession | null;
  sessionExists: (sessionId: string) => boolean;
  isSessionExcluded: (sessionId: string) => boolean;
  listMessages: (sessionId: string, input?: SessionArchiveMessagesInput) => SessionArchiveMessagesResponse;
  listAllMessages: (sessionId: string) => SessionArchiveMessage[];
  listVisibleMessages: (sessionId: string) => SessionArchiveMessage[];
  listToolCalls: (sessionId: string) => SessionArchiveToolCallListResponse;
  listChildren: (sessionId: string) => SessionArchiveSession[];
  getActivity: (sessionId: string) => SessionArchiveSessionActivityResponse | null;
  getTiming: (sessionId: string) => SessionArchiveSessionTiming | null;
  listInsights: (input?: SessionArchiveInsightFilterInput) => SessionArchiveInsightsResponse;
  getInsight: (id: number) => SessionArchiveInsight | null;
  listStarredSessions: () => string[];
  listPins: (project?: string) => SessionArchivePinsResponse;
  listSessionPins: (sessionId: string) => SessionArchivePinsResponse;
  listTrash: () => SessionArchiveTrashList;
  getSessionDirectory: (sessionId: string) => SessionArchiveDirectoryResponse | null;
  openSessionDirectory: (sessionId: string) => SessionArchiveOpenSessionResponse | null;
  resumeSession: (sessionId: string, input?: SessionArchiveResumeSessionRequest) => SessionArchiveResumeSessionResponse | null;
  exportSessionHtml: (sessionId: string) => SessionArchiveExportResponse | null;
  exportSessionMarkdown: (sessionId: string) => SessionArchiveExportResponse | null;
  publishSession: (sessionId: string) => SessionArchivePublishResponse | null;
  listSecretFindings: (input?: SessionArchiveSecretFindingsInput) => SessionArchiveSecretFindingsResponse;
  listWorktreeMappings: () => SessionArchiveWorktreeMapping[];
};

/**
 * Read-side session archive queries — extracted from createSessionArchiveStore
 * to keep session-archive.ts under the file-size ratchet.
 */
export function createSessionArchiveReadApi(input: {
  db: SqliteDatabase;
  dbPath: string;
}): SessionArchiveReadApi {
  const { db, dbPath } = input;

  const getSourceFileStatement = db.prepare("SELECT * FROM source_files WHERE path = ?");
  const getSkippedFileStatement = db.prepare("SELECT * FROM skipped_files WHERE path = ?");

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


function getSkippedFile(path: string): SessionArchiveSkippedFileState | null {
  const row = getSkippedFileStatement.get(path);
  return row ? skippedFileFromRow(row) : null;
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


function listStarredSessions(): string[] {
  return db.prepare(`
    SELECT starred_sessions.session_id
    FROM starred_sessions
    INNER JOIN sessions ON sessions.id = starred_sessions.session_id
    WHERE sessions.deleted_at IS NULL
    ORDER BY starred_sessions.created_at DESC, starred_sessions.session_id ASC
  `).all().map((row) => stringField(row, "session_id"));
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


function listTrash(): SessionArchiveTrashList {
  return {
    sessions: db.prepare(`
      SELECT * FROM sessions
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC, id ASC
    `).all().map(sessionFromRow),
  };
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


function listWorktreeMappings(): SessionArchiveWorktreeMapping[] {
  return db.prepare("SELECT * FROM worktree_mappings ORDER BY updated_at DESC, id ASC").all().map(worktreeMappingFromRow);
}

  return {
    listUsageEvents,
    getSourceFile,
    getSkippedFile,
    listSessions,
    sessionListWhere,
    getSession,
    getSessionIncludingDeleted,
    sessionExists,
    isSessionExcluded,
    listMessages,
    listAllMessages,
    listVisibleMessages,
    listToolCalls,
    listChildren,
    getActivity,
    getTiming,
    listInsights,
    getInsight,
    listStarredSessions,
    listPins,
    listSessionPins,
    listTrash,
    getSessionDirectory,
    openSessionDirectory,
    resumeSession,
    exportSessionHtml,
    exportSessionMarkdown,
    publishSession,
    listSecretFindings,
    listWorktreeMappings,
  };
}
