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

/** Shared class for empty-state Koboyo marks: height-driven, not square-forced. */
export const EMPTY_STATE_ILLUSTRATION_CLASS =
  "mb-5 h-[min(11rem,40vw)] w-auto max-w-[min(14rem,70vw)] select-none object-contain text-dls-secondary";

/** Smaller mark for compact EmptyStateBox columns. */
export const EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS =
  "mx-auto mb-3 h-16 w-auto max-w-[7rem] select-none object-contain text-dls-secondary";
