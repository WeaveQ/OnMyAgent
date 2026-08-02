/**
 * Settings-route workspace CRUD + remote connection check handlers.
 * Extracted from settings-route/render.tsx (mechanical split).
 */
import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";

import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type {
  WorkspaceConnectionState,
  WorkspacePreset,
} from "../../../app/types";
import { t } from "../../../i18n";
import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import type { RestrictionNoticeController } from "../../domains/cloud";
import {
  useRemoteWorkspaceConnectionEditor,
} from "../../domains/workspace";
import { writeActiveWorkspaceId } from "../session-memory";
import { workspaceSettingsRoute } from "../workspace-routes";
import {
  describeWorkspaceCreateError,
  settingsPathForRoute,
  workspaceLabel,
  type RouteWorkspace,
  type SettingsRoutePath,
} from "./model";
import {
  buildRemoteWorkspaceConnectingState,
  remoteWorkspaceConnectionCheckIsCurrent,
  resolveRemoteWorkspaceConnectionCheckTarget,
  runRemoteWorkspaceConnectionCheckTarget,
} from "./remote-workspace-actions";
import {
  activateDesktopSettingsWorkspaceInBackground,
  createLocalSettingsWorkspaceAndRefresh,
  createRemoteSettingsWorkspaceAndRefresh,
  forgetSettingsWorkspaceAndRefresh,
  pickAndExportSettingsWorkspaceConfig,
  renameSettingsWorkspaceAndRefresh,
  revealSettingsWorkspacePath,
} from "./workspace-actions";

export type SettingsWorkspaceHandlersInput = {
  workspaces: RouteWorkspace[];
  workspacesRef: MutableRefObject<RouteWorkspace[]>;
  selectedWorkspaceId: string;
  onmyagentClient: OnMyAgentServerClient | null;
  route: SettingsRoutePath;
  locationState: unknown;
  navigate: NavigateFunction;
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  restrictionNotice: RestrictionNoticeController;
  refreshRouteState: () => Promise<void>;
  setLegacySelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setCreateWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceBusy: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceError: Dispatch<SetStateAction<string | null>>;
  setCreateWorkspaceRemoteBusy: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceRemoteError: Dispatch<SetStateAction<string | null>>;
  renameWorkspaceId: string | null;
  setRenameWorkspaceId: Dispatch<SetStateAction<string | null>>;
  renameWorkspaceTitle: string;
  setRenameWorkspaceTitle: Dispatch<SetStateAction<string>>;
  setRenameWorkspaceBusy: Dispatch<SetStateAction<boolean>>;
  setExportWorkspaceBusy: Dispatch<SetStateAction<boolean>>;
  setWorkspaceConnectionOverrides: Dispatch<
    SetStateAction<Record<string, WorkspaceConnectionState>>
  >;
  setErrorsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, string | null>>
  >;
};

