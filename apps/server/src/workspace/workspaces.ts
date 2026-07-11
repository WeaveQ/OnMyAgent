import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import type { WorkspaceConfig, WorkspaceInfo } from "@onmyagent/types/server";

function workspaceIdForKey(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return `ws_${hash.slice(0, 12)}`;
}

export function workspaceIdForPath(path: string): string {
  return workspaceIdForKey(path);
}

export function workspaceIdForRemote(baseUrl: string, directory?: string | null): string {
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedDirectory = directory?.trim() ?? "";
  const key = normalizedDirectory
    ? `remote::${normalizedBaseUrl}::${normalizedDirectory}`
    : `remote::${normalizedBaseUrl}`;
  return workspaceIdForKey(key);
}

export function workspaceIdForOnMyAgent(hostUrl: string, workspaceId?: string | null): string {
  const normalizedHostUrl = hostUrl.trim();
  const normalizedWorkspaceId = workspaceId?.trim() ?? "";
  const key = normalizedWorkspaceId
    ? `onmyagent::${normalizedHostUrl}::${normalizedWorkspaceId}`
    : `onmyagent::${normalizedHostUrl}`;
  return workspaceIdForKey(key);
}

export function buildWorkspaceInfos(
  workspaces: WorkspaceConfig[],
  cwd: string,
): WorkspaceInfo[] {
  return workspaces.map((workspace) => {
    const rawPath = workspace.path?.trim() ?? "";
    const workspaceType = workspace.workspaceType ?? "local";
    const resolvedPath = rawPath ? resolve(cwd, rawPath) : "";
    const remoteType = workspace.remoteType;
    const id = workspace.id?.trim()
      || (workspaceType === "remote"
        ? remoteType === "onmyagent"
          ? workspaceIdForOnMyAgent(workspace.onmyagentHostUrl ?? workspace.baseUrl ?? "", workspace.onmyagentWorkspaceId)
          : workspaceIdForRemote(workspace.baseUrl ?? "", workspace.directory)
        : workspaceIdForPath(resolvedPath));
    const name = workspace.name?.trim()
      || workspace.displayName?.trim()
      || workspace.onmyagentWorkspaceName?.trim()
      || basename(resolvedPath || workspace.directory?.trim() || workspace.baseUrl?.trim() || "Workspace");
    return {
      id,
      name,
      path: resolvedPath,
      preset: workspace.preset?.trim() || (workspaceType === "remote" ? "remote" : "starter"),
      workspaceType,
      remoteType,
      baseUrl: workspace.baseUrl,
      directory: workspace.directory,
      displayName: workspace.displayName,
      onmyagentHostUrl: workspace.onmyagentHostUrl,
      onmyagentToken: workspace.onmyagentToken,
      onmyagentWorkspaceId: workspace.onmyagentWorkspaceId,
      onmyagentWorkspaceName: workspace.onmyagentWorkspaceName,
      sandboxBackend: workspace.sandboxBackend,
      sandboxRunId: workspace.sandboxRunId,
      sandboxContainerName: workspace.sandboxContainerName,
      opencodeUsername: workspace.opencodeUsername,
      opencodePassword: workspace.opencodePassword,
    };
  });
}
