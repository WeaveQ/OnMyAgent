import type { WorkspaceSessionGroup } from "../../../../app/types";

export type VisibleAgentSessionEntry = {
  sessionId: string;
  agentId: string;
};

export function ensureSelectedAgentSessionVisible(input: {
  sessions: WorkspaceSessionGroup["sessions"];
  selectedSessionId: string | null;
  selectedAgentId: string | null;
}): WorkspaceSessionGroup["sessions"] {
  return ensureAgentSessionsVisible({
    sessions: input.sessions,
    agentSessions:
      input.selectedSessionId && input.selectedAgentId
        ? [
            {
              sessionId: input.selectedSessionId,
              agentId: input.selectedAgentId,
            },
          ]
        : [],
  });
}

export function ensureAgentSessionsVisible(input: {
  sessions: WorkspaceSessionGroup["sessions"];
  agentSessions: VisibleAgentSessionEntry[];
}): WorkspaceSessionGroup["sessions"] {
  if (input.agentSessions.length === 0) return input.sessions;
  const existingSessionIds = new Set(input.sessions.map((session) => session.id));
  const missingSessions = input.agentSessions.flatMap((entry) => {
    if (!entry.sessionId || !entry.agentId) return [];
    if (existingSessionIds.has(entry.sessionId)) return [];
    existingSessionIds.add(entry.sessionId);
    return [
      {
        id: entry.sessionId,
        title: "",
      },
    ];
  });
  return missingSessions.length > 0
    ? [...missingSessions, ...input.sessions]
    : input.sessions;
}

export function ensureSelectedAgentSessionGroupVisible(input: {
  groups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  selectedAgentId: string | null;
}): WorkspaceSessionGroup[] {
  return ensureAgentSessionGroupVisible({
    groups: input.groups,
    selectedWorkspaceId: input.selectedWorkspaceId,
    agentSessions:
      input.selectedSessionId && input.selectedAgentId
        ? [
            {
              sessionId: input.selectedSessionId,
              agentId: input.selectedAgentId,
            },
          ]
        : [],
  });
}

export function ensureAgentSessionGroupVisible(input: {
  groups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  agentSessions: VisibleAgentSessionEntry[];
}): WorkspaceSessionGroup[] {
  let changed = false;
  const groups = input.groups.map((group) => {
    if (group.workspace.id !== input.selectedWorkspaceId) return group;
    const sessions = ensureAgentSessionsVisible({
      sessions: group.sessions,
      agentSessions: input.agentSessions,
    });
    if (sessions === group.sessions) return group;
    changed = true;
    return { ...group, sessions };
  });
  return changed ? groups : input.groups;
}
