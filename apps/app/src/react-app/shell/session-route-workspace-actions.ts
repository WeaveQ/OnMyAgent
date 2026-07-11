import type { OnMyAgentServerClient } from "../../app/lib/onmyagent-server";
import {
  revealDesktopItemInDir,
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  workspaceCreate,
  workspaceCreateRemote,
  workspaceExportConfig,
  workspaceForget,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  workspaceUpdateDisplayName,
  type WorkspaceList,
} from "../../app/lib/desktop";
import type { WorkspacePreset } from "../../app/types";
import { isDesktopRuntime } from "../../app/utils";
import {
  buildWorkspaceBootstrapErrorEvent,
  folderNameFromPath,
  mapDesktopWorkspace,
  type RouteWorkspace,
} from "./session-route-model";
import { recordInspectorEvent } from "./app-inspector";

export type DesktopSessionWorkspaceBootstrapResult = {
  desktopList: WorkspaceList | null;
  desktopWorkspaces: RouteWorkspace[];
};

export function resolveCreatedSessionWorkspaceId(list: WorkspaceList | null) {
  if (!list) return "";
  return resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
}

export function resolveSelectedDesktopSessionWorkspaceId(list: WorkspaceList | null) {
  return resolveWorkspaceListSelectedId(list);
}

export function resolveSessionWorkspaceCreateTargetId(input: {
  desktopList: WorkspaceList | null;
  serverList: WorkspaceList | null;
}) {
  const desktopId = resolveCreatedSessionWorkspaceId(input.desktopList);
  return resolveCreatedSessionWorkspaceId(input.serverList) || desktopId;
}

export async function bootstrapDesktopSessionWorkspaces() {
  return await workspaceBootstrap() as WorkspaceList;
}

export async function loadDesktopSessionWorkspaces(input: {
  fallbackWorkspaces: RouteWorkspace[];
}) {
  if (!isDesktopRuntime()) {
    return {
      desktopList: null,
      desktopWorkspaces: input.fallbackWorkspaces,
    } satisfies DesktopSessionWorkspaceBootstrapResult;
  }
  try {
    const desktopList = await bootstrapDesktopSessionWorkspaces();
    return {
      desktopList,
      desktopWorkspaces: (desktopList.workspaces ?? []).map(mapDesktopWorkspace),
    } satisfies DesktopSessionWorkspaceBootstrapResult;
  } catch (error) {
    const bootstrapError = buildWorkspaceBootstrapErrorEvent({
      error,
      route: "session",
      preservedWorkspaceCount: input.fallbackWorkspaces.length,
    });
    console.error("[session-route] workspaceBootstrap failed", error);
    recordInspectorEvent("route.workspace_bootstrap.error", bootstrapError.payload);
    return {
      desktopList: null,
      desktopWorkspaces: input.fallbackWorkspaces,
    } satisfies DesktopSessionWorkspaceBootstrapResult;
  }
}

export async function activateDesktopSessionWorkspace(workspaceId: string) {
  if (!workspaceId || !isDesktopRuntime()) return;
  await workspaceSetSelected(workspaceId).catch(() => undefined);
  await workspaceSetRuntimeActive(workspaceId).catch(() => undefined);
}

export async function createLocalSessionWorkspace(input: {
  folder: string;
  onmyagentClient: Pick<OnMyAgentServerClient, "createLocalWorkspace"> | null;
  preset: WorkspacePreset;
}) {
  const workspaceName = folderNameFromPath(input.folder);
  const list = await workspaceCreate({
    folderPath: input.folder,
    name: workspaceName,
    preset: input.preset,
  }) as WorkspaceList;
  const createdId = resolveCreatedSessionWorkspaceId(list);
  if (createdId) {
    await activateDesktopSessionWorkspace(createdId);
  }
  let serverList: WorkspaceList | null = null;
  if (input.onmyagentClient) {
    serverList = await input.onmyagentClient
      .createLocalWorkspace({
        folderPath: input.folder,
        name: workspaceName,
        preset: input.preset,
      })
      .catch(() => null);
  }
  return resolveSessionWorkspaceCreateTargetId({ desktopList: list, serverList });
}

export type CreateRemoteSessionWorkspaceInput = {
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
};

