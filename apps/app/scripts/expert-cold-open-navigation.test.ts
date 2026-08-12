import { describe, expect, test } from "bun:test";

import {
  normalizeExpertSessionId,
  resolveExpertColdOpenNavigation,
  shouldSuppressExpertColdOpen,
} from "../src/react-app/domains/session/pages/order-conversation-groups";

const isExpert = (id: string) => id.startsWith("ses_expert_");

describe("normalizeExpertSessionId", () => {
  test("treats empty / whitespace as null", () => {
    expect(normalizeExpertSessionId("")).toBeNull();
    expect(normalizeExpertSessionId("   ")).toBeNull();
    expect(normalizeExpertSessionId(null)).toBeNull();
    expect(normalizeExpertSessionId(undefined)).toBeNull();
    expect(normalizeExpertSessionId("ses_1")).toBe("ses_1");
    expect(normalizeExpertSessionId("  ses_1  ")).toBe("ses_1");
  });
});

describe("shouldSuppressExpertColdOpen", () => {
  test("suppresses unbound create transaction", () => {
    expect(
      shouldSuppressExpertColdOpen({
        pendingAgent: {
          operationId: "op_1",
          boundSessionId: null,
          draftSource: "agent-selection",
        },
      }),
    ).toBe(true);
  });

  test("suppresses draft chrome / creating / tab highlight", () => {
    expect(shouldSuppressExpertColdOpen({ draftSessionActive: true })).toBe(
      true,
    );
    expect(shouldSuppressExpertColdOpen({ draftAgentId: "agent_a" })).toBe(
      true,
    );
    expect(
      shouldSuppressExpertColdOpen({ creatingSessionId: "ses_new" }),
    ).toBe(true);
    expect(
      shouldSuppressExpertColdOpen({ tabHighlightSessionId: "ses_new" }),
    ).toBe(true);
  });

  test("allows cold-open after create settled (bound + no chrome flags)", () => {
    expect(
      shouldSuppressExpertColdOpen({
        pendingAgent: {
          operationId: "op_1",
          boundSessionId: "ses_bound",
        },
      }),
    ).toBe(false);
  });
});

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

  test("suppress flag forces keep even with empty selection", () => {
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: null,
        routeSessionLive: false,
        isExpertSession: isExpert,
        coldOpenSessionId: "ses_expert_a",
        suppress: true,
      }),
    ).toEqual({ action: "keep" });
  });

  test("empty selected id is treated as no selection", () => {
    expect(
      resolveExpertColdOpenNavigation({
        selectedSessionId: "   ",
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
