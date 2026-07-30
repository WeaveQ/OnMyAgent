/**
 * Default keymap + helpers for Settings → Shortcuts.
 * Accelerators use Electron-style tokens; UI maps CommandOrControl per platform.
 */

export type KeymapActionId =
  | "openSettings"
  | "toggleSidebar"
  | "toggleTaskMonitor"
  | "quickSwitchTask"
  | "newTask"
  | "searchAllTasks"
  | "searchInCurrentTask"
  | "sendMessage"
  | "insertNewline"
  | "appSnapshot";

export type KeymapGroupId = "general" | "task" | "session" | "global";

export type KeymapActionDef = {
  id: KeymapActionId;
  group: KeymapGroupId;
  /** Electron accelerator or multi (`A|B`) or special (`double-command`). */
  defaultAccelerator: string;
};

export const DEFAULT_KEYMAP_ACTIONS: readonly KeymapActionDef[] = [
  {
    id: "openSettings",
    group: "general",
    defaultAccelerator: "CommandOrControl+,",
  },
  {
    id: "toggleSidebar",
    group: "general",
    defaultAccelerator: "CommandOrControl+\\",
  },
  {
    id: "toggleTaskMonitor",
    group: "general",
    defaultAccelerator: "CommandOrControl+/",
  },
  {
    id: "quickSwitchTask",
    group: "task",
    defaultAccelerator: "Control+Tab",
  },
  {
    id: "newTask",
    group: "task",
    defaultAccelerator: "CommandOrControl+N",
  },
  {
    id: "searchAllTasks",
    group: "task",
    defaultAccelerator: "CommandOrControl+G",
  },
  {
    id: "searchInCurrentTask",
    group: "task",
    defaultAccelerator: "CommandOrControl+F",
  },
  {
    id: "sendMessage",
    group: "session",
    defaultAccelerator: "Enter|CommandOrControl+Enter",
  },
  {
    id: "insertNewline",
    group: "session",
    defaultAccelerator: "Shift+Enter|Control+Enter",
  },
  {
    id: "appSnapshot",
    group: "global",
    defaultAccelerator: "double-command",
  },
] as const;

export function resolveAccelerator(
  actionId: KeymapActionId,
  overrides: Record<string, string> | null | undefined,
): string {
  const fromOverride = overrides?.[actionId]?.trim();
  if (fromOverride) return fromOverride;
  const def = DEFAULT_KEYMAP_ACTIONS.find((a) => a.id === actionId);
  return def?.defaultAccelerator ?? "";
}

/** Display helper: CommandOrControl → ⌘ (mac) / Ctrl (else). */
export function formatAcceleratorForDisplay(
  accelerator: string,
  platform: "macos" | "windows" | "linux" | "unknown" = "macos",
): string {
  if (!accelerator) return "—";
  if (accelerator === "double-command") {
    return platform === "windows" || platform === "linux"
      ? "Ctrl+Ctrl"
      : "⌘+⌘";
  }
  if (accelerator === "double-control") return "Ctrl+Ctrl";

  const isMac = platform === "macos";
  return accelerator
    .split("|")
    .map((part) =>
      part
        .trim()
        .replace(/CommandOrControl/gi, isMac ? "⌘" : "Ctrl")
        .replace(/Command/gi, isMac ? "⌘" : "Ctrl")
        .replace(/Control/gi, isMac ? "⌃" : "Ctrl")
        .replace(/Shift/gi, isMac ? "⇧" : "Shift")
        .replace(/Alt|Option/gi, isMac ? "⌥" : "Alt")
        .replace(/Enter/gi, "↵")
        .replace(/\+/g, " + "),
    )
    .join(" / ");
}

export function eventToAccelerator(event: KeyboardEvent): string | null {
  const key = event.key;
  if (!key || key === "Meta" || key === "Control" || key === "Shift" || key === "Alt") {
    return null;
  }
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let k = key.length === 1 ? key.toUpperCase() : key;
  if (k === " ") k = "Space";
  if (k === "ArrowUp") k = "Up";
  if (k === "ArrowDown") k = "Down";
  if (k === "ArrowLeft") k = "Left";
  if (k === "ArrowRight") k = "Right";
  parts.push(k);
  return parts.join("+");
}
