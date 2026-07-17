/**
 * Shared page typography + chrome classes for OnMyAgent surfaces.
 * Prefer these over ad-hoc text-xl/lg/base mixes on page headers.
 */
export const typeScale = {
  /** Full-page / panel chrome title (settings shell uses xl; side panels use lg). */
  pageTitle: "text-lg font-medium leading-7 text-dls-text",
  pageTitleSm: "text-base font-medium leading-6 text-dls-text",
  pageSubtitle: "text-sm leading-5 text-dls-secondary",
  sectionTitle: "text-sm font-medium leading-5 text-dls-text",
  dialogTitle: "text-base font-medium leading-6 text-dls-text",
} as const;

export const shellChrome = {
  /** Standard top bar for full-height side pages */
  pageHeader:
    "flex h-12 shrink-0 items-center justify-between gap-3 border-b border-dls-border bg-dls-background px-6",
  pageHeaderSimple:
    "flex h-12 shrink-0 items-center border-b border-dls-border bg-dls-background px-6",
} as const;
