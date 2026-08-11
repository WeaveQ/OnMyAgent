import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");
const pageSource = readFileSync(
  join(appRoot, "src/react-app/domains/agents/expert-creation-page.tsx"),
  "utf8",
);
const skillsSource = readFileSync(
  join(appRoot, "src/react-app/domains/agents/expert-creation-skills-tab.tsx"),
  "utf8",
);
const emptyStateStart = skillsSource.indexOf("        <Empty\n          variant=\"ghost\"");
const emptyStateEnd = skillsSource.indexOf("        </Empty>", emptyStateStart);
const emptyStateSource = skillsSource.slice(emptyStateStart, emptyStateEnd);
const illustrationStart = skillsSource.indexOf("function SkillsEmptyIllustration()");
const illustrationEnd = skillsSource.indexOf("function SkillImportDialog", illustrationStart);
const illustrationSource = skillsSource.slice(illustrationStart, illustrationEnd);

describe("expert creation skill empty state", () => {
  test("uses an illustration, title, and guidance without inline actions", () => {
    expect(emptyStateStart).toBeGreaterThanOrEqual(0);
    expect(emptyStateEnd).toBeGreaterThan(emptyStateStart);
    expect(emptyStateSource).toContain("SkillsEmptyIllustration");
    expect(emptyStateSource).toContain("EmptyDescription");
    expect(emptyStateSource).toContain("agents.expert_creation_no_skills_desc");
    expect(emptyStateSource).not.toContain("EmptyContent");
    expect(emptyStateSource).not.toContain("SkillPickerPopover");
    expect(emptyStateSource).not.toContain("expert_creation_import_skill");
  });

  test("uses shared Koboyo skills wand illustration without accent chrome", () => {
    expect(illustrationSource).toContain("EmptyStateIllustration");
    expect(illustrationSource).toContain("SKILLS_EMPTY_STATE_ASSET");
    expect(illustrationSource).not.toContain("FileSearch");
    expect(illustrationSource).not.toContain("<IconTile");
    expect(illustrationSource).not.toContain("BookOpenCheck");
    expect(illustrationSource).not.toContain("<Blocks");
    expect(illustrationSource).not.toContain("dls-accent");
  });

  test("keeps the add-skill action in the panel header", () => {
    const panelHeader = skillsSource.slice(0, emptyStateStart);
    expect(panelHeader).toContain("<SkillPickerPopover");
    expect(panelHeader).toContain("expert_creation_add_skill");
  });
});
