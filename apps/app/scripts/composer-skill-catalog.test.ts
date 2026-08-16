import { describe, expect, test } from "bun:test";

import type { SkillCard, SlashCommandOption } from "../src/app/types";
import type { McpDirectoryInfo } from "../src/app/constants";
import type { McpServerEntry } from "../src/app/types";
import {
  buildActiveMcpItems,
  buildCombinedSkillItems,
  buildOnmyagentInstalledNames,
  builtInExtensionMcpServerNames,
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
      name: "getworkbuddy",
      path: "/home/u/.onmyagent/profiles/local/config/skills/getworkbuddy/SKILL.md",
      description: "Import local WorkBuddy experts",
      scope: "onmyagent",
    },
    {
      name: "browser-automation",
      path: "/app/bundled-skills/browser-automation/SKILL.md",
      description: "ghost",
      scope: "local",
    },
  ];

  test("onmyagent + builtin + local skills are composer-managed", () => {
    expect(isComposerManagedSkill(skills[0]!)).toBe(true);
    expect(isComposerManagedSkill(skills[1]!)).toBe(true);
    expect(isComposerManagedSkill(skills[2]!)).toBe(true);
  });

  test("combined catalog includes local skills and managed OpenCode rows", () => {
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
      "browser-automation",
      "documents",
      "find-skills",
      "getworkbuddy",
    ]);
  });

  test("uses marketplace-style Chinese display labels when locale is zh", () => {
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
    const items = buildCombinedSkillItems(
      localized,
      [],
      new Set(["douyin-content-surge"]),
      "zh",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("抖音每日点赞飙升榜");
    expect(items[0]?.description).toBe("抖音飙升榜说明");
    expect(items[0]?.name).toBe("douyin-content-surge");
  });

  test("uses English display labels when locale is en", () => {
    const localized: SkillCard[] = [
      {
        name: "douyin-content-surge",
        path: "/x/skills/douyin-content-surge",
        description: "fallback desc",
        descriptionZh: "抖音飙升榜说明",
        descriptionEn: "Douyin surge notes",
        displayNameZh: "抖音每日点赞飙升榜",
        displayNameEn: "Douyin Daily Like Surge",
        scope: "onmyagent",
      },
    ];
    const items = buildCombinedSkillItems(
      localized,
      [],
      new Set(["douyin-content-surge"]),
      "en",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("Douyin Daily Like Surge");
    expect(items[0]?.description).toBe("Douyin surge notes");
  });

  test("slash merge keeps managed skills including local", () => {
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
    expect(names).toEqual([
      "browser-automation",
      "documents",
      "find-skills",
      "getworkbuddy",
      "my-cmd",
    ]);
    expect(merged.skillsForState?.map((s) => s.name).sort()).toEqual([
      "browser-automation",
      "documents",
      "find-skills",
      "getworkbuddy",
    ]);
  });

  test("connector menu excludes MCP servers owned by built-in extensions", () => {
    const extensions: McpDirectoryInfo[] = [
      {
        id: "computer-use",
        name: "计算机控制",
        serverName: "computer-use",
        description: "desktop",
        oauth: false,
        kind: "extension",
        extensionManifest: {
          schemaVersion: 1,
          id: "computer-use",
          name: "计算机控制",
          description: "desktop",
          source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
          resources: [
            {
              type: "mcp",
              id: "computer-use-mcp",
              mcpServerName: "computer-use",
            },
          ],
        },
      },
    ];
    const servers: McpServerEntry[] = [
      {
        name: "computer-use",
        config: { type: "local", command: ["npx", "handsfree"], enabled: true },
      },
      {
        name: "custom-mcp",
        config: { type: "local", command: ["echo"], enabled: true },
      },
    ];
    const exclude = builtInExtensionMcpServerNames(extensions);
    expect(exclude.has("computer-use")).toBe(true);
    const items = buildActiveMcpItems(servers, {}, exclude);
    expect(items.map((item) => item.entry.name)).toEqual(["custom-mcp"]);
  });
});
