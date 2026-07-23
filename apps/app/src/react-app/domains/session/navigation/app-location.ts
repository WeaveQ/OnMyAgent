/**
 * Unified shell location policy for session routes.
 *
 * Visible place = workspace + mode + session + rail view.
 * History: user navigations push; bootstrap/repair may replace.
 * localStorage rail/session memory is cold-start only — not a back stack.
 */
import type { OnMyAgentPrimaryView } from "../sidebar/main-rail";
import { isPrimarySessionRailView } from "../sidebar/rail-navigation-memory";

export type ShellMode = "assistant" | "expert";

/** Why we navigate — drives push vs replace. */
export type NavReason = "user" | "bootstrap" | "repair" | "pop";

/** React Router navigationType values we care about. */
export type HistoryNavigationType = "POP" | "PUSH" | "REPLACE" | string;

export const RAIL_VIEW_SEARCH_PARAM = "view";

const KNOWN_RAIL_VIEWS = new Set<string>([
  "assistant",
  "chat",
  "localAgent",
  "files",
  "store",
  "projects",
  "agentManagement",
  "devices",
  "channels",
  "billing",
  "scheduledTasks",
  "agents",
  "skills",
  "connectors",
  "usage",
]);

export function isKnownRailView(value: string): value is OnMyAgentPrimaryView {
  return KNOWN_RAIL_VIEWS.has(value);
}

export function defaultPrimaryRailView(mode: ShellMode): OnMyAgentPrimaryView {
  return mode === "assistant" ? "assistant" : "chat";
}

/** User navigations must push so Back works; system fixes may replace. */
export function shouldReplaceHistory(reason: NavReason): boolean {
  return reason === "bootstrap" || reason === "repair";
}

/**
 * Last-session auto-restore must not run on POP — otherwise Back to a
 * draft/empty session URL is immediately stolen by replace restore.
 */
export function shouldSkipSessionRestoreOnHistoryAction(
  navigationType: HistoryNavigationType | undefined | null,
): boolean {
  return navigationType === "POP";
}

export function parseRailViewFromSearch(
  search: string,
): OnMyAgentPrimaryView | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return null;
  try {
    const value = new URLSearchParams(raw).get(RAIL_VIEW_SEARCH_PARAM)?.trim() ?? "";
    if (!value || !isKnownRailView(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Build pathname+search with rail view encoded.
 * Primary conversation surfaces omit `view` for a clean default URL.
 */
export function buildPathWithRailView(input: {
  mode: ShellMode;
  pathname: string;
  search: string;
  view: OnMyAgentPrimaryView;
}): string {
  const pathname = input.pathname || "/";
  const raw = input.search.startsWith("?") ? input.search.slice(1) : input.search;
  const params = new URLSearchParams(raw);
  const primary =
    isPrimarySessionRailView(input.view) ||
    input.view === defaultPrimaryRailView(input.mode);

  if (primary) {
    params.delete(RAIL_VIEW_SEARCH_PARAM);
  } else {
    params.set(RAIL_VIEW_SEARCH_PARAM, input.view);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Mode switch is always a user navigation → push (replace: false).
 * Returns null when there is no path change.
 */
export function resolveModeSwitchHistoryOptions(path: string | null): {
  to: string;
  replace: false;
} | null {
  if (!path) return null;
  return { to: path, replace: false };
}

/**
 * Session restore navigation options: replace only for non-POP system restore.
 * POP must never auto-replace.
 */
export function resolveSessionRestoreHistoryOptions(input: {
  navigationType?: HistoryNavigationType | null;
}): { replace: boolean; allowed: boolean } {
  if (shouldSkipSessionRestoreOnHistoryAction(input.navigationType)) {
    return { allowed: false, replace: false };
  }
  return { allowed: true, replace: true };
}

/**
 * Resolve active rail view from the URL only.
 *
 * Empty / missing `?view=` always means the primary conversation surface for
 * `mode`. localStorage bookmarks must NOT be applied here — that would break
 * Back (open files → write bookmark → Back to clean URL → bookmark re-opens files).
 *
 * Cold-start bookmark hydration is a one-shot `replace` into `?view=` (see
 * use-rail-location), never a silent state override of a clean history entry.
 */
export function resolveActiveRailView(input: {
  mode: ShellMode;
  search: string;
}): OnMyAgentPrimaryView {
  return parseRailViewFromSearch(input.search) ?? defaultPrimaryRailView(input.mode);
}

/**
 * Whether a cold-start bookmark should be written into the URL via replace.
 * Only when the URL has no view and the bookmark is a secondary rail surface.
 */
export function shouldHydrateRailBookmarkIntoUrl(input: {
  mode: ShellMode;
  search: string;
  bookmarkedView: OnMyAgentPrimaryView | null | undefined;
}): boolean {
  if (parseRailViewFromSearch(input.search)) return false;
  const bookmark = input.bookmarkedView;
  if (!bookmark || !isKnownRailView(bookmark)) return false;
  if (isPrimarySessionRailView(bookmark)) return false;
  if (bookmark === defaultPrimaryRailView(input.mode)) return false;
  return true;
}

/**
 * After history POP, nothing may rewrite the rail URL (e.g. force primary chat
 * because selectedSessionId changed). User session opens already navigate to a
 * clean path without `?view=`; POP must restore whatever rail the stack had.
 */
export function mustPreserveRailViewOnHistoryAction(
  navigationType: HistoryNavigationType | undefined | null,
): boolean {
  return navigationType === "POP";
}
