import { describe, expect, test } from "bun:test";

import {
  buildPathWithRailView,
  defaultPrimaryRailView,
  mustPreserveRailViewOnHistoryAction,
  parseRailViewFromSearch,
  resolveActiveRailView,
  resolveModeSwitchHistoryOptions,
  resolveSessionRestoreHistoryOptions,
  shouldHydrateRailBookmarkIntoUrl,
  shouldReplaceHistory,
  shouldSkipSessionRestoreOnHistoryAction,
} from "../src/react-app/shell/session-route/app-location";
import { resolveSessionRouteRestoreNavigation } from "../src/react-app/shell/session-route/control";
import type { SidebarSessionItem } from "../src/app/types";

function session(id: string): SidebarSessionItem {
  return { id, title: id, version: "0.0.0", time: { created: 1, updated: 1 } };
}

describe("app-location history policy", () => {
  test("user navigations push; bootstrap and repair replace", () => {
    expect(shouldReplaceHistory("user")).toBe(false);
    expect(shouldReplaceHistory("bootstrap")).toBe(true);
    expect(shouldReplaceHistory("repair")).toBe(true);
    expect(shouldReplaceHistory("pop")).toBe(false);
  });

  test("mode switch history options always push when path is present", () => {
    expect(resolveModeSwitchHistoryOptions(null)).toBeNull();
    expect(resolveModeSwitchHistoryOptions("/workspace/ws/assistant/s1")).toEqual({
      to: "/workspace/ws/assistant/s1",
      replace: false,
    });
  });

  test("session restore is blocked on POP", () => {
    expect(shouldSkipSessionRestoreOnHistoryAction("POP")).toBe(true);
    expect(shouldSkipSessionRestoreOnHistoryAction("PUSH")).toBe(false);
    expect(shouldSkipSessionRestoreOnHistoryAction("REPLACE")).toBe(false);
    expect(resolveSessionRestoreHistoryOptions({ navigationType: "POP" })).toEqual({
      allowed: false,
      replace: false,
    });
    expect(resolveSessionRestoreHistoryOptions({ navigationType: "PUSH" })).toEqual({
      allowed: true,
      replace: true,
    });
  });
});

