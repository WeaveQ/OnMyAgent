import type {
  SessionArchiveContentSearchResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSessionSearchResponse,
  SessionArchiveStats,
} from "@onmyagent/types/session-archive";
import type { SqliteDatabase } from "../core/sqlite.js";
import {
  appendSubstringMatches,
  contentSearchRowSource,
  createContentMatcher,
  likePattern,
  matchesSystemVisibleContent,
  normalizeLimit,
  normalizeOffset,
  nullableStringField,
  numberField,
  prepareFtsQuery,
  searchResultFromRow,
  snippetAround,
  stringField,
  systemPrefixSql,
} from "./session-archive-sql.js";
import type {
  SessionArchiveContentSearchInput,
  SessionArchiveSearchInput,
  SessionArchiveSessionListInput,
  SessionArchiveSessionSearchInput,
  SessionArchiveSessionSearchMatch,
} from "./session-archive-types.js";

export type SessionArchiveSearchApi = {
  searchSession: (input: SessionArchiveSessionSearchInput) => SessionArchiveSessionSearchResponse;
  searchContent: (input: SessionArchiveContentSearchInput) => SessionArchiveContentSearchResponse;
  search: (input: SessionArchiveSearchInput) => SessionArchiveSearchResponse;
  stats: () => SessionArchiveStats;
};

/**
 * Search / content-search / global search / archive stats — extracted from
 * createSessionArchiveStore to keep session-archive.ts under the file-size ratchet.
 */
export function createSessionArchiveSearchApi(input: {
  db: SqliteDatabase;
  sessionListWhere: (
    listInput: SessionArchiveSessionListInput,
  ) => { where: string; args: Array<string | number> };
}): SessionArchiveSearchApi {
  const { db, sessionListWhere } = input;

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

  return { searchSession, searchContent, search, stats };
}
