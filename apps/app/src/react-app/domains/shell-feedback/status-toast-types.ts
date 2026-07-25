/** Leaf toast types — monitors import these without cycling through status-toasts. */

export type AppStatusToastTone = "success" | "info" | "warning" | "error";

export type AppStatusToastInput = {
  title: string;
  description?: string | null;
  tone?: AppStatusToastTone;
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  durationMs?: number;
};

export type AppStatusToast = AppStatusToastInput & {
  id: string;
};
