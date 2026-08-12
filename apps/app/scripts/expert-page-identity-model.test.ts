import { describe, expect, test } from "bun:test";

import { collectExpertMissingSkills } from "../src/react-app/domains/session/pages/expert-page-identity-model";

describe("collectExpertMissingSkills", () => {
  const records = [
    {
      agentId: "fleet-management-specialist:fleet-management-specialist",
      missingSkills: ["fleet-data-consolidation", "vehicle-candidate-ranking"],
    },
    {
      agentId: "proposal-strategist:proposal-strategist",
      missingSkills: ["anti-distill", "market-researcher", "marketing-skills"],
    },
  ];

  test("scopes missing skills to the active expert agent", () => {
    expect(
      collectExpertMissingSkills(
        records,
        "fleet-management-specialist:fleet-management-specialist",
      ),
    ).toEqual(["fleet-data-consolidation", "vehicle-candidate-ranking"]);
  });

  test("falls back to the directory union when no agent is selected", () => {
    expect(collectExpertMissingSkills(records, null)).toEqual([
      "anti-distill",
      "fleet-data-consolidation",
      "market-researcher",
      "marketing-skills",
      "vehicle-candidate-ranking",
    ]);
  });
});
