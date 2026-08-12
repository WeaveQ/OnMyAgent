/** Leaf toast types — monitors import these without cycling through status-toasts. */
import type { LucideIcon } from "lucide-react";

export type AppStatusToastTone = "success" | "info" | "warning" | "error";

export type AppStatusToastInput = {
  title: string;
  description?: string | null;
  tone?: AppStatusToastTone;
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  durationMs?: number;
  /**
   * Stable identity for a toast whose content updates over time (e.g. a
   * download progress percentage). Toasts sharing a tag replace one another
   * in place — keeping the same id — instead of stacking or resetting their
   * auto-dismiss timer on every update. When omitted, dedupe falls back to a
   * content fingerprint (title/description/tone).
   */
  tag?: string;
  /** Called when the toast is dismissed (via × or its secondary action). */
  onDismiss?: () => void;
  /** Override the default tone icon (e.g. a spinner for an in-progress toast). */
  icon?: LucideIcon;
  /** Animate the icon with a continuous spin (used with a spinner icon). */
  spinIcon?: boolean;
};

export type AppStatusToast = AppStatusToastInput & {
  id: string;
};
