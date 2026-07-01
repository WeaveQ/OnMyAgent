import { useEffect, useMemo, useState } from "react";

import type { WorkspaceSessionGroup } from "../../../../app/types";
import { sessionTitleForId } from "./session-page-model";

type UseSessionPageSessionActionsInput = {
  selectedSessionId: string | null;
  workspaceSessionGroups: WorkspaceSessionGroup[];
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
};

export function useSessionPageSessionActions(
  input: UseSessionPageSessionActionsInput,
) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);

  const sessionActionTitle = useMemo(
    () => sessionTitleForId(input.workspaceSessionGroups, sessionActionId),
    [input.workspaceSessionGroups, sessionActionId],
  );

  const canSaveRename =
    renameTitle.trim().length > 0 &&
    renameTitle.trim() !== sessionActionTitle.trim();

  useEffect(() => {
    setRenameOpen(false);
    setDeleteOpen(false);
    setRenameBusy(false);
    setDeleteBusy(false);
    setSessionActionId(null);
  }, [input.selectedSessionId]);

  const openRenameModal = (sessionId: string) => {
    if (!input.onRenameSession) return;
    setSessionActionId(sessionId);
    setRenameTitle(sessionTitleForId(input.workspaceSessionGroups, sessionId));
    setRenameOpen(true);
  };

  const closeRenameModal = () => {
    if (!renameBusy) setRenameOpen(false);
  };

  const submitRename = async () => {
    const sessionId = sessionActionId;
    const nextTitle = renameTitle.trim();
    if (!sessionId || !input.onRenameSession || !nextTitle || !canSaveRename)
      return;
    setRenameBusy(true);
    try {
      await input.onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const openDeleteModal = (sessionId: string) => {
    if (!input.onDeleteSession) return;
    setSessionActionId(sessionId);
    setDeleteOpen(true);
  };

  const closeDeleteModal = () => {
    if (!deleteBusy) setDeleteOpen(false);
  };

  const confirmDelete = async () => {
    const sessionId = sessionActionId;
    if (!sessionId || !input.onDeleteSession) return;
    setDeleteBusy(true);
    try {
      await input.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  return {
    renameOpen,
    renameTitle,
    renameBusy,
    canSaveRename,
    setRenameTitle,
    openRenameModal,
    closeRenameModal,
    submitRename,
    deleteOpen,
    deleteBusy,
    sessionActionTitle,
    openDeleteModal,
    closeDeleteModal,
    confirmDelete,
  };
}
