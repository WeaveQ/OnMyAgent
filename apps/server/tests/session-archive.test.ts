import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionArchiveMessage, SessionArchiveSession } from "@onmyagent/types/session-archive";
import { Database } from "../src/core/sqlite.js";
import { openSessionArchiveStore } from "../src/services/session-archive.js";

function sampleSession(input: Partial<SessionArchiveSession> = {}): SessionArchiveSession {
  return {
    id: "session-1",
    project: "studio",
    machine: "local",
    agent: "codex",
    first_message: "Inspect the archive",
    started_at: "2026-06-23T01:00:00Z",
    ended_at: "2026-06-23T01:05:00Z",
    message_count: 0,
    user_message_count: 0,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    is_automated: false,
    created_at: "2026-06-23T01:00:00Z",
    ...input,
  };
}

function sampleMessage(input: Partial<SessionArchiveMessage> = {}): SessionArchiveMessage {
  const content = input.content ?? "Need graph archive search";
  return {
    id: input.id ?? 1,
    session_id: input.session_id ?? "session-1",
    ordinal: input.ordinal ?? 0,
    role: input.role ?? "user",
    content,
    timestamp: input.timestamp ?? "2026-06-23T01:00:01Z",
    has_thinking: false,
    thinking_text: "",
    has_tool_use: false,
    content_length: content.length,
    model: "",
    context_tokens: 0,
    output_tokens: 0,
    is_system: false,
    ...input,
  };
}

