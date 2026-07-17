import {
  getRemoteWorkspaceConnectionKey,
  testRemoteWorkspaceConnection,
  type RemoteWorkspaceConnectionResult,
} from "../../domains/workspace";
import { t } from "../../../i18n";
import type { RouteWorkspace } from "./model";
import {
  buildWorkspaceConnectionLoadingState,
  isCurrentWorkspaceConnectionCheck,
} from "./sidebar-model";

export type SessionRemoteWorkspaceConnectionCheck = {
  connectionKey: string;
  result: RemoteWorkspaceConnectionResult;
  runId: string;
  workspaceId: string;
};

export function buildSessionRemoteWorkspaceConnectingState() {
  return buildWorkspaceConnectionLoadingState({ message: t("config.testing_connection") });
}

export function resolveSessionRemoteWorkspaceConnectionCheckTarget(input: {
  runId: string;
  workspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  const workspace = input.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace || workspace.workspaceType !== "remote") return null;
  return {
    connectionKey: getRemoteWorkspaceConnectionKey(workspace),
    runId: input.runId,
    workspace,
    workspaceId: input.workspaceId,
  };
}

export async function runSessionRemoteWorkspaceConnectionCheckTarget(
  input: ReturnType<typeof resolveSessionRemoteWorkspaceConnectionCheckTarget>,
) {
  if (!input) return null;
  return {
    connectionKey: input.connectionKey,
    result: await testRemoteWorkspaceConnection(input.workspace),
    runId: input.runId,
    workspaceId: input.workspaceId,
  };
}

export function sessionRemoteWorkspaceConnectionCheckIsCurrent(input: {
  activeRunByWorkspaceId: Record<string, string>;
  check: SessionRemoteWorkspaceConnectionCheck;
  currentWorkspace: RouteWorkspace | null | undefined;
}) {
  return isCurrentWorkspaceConnectionCheck({
    activeRunByWorkspaceId: input.activeRunByWorkspaceId,
    workspaceId: input.check.workspaceId,
    runId: input.check.runId,
    currentWorkspace: input.currentWorkspace,
    connectionKey: input.check.connectionKey,
    getConnectionKey: getRemoteWorkspaceConnectionKey,
  });
}
