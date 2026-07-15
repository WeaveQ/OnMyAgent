import { describe, expect, test } from "bun:test";

import {
  normalizeSessionTranscriptNotices,
} from "../src/app/lib/session-transcript-notices";

describe("session transcript notice persistence", () => {
  test("migrates repeated legacy terminal notices to the latest one", () => {
    const normalized = normalizeSessionTranscriptNotices({
      ses_1: [
        {
          id: "cancelled-1",
          kind: "cancelled",
          afterMessageCount: 4,
          runStartedAt: 100,
        },
        {
          id: "stalled-1",
          kind: "stalled",
          afterMessageCount: 4,
        },
        {
          id: "cancelled-2",
          kind: "cancelled",
          afterMessageCount: 5,
          runStartedAt: 200,
        },
      ],
    });

    expect(normalized.ses_1?.map((notice) => notice.id)).toEqual([
      "stalled-1",
      "cancelled-2",
    ]);
    expect(normalized.ses_1?.[1]?.runKey).toBe("legacy:ses_1");
  });

  test("preserves separate v2 terminal notices with stable run keys", () => {
    const normalized = normalizeSessionTranscriptNotices({
      ses_1: [
        {
          id: "cancelled-1",
          kind: "cancelled",
          afterMessageCount: 4,
          runKey: "ses_1:100",
          runStartedAt: 100,
        },
        {
          id: "stopped-2",
          kind: "stopped",
          afterMessageCount: 8,
          runKey: "ses_1:200",
          runStartedAt: 200,
          elapsedMs: 5_000,
        },
      ],
    });

    expect(normalized.ses_1?.map((notice) => notice.runKey)).toEqual([
      "ses_1:100",
      "ses_1:200",
    ]);
  });

  test("drops malformed sessions and notices", () => {
    expect(
      normalizeSessionTranscriptNotices({
        "": [{ id: "empty-session", kind: "cancelled", afterMessageCount: 0 }],
        ses_1: [
          null,
          { id: "bad-kind", kind: "unknown", afterMessageCount: 0 },
          { id: "bad-count", kind: "cancelled", afterMessageCount: -1 },
        ],
      }),
    ).toEqual({});
  });
});
