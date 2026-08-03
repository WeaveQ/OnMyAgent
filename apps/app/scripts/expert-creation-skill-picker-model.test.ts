import { describe, expect, test } from "bun:test";

import type { AgentSkillItem } from "../src/react-app/domains/agents/agent-registry-types";
import {
  expertCreationSkillKey,
  filterExpertCreationSkills,
  isExpertCreationSkillSelected,
  materializeExpertCreationMarketplaceSkill,
  resolveExpertCreationSkillId,
  toggleExpertCreationSkill,
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

  test("synchronizes market rows with installed rows by canonical skill name", () => {
    const installed = {
      ...skills[0],
      id: "installed-railway-12306",
      name: "railway-12306",
    };
    const market = {
      ...skills[0],
      id: "market:railway-12306",
      name: "railway-12306",
    };

    expect(expertCreationSkillKey(market)).toBe("railway-12306");
    expect(resolveExpertCreationSkillId(market, [installed])).toBe(
      "installed-railway-12306",
    );
    expect(
      isExpertCreationSkillSelected(
        market,
        ["installed-railway-12306"],
        [installed],
      ),
    ).toBe(true);
    expect(
      toggleExpertCreationSkill(
        ["installed-railway-12306"],
        market,
        [installed],
      ),
    ).toEqual([]);
  });

  test("materializes an installed marketplace skill with its persisted path", () => {
    const market = {
      ...skills[0],
      id: "market:railway-12306",
      name: "railway-12306",
    };

    expect(
      materializeExpertCreationMarketplaceSkill(
        market,
        "/workspace/.onmyagent/skills/railway-12306/SKILL.md",
      ),
    ).toMatchObject({
      id: "railway-12306",
      name: "railway-12306",
      enabled: true,
      path: "/workspace/.onmyagent/skills/railway-12306/SKILL.md",
    });
  });
});
