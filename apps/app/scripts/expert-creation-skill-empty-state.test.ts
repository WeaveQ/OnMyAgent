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

  test("keeps the add-skill action in the panel header", () => {
    const panelHeader = pageSource.slice(0, emptyStateStart);
    expect(panelHeader).toContain("<SkillPickerPopover");
    expect(panelHeader).toContain("expert_creation_add_skill");
  });
});
