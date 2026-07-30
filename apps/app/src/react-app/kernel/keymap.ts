/**
 * Cross-cutting keymap defaults + match helpers (kernel).
 * Used by shell dispatcher, session composer, and Settings → Shortcuts UI.
 * Accelerators use Electron-style tokens; CommandOrControl is platform-aware.
 */

export type KeymapActionId =
  | "openSettings"
  | "toggleSidebar"
  | "newTask"
  | "searchInCurrentTask"
  | "sendMessage"
  | "insertNewline"
  | "appSnapshot";

export type KeymapGroupId = "general" | "task" | "session" | "global";

export type KeymapActionDef = {
  id: KeymapActionId;
  group: KeymapGroupId;
  /** Electron accelerator, multi (`A|B`), or special (`double-command` / `double-control`). */
  defaultAccelerator: string;
};

/** Actions removed from product: toggleTaskMonitor, quickSwitchTask, searchAllTasks. */
export const DEFAULT_KEYMAP_ACTIONS: readonly KeymapActionDef[] = [
  {
    id: "openSettings",
    group: "general",
    defaultAccelerator: "CommandOrControl+,",
  },
  {
    id: "toggleSidebar",
    group: "general",
    // Match Electron menu default (⌘B / Ctrl+B).
    defaultAccelerator: "CommandOrControl+B",
  },
  {
    id: "newTask",
    group: "task",
    defaultAccelerator: "CommandOrControl+N",
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
    // Shift+Enter only — avoids Ctrl+Enter conflict with send on Windows.
    id: "insertNewline",
    group: "session",
    defaultAccelerator: "Shift+Enter",
  },
  {
    id: "appSnapshot",
    group: "global",
    // Special: mac both Command keys; win both Control keys (see match).
    defaultAccelerator: "double-command",
  },
] as const;

export type KeymapPlatform = "macos" | "windows" | "linux" | "unknown";

export function detectKeymapPlatform(
  platformHint?: string | null,
): KeymapPlatform {
  const p =
    platformHint ??
    (typeof navigator !== "undefined"
      ? navigator.platform || navigator.userAgent
      : "");
  if (/Mac|iPhone|iPad|iPod/i.test(p)) return "macos";
  if (/Win/i.test(p)) return "windows";
  if (/Linux/i.test(p)) return "linux";
  return "unknown";
}

/**
 * Resolved default for an action. App snapshot uses double-control on Windows
 * so both sides of the Ctrl key work without clashing with Cmd-less chords.
 */
export function resolveDefaultAccelerator(
  actionId: KeymapActionId,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  const def = DEFAULT_KEYMAP_ACTIONS.find((a) => a.id === actionId);
  if (!def) return "";
  if (actionId === "appSnapshot") {
    if (platform === "windows" || platform === "linux") return "double-control";
    return "double-command";
  }
  return def.defaultAccelerator;
}

export function resolveAccelerator(
  actionId: KeymapActionId,
  overrides: Record<string, string> | null | undefined,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, actionId)) {
    // Explicit clear → unbound
    return (overrides[actionId] ?? "").trim();
  }
  return resolveDefaultAccelerator(actionId, platform);
}

function mapToken(
  token: string,
  platform: KeymapPlatform,
): string {
  const isMac = platform === "macos";
  const t = token.trim();
  if (/^CommandOrControl$/i.test(t)) return isMac ? "⌘" : "Ctrl";
  if (/^Command$/i.test(t)) return isMac ? "⌘" : "Ctrl";
  if (/^Control$/i.test(t)) return isMac ? "⌃" : "Ctrl";
  if (/^Shift$/i.test(t)) return isMac ? "⇧" : "Shift";
  if (/^(Alt|Option)$/i.test(t)) return isMac ? "⌥" : "Alt";
  if (/^Enter$/i.test(t) || /^Return$/i.test(t)) return isMac ? "↵" : "Enter";
  if (/^Tab$/i.test(t)) return "Tab";
  if (/^Space$/i.test(t)) return "Space";
  if (/^Escape$/i.test(t) || /^Esc$/i.test(t)) return "Esc";
  if (/^Backslash$/i.test(t) || t === "\\") return "\\";
  if (/^Comma$/i.test(t) || t === ",") return ",";
  if (/^Slash$/i.test(t) || t === "/") return "/";
  if (t.length === 1) return t.toUpperCase();
  return t;
}

