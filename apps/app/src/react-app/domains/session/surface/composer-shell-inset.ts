/**
 * Shared vertical inset tokens for the sticky composer shell.
 *
 * Bottom air matches the conversation sidebar footer (`aside` pb-5 +
 * New task CTA) so the composer card baseline and the CTA sit on one
 * horizontal band. Extra column padding used to lift the input above
 * that line.
 *
 * Embedded panels (expert-creation coach sidebar) opt into flushShell so they
 * do not double the parent panel's padding.
 */

/**
 * Sticky shell bottom breathing room — same token as
 * `agent-conversation-panel` aside `pb-5`.
 */
export const COMPOSER_SHELL_BOTTOM_PAD_CLASS = "pb-5";

/**
 * Outer column under SessionSurfaceComposerColumn.
 * Bottom pad is 0 so shell `pb-5` alone aligns with the sidebar CTA.
 */
export const COMPOSER_COLUMN_BOTTOM_PAD_CLASS = "pb-0";

/** Horizontal pad shared with SESSION_CONTENT_X_PADDING_CLASS. */
export const COMPOSER_SHELL_X_PAD_CLASS = "px-4 md:px-6";

/**
 * Embedded hosts (expert-creation coach): modest pad only — not full chat
 * gutters (px-4 md:px-6) and not zero (that jammed the input against the card).
 */
export const COMPOSER_SHELL_FLUSH_PAD_CLASS = "px-3 pt-2.5 pb-4";

/**
 * Sticky composer root padding (width unchanged; bottom always chat-level).
 * flushShell: compact embedded inset (coach sidebar), not parent-double pad.
 */
export function resolveComposerShellPadClass(input: {
  compactTopSpacing?: boolean;
  flushShell?: boolean;
}): string {
  if (input.flushShell) return COMPOSER_SHELL_FLUSH_PAD_CLASS;
  const top = input.compactTopSpacing ? "pt-0" : "pt-3";
  return `${COMPOSER_SHELL_X_PAD_CLASS} ${top} ${COMPOSER_SHELL_BOTTOM_PAD_CLASS}`;
}

/**
 * Column wrapper around the composer host.
 * Home layouts may collapse top spacing; bottom pad stays equal to chat
 * (shell-owned so sidebar New task and composer share one baseline).
 */
export function resolveComposerColumnShellClass(input: {
  collapseTopSpacing: boolean;
}): string {
  const top = input.collapseTopSpacing ? "pt-0" : "pt-2";
  return `w-full shrink-0 px-0 ${COMPOSER_COLUMN_BOTTOM_PAD_CLASS} ${top}`;
}
