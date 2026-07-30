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

function mapToken(
  token: string,
  platform: "macos" | "windows" | "linux" | "unknown",
): string {
  const isMac = platform === "macos";
  const t = token.trim();
  if (/^CommandOrControl$/i.test(t)) return isMac ? "⌘" : "Ctrl";
  if (/^Command$/i.test(t)) return isMac ? "⌘" : "Ctrl";
  if (/^Control$/i.test(t)) return isMac ? "⌃" : "Ctrl";
  if (/^Shift$/i.test(t)) return isMac ? "⇧" : "Shift";
  if (/^(Alt|Option)$/i.test(t)) return isMac ? "⌥" : "Alt";
  if (/^Enter$/i.test(t)) return "↵";
  if (/^Tab$/i.test(t)) return "Tab";
  if (/^Space$/i.test(t)) return "Space";
  if (/^Backslash$/i.test(t) || t === "\\") return "\\";
  if (/^Comma$/i.test(t) || t === ",") return ",";
  if (/^Slash$/i.test(t) || t === "/") return "/";
  if (t.length === 1) return t.toUpperCase();
  return t;
}

/**
 * Split one binding into key labels for kbd chips.
 * Multi-bindings (`A|B`) become separate alternatives (array of arrays).
 */
export function acceleratorToKeyGroups(
  accelerator: string,
  platform: "macos" | "windows" | "linux" | "unknown" = "macos",
): string[][] {
  if (!accelerator) return [["—"]];
  if (accelerator === "double-command") {
    return platform === "windows" || platform === "linux"
      ? [["Ctrl", "Ctrl"]]
      : [["⌘", "⌘"]];
  }
  if (accelerator === "double-control") return [["Ctrl", "Ctrl"]];

  return accelerator.split("|").map((binding) =>
    binding
      .trim()
      .split("+")
      .map((part) => mapToken(part, platform))
      .filter(Boolean),
  );
}

/** Display helper: CommandOrControl → ⌘ (mac) / Ctrl (else). Compact, no extra spaces. */
export function formatAcceleratorForDisplay(
  accelerator: string,
  platform: "macos" | "windows" | "linux" | "unknown" = "macos",
): string {
  return acceleratorToKeyGroups(accelerator, platform)
    .map((keys) => keys.join(""))
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
