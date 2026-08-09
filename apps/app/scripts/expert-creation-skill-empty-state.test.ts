import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");
const pageSource = readFileSync(
  join(appRoot, "src/react-app/domains/agents/expert-creation-page.tsx"),
  "utf8",
);
const emptyStateStart = pageSource.indexOf("        <Empty\n          variant=\"ghost\"");
const emptyStateEnd = pageSource.indexOf("        </Empty>", emptyStateStart);
const emptyStateSource = pageSource.slice(emptyStateStart, emptyStateEnd);
const illustrationStart = pageSource.indexOf("function SkillsEmptyIllustration()");
const illustrationEnd = pageSource.indexOf("function SkillImportDialog", illustrationStart);
const illustrationSource = pageSource.slice(illustrationStart, illustrationEnd);

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
    const panelHeader = pageSource.slice(0, emptyStateStart);
    expect(panelHeader).toContain("<SkillPickerPopover");
    expect(panelHeader).toContain("expert_creation_add_skill");
  });
});
