/**
 * Drives createSessionArchiveAnalyticsApi / store analytics through the real
 * SQLite path — proves TTL expiry resets sessions AND messages together.
 */
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionArchiveMessage, SessionArchiveSession } from "@onmyagent/types/session-archive";
import { ANALYTICS_CACHE_TTL_MS } from "../src/services/analytics-cache-policy.js";
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
  const content = input.content ?? "hello";
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

afterEach(() => {
  setSystemTime(); // reset to real time
});

describe("session-archive analytics cache TTL (shipped store path)", () => {
  test("after TTL + DB change, sessions and messages both refresh (no partial-stale)", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-analytics-ttl-"));
    const dbPath = join(root, "archive.sqlite");
    try {
      const t0 = new Date("2026-07-01T12:00:00.000Z");
      setSystemTime(t0);

      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ id: "s-old", first_message: "old session", message_count: 1 }));
        store.replaceSessionMessages("s-old", [
          sampleMessage({ id: 1, session_id: "s-old", content: "old message body" }),
        ]);

        // Fill cache: summary reads sessions; tools/batch paths also pull messages.
        const summaryBefore = store.getAnalyticsSummary();
        expect(summaryBefore.total_sessions).toBe(1);
        const batchBefore = store.getAnalyticsBatch();
        expect(batchBefore.summary.total_sessions).toBe(1);
        expect(batchBefore.summary.total_messages).toBeGreaterThanOrEqual(1);

        // Mutate DB while still within TTL — cached reads may still be old.
        store.upsertSession(
          sampleSession({
            id: "s-new",
            first_message: "new session",
            message_count: 1,
            project: "other",
          }),
        );
        store.replaceSessionMessages("s-new", [
          sampleMessage({ id: 2, session_id: "s-new", content: "brand new message" }),
        ]);

        // Expire TTL so ensureFresh must reset the whole cache.
        setSystemTime(new Date(t0.getTime() + ANALYTICS_CACHE_TTL_MS + 5_000));

        const summaryAfter = store.getAnalyticsSummary();
        const batchAfter = store.getAnalyticsBatch();

        // Sessions and messages must both reflect the DB after full reset.
        expect(summaryAfter.total_sessions).toBe(2);
        expect(batchAfter.summary.total_sessions).toBe(2);
        expect(batchAfter.summary.total_messages).toBeGreaterThanOrEqual(2);
        // Pre-fix bug: sessions could refresh while messages stayed at 1.
        expect(batchAfter.summary.total_messages).toBeGreaterThan(
          batchBefore.summary.total_messages,
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
