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
  /**
   * Standard top bar for full-height side pages (市场 / 管理 / 文件).
   * min-h-14 + py-3 matches home session chrome breathing room and avoids
   * tabs sitting too tight under the mac traffic-light titlebar.
   */
  pageHeader:
    "flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-dls-border bg-dls-background px-6 py-3",
  pageHeaderSimple:
    "flex min-h-14 shrink-0 items-center border-b border-dls-border bg-dls-background px-6 py-3",
} as const;