export function acceleratorToKeyGroups(
  accelerator: string,
  platform: KeymapPlatform = "macos",
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

export function formatAcceleratorForDisplay(
  accelerator: string,
  platform: KeymapPlatform = "macos",
): string {
  return acceleratorToKeyGroups(accelerator, platform)
    .map((keys) => keys.join(""))
    .join(" / ");
}

export function eventToAccelerator(event: KeyboardEvent): string | null {
  const key = event.key;
  if (
    !key ||
    key === "Meta" ||
    key === "Control" ||
    key === "Shift" ||
    key === "Alt"
  ) {
    return null;
  }
  const parts: string[] = [];
  // Prefer CommandOrControl when primary mod is held (platform-neutral storage).
  if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let k = key.length === 1 ? key.toUpperCase() : key;
  if (k === " ") k = "Space";
  if (k === "ArrowUp") k = "Up";
  if (k === "ArrowDown") k = "Down";
  if (k === "ArrowLeft") k = "Left";
  if (k === "ArrowRight") k = "Right";
  if (k === "Escape") k = "Escape";
  parts.push(k);
  return parts.join("+");
}

export type NormalizedChord = {
  /** Primary mod: Meta on mac, Ctrl on win/linux when CommandOrControl used */
  requirePrimaryMod: boolean;
  /** Explicit Control (not CommandOrControl) */
  requireControl: boolean;
  requireMeta: boolean;
  requireAlt: boolean;
  requireShift: boolean;
  /** Lowercase key or special token */
  key: string;
};

function normalizeKeyToken(raw: string): string {
  const t = raw.trim();
  if (/^Enter$/i.test(t) || /^Return$/i.test(t)) return "enter";
  if (/^Esc(ape)?$/i.test(t)) return "escape";
  if (/^Space$/i.test(t)) return " ";
  if (/^Tab$/i.test(t)) return "tab";
  if (/^Up$/i.test(t) || /^ArrowUp$/i.test(t)) return "arrowup";
  if (/^Down$/i.test(t) || /^ArrowDown$/i.test(t)) return "arrowdown";
  if (/^Left$/i.test(t) || /^ArrowLeft$/i.test(t)) return "arrowleft";
  if (/^Right$/i.test(t) || /^ArrowRight$/i.test(t)) return "arrowright";
  if (t === ",") return ",";
  if (t === "\\" || /^Backslash$/i.test(t)) return "\\";
  if (t === "/" || /^Slash$/i.test(t)) return "/";
  if (t.length === 1) return t.toLowerCase();
  return t.toLowerCase();
}

/** Parse one binding like `CommandOrControl+Shift+N` into a chord. */
export function parseBinding(
  binding: string,
  platform: KeymapPlatform,
): NormalizedChord | null {
  const raw = binding.trim();
  if (!raw) return null;
  if (raw === "double-command" || raw === "double-control") {
    return null; // handled specially
  }
  const tokens = raw.split("+").map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return null;

  let requirePrimaryMod = false;
  let requireControl = false;
  let requireMeta = false;
  let requireAlt = false;
  let requireShift = false;
  let key = "";

  for (const token of tokens) {
    if (/^CommandOrControl$/i.test(token)) {
      requirePrimaryMod = true;
      continue;
    }
    if (/^Command$/i.test(token) || /^Meta$/i.test(token) || /^Cmd$/i.test(token)) {
      requireMeta = true;
      continue;
    }
    if (/^Control$/i.test(token) || /^Ctrl$/i.test(token)) {
      requireControl = true;
      continue;
    }
    if (/^Alt$/i.test(token) || /^Option$/i.test(token)) {
      requireAlt = true;
      continue;
    }
    if (/^Shift$/i.test(token)) {
      requireShift = true;
      continue;
    }
    key = normalizeKeyToken(token);
  }
  if (!key) return null;
  return {
    requirePrimaryMod,
    requireControl,
    requireMeta,
    requireAlt,
    requireShift,
    key,
  };
}

function eventKeyNormalized(event: KeyboardEvent): string {
  if (event.key === " ") return " ";
  if (event.key.length === 1) return event.key.toLowerCase();
  return event.key.toLowerCase();
}

export function matchChord(
  event: KeyboardEvent,
  chord: NormalizedChord,
  platform: KeymapPlatform,
): boolean {
  const isMac = platform === "macos";
  // Effective "primary" mod for CommandOrControl:
  // mac → meta, win/linux → ctrl
  const primaryHeld = isMac ? event.metaKey : event.ctrlKey;

  if (chord.requirePrimaryMod && !primaryHeld) return false;
  if (chord.requireMeta && !event.metaKey) return false;
  if (chord.requireControl && !event.ctrlKey) return false;
  if (chord.requireAlt !== event.altKey) return false;
  if (chord.requireShift !== event.shiftKey) return false;

  // When primary is CommandOrControl, the "other" side mod must be down as required:
  // - mac primary uses meta; bare ctrl must match requireControl only
  // - win primary uses ctrl; bare meta must not be pressed unless requireMeta
  if (chord.requirePrimaryMod) {
    if (isMac) {
      // meta is the primary; ctrl is extra only if requireControl
      if (event.ctrlKey !== chord.requireControl) return false;
    } else {
      // ctrl is primary; meta must not be held unless requireMeta
      if (event.metaKey !== chord.requireMeta) return false;
    }
  } else {
    // No primary mod: neither platform primary should be held unless explicit
    if (isMac) {
      if (event.metaKey) return false;
      if (event.ctrlKey !== chord.requireControl) return false;
    } else {
      if (event.ctrlKey && !chord.requireControl) return false;
      if (event.metaKey !== chord.requireMeta) return false;
    }
  }

  return eventKeyNormalized(event) === chord.key;
}

export function matchAccelerator(
  event: KeyboardEvent,
  accelerator: string,
  platform: KeymapPlatform = detectKeymapPlatform(),
): boolean {
  const raw = accelerator.trim();
  if (!raw) return false;
  if (raw === "double-command" || raw === "double-control") {
    return false; // use pressed-modifiers helpers
  }
  return raw.split("|").some((binding) => {
    const chord = parseBinding(binding, platform);
    if (!chord) return false;
    return matchChord(event, chord, platform);
  });
}

/**
 * Find first matching action for this event (stable order of DEFAULT_KEYMAP_ACTIONS).
 * Prefer more specific chords: implemented by checking all and scoring.
 */
export function matchKeymapAction(
  event: KeyboardEvent,
  overrides: Record<string, string> | null | undefined,
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapActionId | null {
  // Prefer longer / more-modified bindings when multiple match (e.g. Cmd+Enter vs Enter).
  let best: { id: KeymapActionId; score: number } | null = null;
  for (const def of DEFAULT_KEYMAP_ACTIONS) {
    const accel = resolveAccelerator(def.id, overrides, platform);
    if (!accel) continue;
    if (!matchAccelerator(event, accel, platform)) continue;
    const score = accelScore(accel, platform);
    if (!best || score > best.score) best = { id: def.id, score };
  }
  return best?.id ?? null;
}

function accelScore(accelerator: string, platform: KeymapPlatform): number {
  // Highest score among alternatives
  return Math.max(
    ...accelerator.split("|").map((binding) => {
      const c = parseBinding(binding, platform);
      if (!c) return 0;
      let s = 1;
      if (c.requirePrimaryMod) s += 4;
      if (c.requireMeta) s += 3;
      if (c.requireControl) s += 3;
      if (c.requireAlt) s += 2;
      if (c.requireShift) s += 2;
      return s;
    }),
  );
}

/** Whether target is an editable field (skip global actions that would steal typing). */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.closest?.("[contenteditable='true']")) return true;
  if (el.closest?.("[data-lexical-editor]")) return true;
  return false;
}

