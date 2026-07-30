/**
 * Session-route shortcut listeners:
 * - KEYMAP_EVENT_NEW_TASK from unified keymap dispatcher (⌘/Ctrl+N)
 * - Cmd/Ctrl+K command palette (not in settings keymap table)
 */
import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";

import { KEYMAP_EVENT_NEW_TASK } from "../keymap-dispatcher";
import { resolveSessionRouteGlobalShortcut } from "./control";

type Input = {
  canCreateTask: boolean;
  handleCreateTaskInWorkspace: (workspaceId: string) => void | Promise<void>;
  selectedWorkspaceId: string;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
};

export function useSessionRouteGlobalShortcuts(input: Input) {
  const {
    canCreateTask,
    handleCreateTaskInWorkspace,
    selectedWorkspaceId,
    setCommandPaletteOpen,
  } = input;

  const onNewTaskFromKeymap = useEffectEvent(() => {
    if (!canCreateTask || !selectedWorkspaceId) return;
    void handleCreateTaskInWorkspace(selectedWorkspaceId);
  });

  // Cmd/Ctrl+K stays here (not a settings-table action).
  const handlePaletteShortcut = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = resolveSessionRouteGlobalShortcut({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      platform: typeof navigator !== "undefined" ? navigator.platform : null,
      target: event.target,
      canCreateTask: false,
      selectedWorkspaceId: "",
    });
    if (shortcut.action === "toggle-command-palette") {
      event.preventDefault();
      setCommandPaletteOpen((value) => !value);
    }
  });

  useEffect(() => {
    const onNewTask = () => onNewTaskFromKeymap();
    window.addEventListener(KEYMAP_EVENT_NEW_TASK, onNewTask);
    const onKeyDown = (event: KeyboardEvent) => handlePaletteShortcut(event);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(KEYMAP_EVENT_NEW_TASK, onNewTask);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
