/**
 * Covers resolveSessionExpertId for create / continue / reopen paths
 * (the session-route expert resolution used by work-memory inject + capture).
 */
import { describe, expect, test } from "bun:test";

import { resolveSessionExpertId } from "../src/react-app/shell/session-route/resolve-session-expert-id";

describe("resolveSessionExpertId (shipped session-route helper)", () => {
  test("create path: prefers pendingAgentId from create-time snapshot", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "sess-new",
        pendingAgentId: "expert-create",
        currentAgentId: "other",
        currentAgentBoundSessionId: null,
        sessionAgentId: null,
      }),
    ).toBe("expert-create");
  });

  test("continue path: uses currentAgent when bound to this session", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "sess-1",
        pendingAgentId: null,
        currentAgentId: "expert-continue",
        currentAgentBoundSessionId: "sess-1",
        sessionAgentId: "expert-stale",
      }),
    ).toBe("expert-continue");
  });

  test("continue path: unbound current agent still counts", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "sess-1",
        pendingAgentId: null,
        currentAgentId: "expert-unbound",
        currentAgentBoundSessionId: null,
        sessionAgentId: null,
      }),
    ).toBe("expert-unbound");
  });

  test("continue path: ignores currentAgent bound to a different session", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "sess-1",
        pendingAgentId: null,
        currentAgentId: "expert-other-session",
        currentAgentBoundSessionId: "sess-2",
        sessionAgentId: "expert-reopen",
      }),
    ).toBe("expert-reopen");
  });

  test("reopen path: falls back to persisted session agent id", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "sess-reopen",
        pendingAgentId: null,
        currentAgentId: null,
        currentAgentBoundSessionId: null,
        sessionAgentId: "expert-from-storage",
      }),
    ).toBe("expert-from-storage");
  });

  test("no expert when nothing is bound", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "sess-plain",
        pendingAgentId: null,
        currentAgentId: null,
        sessionAgentId: null,
      }),
    ).toBeNull();
  });

  test("draft sessions never resolve an expert", () => {
    expect(
      resolveSessionExpertId({
        sessionId: "draft:xyz",
        pendingAgentId: "expert-x",
        sessionAgentId: "expert-y",
      }),
    ).toBeNull();
  });
});
