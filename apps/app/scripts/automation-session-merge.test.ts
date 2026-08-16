/**
 * Sidebar merge must drop archived / soft-deleted automation sessions.
 */
import { describe, expect, test } from "bun:test";

import { mergeAutomationSessions } from "../src/react-app/domains/session/sidebar/agent-conversation-panel";
import type { AutomationSessionRecord } from "../src/react-app/domains/messaging/automation-session-groups";

describe("mergeAutomationSessions", () => {
  test("excluding an archived parent and its children leaves no child roots", () => {
    const sessions = [
      {
        id: "ses_parent",
        title: "创建电脑截图技能",
        parentID: null,
        time: { created: 1, updated: 4 },
      },
      {
        id: "ses_child",
        title: "baseline 测试1",
        parentID: "ses_parent",
        time: { created: 2, updated: 5 },
      },
    ];
    const merged = mergeAutomationSessions(
      sessions,
      [],
      new Set(["ses_parent", "ses_child"]),
    );
    expect(merged.map((session) => session.id)).toEqual([]);
  });

  test("excludes deleted or archived session ids from workspace sessions", () => {
    const sessions = [
      {
        id: "ses_keep",
        title: "Keep",
        time: { created: 1, updated: 2 },
      },
      {
        id: "ses_gone",
        title: "Gone",
        time: { created: 1, updated: 3 },
      },
    ];
    const records: AutomationSessionRecord[] = [
      {
        sessionId: "ses_local",
        automationId: "auto-1",
        title: "Local only",
        groupName: "g",
        outputDirectory: "/tmp/a",
        category: "office",
        createdAt: 5,
      },
      {
        sessionId: "ses_gone",
        automationId: "auto-1",
        title: "Gone",
        groupName: "g",
        outputDirectory: "/tmp/b",
        category: "office",
        createdAt: 4,
      },
    ];
    const excluded = new Set(["ses_gone"]);
    const merged = mergeAutomationSessions(sessions as never, records, excluded);
    expect(merged.map((item) => item.id)).toEqual(["ses_local", "ses_keep"]);
  });
});
