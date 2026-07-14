/**
 * Cmd/Ctrl+N create-task and Cmd/Ctrl+K command palette shortcuts.
 */
import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";

import { resolveSessionRouteGlobalShortcut } from "./session-route-control";

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

  // Global shortcuts:
  //   Cmd/Ctrl+N  -> new task in selected workspace
  //   Cmd/Ctrl+K  -> toggle command palette
  const handleGlobalShortcut = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = resolveSessionRouteGlobalShortcut({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      platform: typeof navigator !== "undefined" ? navigator.platform : null,
      target: event.target,
      canCreateTask,
      selectedWorkspaceId,
    });

    if (shortcut.action === "create-task") {
      event.preventDefault();
      if (shortcut.workspaceId) {
        void handleCreateTaskInWorkspace(shortcut.workspaceId);
      }
      return;
    }
    if (shortcut.action === "toggle-command-palette") {
      event.preventDefault();
      setCommandPaletteOpen((value) => !value);
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleGlobalShortcut(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);


}
