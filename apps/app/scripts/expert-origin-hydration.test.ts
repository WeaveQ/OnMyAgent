import { describe, expect, test } from "bun:test";

import { resolveExpertOriginHydrationView } from "../src/react-app/domains/session/pages/expert-origin-hydration";
import {
  createSessionOriginHydrationGate,
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
  hasAnyExpertConversation: false,
  showWorkspaceSetupEmptyState: false,
  showSelectedWorkspaceError: false,
  showBlockingStartupSkeleton: false,
};

describe("expert origin hydration view", () => {
  test("keeps a selected existing session mounted while hydration is pending", () => {
    expect(resolveExpertOriginHydrationView({
      ...base,
      originHydrated: false,
      selectedSessionId: "existing-session",
    })).toEqual({
      deferColdOpen: true,
      showPendingWithoutSelection: false,
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
      showNoExpertConversation: true,
    });
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
});
