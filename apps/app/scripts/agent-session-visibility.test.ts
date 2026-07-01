import { describe, expect, test } from "bun:test";

import type { WorkspaceSessionGroup } from "../src/app/types";
import {
  ensureAgentSessionGroupVisible,
  ensureAgentSessionsVisible,
  ensureSelectedAgentSessionGroupVisible,
  ensureSelectedAgentSessionVisible,
} from "../src/react-app/domains/session/components/shared-pages/agent-session-visibility";

const existingSession = {
  id: "expert_chuangye",
  title: "创业教练",
  time: { created: 1, updated: 2 },
};

function workspaceGroup(id: string): WorkspaceSessionGroup {
  return {
    workspace: {
      id,
      name: id,
      path: `/tmp/${id}`,
      preset: "local",
      workspaceType: "local",
    },
    sessions: [existingSession],
    status: "ready",
  };
}

describe("agent session visibility", () => {
  test("adds the selected route expert session when it is missing from sidebar sessions", () => {
    const sessions = ensureSelectedAgentSessionVisible({
      sessions: [existingSession],
      selectedSessionId: "expert_senior_developer",
      selectedAgentId: "senior-developer:senior-developer",
    });

    expect(sessions.map((session) => session.id)).toEqual([
      "expert_senior_developer",
      "expert_chuangye",
    ]);
  });

  test("does not add a fallback without a selected agent id", () => {
    const sessions = [existingSession];

    expect(
      ensureSelectedAgentSessionVisible({
        sessions,
        selectedSessionId: "expert_senior_developer",
        selectedAgentId: null,
      }),
    ).toBe(sessions);
  });

  test("patches only the selected workspace group for the left agent panel", () => {
    const groups = [workspaceGroup("ws_1"), workspaceGroup("ws_2")];
    const patchedGroups = ensureSelectedAgentSessionGroupVisible({
      groups,
      selectedWorkspaceId: "ws_1",
      selectedSessionId: "expert_senior_developer",
      selectedAgentId: "senior-developer:senior-developer",
    });

    expect(patchedGroups[0]?.sessions.map((session) => session.id)).toEqual([
      "expert_senior_developer",
      "expert_chuangye",
    ]);
    expect(patchedGroups[1]).toBe(groups[1]);
  });

  test("keeps all known expert sessions visible after selected session changes", () => {
    const sessions = ensureAgentSessionsVisible({
      sessions: [existingSession],
      agentSessions: [
        {
          sessionId: "expert_senior_developer",
          agentId: "senior-developer:senior-developer",
        },
        {
          sessionId: "expert_chuangye",
          agentId: "chuangye-manor:chuangye-manor",
        },
      ],
    });

    expect(sessions.map((session) => session.id)).toEqual([
      "expert_senior_developer",
      "expert_chuangye",
    ]);
  });

  test("patches the left panel group from known expert sessions even when another expert is selected", () => {
    const groups = [workspaceGroup("ws_1")];
    const patchedGroups = ensureAgentSessionGroupVisible({
      groups,
      selectedWorkspaceId: "ws_1",
      agentSessions: [
        {
          sessionId: "expert_senior_developer",
          agentId: "senior-developer:senior-developer",
        },
      ],
    });

    expect(patchedGroups[0]?.sessions.map((session) => session.id)).toEqual([
      "expert_senior_developer",
      "expert_chuangye",
    ]);
  });
});
