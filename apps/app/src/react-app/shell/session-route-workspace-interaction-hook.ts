/**
 * Workspace modal actions + create-task / remote-check handlers for session route.
 */
import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";

import { pickDirectory } from "../../app/lib/desktop";
import type { OnMyAgentServerClient } from "../../app/lib/onmyagent-server";
import type {
  WorkspaceConnectionState,
  WorkspacePreset,
} from "../../app/types";
import { isDesktopRuntime } from "../../app/utils";
import { t } from "../../i18n";
import { usePendingAgentStore } from "../domains/agents";
import type { LocalPreferences } from "../kernel/local-provider";
import {
  forgetWorkspaceMemory,
  writeActiveWorkspaceId,
  writeWorkspaceOrderIds,
} from "./session-memory";
import {
  resolveCreateTaskWorkspaceNavigation,
  resolveRenameWorkspaceTarget,
  resolveWorkspaceExportTarget,
  resolveWorkspaceRevealTarget,
  shouldBlockCreateWorkspaceForRestriction,
  shouldNavigateAfterForgettingWorkspace,
} from "./session-route-control";
import {
  buildWorkspaceReorderIds,
  describeWorkspaceCreateError,
  findRouteWorkspace,
  normalizePickedDirectory,
  orderRouteWorkspaces,
  type RouteWorkspace,
} from "./session-route-model";
import {
  buildSessionRemoteWorkspaceConnectingState,
  resolveSessionRemoteWorkspaceConnectionCheckTarget,
  runSessionRemoteWorkspaceConnectionCheckTarget,
  sessionRemoteWorkspaceConnectionCheckIsCurrent,
} from "./session-route-remote-workspace-actions";
import {
  clearWorkspaceConnectionCheckRun,
  setWorkspaceConnectionStateById,
} from "./session-route-sidebar-model";
import { focusPromptSoon } from "./session-route-state";
import {
  createLocalSessionWorkspaceAndRefresh,
  createRemoteSessionWorkspaceAndRefresh,
  exportSessionWorkspaceConfig,
  forgetSessionWorkspaceAndRefresh,
  renameSessionWorkspaceAndRefresh,
  revealSessionWorkspacePath,
} from "./session-route-workspace-actions";
import { legacySessionRoute } from "./workspace-routes";

type NavigateToWorkspaceSession = (
  workspaceId: string,
  sessionId?: string | null,
  options?: { replace?: boolean },
) => void;

export type SessionRouteWorkspaceInteractionInput = {
  checkDesktopRestriction: (input: {
    restriction: "allowMultipleWorkspaces";
  }) => boolean;
  client: OnMyAgentServerClient | null;
  loading: boolean;
  local: {
    setPrefs: (
      updater: (previous: LocalPreferences) => LocalPreferences,
    ) => void;
  };
  navigate: NavigateFunction;
  navigateToWorkspaceSession: NavigateToWorkspaceSession;
  refreshRouteState: () => Promise<unknown>;
  remoteAccessRestart: {
    save: (enabled: boolean) => Promise<void> | void;
  };
  remoteWorkspaceCheckRunCounterRef: MutableRefObject<number>;
  remoteWorkspaceCheckRunRef: MutableRefObject<Record<string, string>>;
  renameWorkspaceId: string | null;
  renameWorkspaceTitle: string;
  restrictionNotice: {
    show: (input: { title: string; message: string }) => void;
  };
  retryingWorkspaceIds: string[];
  selectedWorkspaceId: string;
  setAssistantDraftWorkspaceRoot: Dispatch<SetStateAction<string>>;
  setCreateWorkspaceBusy: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceError: Dispatch<SetStateAction<string | null>>;
  setCreateWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceRemoteBusy: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceRemoteError: Dispatch<SetStateAction<string | null>>;
  setErrorsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, string | null>>
  >;
  setLegacySelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setRenameWorkspaceBusy: Dispatch<SetStateAction<boolean>>;
  setRenameWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setRenameWorkspaceTitle: Dispatch<SetStateAction<string>>;
  setRetryingWorkspaceIds: Dispatch<SetStateAction<string[]>>;
  setWorkspaceConnectionOverrides: Dispatch<
    SetStateAction<Record<string, WorkspaceConnectionState>>
  >;
  setWorkspaceOrderIds: Dispatch<SetStateAction<string[]>>;
  setWorkspaces: Dispatch<SetStateAction<RouteWorkspace[]>>;
  shareWorkspaceState: {
    openShareWorkspace: (workspaceId: string) => void;
  };
  suppressRestoreSessionRef: MutableRefObject<boolean>;
  workspaces: RouteWorkspace[];
  workspacesRef: MutableRefObject<RouteWorkspace[]>;
  workspaceOrderIdsRef: MutableRefObject<string[]>;
};

