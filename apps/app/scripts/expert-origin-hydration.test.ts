import { describe, expect, test } from "bun:test";

import {
  resolveExpertOriginHydrationView,
  shouldBlockExpertSurfaceForWorkspaceError,
  shouldMountExpertSessionSurface,
} from "../src/react-app/domains/session/pages/expert-origin-hydration";
import {
  createSessionOriginHydrationGate,
  getSessionOriginRecoveryRetryDelayMs,
  isSessionOriginHydrationDegraded,
  isSessionOriginHydrated,
  resetSessionOriginHydrationForTests,
} from "../src/react-app/domains/agents/session-origin-hydration";

function deferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: () => resolve?.(),
  };
}

const base = {
  activeChat: true,
  originDegraded: false,
  hasAnyExpertConversation: false,
  showWorkspaceSetupEmptyState: false,
  showSelectedWorkspaceError: false,
  showBlockingStartupSkeleton: false,
};

describe("expert origin hydration view", () => {
  test("shows workspace errors instead of an empty draft surface", () => {
    expect(shouldBlockExpertSurfaceForWorkspaceError({
      selectedSessionId: null,
      showSelectedWorkspaceError: true,
    })).toBe(true);
    expect(shouldBlockExpertSurfaceForWorkspaceError({
      selectedSessionId: "existing-session",
      showSelectedWorkspaceError: true,
    })).toBe(false);
  });

  test("keeps a selected existing session mounted while hydration is pending", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: false,
      selectedSessionId: "existing-session",
    })).toEqual({
      deferColdOpen: true,
      showPendingWithoutSelection: false,
      showDegradedWithoutSelection: false,
      showNoExpertConversation: false,
    });
  });

  test("shows loading rather than a definitive landing page without selection", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: false,
      selectedSessionId: null,
    })).toEqual({
      deferColdOpen: true,
      showPendingWithoutSelection: true,
      showDegradedWithoutSelection: false,
      showNoExpertConversation: false,
    });
  });

  test("shows the genuine empty landing page only after hydration completes", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: true,
      selectedSessionId: null,
    })).toEqual({
      deferColdOpen: false,
      showPendingWithoutSelection: false,
      showDegradedWithoutSelection: false,
      showNoExpertConversation: true,
    });
  });

  test("shows a degraded recovery notice instead of a false empty landing page", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: true,
      originDegraded: true,
      selectedSessionId: null,
    })).toEqual({
      deferColdOpen: false,
      showPendingWithoutSelection: false,
      showDegradedWithoutSelection: true,
      showNoExpertConversation: false,
    });
  });

  test("does not cover a workspace error with the degraded recovery notice", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: true,
      originDegraded: true,
      selectedSessionId: null,
      showSelectedWorkspaceError: true,
    }).showDegradedWithoutSelection).toBe(false);
  });

  test("does not cover a workspace error with the pending recovery spinner", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: false,
      originDegraded: false,
      selectedSessionId: null,
      showSelectedWorkspaceError: true,
    }).showPendingWithoutSelection).toBe(false);
  });

  test("summon/draft chrome suppresses degraded empty banner", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: true,
      originDegraded: true,
      selectedSessionId: null,
      showDraftChrome: true,
    })).toEqual({
      deferColdOpen: false,
      showPendingWithoutSelection: false,
      showDegradedWithoutSelection: false,
      showNoExpertConversation: false,
    });
  });

  test("settled empty (not degraded) shows genuine no-expert landing", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: true,
      originDegraded: false,
      selectedSessionId: null,
      hasAnyExpertConversation: false,
    }).showDegradedWithoutSelection).toBe(false);
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: true,
      originDegraded: false,
      selectedSessionId: null,
      hasAnyExpertConversation: false,
    }).showNoExpertConversation).toBe(true);
  });
});

