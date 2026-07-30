/**
 * Shared main content column width for session transcript/composer and
 * personal-local-agent chat chrome. Single source of truth — do not scatter
 * `max-w-[1120px]` or the numeric 1120 elsewhere in product UI.
 */

export const SESSION_CONTENT_MAX_WIDTH_PX = 1120;

/**
 * Tailwind max-width class. Fixed vs wide is controlled by CSS variable
 * `--session-content-max-w` (set from LocalPreferences.conversationWidth).
 * Default 1120px matches SESSION_CONTENT_MAX_WIDTH_PX when the var is unset.
 */
export const SESSION_CONTENT_MAX_WIDTH_CLASS =
  "max-w-[var(--session-content-max-w,1120px)]" as const;

/** Wide mode: follow the outer main pane (no fixed product max). */
export const SESSION_CONTENT_WIDE_CLASS = "max-w-none" as const;

export type ConversationWidthMode = "fixed" | "wide";

/** Resolve column max-width class from preferences.conversationWidth. */
export function sessionContentMaxWidthClass(
  mode: ConversationWidthMode | null | undefined = "fixed",
): string {
  return mode === "wide"
    ? SESSION_CONTENT_WIDE_CLASS
    : SESSION_CONTENT_MAX_WIDTH_CLASS;
}

/** Apply conversation width CSS variable on documentElement (desktop/web shell). */
export function applyConversationWidthCssVar(
  mode: ConversationWidthMode | null | undefined,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "wide") {
    root.style.setProperty("--session-content-max-w", "none");
    root.dataset.conversationWidth = "wide";
  } else {
    root.style.setProperty(
      "--session-content-max-w",
      `${SESSION_CONTENT_MAX_WIDTH_PX}px`,
    );
    root.dataset.conversationWidth = "fixed";
  }
}

/** Cap for layout math; wide mode returns the full available width. */
export function sessionContentMaxWidthPx(
  mode: ConversationWidthMode | null | undefined,
  available: number,
): number {
  if (mode === "wide") return Math.max(0, available);
  return Math.min(SESSION_CONTENT_MAX_WIDTH_PX, Math.max(0, available));
}

/** Horizontal padding on the scroll/composer column (px-4 / md:px-8). */
export const SESSION_CONTENT_X_PADDING_CLASS = "px-4 md:px-8" as const;

/** md breakpoint (px) used with SESSION_CONTENT_X_PADDING_CLASS gutters. */
export const SESSION_CONTENT_MD_BREAKPOINT_PX = 768;

/** Horizontal pad in px: 16*2 below md, 32*2 at md+. */
export function sessionContentHorizontalPadPx(containerWidth: number): number {
  return containerWidth >= SESSION_CONTENT_MD_BREAKPOINT_PX ? 64 : 32;
}
