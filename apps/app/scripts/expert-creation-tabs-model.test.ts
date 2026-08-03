import { describe, expect, test } from "bun:test";

import { EXPERT_CREATION_VISIBLE_TABS } from "../src/react-app/domains/agents/expert-creation-tabs-model";

describe("expert creation visible tabs", () => {
  test("does not expose the knowledge tab", () => {
    expect(EXPERT_CREATION_VISIBLE_TABS).toEqual(["basic", "memory", "skills"]);
    expect(EXPERT_CREATION_VISIBLE_TABS).not.toContain("knowledge");
  });
});
