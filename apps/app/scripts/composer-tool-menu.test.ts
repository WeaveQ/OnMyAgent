import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collaborationModeOptionKeys,
  filterToolMenuItems,
  matchComposerSlashQuery,
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
    const helpers = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer-helpers.tsx",
      ),
      "utf8",
    );

    expect(helpers).toContain("showOuterBorder?: boolean;");
    expect(helpers).toContain("homeLayout?: boolean;");
    expect(source).toContain(
      'props.showOuterBorder ? `border border-dls-border shadow-sm',
    );
    expect(source).toContain("const homeLayout = Boolean(props.homeLayout);");
    expect(source).not.toContain("shadow-sm transition-shadow");
  });

  test("matches marketplace search styling for skills and connectors", () => {
    // Search chrome lives in the extracted tool-menu panel.
    const menu = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer-tool-menu.tsx",
      ),
      "utf8",
    );
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(
      menu.match(
        /controlSize="sm"\s*\n\s*radius="lg"\s*\n\s*tone="surfaceMuted"/g,
      ) ?? [],
    ).toHaveLength(2);
    expect(
      menu.match(
        /<Search aria-hidden="true" className="size-3\.5 text-dls-secondary" \/>/g,
      ) ?? [],
    ).toHaveLength(2);
    expect(
      menu.match(
        /className="text-sm text-dls-text placeholder:text-dls-secondary\/70"/g,
      ) ?? [],
    ).toHaveLength(2);
    // Configure prefers connectors marketplace; falls back to settings mcps.
    expect(source).toContain("openCustomConnectorOrMarketplace");
    expect(source).toContain("openConnectorsConfigure");
    expect(source).toContain("onOpenConnectorsMarketplace");
    expect(menu).toContain("onClick={openConnectorsConfigure}");
  });

  test("keeps pursue goal out of office collaboration modes", () => {
    expect(collaborationModeOptionKeys("office")).toEqual(["craft", "ask", "plan"]);
    expect(collaborationModeOptionKeys("legacy")).toEqual(["planning", "pursueGoal"]);
  });

  test("nests assistant prompt templates in the add menu", () => {
    const menu = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer-tool-menu.tsx",
      ),
      "utf8",
    );
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );
    const helpers = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer-helpers.tsx",
      ),
      "utf8",
    );

    expect(helpers).toContain(
      'export type ToolMenuSection = "files" | "templates" | "modes" | "skills" | "mcps";',
    );
    expect(menu).toContain('t("composer.prompt_templates")');
    expect(menu).toContain("selectedPromptTemplate.prompts.map");
    expect(menu).toContain(
      "onMouseEnter={() => setSelectedPromptTemplateId(template.id)}",
    );
    // Primary (11rem) + secondary (17.5rem) → third flyout for selected template prompts.
    expect(menu).toContain("left-[calc(11rem+17.5rem-2px)]");
    expect(menu).toContain("max-w-[17.5rem]");
    expect(menu).toContain('toolMenuSection === "templates" ? "max-h-48" : "max-h-56"');
    // WorkBuddy cascade: open 3rd panel when the prompts section becomes active.
    expect(source).toContain("WorkBuddy-style cascade");
    expect(menu).toContain(
      "applyPromptTemplate(selectedPromptTemplate.id, prompt)",
    );
  });

  test("filters skills by name or description and ranks hits", () => {
    const items = [
      { name: "review", description: "Review code changes" },
      { name: "xlsx", description: "Analyze spreadsheet data" },
      { name: "init", description: "Guided project setup" },
      { name: "obsidian", description: "Manage Obsidian vault notes" },
    ];

    expect(
      filterToolMenuItems(items, "  SPREADSHEET  ", (item) =>
        `${item.name} ${item.description}`,
      ),
    ).toEqual([items[1]]);
    expect(filterToolMenuItems(items, "", (item) => item.name)).toEqual(items);
    // `/obsidian` style query should isolate the skill, not leave the full catalog.
    expect(
      filterToolMenuItems(items, "obsidian", (item) =>
        `${item.name} ${item.name} ${item.description}`,
      ).map((item) => item.name),
    ).toEqual(["obsidian"]);
  });

  test("matchComposerSlashQuery tolerates trailing newlines and invisible chars", () => {
    expect(matchComposerSlashQuery("/obsidian")).toEqual({
      open: true,
      query: "obsidian",
    });
    expect(matchComposerSlashQuery("/obsidian\n")).toEqual({
      open: true,
      query: "obsidian",
    });
    expect(matchComposerSlashQuery("/obsidian\n\n")).toEqual({
      open: true,
      query: "obsidian",
    });
    expect(matchComposerSlashQuery("/obsidian ")).toEqual({
      open: false,
      query: "",
    });
    expect(matchComposerSlashQuery("/")).toEqual({ open: true, query: "" });
    expect(matchComposerSlashQuery("hello /obs")).toEqual({
      open: true,
      query: "obs",
    });
    // Zero-width space after the token should not poison the query.
    expect(matchComposerSlashQuery("/obsidian\u200b")).toEqual({
      open: true,
      query: "obsidian",
    });
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
