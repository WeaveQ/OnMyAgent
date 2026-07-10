/** UI chrome state: create/rename workspace modals + command palette. */
import { useCallback, useEffect, useState } from "react";

import type { OpenTarget } from "../domains/session";

export function useSessionRouteChromeState(input: {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
}) {
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(
    null,
  );
  const [createWorkspaceRemoteBusy, setCreateWorkspaceRemoteBusy] =
    useState(false);
  const [createWorkspaceRemoteError, setCreateWorkspaceRemoteError] = useState<
    string | null
  >(null);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameWorkspaceTitle, setRenameWorkspaceTitle] = useState("");
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteAccessibleTargets, setPaletteAccessibleTargets] = useState<
    OpenTarget[]
  >([]);

  useEffect(() => {
    setPaletteAccessibleTargets([]);
  }, [input.selectedSessionId, input.selectedWorkspaceId]);

  const resetCreateWorkspaceErrors = useCallback(() => {
    setCreateWorkspaceError(null);
    setCreateWorkspaceRemoteError(null);
  }, []);

  return {
    createWorkspaceOpen,
    setCreateWorkspaceOpen,
    createWorkspaceBusy,
    setCreateWorkspaceBusy,
    createWorkspaceError,
    setCreateWorkspaceError,
    createWorkspaceRemoteBusy,
    setCreateWorkspaceRemoteBusy,
    createWorkspaceRemoteError,
    setCreateWorkspaceRemoteError,
    renameWorkspaceId,
    setRenameWorkspaceId,
    renameWorkspaceTitle,
    setRenameWorkspaceTitle,
    renameWorkspaceBusy,
    setRenameWorkspaceBusy,
    commandPaletteOpen,
    setCommandPaletteOpen,
    paletteAccessibleTargets,
    setPaletteAccessibleTargets,
    resetCreateWorkspaceErrors,
  };
}
