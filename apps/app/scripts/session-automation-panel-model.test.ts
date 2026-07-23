import { describe, expect, test } from "bun:test";

import { automationsForSourceSession } from "../src/react-app/domains/session/artifacts/session-automation-panel-model";

describe("automationsForSourceSession", () => {
  test("returns only tasks created by the current conversation", () => {
    const base = {
      scene: "office" as const,
      prompt: "run",
      schedule: { mode: "interval" as const, day: "daily" as const, time: "09:00" },
      effectiveRange: {},
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      nextRunAt: null,
      running: null,
      lastRun: null,
      runs: [],
    };
    const result = automationsForSourceSession(
      [
        { ...base, id: "a", title: "Current A", sourceSessionId: "ses_current" },
        { ...base, id: "legacy", title: "Legacy" },
        { ...base, id: "other", title: "Other", sourceSessionId: "ses_other" },
        { ...base, id: "b", title: "Current B", sourceSessionId: "ses_current" },
      ],
      " ses_current ",
    );

    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
    expect(automationsForSourceSession(result, "")).toEqual([]);
  });
});