describe("session-archive archive store", () => {
  test("migrates legacy archive databases before creating indexes that depend on new columns", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-legacy-"));
    const dbPath = join(root, "archive.sqlite");
    try {
      const db = new Database(dbPath);
      try {
        db.exec(`
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            project TEXT NOT NULL,
            machine TEXT NOT NULL,
            agent TEXT NOT NULL,
            first_message TEXT,
            display_name TEXT,
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
            total_output_tokens INTEGER NOT NULL DEFAULT 0,
            peak_context_tokens INTEGER NOT NULL DEFAULT 0,
            has_total_output_tokens INTEGER,
            has_peak_context_tokens INTEGER,
            is_automated INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          CREATE TABLE messages (
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
            source_subtype TEXT,
            UNIQUE(session_id, ordinal)
          );
          CREATE TABLE source_files (
            path TEXT PRIMARY KEY,
            agent TEXT NOT NULL,
            session_id TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime REAL NOT NULL,
            hash TEXT NOT NULL,
            synced_at TEXT NOT NULL
          );
          CREATE TABLE secret_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            rule TEXT NOT NULL,
            confidence TEXT NOT NULL,
            location_kind TEXT NOT NULL,
            message_ordinal INTEGER NOT NULL,
            call_index INTEGER,
            match_start INTEGER NOT NULL,
            match_end INTEGER NOT NULL,
            redacted_match TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `);
      } finally {
        db.close();
      }

      const store = await openSessionArchiveStore({ dbPath });
      try {
        expect(store.listSessions({ limit: 1 })).toMatchObject({ sessions: [], total: 0 });
        expect(store.listSecretFindings({ confidence: "definite" }).findings).toEqual([]);
        expect(store.stats()).toMatchObject({ session_count: 0, message_count: 0 });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stores sessions and messages in an injected runtime-state sqlite path", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "studio-abc", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession());
        store.replaceSessionMessages("session-1", [
          sampleMessage(),
          sampleMessage({ id: 2, ordinal: 1, role: "assistant", content: "Archive search is ready." }),
        ]);

        expect(store.getSession("session-1")?.message_count).toBe(2);
        expect(store.listSessions().sessions.map((session) => session.id)).toEqual(["session-1"]);
        expect(store.listMessages("session-1").messages.map((message) => message.content)).toEqual([
          "Need graph archive search",
          "Archive search is ready.",
        ]);
        expect(store.stats()).toMatchObject({
          session_count: 1,
          message_count: 2,
          project_count: 1,
          machine_count: 1,
          earliest_session: "2026-06-23T01:00:00Z",
        });
        expect(store.search({ query: "archive search" }).results[0]).toMatchObject({
          session_id: "session-1",
          project: "studio",
          agent: "codex",
        });
      } finally {
        store.close();
      }

      expect(await readFile(dbPath)).toBeInstanceOf(Buffer);
      expect(dbPath.includes(`${join(root, "repo")}/.session-archive`)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("replaces a session message set and keeps FTS in sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession());
        store.replaceSessionMessages("session-1", [sampleMessage({ content: "legacy keyword" })]);
        expect(store.search({ query: "legacy" }).count).toBe(1);

        store.replaceSessionMessages("session-1", [sampleMessage({ id: 2, content: "fresh keyword" })]);

        expect(store.search({ query: "legacy" }).count).toBe(0);
        expect(store.search({ query: "fresh" }).count).toBe(1);
        expect(store.getSession("session-1")?.message_count).toBe(1);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("computes stats from canonical archive rows without trigger cache drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-stats-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "stats-a", project: "alpha", machine: "mac-a" }));
        store.upsertSession(sampleSession({ id: "stats-b", project: "beta", machine: "mac-b" }));
        store.replaceSessionMessages("stats-a", [
          sampleMessage({ id: 1, session_id: "stats-a", ordinal: 0, role: "user", content: "one" }),
        ]);
        store.replaceSessionMessages("stats-b", [
          sampleMessage({ id: 2, session_id: "stats-b", ordinal: 0, role: "user", content: "two" }),
          sampleMessage({ id: 3, session_id: "stats-b", ordinal: 1, role: "assistant", content: "three" }),
        ]);

        expect(store.stats()).toMatchObject({ session_count: 2, message_count: 3, project_count: 2, machine_count: 2 });

        store.replaceSessionMessages("stats-b", [
          sampleMessage({ id: 4, session_id: "stats-b", ordinal: 0, role: "user", content: "replacement" }),
        ]);
        expect(store.stats()).toMatchObject({ session_count: 2, message_count: 2, project_count: 2, machine_count: 2 });

        expect(store.trashSession("stats-b")).toBe(true);
        expect(store.stats()).toMatchObject({ session_count: 1, message_count: 1, project_count: 1, machine_count: 1 });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("persists AgentsView provenance and message source fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({
          session_name: "Agent title",
          file_inode: 123,
          file_device: 456,
          file_hash: "hash-abc",
          local_modified_at: "2026-06-23T01:00:02.000Z",
          cwd: "/Users/alice/project",
          git_branch: "main",
          source_session_id: "source-session-1",
          source_version: "studio-session-archive-v1",
          parser_malformed_lines: 2,
          is_truncated: true,
        }));
        store.replaceSessionMessages("session-1", [
          sampleMessage({
            claude_message_id: "msg-1",
            claude_request_id: "req-1",
            source_type: "assistant",
            source_uuid: "uuid-1",
            source_parent_uuid: "uuid-0",
            source_subtype: "text",
            is_sidechain: true,
          }),
        ]);

        expect(store.getSession("session-1")).toMatchObject({
          session_name: "Agent title",
          file_inode: 123,
          file_device: 456,
          file_hash: "hash-abc",
          local_modified_at: "2026-06-23T01:00:02.000Z",
          cwd: "/Users/alice/project",
          git_branch: "main",
          source_session_id: "source-session-1",
          source_version: "studio-session-archive-v1",
          parser_malformed_lines: 2,
          is_truncated: true,
        });
        expect(store.listMessages("session-1").messages[0]).toMatchObject({
          claude_message_id: "msg-1",
          claude_request_id: "req-1",
          source_type: "assistant",
          source_uuid: "uuid-1",
          source_parent_uuid: "uuid-0",
          source_subtype: "text",
          is_sidechain: true,
        });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("persists normalized usage events and uses them for usage totals", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "event-session", agent: "hermes", project: "usage", user_message_count: 2 }));
        store.replaceSessionMessages("event-session", [
          sampleMessage({
            session_id: "event-session",
            model: "gpt-5.5",
            token_usage: { input_tokens: 1, output_tokens: 1 },
            context_tokens: 1,
            output_tokens: 1,
            has_context_tokens: true,
            has_output_tokens: true,
          }),
        ]);
        store.replaceSessionUsageEvents("event-session", [{
          session_id: "event-session",
          message_ordinal: null,
          source: "hermes",
          model: "gpt-5.5",
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 400,
          reasoning_tokens: 50,
          cost_usd: 0.25,
          cost_status: "actual",
          cost_source: "hermes",
          occurred_at: "2026-06-23T01:00:00Z",
          dedup_key: "event-1",
        }]);

        expect(store.listUsageEvents("event-session")[0]).toMatchObject({
          source: "hermes",
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 400,
          reasoning_tokens: 50,
          cost_usd: 0.25,
          dedup_key: "event-1",
        });
        const summary = store.getUsageSummary({ from: "2026-06-23", to: "2026-06-23", includeOneShot: true });
        expect(summary.totals).toMatchObject({
          inputTokens: 1000,
          outputTokens: 250,
          cacheCreationTokens: 300,
          cacheReadTokens: 400,
          totalCost: 0.25,
        });

        store.replaceSessionUsageEvents("event-session", []);
        expect(store.listUsageEvents("event-session")).toHaveLength(0);
        const fallback = store.getUsageSummary({ from: "2026-06-23", to: "2026-06-23", includeOneShot: true });
        expect(fallback.totals).toMatchObject({ inputTokens: 1, outputTokens: 1 });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("imports multiple agent sessions without global message id collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        const codex = store.importUploadedExport({
          filename: "codex.jsonl",
          agent: "codex",
          project: "parity",
          content: JSON.stringify({ session_id: "parity:codex", role: "user", content: "codex parity" }),
        });
        const claude = store.importUploadedExport({
          filename: "claude.jsonl",
          agent: "claude",
          project: "parity",
          content: JSON.stringify({ session_id: "parity:claude", role: "user", content: "claude parity" }),
        });

        expect(codex).toMatchObject({ imported: 1, errors: 0 });
        expect(claude).toMatchObject({ imported: 1, errors: 0 });
        expect(store.listSessions({ limit: 10 }).sessions.map((session) => session.id).sort()).toEqual([
          "parity:claude",
          "parity:codex",
        ]);
        expect(store.stats()).toMatchObject({ session_count: 2, message_count: 2 });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns full agent counts while listing a filtered agent page", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "codex-1", agent: "codex", first_message: "codex" }));
        store.upsertSession(sampleSession({ id: "hermes-1", agent: "hermes", first_message: "hermes" }));
        store.upsertSession(sampleSession({ id: "openclaw-1", agent: "openclaw", first_message: "openclaw" }));

        const page = store.listSessions({ agent: "hermes", limit: 10 });

        expect(page.sessions.map((session) => session.agent)).toEqual(["hermes"]);
        expect(page.agent_counts).toEqual([
          { agent: "codex", count: 1 },
          { agent: "hermes", count: 1 },
          { agent: "openclaw", count: 1 },
        ]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("filters session list with AgentsView parity filter families", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-filters-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({
          id: "alpha-root",
          project: "alpha",
          machine: "mac-a",
          agent: "codex",
          first_message: "Root alpha search title",
          started_at: "2026-06-20T01:00:00Z",
          ended_at: "2026-06-20T02:00:00Z",
          message_count: 8,
          user_message_count: 4,
          health_grade: "A",
          outcome: "success",
          termination_status: "clean",
          tool_failure_signal_count: 0,
        }));
        store.upsertSession(sampleSession({
          id: "beta-automated",
          project: "beta",
          machine: "mac-b",
          agent: "hermes",
          started_at: "2026-06-21T01:00:00Z",
          ended_at: "2026-06-21T02:00:00Z",
          message_count: 3,
          user_message_count: 1,
          is_automated: true,
          health_grade: "D",
          outcome: "failed",
          termination_status: "tool_call_pending",
          tool_failure_signal_count: 2,
        }));
        store.upsertSession(sampleSession({
          id: "gamma-child",
          project: "alpha",
          machine: "mac-a",
          agent: "codex",
          parent_session_id: "alpha-root",
          relationship_type: "subagent",
          started_at: "2026-06-22T01:00:00Z",
          ended_at: "2026-06-22T02:00:00Z",
          message_count: 2,
          user_message_count: 2,
          health_grade: "B",
          outcome: "success",
          termination_status: "truncated",
          tool_failure_signal_count: 1,
        }));
        store.upsertSession(sampleSession({
          id: "delta-orphan",
          project: "delta",
          machine: "mac-c",
          agent: "openclaw",
          parent_session_id: "missing-parent",
          started_at: "2026-06-23T01:00:00Z",
          ended_at: "2026-06-23T02:00:00Z",
          message_count: 10,
          user_message_count: 5,
          health_grade: "C",
          outcome: "partial",
          termination_status: "clean",
        }));
        store.starSession("alpha-root");
        store.replaceSessionMessages("alpha-root", [
          sampleMessage({ session_id: "alpha-root", ordinal: 0, role: "user", content: "Authorization: Bearer sk-proj-abcdefghijklmnopqrstuvwxyzABCDE123456789" }),
          sampleMessage({ id: 2, session_id: "alpha-root", ordinal: 1, role: "assistant", content: "Secret noted" }),
          sampleMessage({ id: 3, session_id: "alpha-root", ordinal: 2, role: "user", content: "Continue alpha" }),
          sampleMessage({ id: 4, session_id: "alpha-root", ordinal: 3, role: "assistant", content: "Continuing" }),
          sampleMessage({ id: 5, session_id: "alpha-root", ordinal: 4, role: "user", content: "Check filters" }),
          sampleMessage({ id: 6, session_id: "alpha-root", ordinal: 5, role: "assistant", content: "Filters checked" }),
          sampleMessage({ id: 7, session_id: "alpha-root", ordinal: 6, role: "user", content: "Finish" }),
          sampleMessage({ id: 8, session_id: "alpha-root", ordinal: 7, role: "assistant", content: "Done" }),
        ]);
        store.scanSecrets();

        expect(store.listSessions({ limit: 10 }).sessions.map((session) => session.id)).toEqual(["alpha-root"]);
        expect(store.listSessions({ project: "alpha", includeChildren: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["alpha-root", "gamma-child"]);
        expect(store.listSessions({ excludeProject: "alpha", includeAutomated: true, includeChildren: true, includeOrphans: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["beta-automated", "delta-orphan"]);
        expect(store.listSessions({ machine: "mac-a", includeChildren: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["alpha-root", "gamma-child"]);
        expect(store.listSessions({ date: "2026-06-20", limit: 10 }).sessions.map((session) => session.id)).toEqual(["alpha-root"]);
        expect(store.listSessions({ from: "2026-06-21", to: "2026-06-22", includeAutomated: true, includeChildren: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["beta-automated", "gamma-child"]);
        expect(store.listSessions({ activeSince: "2026-06-22T00:00:00Z", includeChildren: true, includeOrphans: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["delta-orphan", "gamma-child"]);
        expect(store.listSessions({ minMessages: 4, maxMessages: 9, limit: 10 }).sessions.map((session) => session.id)).toEqual(["alpha-root"]);
        expect(store.listSessions({ includeAutomated: true, includeOneShot: false, includeChildren: true, includeOrphans: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["alpha-root", "delta-orphan", "gamma-child"]);
        expect(store.listSessions({ automated: "automated", includeAutomated: true, limit: 10 }).sessions.map((session) => session.id)).toEqual(["beta-automated"]);
        expect(store.listSessions({ outcome: ["success"], includeChildren: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["alpha-root", "gamma-child"]);
        expect(store.listSessions({ healthGrade: ["D"], includeAutomated: true, limit: 10 }).sessions.map((session) => session.id)).toEqual(["beta-automated"]);
        expect(store.listSessions({ minToolFailures: 1, includeAutomated: true, includeChildren: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["beta-automated", "gamma-child"]);
        expect(store.listSessions({ hasSecret: true, limit: 10 }).sessions.map((session) => session.id)).toEqual(["alpha-root"]);
        expect(store.listSessions({ starred: true, limit: 10 }).sessions.map((session) => session.id)).toEqual(["alpha-root"]);
        expect(store.listSessions({ termination: "unclean", includeAutomated: true, includeChildren: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["beta-automated", "gamma-child"]);
        expect(store.listSessions({ termination: "clean", includeOrphans: true, limit: 10 }).sessions.map((session) => session.id).sort()).toEqual(["alpha-root", "delta-orphan"]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("paginates session list with signed keyset cursors", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-cursor-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "a-new", ended_at: "2026-06-24T10:00:00Z" }));
        store.upsertSession(sampleSession({ id: "b-same", ended_at: "2026-06-24T09:00:00Z" }));
        store.upsertSession(sampleSession({ id: "c-same", ended_at: "2026-06-24T09:00:00Z" }));
        store.upsertSession(sampleSession({ id: "d-old", ended_at: "2026-06-24T08:00:00Z" }));

        const first = store.listSessions({ limit: 2 });

        expect(first.sessions.map((session) => session.id)).toEqual(["a-new", "b-same"]);
        expect(first.next_cursor).toBeTruthy();
        expect(first.next_cursor).not.toBe("2");

        const second = store.listSessions({ cursor: first.next_cursor, limit: 2 });

        expect(second.sessions.map((session) => session.id)).toEqual(["c-same", "d-old"]);
        expect(second.total).toBe(4);
        expect(second.next_cursor).toBeUndefined();
        expect(() => store.listSessions({ cursor: `${first.next_cursor}x`, limit: 2 })).toThrow("invalid session archive list cursor");
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("searches globally with per-session best hit, name branch, and filters", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-search-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "message-hit", project: "alpha", agent: "codex", display_name: "Plain transcript", ended_at: "2026-06-24T11:00:00Z" }));
        store.replaceSessionMessages("message-hit", [
          sampleMessage({ session_id: "message-hit", ordinal: 0, content: "zebra appears later" }),
          sampleMessage({ id: 2, session_id: "message-hit", ordinal: 1, content: "zebra appears again" }),
        ]);
        store.upsertSession(sampleSession({ id: "name-hit", project: "alpha", agent: "hermes", display_name: "Zebra release title", first_message: "ordinary request", ended_at: "2026-06-24T10:00:00Z" }));
        store.replaceSessionMessages("name-hit", [sampleMessage({ session_id: "name-hit", content: "ordinary request" })]);
        store.upsertSession(sampleSession({ id: "first-message-hit", project: "beta", agent: "codex", first_message: "zebra first request", ended_at: "2026-06-24T09:00:00Z" }));
        store.replaceSessionMessages("first-message-hit", [sampleMessage({ session_id: "first-message-hit", content: "ordinary transcript" })]);
        store.upsertSession(sampleSession({ id: "system-prefix", project: "alpha", agent: "codex", first_message: "system only", ended_at: "2026-06-24T08:00:00Z" }));
        store.replaceSessionMessages("system-prefix", [sampleMessage({ session_id: "system-prefix", content: "<command-message> zebra hidden system prefix" })]);

        const response = store.search({ query: "zebra", limit: 10 });

        expect(response.results.map((result) => result.session_id)).toEqual(["message-hit", "name-hit", "first-message-hit"]);
        expect(response.results.find((result) => result.session_id === "message-hit")?.ordinal).toBe(0);
        expect(response.results.find((result) => result.session_id === "name-hit")).toMatchObject({ ordinal: -1, name: "Zebra release title" });
        expect(response.results.find((result) => result.session_id === "first-message-hit")).toMatchObject({ ordinal: -1 });
        expect(store.search({ query: "zebra", project: "alpha", limit: 10 }).results.map((result) => result.session_id)).toEqual(["message-hit", "name-hit"]);
        expect(store.search({ query: "zebra", agent: "hermes", limit: 10 }).results.map((result) => result.session_id)).toEqual(["name-hit"]);
        expect(store.search({ query: "zebra", sort: "recency", includeChildren: true, limit: 2 })).toMatchObject({ count: 2, next: 2 });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("searches within a session with substring ordinals and tool result matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-in-session-search-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "find-session" }));
        store.replaceSessionMessages("find-session", [
          sampleMessage({ session_id: "find-session", ordinal: 0, role: "user", content: "Alpha alpha message" }),
          sampleMessage({ id: 2, session_id: "find-session", ordinal: 1, role: "user", content: "<command-message> alpha hidden" }),
          sampleMessage({
            id: 3,
            session_id: "find-session",
            ordinal: 2,
            role: "assistant",
            content: "Tool completed",
            has_tool_use: true,
            tool_calls: [{
              tool_name: "Read",
              result_events: [{ source: "tool", status: "ok", content: "tool alpha result", content_length: 17, event_index: 0 }],
            }],
          }),
        ]);

        const result = store.searchSession({ sessionId: "find-session", query: "alpha" });

        expect(result.ordinals).toEqual([0, 2]);
        expect(result.matches?.map((match) => [match.ordinal, match.source, match.match_start])).toEqual([
          [0, "message", 0],
          [0, "message", 6],
          [2, "tool_result", 5],
        ]);
        expect(result.matches?.map((match) => match.snippet).join("\n")).not.toContain("<command-message>");
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("computes session parity endpoints from archived messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({
          total_output_tokens: 12,
          peak_context_tokens: 128,
          has_total_output_tokens: true,
          has_peak_context_tokens: true,
        }));
        store.upsertSession(sampleSession({
          id: "child-1",
          parent_session_id: "session-1",
          relationship_type: "subagent",
          started_at: "2026-06-23T01:01:10Z",
          ended_at: "2026-06-23T01:01:20Z",
        }));
        store.replaceSessionMessages("session-1", [
          sampleMessage({ id: 1, ordinal: 0, role: "user", content: "Search parent archive", timestamp: "2026-06-23T01:00:00Z" }),
          sampleMessage({
            id: 90,
            ordinal: 1,
            role: "system",
            content: "Token usage",
            timestamp: "2026-06-23T01:00:30Z",
            model: "gpt-5.5",
            token_usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 50 },
            context_tokens: 1000,
            output_tokens: 100,
            has_context_tokens: true,
            has_output_tokens: true,
            is_system: true,
            source_subtype: "token_count",
          }),
          sampleMessage({
            id: 2,
            ordinal: 2,
            role: "assistant",
            content: "Running Bash and child task",
            timestamp: "2026-06-23T01:01:00Z",
            has_tool_use: true,
            model: "gpt-test",
            output_tokens: 12,
            has_output_tokens: true,
            tool_calls: [
              { tool_name: "Bash", category: "Bash", tool_use_id: "tool-1", input_json: JSON.stringify({ command: "pnpm test" }) },
              {
                tool_name: "Task",
                category: "Task",
                tool_use_id: "tool-2",
                input_json: JSON.stringify({ description: "child" }),
                subagent_session_id: "child-1",
                result_events: [{
                  tool_use_id: "tool-2",
                  subagent_session_id: "child-1",
                  source: "tool_result",
                  status: "ok",
                  content: "child archive result",
                  content_length: "child archive result".length,
                  timestamp: "2026-06-23T01:01:05Z",
                  event_index: 0,
                }],
              },
            ],
          }),
          sampleMessage({ id: 3, ordinal: 3, role: "assistant", content: "Done", timestamp: "2026-06-23T01:02:00Z" }),
        ]);

        expect(store.listMessages("session-1", { direction: "desc", from: 3, limit: 3 }).messages.map((message) => message.ordinal)).toEqual([3, 2, 0]);
        expect(store.listMessages("session-1", { limit: 10 }).messages.some((message) => message.is_system)).toBe(false);
        const toolCalls = store.listToolCalls("session-1");
        expect(toolCalls.count).toBe(2);
        expect(toolCalls.tool_calls[0]).toMatchObject({ ordinal: 2, tool_name: "Bash" });
        expect(toolCalls.tool_calls[1]).toMatchObject({ ordinal: 2, tool_name: "Task", subagent_session_id: "child-1" });
        expect(store.listChildren("session-1").map((session) => session.id)).toEqual(["child-1"]);
        const activity = store.getActivity("session-1");
        expect(activity?.total_messages).toBe(4);
        expect(activity?.buckets[0]).toMatchObject({ user_count: 1 });
        const timing = store.getTiming("session-1");
        expect(timing).toMatchObject({
          session_id: "session-1",
          turn_count: 1,
          tool_call_count: 2,
          subagent_count: 1,
        });
        expect(timing?.slowest_call).toMatchObject({ tool_name: "Task", subagent_session_id: "child-1" });
        expect(store.getUsage("session-1")).toMatchObject({
          session_id: "session-1",
          has_token_data: true,
          cost_usd: 0.00802,
          has_cost: true,
          models: ["gpt-5.5", "gpt-test"],
          unpriced_models: ["gpt-test"],
        });
        expect(store.searchSession({ sessionId: "session-1", query: "child" }).ordinals).toEqual([2]);
        expect(store.searchContent({ pattern: "parent", mode: "substring" }).matches[0]).toMatchObject({ session_id: "session-1", ordinal: 0 });
        expect(store.searchContent({ pattern: "pnpm test", mode: "substring", sources: ["tool_input"] }).matches[0]).toMatchObject({ session_id: "session-1", ordinal: 2, source: "tool_input" });
        expect(store.searchContent({ pattern: "child archive result", mode: "substring", sources: ["tool_result"] }).matches[0]).toMatchObject({ session_id: "session-1", ordinal: 2, source: "tool_result" });
        expect(store.searchContent({ pattern: "child", mode: "regex", sources: ["tool_input", "tool_result"] }).matches.map((match) => match.source).sort()).toEqual(["tool_input", "tool_result"]);
        expect(store.searchContent({ pattern: "pnpm test", mode: "substring", sources: ["messages"] }).matches).toEqual([]);
        expect(store.searchContent({ pattern: "Token usage", mode: "substring", excludeSystem: true }).matches).toEqual([]);
        expect(store.exportSessionMarkdown("session-1")?.content).not.toContain("Token usage");
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("aggregates usage summary, comparison, and top sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "usage-a", project: "alpha", agent: "claude", first_message: "Alpha usage", started_at: "2024-06-01T09:00:00Z", ended_at: "2024-06-01T09:05:00Z" }));
        store.upsertSession(sampleSession({ id: "usage-b", project: "beta", agent: "codex", first_message: "Beta usage", started_at: "2024-06-02T09:00:00Z", ended_at: "2024-06-02T09:05:00Z" }));
        store.upsertSession(sampleSession({ id: "usage-prior", project: "alpha", agent: "claude", first_message: "Prior usage", started_at: "2024-05-31T09:00:00Z", ended_at: "2024-05-31T09:05:00Z" }));
        store.replaceSessionMessages("usage-a", [sampleMessage({
          id: 10,
          session_id: "usage-a",
          role: "assistant",
          timestamp: "2024-06-01T09:01:00Z",
          model: "model-a",
          token_usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, cost_usd: 0.5 },
        })]);
        store.replaceSessionMessages("usage-b", [sampleMessage({
          id: 11,
          session_id: "usage-b",
          role: "assistant",
          timestamp: "2024-06-02T09:01:00Z",
          model: "model-b",
          token_usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 40, cost_usd: 0.8 },
        })]);
        store.replaceSessionMessages("usage-prior", [sampleMessage({
          id: 12,
          session_id: "usage-prior",
          role: "assistant",
          timestamp: "2024-05-31T09:01:00Z",
          model: "model-a",
          token_usage: { input_tokens: 50, output_tokens: 25, cost_usd: 0.25 },
        })]);

        const summary = store.getUsageSummary({ from: "2024-06-01", to: "2024-06-02", includeOneShot: true, includeAutomated: false });
        expect(summary.totals).toMatchObject({ inputTokens: 300, outputTokens: 130, cacheCreationTokens: 10, cacheReadTokens: 60, totalCost: 1.3 });
        expect(summary.daily.map((entry) => entry.date)).toEqual(["2024-06-01", "2024-06-02"]);
        expect(summary.projectTotals.map((entry) => entry.project)).toEqual(["beta", "alpha"]);
        expect(summary.modelTotals.map((entry) => entry.model)).toEqual(["model-b", "model-a"]);
        expect(summary.agentTotals.map((entry) => entry.agent)).toEqual(["codex", "claude"]);
        expect(summary.sessionCounts).toMatchObject({ total: 2, byProject: { alpha: 1, beta: 1 }, byAgent: { claude: 1, codex: 1 } });
        expect(summary.cacheStats.hitRate).toBeCloseTo(60 / 360);

        expect(store.getUsageComparison({ from: "2024-06-01", to: "2024-06-01", includeOneShot: true, includeAutomated: false, currentCost: 0.5 })).toMatchObject({
          priorFrom: "2024-05-31",
          priorTo: "2024-05-31",
          priorTotalCost: 0.25,
          deltaPct: 1,
        });
        expect(store.getTopUsageSessions({ from: "2024-06-01", to: "2024-06-02", includeOneShot: true, includeAutomated: false, limit: 1 })).toEqual([
          { sessionId: "usage-b", displayName: "Beta usage", agent: "codex", project: "beta", startedAt: "2024-06-02T09:00:00Z", totalTokens: 320, cost: 0.8 },
        ]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prices token-only usage with local fallback model rates", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "priced-a", project: "alpha", agent: "codex", first_message: "Priced usage", started_at: "2024-06-01T09:00:00Z", ended_at: "2024-06-01T09:05:00Z" }));
        store.replaceSessionMessages("priced-a", [sampleMessage({
          id: 40,
          session_id: "priced-a",
          ordinal: 0,
          role: "system",
          content: "Token usage",
          timestamp: "2024-06-01T09:01:00Z",
          model: "openai/gpt-5.5",
          token_usage: { input_tokens: 1000, output_tokens: 100, reasoning_output_tokens: 20, cache_read_input_tokens: 500 },
          context_tokens: 1000,
          output_tokens: 100,
          has_context_tokens: true,
          has_output_tokens: true,
          is_system: true,
          source_subtype: "token_count",
        })]);

        expect(store.listMessages("priced-a").messages).toEqual([]);
        expect(store.getUsage("priced-a")).toMatchObject({ cost_usd: 0.00885, has_cost: true, models: ["openai/gpt-5.5"], unpriced_models: [] });
        const summary = store.getUsageSummary({ from: "2024-06-01", to: "2024-06-01", includeOneShot: true, includeAutomated: false });
        expect(summary.totals).toMatchObject({ inputTokens: 1000, outputTokens: 120, cacheReadTokens: 500, totalCost: 0.00885 });
        expect(store.getTopUsageSessions({ from: "2024-06-01", to: "2024-06-01", includeOneShot: true, includeAutomated: false, limit: 1 })).toEqual([
          { sessionId: "priced-a", displayName: "Priced usage", agent: "codex", project: "alpha", startedAt: "2024-06-01T09:00:00Z", totalTokens: 1620, cost: 0.00885 },
        ]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("imports uploaded Codex JSONL token count events into usage without transcript pollution", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        const content = [
          JSON.stringify({ type: "session_meta", timestamp: "2026-06-23T01:00:00Z", payload: { id: "upload-codex-usage", cwd: "/Users/alice/studio" } }),
          JSON.stringify({ type: "turn_context", timestamp: "2026-06-23T01:00:00Z", payload: { model: "gpt-5.5" } }),
          JSON.stringify({ type: "response_item", timestamp: "2026-06-23T01:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "Uploaded usage" }] } }),
          JSON.stringify({ type: "event_msg", timestamp: "2026-06-23T01:00:02Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 20 } } } }),
          JSON.stringify({ type: "response_item", timestamp: "2026-06-23T01:00:05Z", payload: { role: "assistant", content: [{ type: "output_text", text: "Uploaded response" }] } }),
        ].join("\n");

        expect(store.importUploadedExport({ filename: "upload-codex.jsonl", agent: "codex", project: "studio-upload", content })).toMatchObject({ imported: 1, errors: 0 });

        expect(store.getSession("codex:upload-codex-usage")).toMatchObject({ message_count: 2, total_output_tokens: 100, peak_context_tokens: 1000 });
        expect(store.listMessages("codex:upload-codex-usage").messages.map((message) => message.content)).toEqual(["Uploaded usage", "Uploaded response"]);
        expect(store.getUsage("codex:upload-codex-usage")).toMatchObject({ cost_usd: 0.00885, has_cost: true, models: ["gpt-5.5"] });
        expect(store.exportSessionMarkdown("codex:upload-codex-usage")?.content).not.toContain("Token usage");
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("aggregates analytics parity responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-analytics-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({
          id: "analytics-a",
          project: "alpha",
          agent: "claude",
          first_message: "Alpha analytics",
          started_at: "2024-06-01T09:00:00Z",
          ended_at: "2024-06-01T09:10:00Z",
          total_output_tokens: 120,
          has_total_output_tokens: true,
          health_score: 0.92,
          health_grade: "A",
          outcome: "success",
          outcome_confidence: "high",
          quality_signals: { version: 1, short_prompt_count: 0, unstructured_start: false, missing_success_criteria_count: 0, missing_verification_count: 0, duplicate_prompt_count: 0, no_code_context_count: 0, runaway_tool_loop_count: 0 },
        }));
        store.upsertSession(sampleSession({
          id: "analytics-b",
          project: "beta",
          agent: "codex",
          first_message: "Beta analytics",
          started_at: "2024-06-02T10:00:00Z",
          ended_at: "2024-06-02T10:20:00Z",
          health_score: 0.42,
          health_grade: "D",
          outcome: "failed",
          outcome_confidence: "medium",
          tool_failure_signal_count: 2,
          tool_retry_count: 1,
          compaction_count: 1,
          context_pressure_max: 0.8,
          quality_signals: { version: 1, short_prompt_count: 1, unstructured_start: true, missing_success_criteria_count: 1, missing_verification_count: 1, duplicate_prompt_count: 0, no_code_context_count: 1, runaway_tool_loop_count: 0 },
        }));
        store.replaceSessionMessages("analytics-a", [
          sampleMessage({ id: 30, session_id: "analytics-a", ordinal: 0, role: "user", content: "Alpha", timestamp: "2024-06-01T09:00:00Z" }),
          sampleMessage({ id: 31, session_id: "analytics-a", ordinal: 1, role: "assistant", content: "Alpha done", timestamp: "2024-06-01T09:01:00Z", has_tool_use: true, tool_calls: [{ tool_name: "Read", category: "File", skill_name: "reader" }] }),
        ]);
        store.replaceSessionMessages("analytics-b", [
          sampleMessage({ id: 32, session_id: "analytics-b", ordinal: 0, role: "user", content: "Beta", timestamp: "2024-06-02T10:00:00Z" }),
          sampleMessage({ id: 33, session_id: "analytics-b", ordinal: 1, role: "assistant", content: "Beta thinking", timestamp: "2024-06-02T10:01:00Z", has_thinking: true, has_tool_use: true, tool_calls: [{ tool_name: "Bash", category: "Shell" }] }),
          sampleMessage({ id: 34, session_id: "analytics-b", ordinal: 2, role: "assistant", content: "Beta done", timestamp: "2024-06-02T10:02:00Z" }),
        ]);

        expect(store.getAnalyticsSummary()).toMatchObject({ total_sessions: 2, total_messages: 5, active_projects: 2, agents: { claude: { sessions: 1 }, codex: { sessions: 1 } } });
        expect(store.getAnalyticsActivity().series.map((entry) => entry.date)).toEqual(["2024-06-01", "2024-06-02"]);
        expect(store.getAnalyticsHeatmap("messages").entries.map((entry) => entry.value)).toEqual([2, 3]);
        expect(store.getAnalyticsProjects().projects.map((project) => project.name)).toEqual(["alpha", "beta"]);
        expect(store.getAnalyticsHourOfWeek().cells).toHaveLength(168);
        expect(store.getAnalyticsSessionShape().count).toBe(2);
        expect(store.getAnalyticsVelocity().by_agent.map((entry) => entry.label).sort()).toEqual(["claude", "codex"]);
        expect(store.getAnalyticsTools()).toMatchObject({ total_calls: 2, by_category: [{ category: "File" }, { category: "Shell" }] });
        expect(store.getAnalyticsSkills()).toMatchObject({ total_skill_calls: 1, distinct_skills: 1, by_skill: [{ skill_name: "reader" }] });
        expect(store.getAnalyticsTopSessions("messages", 1).sessions[0]).toMatchObject({ id: "analytics-b", message_count: 3 });
        expect(store.getAnalyticsSignals()).toMatchObject({ scored_sessions: 2, grade_distribution: { A: 1, D: 1 }, outcome_distribution: { success: 1, failed: 1 } });
        expect(store.getAnalyticsSignalSessions("tool_failure", 5).sessions[0]).toMatchObject({ id: "analytics-b" });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("manages stars pins trash resume and exports with fixture data", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-management-"));
    try {
      const sessionFile = join(root, "repo", "sessions", "session-1.jsonl");
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ file_path: sessionFile, project: join(root, "repo") }));
        store.replaceSessionMessages("session-1", [
          sampleMessage({ id: 1, ordinal: 0, role: "user", content: "Export this archive" }),
          sampleMessage({ id: 2, ordinal: 1, role: "assistant", content: "Archive exported." }),
        ]);

        expect(store.starSession("session-1")).toBe(true);
        expect(store.listStarredSessions()).toEqual(["session-1"]);
        store.unstarSession("session-1");
        expect(store.listStarredSessions()).toEqual([]);
        store.bulkStarSessions(["session-1", "missing"]);
        expect(store.listStarredSessions()).toEqual(["session-1"]);

        expect(store.pinMessage("session-1", 1, { note: "important" })).toMatchObject({ id: 1 });
        expect(store.listSessionPins("session-1").pins[0]).toMatchObject({ session_id: "session-1", message_id: 1, note: "important" });
        expect(store.listPins().pins).toHaveLength(1);
        store.unpinMessage("session-1", 1);
        expect(store.listPins().pins).toHaveLength(0);

        expect(store.renameSession("session-1", { name: "Renamed archive" })?.display_name).toBe("Renamed archive");
        expect(store.getSessionDirectory("session-1")?.directory).toBe(join(root, "repo", "sessions"));
        expect(store.openSessionDirectory("session-1")).toMatchObject({ launched: false, directory: join(root, "repo", "sessions") });
        expect(store.resumeSession("session-1", { command_only: true })?.command).toContain("codex resume session-1");
        expect(store.exportSessionHtml("session-1")?.content).toContain("Archive exported.");
        expect(store.exportSessionMarkdown("session-1")?.content).toContain("## assistant");
        expect(store.publishSession("session-1")).toMatchObject({ ok: false, requires_remote: true });

        expect(store.trashSession("session-1")).toBe(true);
        expect(store.getSession("session-1")).toBeNull();
        expect(store.listTrash().sessions.map((session) => session.id)).toEqual(["session-1"]);
        expect(store.restoreSession("session-1")).toBe(true);
        expect(store.getSession("session-1")?.id).toBe("session-1");
        expect(store.trashSession("session-1")).toBe(true);
        expect(store.emptyTrash()).toBe(1);
        expect(store.getSession("session-1")).toBeNull();
        expect(store.isSessionExcluded("session-1")).toBe(true);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("imports archives and persists redacted config in runtime-state db", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-config-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        expect(store.importUploadedExport({
          filename: "manual.jsonl",
          agent: "codex",
          project: "manual-project",
          content: JSON.stringify({ session_id: "manual-1", role: "user", content: "Imported manual session" }),
        })).toMatchObject({ imported: 1, errors: 0 });
        expect(store.getSession("manual-1")).toMatchObject({ agent: "codex", project: "manual-project" });

        const claudeContent = JSON.stringify([{ uuid: "claude-a", name: "Claude A", messages: [{ role: "user", content: "hello claude" }] }]);
        expect(store.importClaudeAiExport({ filename: "conversations.json", content: claudeContent })).toMatchObject({ imported: 1, errors: 0 });
        expect(store.getSession("claude-ai:claude-a")?.agent).toBe("claude-ai");

        const snapshot = store.updateConfig({
          github_token: "ghp_secret_token_value",
          terminal: { mode: "custom", custom_bin: "iTerm", custom_args: "-- {cmd}" },
          agent_dirs: [{ agent: "codex", dirs: [join(root, "codex-sessions")] }],
          remote: { public_url: "https://viewer.example.test", public_origins: ["https://viewer.example.test"], require_auth: true, auth_token_configured: true },
        });
        expect(snapshot.github).toMatchObject({ configured: true, token_preview: "ghp_...alue" });
        expect(snapshot.terminal).toMatchObject({ mode: "custom", custom_bin: "iTerm" });
        expect(snapshot.remote).toMatchObject({ public_url: "https://viewer.example.test", require_auth: true, auth_configured: true });
        expect(snapshot.agent_dirs.find((item) => item.agent === "codex")?.dirs).toEqual([join(root, "codex-sessions")]);

        const mapping = store.upsertWorktreeMapping({ path_prefix: join(root, "repo", "worktree"), project: "mapped", enabled: true, machine: "local" });
        store.upsertSession(sampleSession({ id: "mapped-session", project: join(root, "repo", "worktree", "feature"), machine: "local" }));
        expect(store.applyWorktreeMappings()).toMatchObject({ updated: 1, mappings: [mapping] });
        expect(store.getSession("mapped-session")?.project).toBe("mapped");
        expect(store.deleteWorktreeMapping(mapping.id)).toBe(true);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("scans secret findings and returns only redacted matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-secrets-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        const rawAws = ["AKIA", "7QHWN2DKR4FYPLJM"].join("");
        const rawOpenAi = ["sk", "proj", "abcdefghijklmnopqrstuvwxyzABCDE123456789"].join("-");
        store.upsertSession(sampleSession({ id: "secret-session", project: "security", agent: "codex", display_name: "Secret scan" }));
        store.replaceSessionMessages("secret-session", [
          sampleMessage({ id: 80, session_id: "secret-session", ordinal: 0, role: "user", content: `check ${rawAws}` }),
          sampleMessage({
            id: 81,
            session_id: "secret-session",
            ordinal: 1,
            role: "assistant",
            content: "tool inspected",
            has_tool_use: true,
            tool_calls: [{ tool_name: "Bash", category: "Bash", input_json: JSON.stringify({ token: rawOpenAi }) }],
          }),
        ]);

        const summary = store.scanSecrets();
        expect(summary).toMatchObject({ scanned: 1, with_secrets: 1, total_findings: 2, definite_findings: 2, rules_version: "studio-secret-rules-v1" });
        expect(store.getSession("secret-session")).toMatchObject({ secret_leak_count: 2, secrets_rules_version: "studio-secret-rules-v1" });
        expect(store.listSessions({ hasSecret: true, limit: 10 }).sessions.map((session) => session.id)).toEqual(["secret-session"]);
        const findings = store.listSecretFindings({ confidence: "all", limit: 10 }).findings;
        expect(findings).toHaveLength(2);
        expect(findings.map((finding) => finding.redacted_match).join("\n")).not.toContain(rawAws);
        expect(findings.map((finding) => finding.redacted_match).join("\n")).not.toContain(rawOpenAi);
        expect(findings.map((finding) => finding.location_kind).sort()).toEqual(["message", "tool_input"]);
        expect(findings.every((finding) => finding.rules_version === "studio-secret-rules-v1")).toBe(true);
        expect(findings.map((finding) => finding.match_index)).toEqual([0, 0]);
        expect(store.listSecretFindings().findings.every((finding) => finding.confidence === "definite")).toBe(true);

        store.replaceSessionMessages("secret-session", [
          sampleMessage({ id: 82, session_id: "secret-session", ordinal: 0, role: "user", content: "nothing sensitive" }),
        ]);
        expect(store.getSession("secret-session")).toMatchObject({ secret_leak_count: 0, secrets_rules_version: "" });
        expect(store.listSecretFindings({ confidence: "all", limit: 10 }).findings).toEqual([]);
        expect(store.listSessions({ hasSecret: true, limit: 10 }).sessions).toEqual([]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("filters secret sessions by current rules version", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-secret-rollup-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "current-secret", secret_leak_count: 1, secrets_rules_version: "studio-secret-rules-v1" }));
        store.upsertSession(sampleSession({ id: "stale-secret", secret_leak_count: 1, secrets_rules_version: "legacy-rules" }));
        store.upsertSession(sampleSession({ id: "clean-secret", secret_leak_count: 0, secrets_rules_version: "studio-secret-rules-v1" }));

        expect(store.listSessions({ hasSecret: true, limit: 10 }).sessions.map((session) => session.id)).toEqual(["current-secret"]);
        expect(store.getSession("stale-secret")).toMatchObject({ secret_leak_count: 1, secrets_rules_version: "legacy-rules" });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves activity, trends, and deterministic insights", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-insights-"));
    try {
      const store = await openSessionArchiveStore({ dbPath: join(root, "archive.sqlite") });
      try {
        store.upsertSession(sampleSession({ id: "p27-a", project: "alpha", agent: "claude", first_message: "Alpha seam", started_at: "2024-06-01T09:00:00Z", ended_at: "2024-06-01T09:10:00Z", total_output_tokens: 42, has_total_output_tokens: true }));
        store.upsertSession(sampleSession({ id: "p27-b", project: "beta", agent: "codex", first_message: "Beta seam", started_at: "2024-06-02T09:00:00Z", ended_at: "2024-06-02T09:30:00Z", is_automated: true }));
        store.replaceSessionMessages("p27-a", [
          sampleMessage({ id: 40, session_id: "p27-a", ordinal: 0, role: "user", content: "Review seam reliability", timestamp: "2024-06-01T09:00:00Z" }),
          sampleMessage({ id: 41, session_id: "p27-a", ordinal: 1, role: "assistant", content: "Seam reliability looks better", timestamp: "2024-06-01T09:01:00Z", token_usage: { cost_usd: 0.2 } }),
        ]);
        store.replaceSessionMessages("p27-b", [
          sampleMessage({ id: 42, session_id: "p27-b", ordinal: 0, role: "user", content: "Automated seam check", timestamp: "2024-06-02T09:00:00Z" }),
        ]);

        const activity = store.getActivityReport({ preset: "custom", from: "2024-06-01T00:00:00Z", to: "2024-06-03T00:00:00Z", bucket: "1d" });
        expect(activity.totals).toMatchObject({ sessions: 2, interactive_sessions: 1, automated_sessions: 1, output_tokens: 42 });
        expect(activity.by_session.map((row) => row.session_id).sort()).toEqual(["p27-a", "p27-b"]);

        const trends = store.getTrendsTerms({ from: "2024-06-01", to: "2024-06-02", includeOneShot: true, includeAutomated: true, terms: ["seam"], granularity: "day" });
        expect(trends.message_count).toBe(3);
        expect(trends.series[0]).toMatchObject({ term: "seam", total: 3 });

        expect(store.listInsights().insights).toEqual([]);
        const generated = store.generateInsight({ type: "daily_activity", date_from: "2024-06-01", date_to: "2024-06-02", prompt: "Summarize" });
        expect(generated).toMatchObject({ type: "daily_activity", date_from: "2024-06-01", date_to: "2024-06-02" });
        expect(generated.content).toContain("Sessions: 2");
        expect(store.getInsight(generated.id)?.id).toBe(generated.id);
        expect(store.listInsights({ type: "daily_activity" }).insights).toHaveLength(1);
        expect(store.deleteInsight(generated.id)).toBe(true);
        expect(store.getInsight(generated.id)).toBeNull();
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
