import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("composer tool menu contract", () => {
  test("wires pin skills storage into the skills panel", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('from "./pinned-skills"');
    expect(source).toContain("readPinnedSkillIds");
    expect(source).toContain("sortWithPinnedFirst");
    expect(source).toContain("togglePinnedSkillId");
    expect(source).toContain("writePinnedSkillIds");
    expect(source).toContain("handleTogglePinnedSkill");
    expect(source).toContain('t("composer.pin_skill")');
    expect(source).toContain('t("composer.unpin_skill")');
  });

  test("primary tool list separates attach actions from mode/skills/connectors", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );
    const addFileIdx = source.indexOf('t("composer.add_file")');
    const captureIdx = source.indexOf('t("composer.capture_appshot")');
    const modesIdx = source.indexOf(
      '["modes", t("composer.collaboration_mode"), Sparkles]',
    );
    const separatorIdx = source.indexOf(
      'className="my-1 h-px bg-dls-border/80"',
    );
    expect(addFileIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(addFileIdx);
    expect(separatorIdx).toBeGreaterThan(captureIdx);
    expect(modesIdx).toBeGreaterThan(separatorIdx);
    expect(source).toContain('role="separator"');
  });

  test("skill and connector descriptions use bottom tooltips", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('side="bottom"');
    expect(source).toContain("TooltipContent");
    expect(source).toContain("TooltipProvider");
  });

  test("Computer Use third flyout stays opaque solid", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "toolMenuSection === \"mcps\" && selectedComposerExtension?.suggestedPrompts?.length",
    );
    const thirdPanel = source.slice(
      source.indexOf(
        "toolMenuSection === \"mcps\" && selectedComposerExtension?.suggestedPrompts?.length",
      ),
    );
    expect(thirdPanel).toContain("bg-dls-surface-solid");
    expect(thirdPanel).toContain(
      'style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}',
    );
  });
});

describe("assistant task context menu order", () => {
  test("save-to-space sits below archive", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-task-item.tsx",
      ),
      "utf8",
    );

    const archiveIdx = source.indexOf('t("session.archive_task")');
    const saveIdx = source.indexOf('t("session.save_to_space")');
    // Menu body: last archive_task label in menu should precede save_to_space
    // (hover chip also has archive_task earlier — use lastIndex for menu item).
    const archiveMenuIdx = source.lastIndexOf('t("session.archive_task")');
    expect(archiveMenuIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(archiveMenuIdx);
    expect(archiveIdx).toBeGreaterThan(-1);
  });
});
