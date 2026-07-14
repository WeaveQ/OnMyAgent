export const modalBodyClass = "min-h-0 flex-1 overflow-y-auto";

export const surfaceCardClass =
  "rounded-xl border border-dls-border bg-dls-surface p-5";

export const softCardClass =
  "rounded-xl border border-dls-border bg-dls-hover p-4";

export const interactiveCardClass =
  "rounded-xl border border-dls-border bg-dls-surface p-5 text-left transition-all duration-150 hover:border-dls-border focus:outline-none focus:ring-2 focus:ring-dls-accent/30";

export const iconTileClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover text-dls-secondary";

export const sectionTitleClass =
  "text-base font-medium text-dls-text";

export const sectionBodyClass = "mt-1 text-sm leading-relaxed text-dls-secondary";

export const inputLabelClass = "text-sm font-medium text-dls-text";

export const inputHintClass = "text-xs leading-5 text-dls-secondary";

export const inputClass =
  "w-full rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60";

export const subtleInputClass =
  "w-full rounded-xl border border-dls-border bg-dls-hover px-4 py-3 text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60";

const pillButtonBaseClass =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60";

export const pillPrimaryClass = `${pillButtonBaseClass} bg-dls-accent text-dls-accent-fg hover:bg-dls-accent-hover`;

export const pillSecondaryClass = `${pillButtonBaseClass} border border-dls-border bg-dls-surface text-dls-text hover:bg-dls-hover`;

export const pillGhostClass = `${pillButtonBaseClass} border border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text`;

export const tagClass =
  "inline-flex items-center rounded-md border border-dls-border bg-dls-hover px-2 py-1 text-xs text-dls-secondary";

export const infoBannerClass =
  "rounded-xl border border-dls-border bg-dls-hover px-4 py-3 text-sm text-dls-secondary";

export const warningBannerClass =
  "rounded-xl border border-dls-status-warning-border bg-dls-status-warning-soft px-4 py-3 text-sm text-dls-status-warning";

export const errorBannerClass =
  "rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-4 py-3 text-sm text-dls-status-danger-fg";

export const successBannerClass =
  "rounded-xl border border-dls-status-success-border bg-dls-status-success-soft px-4 py-3 text-sm text-dls-status-success-fg";

export const modalNoticeNeutralClass =
  "rounded-xl border border-dls-border bg-dls-hover px-3 py-2.5 text-sm leading-relaxed text-dls-text";

export const modalNoticeSuccessClass =
  "rounded-xl border border-dls-border bg-dls-status-success-soft px-3 py-2.5 text-sm leading-relaxed text-dls-text";

export const modalNoticeErrorClass =
  "rounded-xl border border-dls-border bg-dls-status-danger-soft px-3 py-2.5 text-sm leading-relaxed text-dls-text";
