/**
 * Shared vertical inset tokens for the sticky composer shell.
 *
 * Draft-home / expert-empty used a tighter bottom pad than in-session chat,
 * so the input sat flush on the window edge. Keep one bottom token so the
 * surfaces cannot drift.
 *
 * Embedded panels (expert-creation coach sidebar) opt into flushShell so they
 * do not double the parent panel's padding.
 */

/** Matches in-session chat sticky shell bottom breathing room. */
export const COMPOSER_SHELL_BOTTOM_PAD_CLASS = "pb-5";

/** Outer column under SessionSurfaceComposerColumn — always leave bottom air. */
export const COMPOSER_COLUMN_BOTTOM_PAD_CLASS = "pb-2";

/** Horizontal pad shared with SESSION_CONTENT_X_PADDING_CLASS. */
export const COMPOSER_SHELL_X_PAD_CLASS = "px-4 md:px-8";

/** Embedded / parent-padded hosts: no sticky-shell breathing room. */
export const COMPOSER_SHELL_FLUSH_PAD_CLASS = "px-0 pt-0 pb-0";

/**
 * Sticky composer root padding (width unchanged; bottom always chat-level).
 * flushShell: zero inset when the parent already owns padding (e.g. expert creation).
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
 * Home layouts may collapse top spacing; bottom pad stays equal to chat.
 */
export function resolveComposerColumnShellClass(input: {
  collapseTopSpacing: boolean;
}): string {
  const top = input.collapseTopSpacing ? "pt-0" : "pt-2";
  return `w-full shrink-0 px-0 ${COMPOSER_COLUMN_BOTTOM_PAD_CLASS} ${top}`;
}