/** Actions that must work even while typing in composer. */
export const COMPOSER_SCOPED_ACTIONS = new Set<KeymapActionId>([
  "sendMessage",
  "insertNewline",
]);

/** Actions that should not fire while typing in generic inputs. */
export function shouldIgnoreForTarget(
  actionId: KeymapActionId,
  target: EventTarget | null,
): boolean {
  if (COMPOSER_SCOPED_ACTIONS.has(actionId)) return false;
  // Search/open settings ok from inputs sometimes — still skip text fields for newTask etc.
  if (actionId === "searchInCurrentTask") return false;
  if (actionId === "openSettings") return false;
  if (actionId === "toggleSidebar") return false;
  if (actionId === "appSnapshot") return false;
  if (actionId === "newTask" && isEditableShortcutTarget(target)) return true;
  return false;
}

// --- Special dual-modifier tracking (left+right Command / Control) ---

const pressedCodes = new Set<string>();

export function noteKeyDownCode(code: string): void {
  pressedCodes.add(code);
}

export function noteKeyUpCode(code: string): void {
  pressedCodes.delete(code);
}

export function clearPressedCodes(): void {
  pressedCodes.clear();
}

export function isDoubleCommandPressed(): boolean {
  return pressedCodes.has("MetaLeft") && pressedCodes.has("MetaRight");
}

export function isDoubleControlPressed(): boolean {
  return pressedCodes.has("ControlLeft") && pressedCodes.has("ControlRight");
}

export function matchSpecialAppSnapshot(
  platform: KeymapPlatform,
  accelerator: string,
): boolean {
  const a = accelerator.trim();
  if (a === "double-command") return isDoubleCommandPressed();
  if (a === "double-control") return isDoubleControlPressed();
  // Platform default when stored as double-command but running on Win
  if (a === "double-command" && platform !== "macos") {
    return isDoubleControlPressed();
  }
  return false;
}
