import { describe, expect, test } from "bun:test";
import type { SessionArchiveSession } from "@onmyagent/types/session-archive";
import { applyAutomationOwnershipToArchiveSession } from "../src/services/session-archive-sync.js";

function sample(overrides: Partial<SessionArchiveSession> = {}): SessionArchiveSession {
  return {
    id: "ses_1",
    project: "p",
    machine: "local",
    agent: "opencode",
    first_message: null,
    started_at: null,
    ended_at: null,
    message_count: 0,
    user_message_count: 0,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    is_automated: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("applyAutomationOwnershipToArchiveSession", () => {
  test("marks sessions listed in automation ownership set", () => {
    const next = applyAutomationOwnershipToArchiveSession(
      sample(),
      new Set(["ses_1"]),
      null,
    );
    expect(next.is_automated).toBe(true);
  });

  test("matches source_session_id when present", () => {
    const next = applyAutomationOwnershipToArchiveSession(
      sample({ id: "archive-row", source_session_id: "ses_oc" }),
      new Set(["ses_oc"]),
      null,
    );
    expect(next.is_automated).toBe(true);
  });

  test("preserves prior is_automated even when ownership set is empty", () => {
    const next = applyAutomationOwnershipToArchiveSession(
      sample(),
      new Set(),
      sample({ is_automated: true }),
    );
    expect(next.is_automated).toBe(true);
  });

  test("leaves interactive sessions unmarked", () => {
    const next = applyAutomationOwnershipToArchiveSession(
      sample({ id: "ses_chat" }),
      new Set(["ses_other"]),
      null,
    );
    expect(next.is_automated).toBe(false);
  });
});
