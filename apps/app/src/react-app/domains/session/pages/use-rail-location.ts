/**
 * Derive active rail view from URL `?view=` and push history on user rail changes.
 *
 * localStorage (readRailView/writeRailView) is cold-start bookmark only:
 * applied once via replace into `?view=`, never re-applied on Back to a clean URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "../../../shell/session-route/app-location";

export function useRailLocation(input: {
  mode: ShellMode;
  workspaceId: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const primary = defaultPrimaryRailView(input.mode);

  // One-shot cold-start hydrate per workspace mount (not on every POP to clean URL).
  const hydratedWorkspaceRef = useRef<string | null>(null);

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

  // Cold start / workspace switch: if bookmark is a secondary rail and URL has
  // no view, replace once into ?view= so history stays consistent.
  useEffect(() => {
    if (hydratedWorkspaceRef.current === input.workspaceId) return;
    hydratedWorkspaceRef.current = input.workspaceId;

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
