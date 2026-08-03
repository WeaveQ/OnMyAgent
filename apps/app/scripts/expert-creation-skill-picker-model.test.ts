import { describe, expect, test } from "bun:test";

import type { AgentSkillItem } from "../src/react-app/domains/agents/agent-registry-types";
import {
  filterExpertCreationSkills,
  toggleExpertCreationSkillId,
} from "../src/react-app/domains/agents/expert-creation-skill-picker-model";

const skills: AgentSkillItem[] = [
  {
    id: "railway-12306",
    category: "travel",
    group: "builtin",
    name: "railway-12306",
    displayNameEn: "Query China Railway 12306",
    description: "Search train schedules and fares.",
    enabled: true,
  },
  {
    id: "affiliate-fleet",
    category: "business",
    group: "local",
    name: "affiliate-fleet",
    displayNameZh: "挂靠车队合同台账",
    description: "Maintain carrier fleet contracts.",
    enabled: true,
  },
];

describe("expert creation skill picker model", () => {
  test("filters by display name, package name, description, or category", () => {
    expect(filterExpertCreationSkills(skills, "12306").map((skill) => skill.id)).toEqual([
      "railway-12306",
    ]);
    expect(filterExpertCreationSkills(skills, "合同").map((skill) => skill.id)).toEqual([
      "affiliate-fleet",
    ]);
    expect(filterExpertCreationSkills(skills, "business").map((skill) => skill.id)).toEqual([
      "affiliate-fleet",
    ]);
  });

  test("returns every skill for an empty query and keeps source order", () => {
    expect(filterExpertCreationSkills(skills, "").map((skill) => skill.id)).toEqual([
      "railway-12306",
      "affiliate-fleet",
    ]);
  });

  test("adds and removes one selected skill without duplicating ids", () => {
    expect(toggleExpertCreationSkillId([], "railway-12306")).toEqual([
      "railway-12306",
    ]);
    expect(toggleExpertCreationSkillId(["railway-12306"], "railway-12306")).toEqual([]);
    expect(toggleExpertCreationSkillId(["railway-12306"], "affiliate-fleet")).toEqual([
      "railway-12306",
      "affiliate-fleet",
    ]);
  });
});
