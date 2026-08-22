import type { AgentRuntimeSessionListResponse } from "@onmyagent/types/agent-runtime";

export async function listRuntimeSessionsFailVisible(input: {
  workspaceId: string;
  listRuntimeSessions: (workspaceId: string) => Promise<AgentRuntimeSessionListResponse>;
}): Promise<AgentRuntimeSessionListResponse> {
  try {
    return await input.listRuntimeSessions(input.workspaceId);
  } catch {
    return {
      items: [],
      complete: false,
      failures: [{
        productSessionId: "*",
        runtimeKind: "grok-build",
        code: "runtime_session_list_failed",
      }],
    };
  }
}
