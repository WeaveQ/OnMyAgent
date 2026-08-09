/**
 * Pure class resolution for composer home / hero / in-session chrome.
 * Keeps visual tokens out of the heavy composer.tsx render path.
 */

import { resolveComposerShellPadClass } from "../composer-shell-inset";
import { SESSION_CONTENT_MAX_WIDTH_CLASS } from "../surface-styles";

export { SESSION_CONTENT_MAX_WIDTH_CLASS };

export type ComposerLayoutInput = {
  homeLayout?: boolean;
  heroHome?: boolean;
  showOuterBorder?: boolean;
  compactTopSpacing?: boolean;
  /** Parent already pads the host (expert-creation coach); drop sticky shell air. */
  flushShell?: boolean;
  hasBottomAccessory?: boolean;
  hasAttachments?: boolean;
  mentionOpen?: boolean;
  slashOpen?: boolean;
};

export type ComposerLayoutClasses = {
  homeLayout: boolean;
  heroHome: boolean;
  inlineToolbarAccessory: boolean;
  underCardAccessory: boolean;
  panelRoundedClass: string;
  shellPadClass: string;
  panelChromeClass: string;
  editorPadClass: string;
  rootChromeClass: string;
  contentMaxWidthClass: typeof SESSION_CONTENT_MAX_WIDTH_CLASS;
};

/**
 * Resolve sticky shell, panel chrome, and editor padding for home/hero/chat.
 */
export function resolveComposerLayoutClasses(
  input: ComposerLayoutInput,
): ComposerLayoutClasses {
  const homeLayout = Boolean(input.homeLayout);
  const heroHome = Boolean(input.heroHome);
  // Home / expert-empty: fold workspace+permission into the primary toolbar so
  // the card stays one compact unit (no tall empty middle + sparse under-bar).
  const inlineToolbarAccessory = homeLayout && Boolean(input.hasBottomAccessory);
  const underCardAccessory =
    Boolean(input.hasBottomAccessory) && !inlineToolbarAccessory;
  // When workspace/permission bar sits under the card, share the outer silhouette:
  // full width + square joint (no top corners on the bar, no bottom corners on the card).
  const panelRoundedClass =
    input.mentionOpen || input.slashOpen
      ? "rounded-t-[18px] border-t-transparent"
      : underCardAccessory
        ? "rounded-t-xl rounded-b-none"
        : heroHome
          ? "rounded-2xl"
          : "rounded-xl";

  // Same width for hero home, expert empty, and in-session (1120 + side pad).
  // Bottom inset matches in-session chat so draft-home is not flush to the edge.
  // flushShell (expert-creation coach) skips sticky air — parent panel owns pad.
  const shellPadClass = resolveComposerShellPadClass({
    compactTopSpacing: input.compactTopSpacing,
    flushShell: input.flushShell,
  });
  const panelChromeClass = heroHome
    ? `relative overflow-visible bg-dls-surface-solid border border-dls-border/80 shadow-md shadow-black/10 ${panelRoundedClass}`
    : `relative overflow-visible bg-dls-surface-solid ${input.showOuterBorder ? `border border-dls-border shadow-sm${underCardAccessory ? " border-b-0" : ""}` : ""} ${panelRoundedClass}`;
  // flushShell (coach): more vertical air so the text field + toolbar
  // don't feel jammed in a narrow creation column.
  const editorPadClass = input.flushShell
    ? input.hasAttachments
      ? "px-3.5 pb-3 pt-3.5"
      : "px-3.5 pb-3 pt-4"
    : input.hasAttachments
      ? heroHome
        ? "px-5 pb-2.5 pt-3"
        : "px-4 pb-2 pt-2"
      : heroHome
        ? "px-5 pb-2.5 pt-4"
        : "px-4 pb-2 pt-3";

  const rootChromeClass =
    homeLayout || heroHome || input.flushShell
      ? `bg-transparent ${shellPadClass}`
      : `bg-gradient-to-t from-dls-background via-dls-background/95 to-transparent ${shellPadClass}`;

  return {
    homeLayout,
    heroHome,
    inlineToolbarAccessory,
    underCardAccessory,
    panelRoundedClass,
    shellPadClass,
    panelChromeClass,
    editorPadClass,
    rootChromeClass,
    contentMaxWidthClass: SESSION_CONTENT_MAX_WIDTH_CLASS,
  };
}
