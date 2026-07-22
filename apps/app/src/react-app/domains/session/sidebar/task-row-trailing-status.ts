/**
 * Single decision for list-row trailing chrome: busy pulse / unread / idle time.
 * Used by assistant tasks, expert conversation rows, and session-page agent rows.
 */
import { expertActivityLabel } from "./utils";

export type TaskRowTrailingKind = "busy" | "unread" | "time";

export type TaskRowTrailingStatus = {
  kind: TaskRowTrailingKind;
  /** Present when kind === "busy" (localized activity label). */
  activityLabel: string | null;
  /** Present when kind === "time". */
  timeLabel: string;
};

/**
 * Priority: busy (incl. selected) > unread (only when unselected) > time.
 * Selected + unread + idle → time (never unread while focused).
 */
export function resolveTaskRowTrailingStatus(input: {
  status?: string | null;
  unread?: boolean;
  selected?: boolean;
  timeLabel: string;
}): TaskRowTrailingStatus {
  const activityLabel = expertActivityLabel(input.status ?? undefined);
  if (activityLabel) {
    return {
      kind: "busy",
      activityLabel,
      timeLabel: input.timeLabel,
    };
  }
  const showUnread = Boolean(input.unread) && !input.selected;
  if (showUnread) {
    return {
      kind: "unread",
      activityLabel: null,
      timeLabel: input.timeLabel,
    };
  }
  return {
    kind: "time",
    activityLabel: null,
    timeLabel: input.timeLabel,
  };
}
