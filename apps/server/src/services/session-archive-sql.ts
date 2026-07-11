import { createHmac, timingSafeEqual } from "node:crypto";
import {
  sessionArchiveInsightSchema,
  sessionArchiveMessageSchema,
  sessionArchiveSessionSchema,
  sessionArchiveToolCallSchema,
  sessionArchiveUsageEventSchema,
} from "@onmyagent/types/session-archive";
import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveConfigUpdate,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveInsight,
  SessionArchiveMessage,
  SessionArchivePinnedMessage,
  SessionArchiveResumeSessionRequest,
  SessionArchiveSecretFinding,
  SessionArchiveSession,
  SessionArchiveSessionTiming,
  SessionArchiveToolCall,
  SessionArchiveUsageEvent,
  SessionArchiveWorktreeMapping,
} from "@onmyagent/types/session-archive";
import {
  SESSION_ARCHIVE_SECRETS_RULES_VERSION,
  scanSessionArchiveSecrets,
} from "./session-archive-secrets.js";
import type {
  SessionArchiveSessionSearchMatch,
  SessionArchiveSourceFileState,
  SessionArchiveSkippedFileState,
} from "./session-archive-types.js";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

export function objectField(row: unknown, key: string): unknown {
  if (!row || typeof row !== "object") return undefined;
  return Reflect.get(row, key);
}

