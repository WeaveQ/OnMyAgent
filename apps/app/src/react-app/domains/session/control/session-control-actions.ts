/** @jsxImportSource react */
import { useMemo } from "react";

import type { createClient } from "../../../../app/lib/opencode";
import type {
  OpenworkServerClient,
  OpenworkWorkspaceInfo,
} from "../../../../app/lib/onmyagent-server";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import {
  useControlAction,
  type OpenworkControlAction,
} from "../../../shell";
import { t } from "../../../../i18n";
import { APP_NAME } from "../../../../i18n/locales/brand";

type SessionLike = {
  id?: string;
  title?: string;
  time?: {
    updated?: number;
    created?: number;
  };
};

type SessionControlWorkspace = OpenworkWorkspaceInfo & {
  displayNameResolved?: string;
};

type UseSessionControlActionsInput = {
  workspaces: SessionControlWorkspace[];
  sessionsByWorkspaceId: Record<string, SessionLike[]>;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedSessionId: string | null;
  canCreateTask: boolean;
  onmyagentClient: OpenworkServerClient | null;
  opencodeClient: ReturnType<typeof createClient> | null;
  navigateToSession: (sessionId: string) => void;
  navigateToSessionRoot: () => void;
  createTaskInWorkspace: (workspaceId: string) => Promise<unknown> | unknown;
  openModelPicker: () => void;
  refreshRouteState: () => Promise<unknown> | unknown;
};

function workspaceLabel(workspace: SessionControlWorkspace) {
  return (
    workspace.displayName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    "workspace"
  );
}

function findSessionWorkspace(
  workspaces: SessionControlWorkspace[],
  sessionsByWorkspaceId: Record<string, SessionLike[]>,
  sessionId: string,
) {
  return workspaces.find((workspace) =>
    (sessionsByWorkspaceId[workspace.id] ?? []).some(
      (session) => session.id === sessionId,
    ),
  );
}

