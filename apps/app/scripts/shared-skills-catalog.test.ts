import { describe, expect, test } from "bun:test";

import { ALL_SKILLS, LEGACY_SKILLS } from "../src/react-app/domains/shared/skills-catalog";

describe("shared skills catalog", () => {
  test("exposes the legacy skills through the shared domain contract", () => {
    expect(ALL_SKILLS).toHaveLength(LEGACY_SKILLS.length);
    expect(ALL_SKILLS.map((skill) => skill.id)).toEqual(
      LEGACY_SKILLS.map((skill) => skill.id),
    );
    expect(new Set(ALL_SKILLS.map((skill) => skill.id)).size).toBe(
      ALL_SKILLS.length,
    );
  });

  test("keeps every built-in skill disabled until explicitly enabled by registry state", () => {
    for (const skill of ALL_SKILLS) {
      expect(skill.name.trim()).not.toBe("");
      expect(skill.description.trim()).not.toBe("");
      expect(["sourcing", "research"]).toContain(skill.category);
      expect(skill.enabled).toBe(false);
    }
  });
});
