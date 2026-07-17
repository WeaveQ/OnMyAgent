import type { WorkspaceConnectionState } from "../../../app/types";
import {
  getRemoteWorkspaceConnectionKey,
  testRemoteWorkspaceConnection,
  type RemoteWorkspaceConnectionResult,
} from "../../domains/workspace";
import { t } from "../../../i18n";
import type { RouteWorkspace } from "./model";

export type RemoteWorkspaceConnectionCheck = {
  connectionKey: string;
  result: RemoteWorkspaceConnectionResult;
  runId: string;
  workspaceId: string;
};

export function buildRemoteWorkspaceConnectingState(): WorkspaceConnectionState {
  return {
    status: "connecting",
    message: t("config.testing_connection"),
    checkedAt: null,
  };
}

export function resolveRemoteWorkspaceConnectionCheckTarget(input: {
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

export async function runRemoteWorkspaceConnectionCheckTarget(input: ReturnType<typeof resolveRemoteWorkspaceConnectionCheckTarget>) {
  if (!input) return null;
  return {
    connectionKey: input.connectionKey,
    result: await testRemoteWorkspaceConnection(input.workspace),
    runId: input.runId,
    workspaceId: input.workspaceId,
  };
}

export function remoteWorkspaceConnectionCheckIsCurrent(input: {
  activeRunId: string | undefined;
  check: RemoteWorkspaceConnectionCheck;
  currentWorkspace: RouteWorkspace | undefined;
}) {
  return Boolean(
    input.activeRunId === input.check.runId &&
    input.currentWorkspace &&
    getRemoteWorkspaceConnectionKey(input.currentWorkspace) === input.check.connectionKey,
  );
}