describe("shouldMountExpertSessionSurface", () => {
  const mountBase = {
    canRenderReactSurface: true,
    blockForWorkspaceError: false,
    showNoExpertConversationEmptyState: false,
    showExpertOriginHydrationDegraded: false,
    showExpertOriginHydrationLoading: false,
    isDraftSession: false,
    showDraftChrome: false,
    surfaceSessionId: null as string | null,
  };

  test("blocks empty degraded without draft intent", () => {
    expect(shouldMountExpertSessionSurface({
      ...mountBase,
      showExpertOriginHydrationDegraded: true,
    })).toBe(false);
  });

  test("allows summon draft chrome while origin recovery is degraded", () => {
    expect(shouldMountExpertSessionSurface({
      ...mountBase,
      showExpertOriginHydrationDegraded: true,
      isDraftSession: true,
      showDraftChrome: true,
      surfaceSessionId: "draft:ws:agent-a",
    })).toBe(true);
  });

  test("allows creating/real surface id even when degraded banner would show", () => {
    expect(shouldMountExpertSessionSurface({
      ...mountBase,
      showExpertOriginHydrationDegraded: true,
      surfaceSessionId: "ses_creating_1",
    })).toBe(true);
  });

  test("does not treat cold empty draft: id as concrete surface", () => {
    expect(shouldMountExpertSessionSurface({
      ...mountBase,
      showExpertOriginHydrationDegraded: true,
      surfaceSessionId: "draft:workspace",
    })).toBe(false);
  });
});

describe("session origin hydration gate", () => {
  test("waits for primary list completion when origin fails first", async () => {
    resetSessionOriginHydrationForTests();
    const primary = deferred();
    const gate = createSessionOriginHydrationGate("workspace-a");
    const originFailed = Promise.resolve().then(() => {
      gate.markOriginRecoverySettled();
    });

    await originFailed;
    expect(isSessionOriginHydrated("workspace-a")).toBe(false);

    primary.resolve();
    await primary.promise;
    gate.markPrimaryListSettled();
    expect(isSessionOriginHydrated("workspace-a")).toBe(true);
  });

  test("keeps an origin failure pending instead of exposing an empty expert state", () => {
    resetSessionOriginHydrationForTests();
    const gate = createSessionOriginHydrationGate("workspace-a");

    gate.markPrimaryListSettled();
    gate.markOriginRecoveryFailed();

    expect(isSessionOriginHydrated("workspace-a")).toBe(false);
  });

  test("backs off a finite number of origin recovery retries", () => {
    expect(getSessionOriginRecoveryRetryDelayMs(0)).toBe(500);
    expect(getSessionOriginRecoveryRetryDelayMs(1)).toBe(1_000);
    expect(getSessionOriginRecoveryRetryDelayMs(2)).toBe(1_500);
    expect(getSessionOriginRecoveryRetryDelayMs(3)).toBeNull();
  });

  test("settles in degraded mode after bounded recovery retries and clears it on refresh", () => {
    resetSessionOriginHydrationForTests();
    const exhausted = createSessionOriginHydrationGate("workspace-a");

    exhausted.markPrimaryListSettled();
    exhausted.markOriginRecoveryDegraded();
    expect(isSessionOriginHydrated("workspace-a")).toBe(true);
    expect(isSessionOriginHydrationDegraded("workspace-a")).toBe(true);

    const refreshed = createSessionOriginHydrationGate("workspace-a");
    refreshed.markPrimaryListSettled();
    refreshed.markOriginRecoverySettled();
    expect(isSessionOriginHydrationDegraded("workspace-a")).toBe(false);
  });

  test("settles a terminal primary-list failure without exposing a false empty state", () => {
    resetSessionOriginHydrationForTests();
    const gate = createSessionOriginHydrationGate("workspace-a");

    gate.markTerminalFailure();

    expect(isSessionOriginHydrated("workspace-a")).toBe(true);
    expect(isSessionOriginHydrationDegraded("workspace-a")).toBe(true);
  });
});
