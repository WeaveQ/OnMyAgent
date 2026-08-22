/**
 * Wire session control actions + command-palette control surface for the route.
 * Extracted from render.tsx to stay under file-size baseline.
 */
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { createClient } from "../../../app/lib/opencode";
import type { SidebarSessionItem } from "../../../app/types";
import {
  clearComposerDraftForNewTask,
  useSessionControlActions,
} from "../../domains/session";
import { useControlAction } from "../control/control-provider";
import {
  buildCommandPaletteControlAction,
  resolveControlSessionWorkspaceId,
} from "./control";
import type { RouteWorkspace } from "./model";
import { toControlSessionEntries } from "./sessions";

type Input = {
  workspaces: RouteWorkspace[];
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  sessionWorkspaceRoot: string;
  canCreateTask: boolean;
  client: OnMyAgentServerClient | null;
  opencodeClient: ReturnType<typeof createClient> | null;
  handleCreateTaskInWorkspace: (workspaceId: string) => void | Promise<void>;
  navigateToWorkspaceSession: (
    workspaceId: string,
    sessionId?: string | null,
  ) => void;
  setModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  refreshRouteState: () => void | Promise<void>;
  routeRuntimeKind?: "opencode" | "grok-build" | null;
};

export function useSessionRouteControlWiring(input: Input) {
  const {
    workspaces,
    sessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedSessionId,
    sessionWorkspaceRoot,
    canCreateTask,
    client,
    opencodeClient,
    handleCreateTaskInWorkspace,
    navigateToWorkspaceSession,
    setModelPickerOpen,
    setCommandPaletteOpen,
    refreshRouteState,
    routeRuntimeKind,
  } = input;

  const navigateToSessionForControl = useCallback(
    (sessionId: string) => {
      const owner = resolveControlSessionWorkspaceId({
        sessionsByWorkspaceId,
        sessionId,
        fallbackWorkspaceId: selectedWorkspaceId,
      });
      navigateToWorkspaceSession(owner, sessionId);
    },
    [navigateToWorkspaceSession, selectedWorkspaceId, sessionsByWorkspaceId],
  );

  const navigateToSessionRootForControl = useCallback(() => {
    navigateToWorkspaceSession(selectedWorkspaceId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId]);

  const openModelPickerForControl = useCallback(() => {
    setModelPickerOpen(true);
  }, [setModelPickerOpen]);

  const controlSessionsByWorkspaceId = useMemo(
    () => toControlSessionEntries(sessionsByWorkspaceId),
    [sessionsByWorkspaceId],
  );

  useSessionControlActions({
    workspaces,
    sessionsByWorkspaceId: controlSessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedWorkspaceRoot: sessionWorkspaceRoot,
    selectedSessionId,
    canCreateTask,
    onmyagentClient: client,
    opencodeClient,
    navigateToSession: navigateToSessionForControl,
    navigateToSessionRoot: navigateToSessionRootForControl,
    createTaskInWorkspace: (workspaceId) => {
      clearComposerDraftForNewTask(workspaceId);
      return handleCreateTaskInWorkspace(workspaceId);
    },
    openModelPicker: openModelPickerForControl,
    refreshRouteState,
    routeRuntimeKind,
  });

  const commandPaletteControlAction = useMemo(
    () =>
      buildCommandPaletteControlAction({
        openCommandPalette: () => setCommandPaletteOpen(true),
      }),
    [setCommandPaletteOpen],
  );
  useControlAction(commandPaletteControlAction);
}
