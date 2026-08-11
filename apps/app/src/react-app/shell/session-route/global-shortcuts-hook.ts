/**
 * Session-route shortcut listeners:
 * - KEYMAP_EVENT_NEW_TASK from unified keymap dispatcher (⌘/Ctrl+N)
 * - Tray "continue last session"
 * - Cmd/Ctrl+K command palette (not in settings keymap table)
 *
 * Quick-capture submit is handled by shell `QuickCaptureSubmitBridge` +
 * pending queue consumed in `useSessionRouteQuickCapture` (SessionRoute may
 * be unmounted on settings).
 */
import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";

import {
  KEYMAP_EVENT_NEW_TASK,
  NATIVE_MENU_RECENT_SESSION_EVENT,
} from "../keymap-dispatcher";
import { resolveSessionRouteGlobalShortcut } from "./control";

type Input = {
  canCreateTask: boolean;
  handleCreateTaskInWorkspace: (workspaceId: string) => void | Promise<void>;
  /** @deprecated kept for call-site compat; quick-capture no longer uses this hook */
  handleCreateTaskWithPrompt?: (
    workspaceId: string,
    prompt: string,
    model?: { providerID: string; modelID: string } | null,
  ) => void | Promise<void>;
  /** Navigate to the most recently used session for the active workspace. */
  handleOpenRecentSession?: () => void | Promise<void>;
  selectedWorkspaceId: string;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
};

export function useSessionRouteGlobalShortcuts(input: Input) {
  const {
    handleCreateTaskInWorkspace,
    handleOpenRecentSession,
    selectedWorkspaceId,
    setCommandPaletteOpen,
  } = input;

  const onNewTaskFromKeymap = useEffectEvent(() => {
    // New-task shortcut only needs a workspace; model readiness is checked on send.
    // (canCreateTask / model availability must not block opening a draft.)
    if (!selectedWorkspaceId) return;
    void handleCreateTaskInWorkspace(selectedWorkspaceId);
  });

  const onRecentSession = useEffectEvent(() => {
    void handleOpenRecentSession?.();
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
    window.addEventListener(NATIVE_MENU_RECENT_SESSION_EVENT, onRecentSession);
    const onKeyDown = (event: KeyboardEvent) => handlePaletteShortcut(event);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(KEYMAP_EVENT_NEW_TASK, onNewTask);
      window.removeEventListener(
        NATIVE_MENU_RECENT_SESSION_EVENT,
        onRecentSession,
      );
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
