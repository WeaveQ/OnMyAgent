/**
 * Platform-aware shortcut formatting — DESIGN.md § 5a.
 * Uses hair-space around "+" and substitutes ⌘/Ctrl at runtime.
 */

const IS_APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "")

const MOD_KEY = IS_APPLE ? "⌘" : "Ctrl"
const ALT_KEY = IS_APPLE ? "⌥" : "Alt"
const SHIFT_KEY = IS_APPLE ? "⇧" : "Shift"

/** Canonical separator with hair space (U+200A). */
export const SHORTCUT_SEPARATOR = " \u200A+\u200A "

export type ShortcutToken =
  | "Mod"
  | "Meta"
  | "Cmd"
  | "Ctrl"
  | "Alt"
  | "Option"
  | "Shift"
  | "Enter"
  | "Esc"
  | "Escape"
  | "Tab"
  | "Space"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | (string & {})

function mapToken(token: string): string {
  const key = token.trim()
  const lower = key.toLowerCase()
  if (lower === "mod" || lower === "meta" || lower === "cmd" || lower === "command") return MOD_KEY
  if (lower === "ctrl" || lower === "control") return IS_APPLE ? "⌃" : "Ctrl"
  if (lower === "alt" || lower === "option") return ALT_KEY
  if (lower === "shift") return SHIFT_KEY
  if (lower === "enter" || lower === "return") return IS_APPLE ? "↩" : "Enter"
  if (lower === "esc" || lower === "escape") return "Esc"
  if (lower === "tab") return "Tab"
  if (lower === "space" || lower === " ") return "Space"
  if (lower === "arrowup" || lower === "up") return "↑"
  if (lower === "arrowdown" || lower === "down") return "↓"
  if (lower === "arrowleft" || lower === "left") return "←"
  if (lower === "arrowright" || lower === "right") return "→"
  if (key.length === 1) return key.toUpperCase()
  return key
}

/**
 * Format a shortcut chord for display.
 * @example formatShortcut(["Mod", "K"]) // "⌘ + K" or "Ctrl + K"
 * @example formatShortcut("Mod+Shift+P")
 */
export function formatShortcut(input: ShortcutToken[] | string): string {
  const tokens =
    typeof input === "string"
      ? input.split(/[+\s]+/).filter(Boolean)
      : input.map(String)
  return tokens.map(mapToken).join(SHORTCUT_SEPARATOR)
}

export function isApplePlatform(): boolean {
  return IS_APPLE
}
