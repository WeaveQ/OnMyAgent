import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionArchiveMessage, SessionArchiveSession } from "@onmyagent/types/session-archive";
import { Database, type SqliteDatabase } from "../core/sqlite.js";
import type { SessionArchiveParseResult } from "./session-archive-parser.js";

// cc-switch parity adapter for OpenCode SQLite storage.
// Reference: cc-switch/src-tauri/src/session_manager/providers/opencode.rs::scan_sessions_sqlite
//
// OpenCode migrated its session storage from flat JSON files under
// `<root>/storage/session/**/*.json` into a SQLite database at
// `<root>/opencode.db`. This adapter enumerates the `session` table and joins
// `message` + `part` in memory to produce `SessionArchiveParseResult` rows the
// existing sync pipeline can persist verbatim.

const OPENCODE_DB_FILENAME = "opencode.db";

export type OpenCodeSqliteSource = {
  root: string;
  dbPath: string;
};

export function findOpenCodeSqliteSource(root: string): OpenCodeSqliteSource | null {
  const dbPath = join(root, OPENCODE_DB_FILENAME);
  return existsSync(dbPath) ? { root, dbPath } : null;
}

export function opencodeSqliteSourceKey(dbPath: string, sessionId: string): string {
  return `sqlite:${dbPath}:${sessionId}`;
}

type OpenCodeSessionRow = {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
};

type OpenCodeMessageRow = {
  id: string;
  time_created: number;
  data: string;
};

type OpenCodePartRow = {
  message_id: string;
  data: string;
};

export type OpenCodeSqliteSessionMeta = {
  sessionId: string;
  title: string;
  directory: string;
  timeCreated: number;
  timeUpdated: number;
  sourceKey: string;
};

export function listOpenCodeSqliteSessions(source: OpenCodeSqliteSource): OpenCodeSqliteSessionMeta[] {
  const db = openReadOnly(source.dbPath);
  if (!db) return [];
  try {
    const stmt = db.prepare(
      "SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC",
    );
    const rows = stmt.all() as OpenCodeSessionRow[];
    return rows.map((row) => ({
      sessionId: row.id,
      title: row.title ?? "",
      directory: row.directory ?? "",
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
      sourceKey: opencodeSqliteSourceKey(source.dbPath, row.id),
    }));
  } finally {
    db.close();
  }
}

export function loadOpenCodeSqliteSession(input: {
  source: OpenCodeSqliteSource;
  session: OpenCodeSqliteSessionMeta;
  machine?: string;
  project?: string;
}): SessionArchiveParseResult | null {
  const db = openReadOnly(input.source.dbPath);
  if (!db) return null;
  try {
    const msgStmt = db.prepare(
      "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC",
    );
    const partStmt = db.prepare(
      "SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created ASC, id ASC",
    );
    const msgRows = msgStmt.all(input.session.sessionId) as OpenCodeMessageRow[];
    const partRows = partStmt.all(input.session.sessionId) as OpenCodePartRow[];
    return buildParseResult({
      source: input.source,
      session: input.session,
      msgRows,
      partRows,
      machine: input.machine ?? "local",
      project: input.project ?? "",
    });
  } finally {
    db.close();
  }
}

function buildParseResult(input: {
  source: OpenCodeSqliteSource;
  session: OpenCodeSqliteSessionMeta;
  msgRows: OpenCodeMessageRow[];
  partRows: OpenCodePartRow[];
  machine: string;
  project: string;
}): SessionArchiveParseResult | null {
  const partsByMessage = new Map<string, OpenCodePartRow[]>();
  for (const part of input.partRows) {
    const bucket = partsByMessage.get(part.message_id);
    if (bucket) bucket.push(part);
    else partsByMessage.set(part.message_id, [part]);
  }

  const sessionId = `opencode:${input.session.sessionId}`;
  const messages: SessionArchiveMessage[] = [];
  let userMessageCount = 0;
  for (let index = 0; index < input.msgRows.length; index += 1) {
    const row = input.msgRows[index];
    if (!row) continue;
    const message = messageFromRow({
      row,
      parts: partsByMessage.get(row.id) ?? [],
      sessionId,
      ordinal: index,
    });
    if (!message) continue;
    messages.push(message);
    if (message.role === "user") userMessageCount += 1;
  }
  if (messages.length === 0) return null;

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const firstUser = messages.find((message) => message.role === "user");
  const startedAt = firstMessage?.timestamp || isoFromMillis(input.session.timeCreated);
  const endedAt = lastMessage?.timestamp || isoFromMillis(input.session.timeUpdated) || startedAt;

  const projectName = input.project || projectFromDirectory(input.session.directory);
  const displayTitle = input.session.title.trim();
  const session: SessionArchiveSession = {
    id: sessionId,
    project: projectName,
    machine: input.machine,
    agent: "opencode",
    first_message: firstUser?.content.slice(0, 300) ?? null,
    display_name: displayTitle || undefined,
    started_at: startedAt || null,
    ended_at: endedAt || null,
    message_count: messages.length,
    user_message_count: userMessageCount,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    is_automated: false,
    file_path: input.session.sourceKey,
    file_mtime: input.session.timeUpdated,
    cwd: input.session.directory || "",
    source_session_id: input.session.sessionId,
    source_version: "opencode-sqlite-v1",
    parser_malformed_lines: 0,
    is_truncated: false,
    local_modified_at: isoFromMillis(input.session.timeUpdated) || null,
    created_at: startedAt || isoFromMillis(input.session.timeCreated) || new Date().toISOString(),
  };
  return { session, messages, usageEvents: [], sourcePath: input.session.sourceKey };
}

function messageFromRow(input: {
  row: OpenCodeMessageRow;
  parts: OpenCodePartRow[];
  sessionId: string;
  ordinal: number;
}): SessionArchiveMessage | null {
  const msg = safeParse(input.row.data);
  const roleRaw = typeof msg?.role === "string" ? msg.role : "";
  const role = roleRaw === "assistant" || roleRaw === "user" ? roleRaw : roleRaw || "assistant";
  const texts: string[] = [];
  for (const part of input.parts) {
    const parsed = safeParse(part.data);
    const text = extractPartText(parsed);
    if (text) texts.push(text);
  }
  const content = texts.join("\n").trim();
  if (!content) return null;
  return {
    id: input.ordinal + 1,
    session_id: input.sessionId,
    ordinal: input.ordinal,
    role,
    content,
    timestamp: isoFromMillis(input.row.time_created) || "",
    has_thinking: false,
    thinking_text: "",
    has_tool_use: content.includes("[Tool:"),
    content_length: content.length,
    model: "",
    context_tokens: 0,
    output_tokens: 0,
    is_system: false,
    source_type: "message",
    source_uuid: input.row.id,
  };
}

function extractPartText(part: Record<string, unknown> | null): string | null {
  if (!part) return null;
  const type = typeof part.type === "string" ? part.type : "";
  if (type === "text") {
    const text = typeof part.text === "string" ? part.text.trim() : "";
    return text.length > 0 ? text : null;
  }
  if (type === "tool") {
    const tool = typeof part.tool === "string" ? part.tool : "unknown";
    return `[Tool: ${tool}]`;
  }
  return null;
}

function safeParse(input: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(input);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function isoFromMillis(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const iso = new Date(value).toISOString();
  return iso;
}

function projectFromDirectory(directory: string): string {
  if (!directory) return "opencode";
  const trimmed = directory.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function openReadOnly(path: string): SqliteDatabase | null {
  try {
    return new Database(path, { readonly: true });
  } catch {
    return null;
  }
}