export function useSessionRouteWorkspaceInteraction(
  input: SessionRouteWorkspaceInteractionInput,
) {
  const {
    checkDesktopRestriction,
    client,
    loading,
    local,
    navigate,
    navigateToWorkspaceSession,
    refreshRouteState,
    remoteAccessRestart,
    remoteWorkspaceCheckRunCounterRef,
    remoteWorkspaceCheckRunRef,
    renameWorkspaceId,
    renameWorkspaceTitle,
    restrictionNotice,
    retryingWorkspaceIds,
    selectedWorkspaceId,
    setAssistantDraftWorkspaceRoot,
    setCreateWorkspaceBusy,
    setCreateWorkspaceError,
    setCreateWorkspaceOpen,
    setCreateWorkspaceRemoteBusy,
    setCreateWorkspaceRemoteError,
    setErrorsByWorkspaceId,
    setLegacySelectedWorkspaceId,
    setRenameWorkspaceBusy,
    setRenameWorkspaceId,
    setRenameWorkspaceTitle,
    setRetryingWorkspaceIds,
    setWorkspaceConnectionOverrides,
    setWorkspaceOrderIds,
    setWorkspaces,
    shareWorkspaceState,
    suppressRestoreSessionRef,
    workspaces,
    workspacesRef,
    workspaceOrderIdsRef,
  } = input;

  const handleOpenCreateWorkspace = useCallback(() => {
    // Respect the org-level `allowMultipleWorkspaces` restriction (dev
    // #1505). If the checker returns true, the admin has disabled
    // adding further workspaces; surface a friendly notice instead of
    // opening the modal.
    if (shouldBlockCreateWorkspaceForRestriction({
      multipleWorkspacesRestricted: checkDesktopRestriction({ restriction: "allowMultipleWorkspaces" }),
      workspaceCount: workspaces.length,
    })) {
      restrictionNotice.show({
        title: t("workspace_list.restricted_workspaces_title"),
        message:
          t("workspace_list.restricted_workspaces_message"),
      });
      return;
    }
    setCreateWorkspaceRemoteError(null);
    setCreateWorkspaceOpen(true);
  }, [checkDesktopRestriction, restrictionNotice, workspaces.length]);

  const handleOpenRenameWorkspace = useCallback(
    (workspaceId: string) => {
      const target = resolveRenameWorkspaceTarget({ workspaceId, workspaces });
      if (!target) return;
      setRenameWorkspaceId(target.workspaceId);
      setRenameWorkspaceTitle(target.title);
    },
    [workspaces],
  );

  const handleSaveRenameWorkspace = useCallback(async () => {
    if (!renameWorkspaceId) return;
    const trimmed = renameWorkspaceTitle.trim();
    if (!trimmed) return;
    setRenameWorkspaceBusy(true);
    try {
      await renameSessionWorkspaceAndRefresh({
        workspaceId: renameWorkspaceId,
        displayName: trimmed,
        onmyagentClient: client,
        refreshRouteState,
      });
      setRenameWorkspaceId(null);
      setRenameWorkspaceTitle("");
    } finally {
      setRenameWorkspaceBusy(false);
    }
  }, [client, refreshRouteState, renameWorkspaceId, renameWorkspaceTitle]);

  const handleRevealWorkspace = useCallback(
    async (workspaceId: string) => {
      const path = resolveWorkspaceRevealTarget({ workspaceId, workspaces });
      if (!path || !isDesktopRuntime()) return;
      await revealSessionWorkspacePath(path);
    },
    [workspaces],
  );

  const handleShareWorkspace = useCallback(
    (workspaceId: string) => {
      shareWorkspaceState.openShareWorkspace(workspaceId);
    },
    [shareWorkspaceState],
  );

  const handleSaveShareRemoteAccess = useCallback(
    async (enabled: boolean) => {
      if (!isDesktopRuntime()) return;
      await remoteAccessRestart.save(enabled);
    },
    [remoteAccessRestart],
  );

  const handleExportWorkspaceConfig = useCallback(
    async (workspaceId: string) => {
      if (!isDesktopRuntime()) return;
      const target = resolveWorkspaceExportTarget({ workspaceId, workspaces });
      if (!target) return;
      const outputPath = await pickDirectory({
        title: target.title,
      });
      const targetPath = normalizePickedDirectory(outputPath);
      if (!targetPath) return;
      await exportSessionWorkspaceConfig({ workspaceId: target.workspaceId, outputPath: targetPath });
    },
    [workspaces],
  );

  const handleForgetWorkspace = useCallback(
    async (workspaceId: string) => {
      if (typeof window !== "undefined") {
        const message =
          t("workspace_list.remove_confirm") ||
          "Remove this workspace from the sidebar?";
        if (!window.confirm(message)) return;
      }
      await forgetSessionWorkspaceAndRefresh({ workspaceId, onmyagentClient: client, refreshRouteState });
      if (shouldNavigateAfterForgettingWorkspace({ selectedWorkspaceId, workspaceId })) {
        setLegacySelectedWorkspaceId("");
        writeActiveWorkspaceId(null);
        navigate(legacySessionRoute());
      }
      forgetWorkspaceMemory(workspaceId);
    },
    [client, navigate, refreshRouteState, selectedWorkspaceId],
  );

  const runRemoteWorkspaceConnectionCheck = useCallback(
    async (workspaceId: string, mode: "test" | "recover") => {
      remoteWorkspaceCheckRunCounterRef.current += 1;
      const runId = String(remoteWorkspaceCheckRunCounterRef.current);
      const target = resolveSessionRemoteWorkspaceConnectionCheckTarget({
        runId,
        workspaceId,
        workspaces: workspacesRef.current,
      });
      if (!target) return false;
      remoteWorkspaceCheckRunRef.current[workspaceId] = runId;

      setWorkspaceConnectionOverrides((current) =>
        setWorkspaceConnectionStateById({
          states: current,
          workspaceId,
          state: buildSessionRemoteWorkspaceConnectingState(),
        }),
      );

      const check = await runSessionRemoteWorkspaceConnectionCheckTarget(target);
      if (!check) return false;
      const currentWorkspace = findRouteWorkspace(workspacesRef.current, workspaceId);
      if (!sessionRemoteWorkspaceConnectionCheckIsCurrent({
        activeRunByWorkspaceId: remoteWorkspaceCheckRunRef.current,
        check,
        currentWorkspace,
      })) {
        clearWorkspaceConnectionCheckRun({
          activeRunByWorkspaceId: remoteWorkspaceCheckRunRef.current,
          workspaceId,
          runId: check.runId,
        });
        return false;
      }
      setWorkspaceConnectionOverrides((current) =>
        setWorkspaceConnectionStateById({
          states: current,
          workspaceId,
          state: check.result.state,
        }),
      );

      if (!check.result.ok) {
        setErrorsByWorkspaceId((current) => ({
          ...current,
          [workspaceId]:
            check.result.state.message ?? t("app.error_remote_worker_connection_failed"),
        }));
        clearWorkspaceConnectionCheckRun({
          activeRunByWorkspaceId: remoteWorkspaceCheckRunRef.current,
          workspaceId,
          runId: check.runId,
        });
        return false;
      }

      setErrorsByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: null,
      }));
      setRetryingWorkspaceIds((current) =>
        current.filter((id) => id !== workspaceId),
      );
      if (mode === "recover") {
        await refreshRouteState();
      }
      clearWorkspaceConnectionCheckRun({
        activeRunByWorkspaceId: remoteWorkspaceCheckRunRef.current,
        workspaceId,
        runId: check.runId,
      });
      return true;
    },
    [refreshRouteState],
  );

  const handleCreateTaskInWorkspace = useCallback(
    async (workspaceId: string) => {
      const navigation = resolveCreateTaskWorkspaceNavigation({
        workspaces,
        workspaceId,
        loading,
        retryingWorkspaceIds,
      });
      if (!navigation) return;
      // Clear any stale pending-agent context so a plain "+新任务" navigation
      // doesn't inherit the previous agent card's persona/welcome card. The
      // agent card flow re-sets `pendingAgent` immediately after calling
      // `onCreateTaskInWorkspace`, so this clear is always "overridden" in
      // that path.
      usePendingAgentStore.getState().setAgent(null);
      setAssistantDraftWorkspaceRoot("");
      setLegacySelectedWorkspaceId(navigation.workspaceId);
      writeActiveWorkspaceId(navigation.activeWorkspaceId);
      suppressRestoreSessionRef.current = true;
      navigateToWorkspaceSession(navigation.workspaceId, null);
      focusPromptSoon();
    },
    [loading, navigateToWorkspaceSession, retryingWorkspaceIds, workspaces],
  );
  const handleReorderWorkspaces = useCallback((workspaceIds: string[]) => {
    const nextOrderIds = buildWorkspaceReorderIds({
      workspaces: workspacesRef.current,
      requestedWorkspaceIds: workspaceIds,
    });

    workspaceOrderIdsRef.current = nextOrderIds;
    setWorkspaceOrderIds(nextOrderIds);
    writeWorkspaceOrderIds(nextOrderIds);
    setWorkspaces((current) => orderRouteWorkspaces(current, nextOrderIds));
  }, []);

  const handleCreateWorkspace = useCallback(
    async (preset: WorkspacePreset, folder: string | null) => {
      if (!folder) return;
      setCreateWorkspaceBusy(true);
      setCreateWorkspaceError(null);
      try {
        const targetWorkspaceId = await createLocalSessionWorkspaceAndRefresh({
          folder,
          preset,
          onmyagentClient: client,
          refreshRouteState,
        });
        setCreateWorkspaceOpen(false);
        // Mark onboarding complete so the /welcome redirect never fires again.
        local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
        if (targetWorkspaceId) {
          setLegacySelectedWorkspaceId(targetWorkspaceId);
          writeActiveWorkspaceId(targetWorkspaceId);
          navigateToWorkspaceSession(targetWorkspaceId, null, {
            replace: true,
          });
        }
      } catch (error) {
        setCreateWorkspaceError(describeWorkspaceCreateError(error));
      } finally {
        setCreateWorkspaceBusy(false);
      }
    },
    [
      client,
      local,
      navigateToWorkspaceSession,
      refreshRouteState,
    ],
  );

  const handleCreateRemoteWorkspace = useCallback(
    async (input: {
      onmyagentHostUrl?: string | null;
      onmyagentToken?: string | null;
      directory?: string | null;
      displayName?: string | null;
    }) => {
      const baseUrlValue = input.onmyagentHostUrl?.trim() ?? "";
      if (!baseUrlValue) return false;
      setCreateWorkspaceRemoteBusy(true);
      setCreateWorkspaceRemoteError(null);
      try {
        const created = await createRemoteSessionWorkspaceAndRefresh({ ...input, refreshRouteState });
        if (!created) return false;
        setCreateWorkspaceOpen(false);
        // Mark onboarding complete so the /welcome redirect never fires again.
        local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
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
    [local, refreshRouteState],
  );

  return {
    handleOpenCreateWorkspace,
    handleOpenRenameWorkspace,
    handleSaveRenameWorkspace,
    handleRevealWorkspace,
    handleShareWorkspace,
    handleSaveShareRemoteAccess,
    handleExportWorkspaceConfig,
    handleForgetWorkspace,
    runRemoteWorkspaceConnectionCheck,
    handleCreateTaskInWorkspace,
    handleReorderWorkspaces,
    handleCreateWorkspace,
    handleCreateRemoteWorkspace,
  };
}
