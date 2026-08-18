import type { AgentRuntimeSession } from "@onmyagent/types/agent-runtime";
import type { SidebarSessionItem } from "../../../app/types";

export function runtimeSessionToSidebarItem(
  session: AgentRuntimeSession,
  fallbackTitle: string,
): SidebarSessionItem {
  return {
    id: session.productSessionId,
    title: session.title?.trim() || fallbackTitle,
    status: session.status,
    time: {
      created: session.createdAt,
      updated: session.updatedAt,
    },
    directory: session.cwd,
  };
}

export function runtimeExpertIdentityEntries(
  sessions: readonly AgentRuntimeSession[],
): Array<{ sessionId: string; expertId: string }> {
  return sessions.flatMap((session) =>
    session.profile?.kind === "expert"
      ? [{
          sessionId: session.productSessionId,
          expertId: session.profile.expertId,
        }]
      : []);
}
