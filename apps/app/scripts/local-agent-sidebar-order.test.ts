import { describe, expect, test } from "bun:test";

import {
  mergeLocalAgentSidebarOrder,
  sortLocalAgentsBySidebarOrder,
} from "../src/react-app/domains/local-agents/local-agent-page-model";

describe("local agent sidebar order", () => {
  test("merge keeps saved relative order and appends newcomers", () => {
    expect(
      mergeLocalAgentSidebarOrder(
        ["b", "a", "gone"],
        ["a", "c", "b"],
      ),
    ).toEqual(["b", "a", "c"]);
  });

  test("sort follows order ids; status is ignored", () => {
    const agents = [
      { id: "a", name: "Alpha", status: "offline" as const },
      { id: "b", name: "Beta", status: "online" as const },
      { id: "c", name: "Gamma", status: "online" as const },
    ];
    const ordered = sortLocalAgentsBySidebarOrder(agents, ["c", "a", "b"]);
    expect(ordered.map((agent) => agent.id)).toEqual(["c", "a", "b"]);

    // Same order even if status flips
    const flipped = agents.map((agent) => ({
      ...agent,
      status: agent.status === "online" ? ("offline" as const) : ("online" as const),
    }));
    expect(sortLocalAgentsBySidebarOrder(flipped, ["c", "a", "b"]).map((a) => a.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("unknown ids fall back to name order after known ones", () => {
    const agents = [
      { id: "z", name: "Zulu" },
      { id: "a", name: "Alpha" },
      { id: "m", name: "Mike" },
    ];
    expect(sortLocalAgentsBySidebarOrder(agents, ["m"]).map((a) => a.id)).toEqual([
      "m",
      "a",
      "z",
    ]);
  });
});
