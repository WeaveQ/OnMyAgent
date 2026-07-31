import { describe, expect, test } from "bun:test";

import {
  mergeKeepOrderWithNewcomers,
  resolveExpertListOrderIds,
  sortExpertListByOrderIds,
} from "../src/react-app/domains/session/sidebar/expert-list-order";

describe("mergeKeepOrderWithNewcomers", () => {
  const byId = new Map([
    ["a", { agentId: "a", name: "A", updated: 1, pinned: false }],
    ["b", { agentId: "b", name: "B", updated: 3, pinned: false }],
    ["c", { agentId: "c", name: "C", updated: 2, pinned: false }],
  ]);

  test("keeps previous order and puts newcomers first by recency", () => {
    expect(
      mergeKeepOrderWithNewcomers(["a", "b"], ["b", "c", "a"], byId),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("resolveExpertListOrderIds", () => {
  const items = [
    { agentId: "fleet", name: "车队", updated: 100, pinned: false },
    { agentId: "cs", name: "客服", updated: 200, pinned: false },
    { agentId: "fin", name: "财务", updated: 50, pinned: true },
  ];

  test("empty ledger seeds once by pin then recency", () => {
    expect(
      resolveExpertListOrderIds({
        items,
        previousOrderIds: [],
      }),
    ).toEqual(["fin", "cs", "fleet"]);
  });

  test("keeps previous order when timestamps flip (snapshot load thrash)", () => {
    expect(
      resolveExpertListOrderIds({
        items: [
          { agentId: "fleet", name: "车队", updated: 999, pinned: false },
          { agentId: "cs", name: "客服", updated: 1, pinned: false },
        ],
        previousOrderIds: ["cs", "fleet"],
      }),
    ).toEqual(["cs", "fleet"]);
  });

  test("pin moves agent to pin bucket without reshuffling peers", () => {
    expect(
      resolveExpertListOrderIds({
        items: [
          { agentId: "fleet", name: "车队", updated: 300, pinned: false },
          { agentId: "cs", name: "客服", updated: 100, pinned: true },
          { agentId: "fin", name: "财务", updated: 50, pinned: false },
        ],
        previousOrderIds: ["fleet", "cs", "fin"],
      }),
    ).toEqual(["cs", "fleet", "fin"]);
  });

  test("newcomer inserts at front of unpinned without reshuffling known", () => {
    expect(
      resolveExpertListOrderIds({
        items: [
          { agentId: "fleet", name: "车队", updated: 10, pinned: false },
          { agentId: "cs", name: "客服", updated: 20, pinned: false },
          { agentId: "new", name: "新", updated: 30, pinned: false },
        ],
        previousOrderIds: ["cs", "fleet"],
      }),
    ).toEqual(["new", "cs", "fleet"]);
  });
});

describe("sortExpertListByOrderIds", () => {
  test("orders rows by agentId ledger", () => {
    const rows = [
      { group: { agentId: "a" }, updated: 1 },
      { group: { agentId: "b" }, updated: 2 },
      { group: { agentId: "c" }, updated: 3 },
    ];
    expect(
      sortExpertListByOrderIds(rows, ["c", "a", "b"]).map((r) => r.group.agentId),
    ).toEqual(["c", "a", "b"]);
  });
});
