import type { OpenworkServerClient } from "../../app/lib/onmyagent-server";
import {
  engineStart,
  pickDirectory,
  workspaceBootstrap,
  workspaceCreate,
  workspaceCreateRemote,
  workspaceExportConfig,
  workspaceForget,
  revealDesktopItemInDir,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  workspaceUpdateDisplayName,
  type WorkspaceList,
} from "../../app/lib/desktop";
import type { WorkspacePreset } from "../../app/types";
import { isDesktopRuntime } from "../../app/utils";
import { t } from "../../i18n";
import {
  folderNameFromPath,
  resolveCreatedSettingsWorkspaceId,
  resolveSettingsWorkspaceIdAfterRemoval,
  type RouteWorkspace,
} from "./settings-route-model";

export async function selectDesktopSettingsWorkspace(workspaceId: string) {
  if (!workspaceId) return;
  await workspaceSetSelected(workspaceId).catch(() => undefined);
}

export async function activateDesktopSettingsWorkspace(workspaceId: string) {
  if (!workspaceId) return;
  await workspaceSetSelected(workspaceId).catch(() => undefined);
  await workspaceSetRuntimeActive(workspaceId).catch(() => undefined);
}

export function activateDesktopSettingsWorkspaceInBackground(workspaceId: string) {
  if (!workspaceId || !isDesktopRuntime()) return;
  void activateDesktopSettingsWorkspace(workspaceId);
}

export async function bootstrapDesktopSettingsWorkspaces() {
  if (!isDesktopRuntime()) return null;
  return await workspaceBootstrap() as WorkspaceList;
}

export async function createLocalSettingsWorkspace(input: {
  folder: string;
  onmyagentClient: Pick<OpenworkServerClient, "createLocalWorkspace"> | null;
  preset: WorkspacePreset;
}) {
  const workspaceName = folderNameFromPath(input.folder);
  const list = await workspaceCreate({
    folderPath: input.folder,
    name: workspaceName,
    preset: input.preset,
  }) as WorkspaceList;
  const createdId = resolveCreatedSettingsWorkspaceId(list);
  if (createdId) {
    await activateDesktopSettingsWorkspace(createdId);
  }
  if (input.onmyagentClient) {
    await input.onmyagentClient
      .createLocalWorkspace({ folderPath: input.folder, name: workspaceName, preset: input.preset })
      .catch(() => undefined);
  }
  return createdId;
}

export type CreateRemoteSettingsWorkspaceInput = {
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
};

export async function createLocalSettingsWorkspaceAndRefresh(input: {
  folder: string | null;
  onmyagentClient: Pick<OpenworkServerClient, "createLocalWorkspace"> | null;
  preset: WorkspacePreset;
  refreshRouteState: () => Promise<unknown>;
}) {
  if (!input.folder) return false;
  await createLocalSettingsWorkspace({
    folder: input.folder,
    onmyagentClient: input.onmyagentClient,
    preset: input.preset,
  });
  await input.refreshRouteState();
  return true;
}

export async function createRemoteSettingsWorkspace(input: CreateRemoteSettingsWorkspaceInput) {
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
  const createdId = resolveCreatedSettingsWorkspaceId(list);
  if (createdId) {
    await activateDesktopSettingsWorkspace(createdId);
  }
  return true;
}

export async function createRemoteSettingsWorkspaceAndRefresh(input: CreateRemoteSettingsWorkspaceInput & {
  refreshRouteState: () => Promise<unknown>;
}) {
  const created = await createRemoteSettingsWorkspace(input);
  if (!created) return false;
  await input.refreshRouteState();
  return true;
}

export async function exportSettingsWorkspaceConfig(input: {
  outputPath: string;
  workspaceId: string;
}) {
  await workspaceExportConfig({ workspaceId: input.workspaceId, outputPath: input.outputPath });
  await revealDesktopItemInDir(input.outputPath).catch(() => undefined);
}