export async function createLocalSessionWorkspaceAndRefresh(input: {
  folder: string | null;
  onmyagentClient: Pick<OnMyAgentServerClient, "createLocalWorkspace"> | null;
  preset: WorkspacePreset;
  refreshRouteState: () => Promise<unknown>;
}) {
  if (!input.folder) return "";
  const targetWorkspaceId = await createLocalSessionWorkspace({
    folder: input.folder,
    preset: input.preset,
    onmyagentClient: input.onmyagentClient,
  });
  await input.refreshRouteState();
  return targetWorkspaceId;
}

export async function createRemoteSessionWorkspace(input: CreateRemoteSessionWorkspaceInput) {
  const baseUrlValue = input.onmyagentHostUrl?.trim() ?? "";
  if (!baseUrlValue) return false;
  const list = await workspaceCreateRemote({
    baseUrl: baseUrlValue,
    onmyagentHostUrl: baseUrlValue,
    onmyagentToken: input.onmyagentToken?.trim() || null,
    displayName: input.displayName?.trim() || null,
    directory: input.directory?.trim() || null,
    remoteType: "onmyagent",
  }) as WorkspaceList;
  const createdId = resolveCreatedSessionWorkspaceId(list);
  if (createdId) {
    await activateDesktopSessionWorkspace(createdId);
  }
  return true;
}

export async function createRemoteSessionWorkspaceAndRefresh(input: CreateRemoteSessionWorkspaceInput & {
  refreshRouteState: () => Promise<unknown>;
}) {
  const created = await createRemoteSessionWorkspace(input);
  if (!created) return false;
  await input.refreshRouteState();
  return true;
}

export function activateDesktopSessionWorkspaceInBackground(workspaceId: string) {
  if (!workspaceId || !isDesktopRuntime()) return;
  void activateDesktopSessionWorkspace(workspaceId);
}

export async function revealSessionWorkspacePath(path: string) {
  const resolvedPath = path.trim();
  if (!resolvedPath || !isDesktopRuntime()) return;
  await revealDesktopItemInDir(resolvedPath).catch(() => undefined);
}

export async function exportSessionWorkspaceConfig(input: {
  outputPath: string;
  workspaceId: string;
}) {
  await workspaceExportConfig({ workspaceId: input.workspaceId, outputPath: input.outputPath });
  await revealDesktopItemInDir(input.outputPath).catch(() => undefined);
}

export async function renameSessionWorkspace(input: {
  displayName: string;
  onmyagentClient: Pick<OnMyAgentServerClient, "updateWorkspaceDisplayName"> | null;
  workspaceId: string;
}) {
  if (isDesktopRuntime()) {
    await workspaceUpdateDisplayName({
      workspaceId: input.workspaceId,
      displayName: input.displayName,
    }).catch(() => undefined);
  }
  if (input.onmyagentClient) {
    await input.onmyagentClient
      .updateWorkspaceDisplayName(input.workspaceId, input.displayName)
      .catch(() => undefined);
  }
}

export async function renameSessionWorkspaceAndRefresh(input: {
  displayName: string;
  onmyagentClient: Pick<OnMyAgentServerClient, "updateWorkspaceDisplayName"> | null;
  refreshRouteState: () => Promise<unknown>;
  workspaceId: string;
}) {
  await renameSessionWorkspace({
    displayName: input.displayName,
    onmyagentClient: input.onmyagentClient,
    workspaceId: input.workspaceId,
  });
  await input.refreshRouteState();
}

export async function forgetSessionWorkspace(input: {
  onmyagentClient: Pick<OnMyAgentServerClient, "deleteWorkspace"> | null;
  workspaceId: string;
}) {
  if (isDesktopRuntime()) {
    await workspaceForget(input.workspaceId).catch(() => undefined);
  }
  if (input.onmyagentClient) {
    await input.onmyagentClient.deleteWorkspace(input.workspaceId).catch(() => undefined);
  }
}

export async function forgetSessionWorkspaceAndRefresh(input: {
  onmyagentClient: Pick<OnMyAgentServerClient, "deleteWorkspace"> | null;
  refreshRouteState: () => Promise<unknown>;
  workspaceId: string;
}) {
  await forgetSessionWorkspace({ workspaceId: input.workspaceId, onmyagentClient: input.onmyagentClient });
  await input.refreshRouteState();
}
