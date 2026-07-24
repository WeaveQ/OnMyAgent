/**
 * Derive active rail view from URL `?view=` and push history on user rail changes.
 *
 * localStorage (readRailView/writeRailView) is cold-start bookmark only:
 * applied once via replace into `?view=`, never re-applied on Back to a clean URL.
 *
 * IMPORTANT: AssistantPage and ExpertPage unmount when switching 助理↔专家.
 * A per-component ref alone re-runs "cold start" on every remount and re-applies
 * a secondary bookmark (e.g. files) after the user left that rail via mode
 * switch. Session-level keys survive remounts for this SPA lifetime.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { OnMyAgentPrimaryView } from "../sidebar/main-rail";
import {
  readRailView,
  writeRailView,
  type ShellMode,
} from "../sidebar/rail-navigation-memory";
import {
  buildPathWithRailView,
  defaultPrimaryRailView,
  resolveActiveRailView,
  shouldHydrateRailBookmarkIntoUrl,
} from "../navigation/app-location";

/** mode:workspaceId keys already cold-hydrated this page load. */
const railBookmarkHydratedKeys = new Set<string>();

function railHydrateKey(mode: ShellMode, workspaceId: string) {
  return `${mode}:${workspaceId.trim()}`;
}

/** Test helper / mode-switch repair: allow re-hydrate in unit tests only. */
export function resetRailBookmarkHydrationForTests() {
  railBookmarkHydratedKeys.clear();
}

/**
 * When leaving a mode (助理↔专家), reset that mode's bookmark to primary so
 * remounting the page does not re-open files/store from a stale bookmark.
 */
export function resetRailBookmarkToPrimary(
  mode: ShellMode,
  workspaceId: string,
) {
  const id = workspaceId.trim();
  if (!id) return;
  writeRailView(mode, id, defaultPrimaryRailView(mode));
  // Next real cold start for this mode can hydrate again if user bookmarks
  // a secondary rail later — only suppress the remount-after-mode-switch case.
  railBookmarkHydratedKeys.add(railHydrateKey(mode, id));
}

export function useRailLocation(input: {
  mode: ShellMode;
  workspaceId: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const primary = defaultPrimaryRailView(input.mode);

  const resolved = useMemo(
    () =>
      resolveActiveRailView({
        mode: input.mode,
        search: location.search,
      }),
    [input.mode, location.search],
  );

  const [activeSidebarView, setActiveSidebarView] =
    useState<OnMyAgentPrimaryView>(resolved);

  // URL is the only ongoing source of truth (including Back/POP to clean path).
  useEffect(() => {
    setActiveSidebarView(resolved);
  }, [resolved]);

  // True cold start / first visit this SPA session: if bookmark is a secondary
  // rail and URL has no view, replace once into ?view=.
  // Do NOT re-run when AssistantPage remounts after 专家→助理 mode switch.
  useEffect(() => {
    const key = railHydrateKey(input.mode, input.workspaceId);
    if (!input.workspaceId.trim()) return;
    if (railBookmarkHydratedKeys.has(key)) return;
    railBookmarkHydratedKeys.add(key);

    const bookmarked = readRailView(input.mode, input.workspaceId, primary);
    if (
      !shouldHydrateRailBookmarkIntoUrl({
        mode: input.mode,
        search: location.search,
        bookmarkedView: bookmarked,
      })
    ) {
      return;
    }

    const next = buildPathWithRailView({
      mode: input.mode,
      pathname: location.pathname,
      search: location.search,
      view: bookmarked,
    });
    const current = `${location.pathname}${location.search}`;
    if (next !== current) {
      navigate(next, { replace: true });
    }
  }, [
    input.mode,
    input.workspaceId,
    location.pathname,
    location.search,
    navigate,
    primary,
  ]);

  const openRailView = useCallback(
    (view: OnMyAgentPrimaryView) => {
      // Bookmark for next cold start only — history uses the URL.
      writeRailView(input.mode, input.workspaceId, view);
      const next = buildPathWithRailView({
        mode: input.mode,
        pathname: location.pathname,
        search: location.search,
        view,
      });
      const current = `${location.pathname}${location.search}`;
      if (next !== current) {
        navigate(next);
      }
      setActiveSidebarView(view);
    },
    [
      input.mode,
      input.workspaceId,
      location.pathname,
      location.search,
      navigate,
    ],
  );

  return {
    activeSidebarView,
    setActiveSidebarView,
    openRailView,
  };
}
