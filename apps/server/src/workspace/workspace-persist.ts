import type { WorkspaceInfo } from "@onmyagent/types/server";

import { persistAgentEngineField } from "../engines/agent-engine-policy.js";

/** Persist shape written by `persistServerWorkspaceState`. */
export function persistWorkspaceConfigEntry(
  workspace: WorkspaceInfo,
): Record<string, unknown> {
  return {
    id: workspace.id,
    path: workspace.path,
    name: workspace.name,
    preset: workspace.preset,
    workspaceType: workspace.workspaceType,
    ...(workspace.remoteType ? { remoteType: workspace.remoteType } : {}),
    ...(workspace.baseUrl ? { baseUrl: workspace.baseUrl } : {}),
    ...(workspace.directory ? { directory: workspace.directory } : {}),
    ...(workspace.displayName ? { displayName: workspace.displayName } : {}),
    ...persistAgentEngineField(workspace.agentEngine),
    ...(workspace.onmyagentHostUrl
      ? { onmyagentHostUrl: workspace.onmyagentHostUrl }
      : {}),
    ...(workspace.onmyagentToken
      ? { onmyagentToken: workspace.onmyagentToken }
      : {}),
    ...(workspace.onmyagentWorkspaceId
      ? { onmyagentWorkspaceId: workspace.onmyagentWorkspaceId }
      : {}),
    ...(workspace.onmyagentWorkspaceName
      ? { onmyagentWorkspaceName: workspace.onmyagentWorkspaceName }
      : {}),
    ...(workspace.sandboxBackend
      ? { sandboxBackend: workspace.sandboxBackend }
      : {}),
    ...(workspace.sandboxRunId ? { sandboxRunId: workspace.sandboxRunId } : {}),
    ...(workspace.sandboxContainerName
      ? { sandboxContainerName: workspace.sandboxContainerName }
      : {}),
    ...(workspace.opencodeUsername
      ? { opencodeUsername: workspace.opencodeUsername }
      : {}),
    ...(workspace.opencodePassword
      ? { opencodePassword: workspace.opencodePassword }
      : {}),
  };
}
