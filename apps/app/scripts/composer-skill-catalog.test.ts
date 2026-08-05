import { describe, expect, test } from "bun:test";

import type { SkillCard, SlashCommandOption } from "../src/app/types";
import {
  buildCombinedSkillItems,
  buildOnmyagentInstalledNames,
  isComposerManagedSkill,
} from "../src/react-app/domains/session/surface/composer/skill-catalog";
import { mergeSlashCommandsWithSkills } from "../src/react-app/domains/session/surface/composer/slash-command-merge";

describe("composer skill catalog product model", () => {
  const skills: SkillCard[] = [
    {
      name: "find-skills",
      path: "/home/u/.onmyagent/skills/find-skills/SKILL.md",
      description: "discover",
      scope: "onmyagent",
    },
    {
      name: "documents",
      path: "/app/plugins/documents/SKILL.md",
      description: "docs",
      scope: "builtin",
    },
    {
      name: "browser-automation",
      path: "/app/bundled-skills/browser-automation/SKILL.md",
      description: "ghost",
      scope: "local",
    },
  ];

  test("only onmyagent + builtin skills are composer-managed", () => {
    expect(isComposerManagedSkill(skills[0]!)).toBe(true);
    expect(isComposerManagedSkill(skills[1]!)).toBe(true);
    expect(isComposerManagedSkill(skills[2]!)).toBe(false);
  });

  test("combined catalog drops unmanaged package skills even if OpenCode lists them", () => {
    const commands: SlashCommandOption[] = [
      {
        id: "cmd:browser-automation",
        name: "browser-automation",
        description: "from opencode",
        source: "skill",
      },
      {
        id: "cmd:find-skills",
        name: "find-skills",
        description: "from opencode",
        source: "skill",
      },
    ];
    const names = buildOnmyagentInstalledNames(skills);
    const items = buildCombinedSkillItems(skills, commands, names);
    expect(items.map((item) => item.name).sort()).toEqual([
      "documents",
      "find-skills",
    ]);
  });

  test("uses marketplace-style Chinese display labels when present", () => {
    const localized: SkillCard[] = [
      {
        name: "douyin-content-surge",
        path: "/x/skills/douyin-content-surge",
        description: "en desc",
        descriptionZh: "抖音飙升榜说明",
        displayNameZh: "抖音每日点赞飙升榜",
        displayNameEn: "Douyin Daily Like Surge",
        scope: "onmyagent",
      },
    ];
    const items = buildCombinedSkillItems(localized, [], new Set(["douyin-content-surge"]));
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("抖音每日点赞飙升榜");
    expect(items[0]?.description).toBe("抖音飙升榜说明");
    expect(items[0]?.name).toBe("douyin-content-surge");
  });

  test("slash merge keeps managed skills only", () => {
    const cmds: SlashCommandOption[] = [
      {
        id: "cmd:browser-automation",
        name: "browser-automation",
        source: "skill",
      },
      { id: "cmd:my-cmd", name: "my-cmd", source: "command" },
    ];
    const merged = mergeSlashCommandsWithSkills(cmds, skills);
    const names = merged.commands.map((c) => c.name).sort();
    expect(names).toEqual(["documents", "find-skills", "my-cmd"]);
    expect(merged.skillsForState?.map((s) => s.name).sort()).toEqual([
      "documents",
      "find-skills",
    ]);
  });
});
