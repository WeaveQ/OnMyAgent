import { describe, expect, test } from "bun:test";
import { listSelectableAssistantSpaceDirectories } from "../src/react-app/domains/session/sidebar/known-assistant-spaces";

describe("listSelectableAssistantSpaceDirectories", () => {
  test("lists session-bound spaces only, drops automation dirs", () => {
    const out = listSelectableAssistantSpaceDirectories({
      sessionBindings: [
        { sessionId: "s1", directory: "/ws/未命0723" },
        { sessionId: "auto-s", directory: "/ws/自动化任务-2026" },
        { sessionId: "s2", directory: "/ws/e4fae6588c5f" },
      ],
      automationRecords: [
        {
          sessionId: "auto-s",
          outputDirectory: "/ws/自动化任务-2026",
        },
      ],
    });

    expect(out).toEqual(["/ws/未命0723", "/ws/e4fae6588c5f"]);
  });

  test("does not invent spaces from empty bindings", () => {
    const out = listSelectableAssistantSpaceDirectories({
      sessionBindings: [],
      automationRecords: [],
    });
    expect(out).toEqual([]);
  });
});
