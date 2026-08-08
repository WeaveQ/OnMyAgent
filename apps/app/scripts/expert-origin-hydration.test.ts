import { describe, expect, test } from "bun:test";

import { resolveExpertOriginHydrationView } from "../src/react-app/domains/session/pages/expert-origin-hydration";

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
