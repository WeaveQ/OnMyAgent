// Workspace desktop IPC wire types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  preset: string;
  workspaceType: "local" | "remote";
  remoteType?: "onmyagent" | "opencode" | null;
  baseUrl?: string | null;
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
  onmyagentClientToken?: string | null;
  onmyagentHostToken?: string | null;
  onmyagentWorkspaceId?: string | null;
  onmyagentWorkspaceName?: string | null;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type WorkspaceList = {
  selectedId?: string;
  watchedId?: string | null;
  activeId?: string | null;
  workspaces: WorkspaceInfo[];
};

/** Args for desktop `workspaceCreateRemote` (remote onmyagent / opencode mount). */
export type WorkspaceCreateRemoteInput = {
  baseUrl: string;
  remoteType?: "onmyagent" | "opencode" | null;
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
  onmyagentClientToken?: string | null;
  onmyagentHostToken?: string | null;
  onmyagentWorkspaceId?: string | null;
  onmyagentWorkspaceName?: string | null;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

/** Args for desktop `workspaceUpdateRemote` — patch remote connection fields by id. */
export type WorkspaceUpdateRemoteInput = {
  workspaceId: string;
  baseUrl?: string | null;
  remoteType?: "onmyagent" | "opencode" | null;
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
  onmyagentClientToken?: string | null;
  onmyagentHostToken?: string | null;
  onmyagentWorkspaceId?: string | null;
  onmyagentWorkspaceName?: string | null;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type WorkspaceExportSummary = {
  outputPath: string;
  included: number;
  excluded: string[];
};

export type OpencodeCommandDraft = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
};

export type WorkspaceOnMyAgentConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};
