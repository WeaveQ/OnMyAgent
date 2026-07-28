/**
 * Sidebar merge must drop archived / soft-deleted automation sessions.
 */
import { describe, expect, test } from "bun:test";

import { mergeAutomationSessions } from "../src/react-app/domains/session/sidebar/agent-conversation-panel";
import type { AutomationSessionRecord } from "../src/react-app/domains/messaging/automation-session-groups";

describe("mergeAutomationSessions", () => {
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