/** Mechanical extract of settings workspace modal/list action handlers. */
export function useSettingsWorkspaceHandlers(input: SettingsWorkspaceHandlersInput) {
  const {
    workspaces,
    workspacesRef,
    selectedWorkspaceId,
    onmyagentClient,
    route,
    locationState,
    navigate,
    checkDesktopRestriction,
    restrictionNotice,
    refreshRouteState,
    setLegacySelectedWorkspaceId,
    setCreateWorkspaceOpen,
    setCreateWorkspaceBusy,
    setCreateWorkspaceError,
    setCreateWorkspaceRemoteBusy,
    setCreateWorkspaceRemoteError,
    renameWorkspaceId,
    setRenameWorkspaceId,
    renameWorkspaceTitle,
    setRenameWorkspaceTitle,
    setRenameWorkspaceBusy,
    setExportWorkspaceBusy,
    setWorkspaceConnectionOverrides,
    setErrorsByWorkspaceId,
  } = input;

  const remoteWorkspaceCheckRunRef = useRef<Record<string, string>>({});
  const remoteWorkspaceCheckRunCounterRef = useRef(0);

  const handleRemoteWorkspaceConnectionSaved = useCallback(
    async (workspaceId: string) => {
      delete remoteWorkspaceCheckRunRef.current[workspaceId];
      setWorkspaceConnectionOverrides((current) => {
        const next = { ...current };
        delete next[workspaceId];
        return next;
      });
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      await refreshRouteState();
    },
    [refreshRouteState, setErrorsByWorkspaceId, setWorkspaceConnectionOverrides],
  );

  const remoteWorkspaceConnectionEditor = useRemoteWorkspaceConnectionEditor({
    workspaces,
    onSaved: handleRemoteWorkspaceConnectionSaved,
  });

  const runRemoteWorkspaceConnectionCheck = useCallback(
    async (workspaceId: string, mode: "test" | "recover") => {
      remoteWorkspaceCheckRunCounterRef.current += 1;
      const runId = String(remoteWorkspaceCheckRunCounterRef.current);
      const target = resolveRemoteWorkspaceConnectionCheckTarget({
        runId,
        workspaceId,
        workspaces: workspacesRef.current,
      });
      if (!target) return false;
      remoteWorkspaceCheckRunRef.current[workspaceId] = runId;

      setWorkspaceConnectionOverrides((current) => ({
        ...current,
        [workspaceId]: buildRemoteWorkspaceConnectingState(),
      }));

      const check = await runRemoteWorkspaceConnectionCheckTarget(target);
      if (!check) return false;
      const currentWorkspace = workspacesRef.current.find((item) => item.id === workspaceId);
      if (
        !remoteWorkspaceConnectionCheckIsCurrent({
          activeRunId: remoteWorkspaceCheckRunRef.current[workspaceId],
          check,
          currentWorkspace,
        })
      ) {
        if (remoteWorkspaceCheckRunRef.current[workspaceId] === check.runId) {
          delete remoteWorkspaceCheckRunRef.current[workspaceId];
        }
        return false;
      }
      setWorkspaceConnectionOverrides((current) => ({
        ...current,
        [workspaceId]: check.result.state,
      }));

      if (!check.result.ok) {
        setErrorsByWorkspaceId((current) => ({
          ...current,
          [workspaceId]:
            check.result.state.message ?? t("app.error_remote_worker_connection_failed"),
        }));
        if (remoteWorkspaceCheckRunRef.current[workspaceId] === check.runId) {
          delete remoteWorkspaceCheckRunRef.current[workspaceId];
        }
        return false;
      }

      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      if (mode === "recover") {
        await refreshRouteState();
      }
      if (remoteWorkspaceCheckRunRef.current[workspaceId] === check.runId) {
        delete remoteWorkspaceCheckRunRef.current[workspaceId];
      }
      return true;
    },
    [
      refreshRouteState,
      setErrorsByWorkspaceId,
      setWorkspaceConnectionOverrides,
      workspacesRef,
    ],
  );

  const handleOpenCreateWorkspace = useCallback(() => {
    if (
      workspaces.length > 0 &&
      checkDesktopRestriction({ restriction: "allowMultipleWorkspaces" })
    ) {
      restrictionNotice.show({
        title: t("workspace_list.restricted_workspaces_title"),
        message: t("workspace_list.restricted_workspaces_message"),
      });
      return;
    }

    setCreateWorkspaceError(null);
    setCreateWorkspaceRemoteError(null);
    setCreateWorkspaceOpen(true);
  }, [
    checkDesktopRestriction,
    restrictionNotice,
    setCreateWorkspaceError,
    setCreateWorkspaceOpen,
    setCreateWorkspaceRemoteError,
    workspaces.length,
  ]);

  const handleSelectSettingsWorkspace = useCallback(
    (workspaceId: string) => {
      setLegacySelectedWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId);
      activateDesktopSettingsWorkspaceInBackground(workspaceId);
      navigate(workspaceSettingsRoute(workspaceId, settingsPathForRoute(route)), {
        state: locationState,
      });
    },
    [locationState, navigate, route, setLegacySelectedWorkspaceId],
  );

  const handleOpenRenameWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return;
      setRenameWorkspaceId(workspaceId);
      setRenameWorkspaceTitle(workspaceLabel(workspace));
    },
    [setRenameWorkspaceId, setRenameWorkspaceTitle, workspaces],
  );

  const handleSaveRenameWorkspace = useCallback(async () => {
    if (!renameWorkspaceId) return;
    const trimmed = renameWorkspaceTitle.trim();
    if (!trimmed) return;
    setRenameWorkspaceBusy(true);
    try {
      await renameSettingsWorkspaceAndRefresh({
        displayName: trimmed,
        onmyagentClient,
        refreshRouteState,
        workspaceId: renameWorkspaceId,
      });
      setRenameWorkspaceId(null);
      setRenameWorkspaceTitle("");
    } finally {
      setRenameWorkspaceBusy(false);
    }
  }, [
    onmyagentClient,
    refreshRouteState,
    renameWorkspaceId,
    renameWorkspaceTitle,
    setRenameWorkspaceBusy,
    setRenameWorkspaceId,
    setRenameWorkspaceTitle,
  ]);

  const handleRevealWorkspace = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      await revealSettingsWorkspacePath(workspace?.path ?? "");
    },
    [workspaces],
  );

  const handleExportWorkspaceConfig = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
      if (!workspace) return;
      setExportWorkspaceBusy(true);
      try {
        await pickAndExportSettingsWorkspaceConfig({
          workspaceId,
          workspaceLabel: workspaceLabel(workspace),
        });
      } finally {
        setExportWorkspaceBusy(false);
      }
    },
    [setExportWorkspaceBusy, workspaces],
  );

  const handleForgetWorkspace = useCallback(
    async (workspaceId: string) => {
      if (typeof window !== "undefined") {
        const message = t("workspace_list.remove_confirm");
        if (!window.confirm(message)) return;
      }
      const nextId = await forgetSettingsWorkspaceAndRefresh({
        onmyagentClient,
        refreshRouteState,
        selectedWorkspaceId,
        workspaceId,
        workspaces,
      });
      if (nextId !== selectedWorkspaceId) {
        setLegacySelectedWorkspaceId(nextId);
      }
    },
    [
      onmyagentClient,
      refreshRouteState,
      selectedWorkspaceId,
      setLegacySelectedWorkspaceId,
      workspaces,
    ],
  );

  const handleCreateWorkspace = useCallback(
    async (preset: WorkspacePreset, folder: string | null) => {
      if (!folder) return;
      setCreateWorkspaceBusy(true);
      setCreateWorkspaceError(null);
      try {
        await createLocalSettingsWorkspaceAndRefresh({
          folder,
          onmyagentClient,
          preset,
          refreshRouteState,
        });
        setCreateWorkspaceOpen(false);
      } catch (error) {
        setCreateWorkspaceError(describeWorkspaceCreateError(error));
      } finally {
        setCreateWorkspaceBusy(false);
      }
    },
    [
      onmyagentClient,
      refreshRouteState,
      setCreateWorkspaceBusy,
      setCreateWorkspaceError,
      setCreateWorkspaceOpen,
    ],
  );

  const handleCreateRemoteWorkspace = useCallback(
    async (createInput: {
      onmyagentHostUrl?: string | null;
      onmyagentToken?: string | null;
      directory?: string | null;
      displayName?: string | null;
    }) => {
      setCreateWorkspaceRemoteBusy(true);
      setCreateWorkspaceRemoteError(null);
      try {
        const created = await createRemoteSettingsWorkspaceAndRefresh({
          ...createInput,
          refreshRouteState,
        });
        if (!created) return false;
        setCreateWorkspaceOpen(false);
        return true;
      } catch (error) {
        setCreateWorkspaceRemoteError(
          error instanceof Error ? error.message : t("app.unknown_error"),
        );
        return false;
      } finally {
        setCreateWorkspaceRemoteBusy(false);
      }
    },
    [
      refreshRouteState,
      setCreateWorkspaceOpen,
      setCreateWorkspaceRemoteBusy,
      setCreateWorkspaceRemoteError,
    ],
  );

  return {
    remoteWorkspaceConnectionEditor,
    runRemoteWorkspaceConnectionCheck,
    handleOpenCreateWorkspace,
    handleSelectSettingsWorkspace,
    handleOpenRenameWorkspace,
    handleSaveRenameWorkspace,
    handleRevealWorkspace,
    handleExportWorkspaceConfig,
    handleForgetWorkspace,
    handleCreateWorkspace,
    handleCreateRemoteWorkspace,
  };
}