export async function pickAndExportSettingsWorkspaceConfig(input: {
  workspaceId: string;
  workspaceLabel: string;
}) {
  if (!isDesktopRuntime()) return false;
  const outputPath = await pickDirectory({
    title: t("workspace_list.export_config_picker_title", { workspace: input.workspaceLabel }),
  });
  const targetPath = Array.isArray(outputPath) ? outputPath[0] : outputPath;
  if (!targetPath) return false;
  await exportSettingsWorkspaceConfig({ workspaceId: input.workspaceId, outputPath: targetPath });
  return true;
}

export async function revealSettingsWorkspacePath(path: string) {
  const resolvedPath = path.trim();
  if (!resolvedPath || !isDesktopRuntime()) return;
  await revealDesktopItemInDir(resolvedPath).catch(() => undefined);
}

export async function renameSettingsWorkspace(input: {
  displayName: string;
  onmyagentClient: Pick<OpenworkServerClient, "updateWorkspaceDisplayName"> | null;
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

export async function renameSettingsWorkspaceAndRefresh(input: {
  displayName: string;
  onmyagentClient: Pick<OpenworkServerClient, "updateWorkspaceDisplayName"> | null;
  refreshRouteState: () => Promise<unknown>;
  workspaceId: string;
}) {
  await renameSettingsWorkspace({
    displayName: input.displayName,
    onmyagentClient: input.onmyagentClient,
    workspaceId: input.workspaceId,
  });
  await input.refreshRouteState();
}

export async function forgetSettingsWorkspace(input: {
  onmyagentClient: Pick<OpenworkServerClient, "deleteWorkspace"> | null;
  workspaceId: string;
}) {
  if (isDesktopRuntime()) {
    await workspaceForget(input.workspaceId).catch(() => undefined);
  }
  if (input.onmyagentClient) {
    await input.onmyagentClient.deleteWorkspace(input.workspaceId).catch(() => undefined);
  }
}

export async function forgetSettingsWorkspaceAndRefresh(input: {
  onmyagentClient: Pick<OpenworkServerClient, "deleteWorkspace"> | null;
  refreshRouteState: () => Promise<unknown>;
  selectedWorkspaceId: string;
  workspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  await forgetSettingsWorkspace({ onmyagentClient: input.onmyagentClient, workspaceId: input.workspaceId });
  const nextId = resolveSettingsWorkspaceIdAfterRemoval({
    removedWorkspaceId: input.workspaceId,
    selectedWorkspaceId: input.selectedWorkspaceId,
    workspaces: input.workspaces,
  });
  if (nextId !== input.selectedWorkspaceId && nextId) {
    await selectDesktopSettingsWorkspace(nextId);
  }
  await input.refreshRouteState();
  return nextId;
}

export async function applySettingsEnvironmentChanges(input: {
  onmyagentRemoteAccess: boolean;
  selectedWorkspaceRoot: string;
  workspacePaths: string[];
}) {
  await engineStart(input.selectedWorkspaceRoot, {
    preferSidecar: true,
    runtime: "direct",
    workspacePaths: input.workspacePaths,
    onmyagentRemoteAccess: input.onmyagentRemoteAccess,
  });
}

export async function applySettingsEnvironmentChangesAndRefresh(input: {
  activeReloadBlockingSessionsCount: number;
  onmyagentRemoteAccess: boolean;
  reconnectOpenworkServer: () => Promise<boolean>;
  refreshRouteState: () => Promise<unknown>;
  selectedWorkspaceRoot: string | null;
  workspacePaths: string[];
}) {
  if (!isDesktopRuntime()) {
    throw new Error(t("settings.environment.apply_unavailable"));
  }
  if (input.activeReloadBlockingSessionsCount > 0) {
    throw new Error(t("settings.environment.apply_blocked_active_tasks"));
  }
  if (!input.selectedWorkspaceRoot) {
    throw new Error(t("settings.environment.apply_no_local_workspace"));
  }
  await applySettingsEnvironmentChanges({
    selectedWorkspaceRoot: input.selectedWorkspaceRoot,
    workspacePaths: input.workspacePaths,
    onmyagentRemoteAccess: input.onmyagentRemoteAccess,
  });
  const reconnected = await input.reconnectOpenworkServer();
  if (!reconnected) {
    await input.refreshRouteState().catch(() => undefined);
    return { statusMessage: t("settings.environment.apply_refresh_failed") };
  }
  await input.refreshRouteState();
}
