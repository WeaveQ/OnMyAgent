import { describe, expect, test } from "bun:test";

import {
  clearExpertCreationEphemeralSessions,
  deleteExpertCreationEphemeralSession,
  isExpertCreationEphemeralSession,
  listExpertCreationEphemeralSessions,
  registerExpertCreationEphemeralSession,
  unregisterExpertCreationEphemeralSession,
} from "../src/react-app/domains/agents/expert-creation-ephemeral-sessions";

describe("expert creation ephemeral sessions", () => {
  test("normalizes, lists, and removes disposable real session ids", () => {
    clearExpertCreationEphemeralSessions();

    registerExpertCreationEphemeralSession("  session-preview  ");
    registerExpertCreationEphemeralSession("draft:preview");

    expect(listExpertCreationEphemeralSessions()).toEqual(["session-preview"]);
    expect(isExpertCreationEphemeralSession("session-preview")).toBe(true);
    expect(isExpertCreationEphemeralSession("draft:preview")).toBe(false);

    unregisterExpertCreationEphemeralSession("session-preview");
    expect(isExpertCreationEphemeralSession("session-preview")).toBe(false);
  });

  test("deletes the archive before unregistering the disposable id", async () => {
    clearExpertCreationEphemeralSessions();
    registerExpertCreationEphemeralSession("session-preview");
    const calls: unknown[] = [];

    await deleteExpertCreationEphemeralSession({
      client: {
        deleteSession: async (...args) => {
          calls.push(args);
        },
      },
      workspaceId: "workspace",
      workspaceRoot: "/tmp/workspace",
      sessionId: "session-preview",
    });

    expect(calls).toEqual([
      ["workspace", "session-preview", { directory: "/tmp/workspace" }],
    ]);
    expect(isExpertCreationEphemeralSession("session-preview")).toBe(false);
  });

  test("keeps a failed deletion hidden for a later cleanup retry", async () => {
    clearExpertCreationEphemeralSessions();
    registerExpertCreationEphemeralSession("session-coach");

    await expect(deleteExpertCreationEphemeralSession({
      client: {
        deleteSession: async () => {
          throw new Error("offline");
        },
      },
      workspaceId: "workspace",
      workspaceRoot: "/tmp/workspace",
      sessionId: "session-coach",
    })).rejects.toThrow("offline");

    expect(isExpertCreationEphemeralSession("session-coach")).toBe(true);
  });
});
