import { describe, expect, test } from "bun:test";
import { isIsolatedExpertSessionDirectory } from "../src/react-app/capabilities/session-identity/expert-session-directory";
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

  test("drops expert auto-isolation timestamp directories", () => {
    const out = listSelectableAssistantSpaceDirectories({
      sessionBindings: [
        { sessionId: "s1", directory: "/ws/test" },
        {
          sessionId: "expert-s",
          directory:
            "/ws/仓储作业-warehouse-managerwarehouse-manager/1784904085001",
        },
        {
          sessionId: "expert-s2",
          directory: "/ws/物流单专家-order-entry-clerk/1753456789000",
        },
      ],
      automationRecords: [],
    });

    expect(out).toEqual(["/ws/test"]);
  });

  test("does not invent spaces from empty bindings", () => {
    const out = listSelectableAssistantSpaceDirectories({
      sessionBindings: [],
      automationRecords: [],
    });
    expect(out).toEqual([]);
  });
});

describe("isIsolatedExpertSessionDirectory", () => {
  test("matches agent/timestamp isolation paths only", () => {
    expect(
      isIsolatedExpertSessionDirectory(
        "/ws/仓储作业-warehouse-manager/1784904085001",
      ),
    ).toBe(true);
    expect(isIsolatedExpertSessionDirectory("/ws/test")).toBe(false);
    expect(isIsolatedExpertSessionDirectory("1784904085001")).toBe(false);
  });
});
