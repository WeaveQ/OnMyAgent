import { describe, expect, test } from "bun:test";

import { resolveExpertColdOpenNavigation } from "../src/react-app/domains/session/pages/order-conversation-groups";

const isExpert = (id: string) => id.startsWith("ses_expert_");

describe("resolveExpertColdOpenNavigation", () => {
  test("keeps a live expert selection", () => {
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: "ses_expert_b",
        routeSessionLive: true,
        isExpertSession: isExpert,
        coldOpenSessionId: "ses_expert_a",
      }),
    ).toEqual({ action: "keep" });
  });

  test("keeps an expert selection that is still lagging out of inventory", () => {
    // Startup / multi-switch race: URL already points at expert B but the
    // sidebar list has not merged B yet. Cold-open must not steal to A.
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: "ses_expert_b",
        routeSessionLive: false,
        isExpertSession: isExpert,
        coldOpenSessionId: "ses_expert_a",
      }),
    ).toEqual({ action: "keep" });
  });

  test("opens cold-open target when there is no selection", () => {
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: null,
        routeSessionLive: false,
        isExpertSession: isExpert,
        coldOpenSessionId: "ses_expert_a",
      }),
    ).toEqual({ action: "open", sessionId: "ses_expert_a" });
  });

  test("clears hard-deleted ghost routes that are no longer expert-indexed", () => {
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: "ses_deleted_ghost",
        routeSessionLive: false,
        isExpertSession: isExpert,
        coldOpenSessionId: "ses_expert_a",
      }),
    ).toEqual({ action: "clear-route" });
  });

  test("create-task only for residual non-expert selection that is still live", () => {
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: "ses_assistant_home",
        routeSessionLive: true,
        isExpertSession: isExpert,
        coldOpenSessionId: null,
      }),
    ).toEqual({ action: "create-task" });
  });
});
