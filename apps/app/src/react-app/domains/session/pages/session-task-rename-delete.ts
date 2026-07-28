import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceSessionGroup } from "../../../../app/types";
import { sessionTitleForId } from "../sidebar/session-chrome";

export type SessionDeleteSessionTarget = {
  kind: "session";
  sessionId: string;
};

export type UseSessionTaskRenameDeleteOptions<TGroupDelete> = {
  selectedSessionId: string | null;
  workspaceSessionGroups: WorkspaceSessionGroup[];
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  /**
   * Run the actual delete. Hook owns busy flags and closes the modal on success.
   */
  executeDelete: (
    target: SessionDeleteSessionTarget | TGroupDelete,
  ) => Promise<void> | void;
  /**
   * Assistant aborts group delete when no real sessions remain.
   * Expert still opens confirm for pin/local cleanup when empty.
   * @default true
   */
  requireGroupSessionIds?: boolean;
};

/**
 * Shared rename/delete session modal state for ExpertPage and AssistantPage.
 * Group delete target shape stays page-specific via the generic parameter.
 */
export function useSessionTaskRenameDelete<
  TGroupDelete extends { sessionIds: string[] },
>(options: UseSessionTaskRenameDeleteOptions<TGroupDelete>) {
  const {
    selectedSessionId,
    workspaceSessionGroups,
    onRenameSession,
    onDeleteSession,
    executeDelete,
    requireGroupSessionIds = true,
  } = options;

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    SessionDeleteSessionTarget | TGroupDelete | null
  >(null);

  const sessionActionTitle = useMemo(
    () => sessionTitleForId(workspaceSessionGroups, sessionActionId),
    [workspaceSessionGroups, sessionActionId],
  );

  // Close rename when selection changes. Do NOT abort an in-flight group delete:
  // deleting the currently open run navigates away (selectedSessionId changes)
  // and used to clear deleteTarget mid-loop, so remaining runs + the schedule
  // survived — “定时任务删不掉”.
  useEffect(() => {
    setRenameOpen(false);
    setRenameBusy(false);
    setSessionActionId(null);
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeleteTarget(null);
  }, [selectedSessionId, deleteBusy]);

  const openRenameModal = useCallback(
    (sessionId: string, title: string) => {
      if (!onRenameSession) return;
      setSessionActionId(sessionId);
      setRenameTitle(title);
      setRenameOpen(true);
    },
    [onRenameSession],
  );

  const openDeleteModal = useCallback(
    (sessionId: string) => {
      if (!onDeleteSession) return;
      setSessionActionId(sessionId);
      setDeleteTarget({ kind: "session", sessionId });
      setDeleteOpen(true);
    },
    [onDeleteSession],
  );

  const openDeleteGroupModal = useCallback(
    (target: TGroupDelete) => {
      if (!onDeleteSession) return;
      const sessionIds = target.sessionIds.filter(
        (id) => id.trim() && !id.startsWith("draft:"),
      );
      if (requireGroupSessionIds && sessionIds.length === 0) return;
      setSessionActionId(null);
      setDeleteTarget({ ...target, sessionIds });
      setDeleteOpen(true);
    },
    [onDeleteSession, requireGroupSessionIds],
  );

  const submitRename = useCallback(async () => {
    const sessionId = sessionActionId;
    const nextTitle = renameTitle.trim();
    if (
      !sessionId ||
      !onRenameSession ||
      !nextTitle ||
      nextTitle === sessionActionTitle.trim()
    ) {
      return;
    }
    setRenameBusy(true);
    try {
      await onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  }, [onRenameSession, renameTitle, sessionActionId, sessionActionTitle]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    if (
      "kind" in deleteTarget &&
      (deleteTarget as SessionDeleteSessionTarget).kind === "session" &&
      !onDeleteSession
    ) {
      return;
    }
    setDeleteBusy(true);
    try {
      await executeDelete(deleteTarget);
      setDeleteOpen(false);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, executeDelete, onDeleteSession]);

  const closeDeleteModal = useCallback(() => {
    if (!deleteBusy) {
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  }, [deleteBusy]);

  const closeRenameModal = useCallback(() => {
    if (!renameBusy) setRenameOpen(false);
  }, [renameBusy]);

  const canSaveRename =
    renameTitle.trim().length > 0 &&
    renameTitle.trim() !== sessionActionTitle.trim();

  return {
    renameOpen,
    renameTitle,
    setRenameTitle,
    renameBusy,
    canSaveRename,
    deleteOpen,
    deleteBusy,
    deleteTarget,
    sessionActionId,
    sessionActionTitle,
    openRenameModal,
    openDeleteModal,
    openDeleteGroupModal,
    submitRename,
    confirmDelete,
    closeDeleteModal,
    closeRenameModal,
  };
}
