import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collaborationModeOptionKeys,
  filterToolMenuItems,
  pluginSkillFileSearchText,
} from "../src/react-app/domains/session/surface/composer/tool-menu-model";

describe("composer tool menu model", () => {
  test("supports a light optional border without a composer shadow", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("showOuterBorder?: boolean;");
    expect(source).toContain(
      'props.showOuterBorder ? "border border-dls-mist" : ""',
    );
    expect(source).not.toContain("shadow-sm transition-shadow");
    expect(source).not.toContain(
      "relative overflow-visible rounded-xl border border-dls-border bg-dls-surface",
    );
  });

  test("matches marketplace search styling for skills and connectors", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(
      source.match(
        /<InputGroup controlSize="sm" radius="md" tone="surface">/g,
      ) ?? [],
    ).toHaveLength(2);
    expect(
      source.match(/<Search aria-hidden="true" className="size-3\.5" \/>/g) ?? [],
    ).toHaveLength(2);
    expect(
      source.match(
        /className="text-sm text-dls-text placeholder:text-dls-secondary\/70"/g,
      ) ?? [],
    ).toHaveLength(2);
  });

  test("keeps pursue goal out of office collaboration modes", () => {
    expect(collaborationModeOptionKeys("office")).toEqual(["craft", "ask", "plan"]);
    expect(collaborationModeOptionKeys("legacy")).toEqual(["planning", "pursueGoal"]);
  });

  test("nests assistant prompt templates in the add menu", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'type ToolMenuSection = "files" | "templates" | "modes" | "skills" | "mcps";',
    );
    expect(source).toContain('t("composer.prompt_templates")');
    expect(source).toContain("selectedPromptTemplate.prompts.map");
    expect(source).toContain(
      "onMouseEnter={() => setSelectedPromptTemplateId(template.id)}",
    );
    expect(source).toContain('left-[calc(36rem-2px)]');
    expect(source).toContain(
      "applyPromptTemplate(selectedPromptTemplate.id, prompt)",
    );
  });

  test("filters skills by name or description while preserving source order", () => {
    const items = [
      { name: "review", description: "Review code changes" },
      { name: "xlsx", description: "Analyze spreadsheet data" },
      { name: "init", description: "Guided project setup" },
    ];

    expect(
      filterToolMenuItems(items, "  SPREADSHEET  ", (item) =>
        `${item.name} ${item.description}`,
      ),
    ).toEqual([items[1]]);
    expect(filterToolMenuItems(items, "", (item) => item.name)).toEqual(items);
  });

  test("filters connectors across names and descriptions", () => {
    const items = [
      { name: "Local Browser", description: "Control the desktop browser" },
      { name: "DingTalk", description: "Send team messages" },
    ];

    expect(
      filterToolMenuItems(items, "desktop", (item) =>
        `${item.name} ${item.description}`,
      ),
    ).toEqual([items[0]]);
    expect(filterToolMenuItems(items, "dingt", (item) => item.name)).toEqual([items[1]]);
  });

  test("indexes imported plugin files by their visible object type", () => {
    expect(
      pluginSkillFileSearchText({ title: "Review changes", objectType: "command" }),
    ).toBe("Review changes Command");
    expect(
      pluginSkillFileSearchText({ title: "Spreadsheet helper", objectType: "skill" }),
    ).toBe("Spreadsheet helper Skill");
  });
});
