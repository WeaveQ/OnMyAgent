/**
 * Shared page typography + chrome classes for OnMyAgent surfaces.
 * Prefer these over ad-hoc text-xl/lg/base mixes on page headers.
 *
 * List-lane fixed h-14 geometry lives in `@/components/ui/sidebar-chrome`
 * (`LIST_LANE_HEADER_CLASS` / `SIDEBAR_PRIMARY_HEADER_CLASS`) so ui/ stays
 * free of react-app imports; re-exported here for design-system discoverability.
 */
import {
  LIST_LANE_HEADER_CLASS,
  SIDEBAR_PRIMARY_HEADER_CLASS,
} from "@/components/ui/sidebar-chrome";

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
  /**
   * Residual main surfaces that share the list-lane fixed h-14 strip
   * (home CTA, expert list search band, automation content header).
   * Add justify/padding per surface — do not reintroduce ad-hoc `flex h-14…`.
   */
  listLaneHeader: LIST_LANE_HEADER_CLASS,
  /** Sidebar primary CTA strip (listLaneHeader + slight pt bias). */
  listLaneHeaderCta: SIDEBAR_PRIMARY_HEADER_CLASS,
} as const;
