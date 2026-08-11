import { afterEach, describe, expect, test } from "bun:test";

import {
  EXPERT_LIFECYCLE_EVENT_CAPACITY,
  EXPERT_LIFECYCLE_EVENT_SCHEMA,
  EXPERT_LIFECYCLE_EVENT_VERSION,
  ExpertLifecycleEventRing,
  exportExpertLifecycleEvents,
  getExpertLifecycleEventsSnapshot,
  recordExpertLifecycleEvent,
  resetExpertLifecycleEventsForTest,
  sanitizeExpertLifecycleEvent,
} from "../src/services/expert-lifecycle-events.js";

describe("Expert lifecycle event ring", () => {
  afterEach(() => {
    resetExpertLifecycleEventsForTest();
  });

  test("uses a versioned schema and strips paths, payloads, and secret-like values", () => {
    const ring = new ExpertLifecycleEventRing({ now: () => 1_700_000_000_000 });
    const event = ring.record({
      kind: "directory_fetch",
      source: "workspace",
      outcome: "failed",
      phase: "fetch",
      workspaceId: "/Users/alice/private-workspace",
      expertId: "package:expert",
      sessionId: "session-123",
      code: "directory_fetch_failed",
      failureCount: 2,
      prompt: "do not export this prompt",
      body: { message: "private body" },
      token: "sk_live_secret_123456789",
      secret: "Bearer abcdefghijklmnop",
      path: "/Users/alice/private-workspace/secret.txt",
      content: "private file content",
    } as never);

    expect(event).toMatchObject({
      sequence: 1,
      timestamp: 1_700_000_000_000,
      kind: "directory_fetch",
      source: "workspace",
      outcome: "failed",
      phase: "fetch",
      code: "directory_fetch_failed",
      failureCount: 2,
    });
    expect(event.workspaceHash).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(event.expertHash).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(event.sessionHash).toMatch(/^sha256:[a-f0-9]{16}$/);

    const serialized = JSON.stringify(event);
    for (const forbidden of [
      "/Users/alice",
      "private-workspace",
      "do not export",
      "private body",
      "sk_live_secret",
      "Bearer abcdefghijklmnop",
      "secret.txt",
      "private file content",
      "prompt",
      "body",
      "token",
      "secret",
      "path",
      "content",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("keeps only the newest 512 events and exports deterministically", () => {
    const ring = new ExpertLifecycleEventRing({ now: () => 42 });
    for (let index = 0; index < EXPERT_LIFECYCLE_EVENT_CAPACITY + 1; index += 1) {
      ring.record({
        kind: "shadow_diff",
        change: index % 2 === 0 ? "added" : "changed",
        count: index,
      });
    }

    const snapshot = ring.snapshot();
    expect(snapshot).toMatchObject({
      schema: EXPERT_LIFECYCLE_EVENT_SCHEMA,
      version: EXPERT_LIFECYCLE_EVENT_VERSION,
      capacity: EXPERT_LIFECYCLE_EVENT_CAPACITY,
      nextSequence: EXPERT_LIFECYCLE_EVENT_CAPACITY + 2,
    });
    expect(snapshot.events).toHaveLength(EXPERT_LIFECYCLE_EVENT_CAPACITY);
    expect(snapshot.events[0]?.sequence).toBe(2);
    expect(snapshot.events.at(-1)?.sequence).toBe(EXPERT_LIFECYCLE_EVENT_CAPACITY + 1);
    expect(ring.export()).toBe(ring.export());
    expect(JSON.parse(ring.export())).toEqual(snapshot);

    snapshot.events.pop();
    expect(ring.size).toBe(EXPERT_LIFECYCLE_EVENT_CAPACITY);
    expect(ring.snapshot().events).toHaveLength(EXPERT_LIFECYCLE_EVENT_CAPACITY);
  });

  test("accepts every lifecycle kind with only its typed fields", () => {
    const ring = new ExpertLifecycleEventRing({ now: () => 100 });
    const events = [
      ring.record({ kind: "directory_fetch", source: "cache" }),
      ring.record({ kind: "shadow_diff", change: "unchanged", changedFieldCount: 0 }),
      ring.record({ kind: "heal", action: "upgrade_marker" }),
      ring.record({ kind: "materialize", declaredSkillCount: 2, installedSkillCount: 1, missingSkillCount: 1 }),
      ring.record({ kind: "contract_assertion", assertion: "skills" }),
      ring.record({ kind: "delete", step: "tombstone" }),
      ring.record({ kind: "missing_skills", declaredSkillCount: 2, missingSkillCount: 1 }),
    ];

    expect(events.map((event) => event.kind)).toEqual([
      "directory_fetch",
      "shadow_diff",
      "heal",
      "materialize",
      "contract_assertion",
      "delete",
      "missing_skills",
    ]);
    expect(events[1]).toMatchObject({ change: "unchanged", changedFieldCount: 0 });
    expect(events[3]).toMatchObject({ declaredSkillCount: 2, installedSkillCount: 1, missingSkillCount: 1 });
    expect(events[4]).toMatchObject({ assertion: "skills" });
  });

  test("sanitizer rejects unknown kinds and normalizes unsafe codes", () => {
    expect(sanitizeExpertLifecycleEvent({ kind: "not-a-kind", token: "sk_live_123456789" })).toBeNull();
    const sanitized = sanitizeExpertLifecycleEvent({
      kind: "delete",
      code: "Bearer sk_live_123456789",
      path: "/home/alice/private.txt",
    }, { sequence: 9, timestamp: 10 });
    expect(sanitized).toMatchObject({ sequence: 9, timestamp: 10, kind: "delete", code: "redacted" });
    expect(JSON.stringify(sanitized)).not.toContain("sk_live_123456789");
    expect(JSON.stringify(sanitized)).not.toContain("/home/alice");
  });

  test("global test reset helper provides an isolated deterministic snapshot", () => {
    resetExpertLifecycleEventsForTest();
    recordExpertLifecycleEvent({ kind: "materialize", missingSkillCount: 1, timestamp: 123 });
    expect(getExpertLifecycleEventsSnapshot().events).toHaveLength(1);
    expect(getExpertLifecycleEventsSnapshot().events[0]?.sequence).toBe(1);
    resetExpertLifecycleEventsForTest();
    expect(getExpertLifecycleEventsSnapshot()).toEqual({
      schema: EXPERT_LIFECYCLE_EVENT_SCHEMA,
      version: EXPERT_LIFECYCLE_EVENT_VERSION,
      capacity: EXPERT_LIFECYCLE_EVENT_CAPACITY,
      nextSequence: 1,
      events: [],
    });
    expect(JSON.parse(exportExpertLifecycleEvents())).toEqual(getExpertLifecycleEventsSnapshot());
  });
});
