/**
 * Shared main content column width for session transcript/composer and
 * personal-local-agent chat chrome. Single source of truth — do not scatter
 * `max-w-[1120px]` or the numeric 1120 elsewhere in product UI.
 */

export const SESSION_CONTENT_MAX_WIDTH_PX = 1120;

/** Tailwind max-width class matching SESSION_CONTENT_MAX_WIDTH_PX. */
export const SESSION_CONTENT_MAX_WIDTH_CLASS = "max-w-[1120px]" as const;

/** Horizontal padding on the scroll/composer column (px-4 / md:px-8). */
export const SESSION_CONTENT_X_PADDING_CLASS = "px-4 md:px-8" as const;

/** md breakpoint (px) used with SESSION_CONTENT_X_PADDING_CLASS gutters. */
export const SESSION_CONTENT_MD_BREAKPOINT_PX = 768;

/** Horizontal pad in px: 16*2 below md, 32*2 at md+. */
export function sessionContentHorizontalPadPx(containerWidth: number): number {
  return containerWidth >= SESSION_CONTENT_MD_BREAKPOINT_PX ? 64 : 32;
}
