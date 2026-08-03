/**
 * Session-route shortcut listeners:
 * - KEYMAP_EVENT_NEW_TASK from unified keymap dispatcher (⌘/Ctrl+N)
 * - Quick capture submit (global mini panel → create task with prompt)
 * - Tray "continue last session"
 * - Cmd/Ctrl+K command palette (not in settings keymap table)
 */
import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";

import {
  KEYMAP_EVENT_NEW_TASK,
  NATIVE_MENU_RECENT_SESSION_EVENT,
  QUICK_CAPTURE_SUBMIT_EVENT,
} from "../keymap-dispatcher";
import { resolveSessionRouteGlobalShortcut } from "./control";

type Input = {
  canCreateTask: boolean;
  handleCreateTaskInWorkspace: (workspaceId: string) => void | Promise<void>;
  /** Create a session and seed the composer draft with prompt text. */
  handleCreateTaskWithPrompt: (
    workspaceId: string,
    prompt: string,
  ) => void | Promise<void>;
  /** Navigate to the most recently used session for the active workspace. */
  handleOpenRecentSession?: () => void | Promise<void>;
  selectedWorkspaceId: string;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
};

export function useSessionRouteGlobalShortcuts(input: Input) {
  const {
    canCreateTask,
    handleCreateTaskInWorkspace,
    handleCreateTaskWithPrompt,
    handleOpenRecentSession,
    selectedWorkspaceId,
    setCommandPaletteOpen,
  } = input;

  const onNewTaskFromKeymap = useEffectEvent(() => {
    if (!canCreateTask || !selectedWorkspaceId) return;
    void handleCreateTaskInWorkspace(selectedWorkspaceId);
  });

  const onQuickCaptureSubmit = useEffectEvent(
    (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; mode?: string }>)
        .detail;
      const text = String(detail?.text ?? "").trim();
      if (!text) return;
      if (!canCreateTask || !selectedWorkspaceId) {
        // No workspace yet — open empty new-task flow so user can pick context.
        if (selectedWorkspaceId) {
          void handleCreateTaskInWorkspace(selectedWorkspaceId);
        }
        return;
      }
      // mode=todo reserved for a future inbox path; treat as agent for now.
      void handleCreateTaskWithPrompt(selectedWorkspaceId, text);
    },
  );

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
    window.addEventListener(QUICK_CAPTURE_SUBMIT_EVENT, onQuickCaptureSubmit);
    window.addEventListener(NATIVE_MENU_RECENT_SESSION_EVENT, onRecentSession);
    const onKeyDown = (event: KeyboardEvent) => handlePaletteShortcut(event);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(KEYMAP_EVENT_NEW_TASK, onNewTask);
      window.removeEventListener(
        QUICK_CAPTURE_SUBMIT_EVENT,
        onQuickCaptureSubmit,
      );
      window.removeEventListener(
        NATIVE_MENU_RECENT_SESSION_EVENT,
        onRecentSession,
      );
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
