/**
 * Local empty/placeholder illustrations (vendored Koboyo SVGs).
 * Offline-only — no runtime fetch. Prefer height-only sizing (non-square viewBoxes).
 */

/** Full-page empty (expert home, projects, devices). */
export const NO_EXPERT_CONVERSATIONS_ASSET =
  "/illustrations/koboyo/empty-state-screen.svg";

export const PROJECTS_PLACEHOLDER_ASSET =
  "/illustrations/koboyo/empty-state-for-activity.svg";

export const DEVICES_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/desktop-computer-stand.svg";

/** Compact list empties (side columns / list panels). */
export const AUTOMATION_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/calendar.svg";

export const CONVERSATION_HISTORY_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/pair-chat-bubbles.svg";

export const SKILLS_EMPTY_STATE_ASSET = "/illustrations/koboyo/wand.svg";

export const CONNECTORS_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/plugin-socket.svg";

export const SCHEDULED_TASKS_PREVIEW_ASSET =
  "/illustrations/koboyo/backup-schedule.svg";

/** Wave-3: files library / uploads empties. */
export const FILES_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/empty-folder.svg";

/** Session artifacts / document stack empties. */
export const ARTIFACTS_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/stack-papers.svg";

/** Session archive + settings archived-tasks empties. */
export const ARCHIVE_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/archive-box.svg";

/** Company market not-connected / org empty lists. */
export const COMPANY_EMPTY_STATE_ASSET =
  "/illustrations/koboyo/office-building.svg";

/**
 * Shared class for empty-state Koboyo marks.
 * Painted via background + CSS mask (see EmptyStateIllustration) so dark mode
 * inherits dls-secondary instead of black currentColor from external <img>.
 * Explicit width keeps the mask box from collapsing (no SVG intrinsic size).
 */
export const EMPTY_STATE_ILLUSTRATION_CLASS =
  "mb-5 inline-block h-[min(11rem,40vw)] w-[min(14rem,70vw)] max-w-full shrink-0 select-none bg-dls-secondary " +
  "[mask-image:var(--empty-illust)] [mask-size:contain] [mask-repeat:no-repeat] [mask-position:center] " +
  "[-webkit-mask-image:var(--empty-illust)] [-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:center]";

/** Smaller mark for compact EmptyStateBox columns. */
export const EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS =
  "mx-auto mb-3 inline-block h-16 w-[7rem] max-w-full shrink-0 select-none bg-dls-secondary " +
  "[mask-image:var(--empty-illust)] [mask-size:contain] [mask-repeat:no-repeat] [mask-position:center] " +
  "[-webkit-mask-image:var(--empty-illust)] [-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:center]";