function objectArgs(args: unknown) {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

function stringArg(args: unknown, name: string) {
  const value = objectArgs(args)[name];
  return typeof value === "string" ? value.trim() : "";
}

function booleanArg(args: unknown, name: string) {
  return objectArgs(args)[name] === true;
}

export function useSessionControlActions(input: UseSessionControlActionsInput) {
  const {
    canCreateTask,
    createTaskInWorkspace,
    navigateToSession,
    navigateToSessionRoot,
    openModelPicker,
    onmyagentClient,
    opencodeClient,
    refreshRouteState,
    selectedSessionId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    sessionsByWorkspaceId,
    workspaces,
  } = input;

  const createTaskControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.create_task",
      label: t("session.control_create_task"),
      description: t("session.control_create_task_desc"),
      sideEffect: "mutation",
      disabled: !canCreateTask || !selectedWorkspaceId,
      execute: async () => {
        if (!selectedWorkspaceId) return false;
        await createTaskInWorkspace(selectedWorkspaceId);
        return true;
      },
    }),
    [canCreateTask, createTaskInWorkspace, selectedWorkspaceId],
  );
  useControlAction(createTaskControlAction);

  const listSessionsControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.list_sessions",
      label: t("session.control_list_sessions"),
      description: t("session.control_list_sessions_desc"),
      sideEffect: "none",
      execute: () => {
        const out: {
          sessionId: string;
          title: string;
          workspace: string;
          updatedAt: number;
        }[] = [];
        for (const workspace of workspaces) {
          const list = sessionsByWorkspaceId[workspace.id] ?? [];
          for (const session of list) {
            const sessionId = session.id?.trim() ?? "";
            if (!sessionId) continue;
            const title = getDisplaySessionTitle(session.title ?? "");
            const updatedAt =
              session.time?.updated ?? session.time?.created ?? 0;
            out.push({
              sessionId,
              title,
              workspace: workspaceLabel(workspace),
              updatedAt,
            });
          }
        }
        out.sort((a, b) => b.updatedAt - a.updatedAt);
        return out.slice(0, 30);
      },
    }),
    [sessionsByWorkspaceId, workspaces],
  );
  useControlAction(listSessionsControlAction);

  const openSessionControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.open",
      label: t("session.control_open_session"),
      description: t("session.control_open_session_desc"),
      sideEffect: "navigation",
      requiresArgs: true,
      args: [
        {
          name: "sessionId",
          type: "string",
          required: true,
          description: t("session.control_session_id_desc"),
        },
      ],
      execute: (args) => {
        const sessionId = stringArg(args, "sessionId");
        if (!sessionId) return { ok: false, error: "sessionId is required" };
        navigateToSession(sessionId);
        return { ok: true, navigatedTo: sessionId };
      },
    }),
    [navigateToSession],
  );
  useControlAction(openSessionControlAction);

  const renameSessionControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.rename",
      label: t("session.control_rename_session"),
      description: t("session.control_rename_session_desc"),
      sideEffect: "mutation",
      requiresArgs: true,
      args: [
        {
          name: "sessionId",
          type: "string",
          required: true,
          description: t("session.control_session_id_desc"),
        },
        {
          name: "title",
          type: "string",
          required: true,
          description: t("session.control_new_session_title_desc"),
        },
      ],
      disabled: !opencodeClient,
      execute: async (args) => {
        const sessionId = stringArg(args, "sessionId");
        const title = stringArg(args, "title");
        if (!sessionId) return { ok: false, error: "sessionId is required" };
        if (!title) return { ok: false, error: "title is required" };
        if (!opencodeClient)
          return { ok: false, error: t("session.control_opencode_not_connected") };

        const targetWorkspace = findSessionWorkspace(
          workspaces,
          sessionsByWorkspaceId,
          sessionId,
        );
        await opencodeClient.session.update({
          sessionID: sessionId,
          title,
          directory:
            targetWorkspace?.path || selectedWorkspaceRoot || undefined,
        });
        await refreshRouteState();
        return { ok: true, sessionId, title };
      },
    }),
    [
      opencodeClient,
      refreshRouteState,
      selectedWorkspaceRoot,
      sessionsByWorkspaceId,
      workspaces,
    ],
  );
  useControlAction(renameSessionControlAction);

  const deleteSessionControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.delete",
      label: t("session.control_delete_session"),
      description: t("session.control_delete_session_desc"),
      sideEffect: "mutation",
      requiresArgs: true,
      requiresConfirmation: true,
      args: [
        {
          name: "sessionId",
          type: "string",
          required: true,
          description: t("session.control_session_id_desc"),
        },
        {
          name: "confirmed",
          type: "boolean",
          required: true,
          description: t("session.control_confirmed_desc"),
        },
      ],
      disabled: !onmyagentClient,
      execute: async (args) => {
        const sessionId = stringArg(args, "sessionId");
        const confirmed = booleanArg(args, "confirmed");
        if (!sessionId) return { ok: false, error: "sessionId is required" };
        if (!confirmed)
          return {
            ok: false,
            error: t("session.control_delete_requires_confirmation"),
          };
        if (!onmyagentClient)
          return { ok: false, error: `${APP_NAME} server is not connected` };

        const targetWorkspace = findSessionWorkspace(
          workspaces,
          sessionsByWorkspaceId,
          sessionId,
        );
        if (!targetWorkspace)
          return {
            ok: false,
            error: t("session.control_session_not_found"),
          };
        await onmyagentClient.deleteSession(targetWorkspace.id, sessionId);
        if (selectedSessionId === sessionId) {
          navigateToSessionRoot();
        }
        await refreshRouteState();
        return { ok: true, sessionId, deleted: true };
      },
    }),
    [
      navigateToSessionRoot,
      onmyagentClient,
      refreshRouteState,
      selectedSessionId,
      sessionsByWorkspaceId,
      workspaces,
    ],
  );
  useControlAction(deleteSessionControlAction);

  const modelPickerControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.model_picker.open",
      label: t("session.control_open_model_picker"),
      description: t("session.control_open_model_picker_desc"),
      sideEffect: "none",
      disabled: !selectedWorkspaceId,
      execute: openModelPicker,
    }),
    [openModelPicker, selectedWorkspaceId],
  );
  useControlAction(modelPickerControlAction);
}