describe("rail view URL encoding", () => {
  test("parses known view search param", () => {
    expect(parseRailViewFromSearch("?view=files")).toBe("files");
    expect(parseRailViewFromSearch("view=agentManagement")).toBe("agentManagement");
    expect(parseRailViewFromSearch("?view=not-a-real-view")).toBeNull();
    expect(parseRailViewFromSearch("")).toBeNull();
  });

  test("primary rail views strip the view query; secondary views set it", () => {
    expect(
      buildPathWithRailView({
        mode: "assistant",
        pathname: "/workspace/ws/assistant/s1",
        search: "?view=files",
        view: "assistant",
      }),
    ).toBe("/workspace/ws/assistant/s1");

    expect(
      buildPathWithRailView({
        mode: "assistant",
        pathname: "/workspace/ws/assistant/s1",
        search: "",
        view: "files",
      }),
    ).toBe("/workspace/ws/assistant/s1?view=files");

    expect(
      buildPathWithRailView({
        mode: "expert",
        pathname: "/workspace/ws/session/s2",
        search: "?foo=1",
        view: "localAgent",
      }),
    ).toBe("/workspace/ws/session/s2?foo=1&view=localAgent");
  });

  test("resolveActiveRailView uses URL only; empty search is always primary", () => {
    expect(
      resolveActiveRailView({
        mode: "assistant",
        search: "?view=files",
      }),
    ).toBe("files");

    // Clean URL after Back must NOT re-apply a secondary bookmark.
    expect(
      resolveActiveRailView({
        mode: "assistant",
        search: "",
      }),
    ).toBe(defaultPrimaryRailView("assistant"));

    expect(
      resolveActiveRailView({
        mode: "expert",
        search: "",
      }),
    ).toBe(defaultPrimaryRailView("expert"));
  });

  test("Back sequence: primary → secondary URL → clean URL resolves primary", () => {
    const mode = "assistant" as const;
    const pathname = "/workspace/ws/assistant/s1";

    // 1) Primary conversation (clean search)
    expect(resolveActiveRailView({ mode, search: "" })).toBe("assistant");

    // 2) User opens files (history push of ?view=files)
    const secondary = buildPathWithRailView({
      mode,
      pathname,
      search: "",
      view: "files",
    });
    expect(secondary).toBe(`${pathname}?view=files`);
    expect(resolveActiveRailView({ mode, search: "?view=files" })).toBe("files");

    // 3) POP back to clean primary URL — must be conversation, not bookmark
    expect(resolveActiveRailView({ mode, search: "" })).toBe("assistant");
    // Bookmark hydrate must not re-fire for a clean post-hydration URL
    expect(
      shouldHydrateRailBookmarkIntoUrl({
        mode,
        search: "",
        bookmarkedView: "files",
      }),
    ).toBe(true); // eligible for cold-start only; useRailLocation gates once via ref

    // After cold-start would have run, clean URL policy is still primary:
    expect(resolveActiveRailView({ mode, search: "" })).toBe("assistant");
  });

  test("POP to secondary rail must not be rewritten when session id also changes", () => {
    // Repro: sessionA?view=files → open sessionB (clean) → Back.
    // selectedSessionId changes A←B on POP; any force-primary rail rewrite
    // would steal files. Policy: preserve rail URL on POP.
    expect(mustPreserveRailViewOnHistoryAction("POP")).toBe(true);
    expect(mustPreserveRailViewOnHistoryAction("PUSH")).toBe(false);
    expect(mustPreserveRailViewOnHistoryAction("REPLACE")).toBe(false);

    const mode = "assistant" as const;
    // Stack top after Back: session A with files still in the URL.
    expect(
      resolveActiveRailView({ mode, search: "?view=files" }),
    ).toBe("files");
    // Forcing primary would build a clean path — that must not run on POP.
    const forcedPrimary = buildPathWithRailView({
      mode,
      pathname: "/workspace/ws/assistant/sA",
      search: "?view=files",
      view: "assistant",
    });
    expect(forcedPrimary).toBe("/workspace/ws/assistant/sA");
    // While POP is active, keep the restored secondary view from search.
    if (mustPreserveRailViewOnHistoryAction("POP")) {
      expect(
        resolveActiveRailView({ mode, search: "?view=files" }),
      ).toBe("files");
    }
  });

  test("user session open drops ?view= so primary rail wins without an effect", () => {
    // navigateToWorkspaceSession builds pathname only — no search carry-over.
    // That is how session clicks leave files/store without a sessionId effect.
    const mode = "expert" as const;
    expect(
      resolveActiveRailView({
        mode,
        search: "", // new session route has empty search
      }),
    ).toBe("chat");
  });

  test("shouldHydrateRailBookmarkIntoUrl only for secondary bookmark without view param", () => {
    expect(
      shouldHydrateRailBookmarkIntoUrl({
        mode: "assistant",
        search: "",
        bookmarkedView: "files",
      }),
    ).toBe(true);
    expect(
      shouldHydrateRailBookmarkIntoUrl({
        mode: "assistant",
        search: "?view=store",
        bookmarkedView: "files",
      }),
    ).toBe(false);
    expect(
      shouldHydrateRailBookmarkIntoUrl({
        mode: "assistant",
        search: "",
        bookmarkedView: "assistant",
      }),
    ).toBe(false);
  });
});

describe("session restore POP guard (shipped control.ts)", () => {
  const base = {
    firstSessionIdForPageMode: () => "ses_first",
    legacySelectedWorkspaceId: "ws_a",
    loading: false,
    pageMode: "assistant" as const,
    readLastSessionFor: () => "ses_last",
    routeWorkspaceId: "ws_a",
    selectedSessionId: null as string | null,
    selectedWorkspaceId: "ws_a",
    sessionMatchesPageMode: () => true,
    sessionListOwnsSession: () => true,
    sessionsByWorkspaceId: { ws_a: [session("ses_last"), session("ses_first")] },
    suppressRestoreSession: false,
    workspaces: [
      {
        id: "ws_a",
        name: "ws_a",
        path: "/tmp/ws_a",
        preset: "local" as const,
        workspaceType: "local" as const,
        displayNameResolved: "ws_a",
      },
    ],
  };

  test("PUSH/REPLACE still restores last session when URL has no sessionId", () => {
    expect(
      resolveSessionRouteRestoreNavigation({ ...base, navigationType: "PUSH" }),
    ).toEqual({
      type: "workspace",
      workspaceId: "ws_a",
      sessionId: "ses_last",
    });
  });

  test("POP does not auto-restore last session", () => {
    expect(
      resolveSessionRouteRestoreNavigation({ ...base, navigationType: "POP" }),
    ).toEqual({ type: "none" });
  });

  test("POP still allows keeping an explicit selected session", () => {
    expect(
      resolveSessionRouteRestoreNavigation({
        ...base,
        navigationType: "POP",
        selectedSessionId: "ses_last",
      }),
    ).toEqual({ type: "reset-suppression" });
  });
});
