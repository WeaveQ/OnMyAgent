import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/agents/expert-creation-page.tsx",
  ),
  "utf8",
);
const pickerStart = pageSource.indexOf("function SkillPickerPopover");
const pickerSource = pageSource.slice(
  pickerStart,
  pageSource.indexOf("function SkillsEmptyIllustration", pickerStart),
);

describe("expert creation skill picker UI contract", () => {
  test("offers searchable mine and market tabs with a market install action", () => {
    expect(pickerSource).toContain("SegmentedTabGroup");
    expect(pickerSource).toContain(
      't("agents.expert_creation_skill_picker_my_skills")',
    );
    expect(pickerSource).toContain(
      't("agents.expert_creation_skill_picker_market")',
    );
    expect(pickerSource).toContain("filterExpertCreationSkills");
    expect(pickerSource).toContain("onInstall");
    expect(pickerSource).toContain("installingSkillId");
  });

  test("loads the built-in marketplace catalog for expert creation", () => {
    expect(pageSource).toContain("BUILTIN_MARKETPLACE_SKILLS");
    expect(pageSource).toContain("installBuiltinSkillPackage");
    expect(pageSource).toContain("materializeExpertCreationMarketplaceSkill");
  });
});