export function sqliteRunChanges(value: unknown): number {
  const raw = objectField(value, "changes");
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

export function sqliteLastInsertRowid(value: unknown): number {
  const raw = objectField(value, "lastInsertRowid");
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  return 0;
}

export function stringField(row: unknown, key: string): string {
  return String(objectField(row, key) ?? "");
}

export function nullableStringField(row: unknown, key: string): string | null {
  const value = objectField(row, key);
  return value === null || value === undefined ? null : String(value);
}

export function optionalStringField(row: unknown, key: string): string | undefined {
  const value = objectField(row, key);
  return value === null || value === undefined ? undefined : String(value);
}

export function numberField(row: unknown, key: string): number {
  const value = Number(objectField(row, key) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function optionalNumberField(row: unknown, key: string): number | undefined {
  const value = objectField(row, key);
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function nullableNumberField(row: unknown, key: string): number | null {
  const value = objectField(row, key);
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sessionFromRow(row: unknown): SessionArchiveSession {
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

export function messageFromRow(row: unknown): SessionArchiveMessage {
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

export function searchResultFromRow(row: unknown) {
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
export function sourceFileFromRow(row: unknown): SessionArchiveSourceFileState {
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

export function skippedFileFromRow(row: unknown): SessionArchiveSkippedFileState {
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

export function sqliteLastInsertRowId(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = Reflect.get(result, "lastInsertRowid");
  return typeof value === "bigint" ? Number(value) : Number(value);
}

export function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

export function intToOptionalBool(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return Number(value) !== 0;
}

export function intToBool(value: unknown): boolean {
  return Number(value) !== 0;
}

export function jsonOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  return JSON.parse(value);
}

export function parseOptionalJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  return JSON.parse(value);
}

export function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(value));
}

export function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return 0;
  return Math.floor(value);
}

export function sessionListCursorSecret(dbPath: string): string {
  return `studio-session-archive-list-cursor-v1:${dbPath}`;
}

export function systemPrefixSql(contentColumn: string, roleColumn: string): string {
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

export function matchesSystemVisibleContent(content: string, role: string): boolean {
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

export function appendSubstringMatches(matches: SessionArchiveSessionSearchMatch[], input: {
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

export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (part) => `\\${part}`)}%`;
}

export function prepareFtsQuery(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(" ");
}

export function parseToolCalls(value: unknown): SessionArchiveToolCall[] {
  const parsed = parseOptionalJsonField(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => sessionArchiveToolCallSchema.parse(item));
}
export function insightFromRow(row: unknown): SessionArchiveInsight {
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

export function buildDeterministicInsight(input: { input: SessionArchiveGenerateInsightRequest; activity: SessionArchiveActivityReport; summary: SessionArchiveAnalyticsSummary; tools: SessionArchiveAnalyticsToolsResponse; signals: SessionArchiveAnalyticsSignalsResponse }): string {
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

export function insightAggregateHash(input: SessionArchiveGenerateInsightRequest, activity: SessionArchiveActivityReport): string {
  return `${input.type}:${input.date_from}:${input.date_to}:${activity.totals.sessions}:${activity.totals.output_tokens}`;
}

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function pinsQuery(extraWhere: string): string {
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

export function pinnedMessageFromRow(row: unknown): SessionArchivePinnedMessage {
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

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value) && !value.startsWith("-")) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function resumeCommandForSession(session: SessionArchiveSession, input: SessionArchiveResumeSessionRequest): string {
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

export function safeFilename(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "session-archive-session";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSessionHtml(session: SessionArchiveSession, messages: SessionArchiveMessage[]): string {
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

export function renderSessionMarkdown(session: SessionArchiveSession, messages: SessionArchiveMessage[]): string {
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

export function importMessage(
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

export function importMessageId(sessionId: string, ordinal: number): number {
  const prefix = Number.parseInt(shortHash(sessionId).slice(0, 10), 16);
  return prefix * 1000 + ordinal + 1;
}

export function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringFromUnknown).filter(Boolean).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

export function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringFromUnknown).map((item) => item.trim()).filter(Boolean);
}

export function redactPostgresConfigUpdate(input: NonNullable<SessionArchiveConfigUpdate["postgres"]>): Record<string, unknown> {
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

export function redactDuckDbConfigUpdate(input: NonNullable<SessionArchiveConfigUpdate["duckdb"]>): Record<string, unknown> {
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

export function previewDatabaseUrl(value: string): string | undefined {
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

export function worktreeMappingFromRow(row: unknown): SessionArchiveWorktreeMapping {
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

export function secretFindingsForMessage(message: SessionArchiveMessage, createdAt: string): Array<Omit<SessionArchiveSecretFinding, "id" | "project" | "agent" | "display_name">> {
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

export function secretFindingFromRow(row: unknown): SessionArchiveSecretFinding {
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

export function secretLocationKind(value: string): SessionArchiveSecretFinding["location_kind"] {
  if (value === "tool_input" || value === "tool_result" || value === "tool_result_event") return value;
  return "message";
}

export function parseJsonArray(content: string): unknown[] | null {
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

export function conversationMessages(conversation: unknown, sessionId: string): SessionArchiveMessage[] {
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

export function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function previewSecret(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 8) return "[REDACTED_SECRET]";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
export function roundCost(value: number): number {
  return Math.round(value * 100000) / 100000;
}

export function parseTimestamp(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function durationBetween(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const startDate = parseTimestamp(start);
  const endDate = parseTimestamp(end);
  if (!startDate || !endDate) return null;
  return Math.round(endDate.getTime() - startDate.getTime());
}

export function snapInterval(durationSec: number): number {
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

export function inputPreview(call: SessionArchiveToolCall): string {
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

export function primaryCategoryForCalls(calls: SessionArchiveSessionTiming["turns"][number]["calls"]): string {
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

export function createContentMatcher(pattern: string, mode: "substring" | "regex" | "fts"): (content: string) => boolean {
  if (mode === "regex") {
    const regexp = new RegExp(pattern, "i");
    return (content) => regexp.test(content);
  }
  const lower = pattern.toLowerCase();
  return (content) => content.toLowerCase().includes(lower);
}

export function contentSearchRowSource(role: string): "message" | "tool_input" | "tool_result" {
  if (role === "tool_input") return "tool_input";
  if (role === "tool_result") return "tool_result";
  return "message";
}

export function snippetAround(content: string, pattern: string): string {
  const index = content.toLowerCase().indexOf(pattern.toLowerCase());
  if (index < 0) return content.slice(0, 180);
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + pattern.length + 120);
  return content.slice(start, end);
}

export function tokenNumber(value: unknown, ...keys: string[]): number | undefined {
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
export function tokenFloat(value: unknown, ...keys: string[]): number | undefined {
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

