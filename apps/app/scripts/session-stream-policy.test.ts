import { describe, expect, test } from "bun:test";

import {
  selectFullStreamSessionIds,
  selectStatusOnlySessionIds,
} from "../src/react-app/domains/session/sync/stream-session-policy";

describe("stream-session-policy (shipped)", () => {
  test("focused session is the only full-stream id", () => {
    expect(
      selectFullStreamSessionIds({
        focusedSessionId: "ses_focus",
        candidateSessionIds: ["ses_focus", "ses_bg_a", "ses_bg_b", null, ""],
      }),
    ).toEqual(["ses_focus"]);
  });

  test("without focus falls back to first candidate", () => {
    expect(
      selectFullStreamSessionIds({
        focusedSessionId: null,
        candidateSessionIds: [null, "  ", "ses_a", "ses_b"],
      }),
    ).toEqual(["ses_a"]);
  });

  test("status-only ids exclude the full-stream focus", () => {
    expect(
      selectStatusOnlySessionIds({
        focusedSessionId: "ses_focus",
        candidateSessionIds: ["ses_focus", "ses_bg", "ses_bg", "ses_other"],
      }),
    ).toEqual(["ses_bg", "ses_other"]);
  });

  test("empty candidates yield empty full-stream list", () => {
    expect(
      selectFullStreamSessionIds({
        focusedSessionId: "  ",
        candidateSessionIds: [null, undefined, ""],
      }),
    ).toEqual([]);
  });
});
