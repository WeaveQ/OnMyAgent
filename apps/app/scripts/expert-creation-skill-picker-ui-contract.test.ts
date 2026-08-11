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
const pickerSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/agents/expert-creation-skills-tab.tsx",
  ),
  "utf8",
);
const pickerStart = pickerSource.indexOf("function SkillPickerPopover");
const pickerBody = pickerSource.slice(
  pickerStart,
  pickerSource.indexOf("function SkillsEmptyIllustration", pickerStart),
);

describe("expert creation skill picker UI contract", () => {
  test("offers searchable mine and market tabs with a market install action", () => {
    expect(pickerBody).toContain("SegmentedTabGroup");
    expect(pickerBody).toContain(
      't("agents.expert_creation_skill_picker_my_skills")',
    );
    expect(pickerBody).toContain(
      't("agents.expert_creation_skill_picker_market")',
    );
    expect(pickerBody).toContain("filterExpertCreationSkills");
    expect(pickerBody).toContain("onInstall");
    expect(pickerBody).toContain("installingSkillId");
  });

  test("loads the built-in marketplace catalog for expert creation", () => {
    expect(pageSource).toContain("BUILTIN_MARKETPLACE_SKILLS");
    expect(pageSource).toContain("installBuiltinSkillPackage");
    expect(pageSource).toContain("materializeExpertCreationMarketplaceSkill");
  });
});
