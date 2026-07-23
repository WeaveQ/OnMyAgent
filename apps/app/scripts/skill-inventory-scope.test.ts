import { describe, expect, test } from "bun:test";

import type { AgentManagementSkill } from "../src/app/lib/desktop";
import {
  AGENTS_SKILLS_SOURCE_KEY,
  countFleetRelatedSkills,
  countSharedPoolSkills,
  filterSkillsByInventoryScope,
  isAgentsSkillsPoolSkill,
  isFleetRelatedSkill,
  skillPrimaryPathForMatrix,
  skillSourceSummaryForMatrix,
  skillSourcesForMatrix,
} from "../src/react-app/domains/local-agents/agent-management/skill-inventory-scope";

function skill(partial: Partial<AgentManagementSkill> & Pick<AgentManagementSkill, "name" | "path">): AgentManagementSkill {
  return {
    description: undefined,
    trigger: undefined,
    root: partial.root ?? partial.path,
    readonly: false,
    agents: partial.agents ?? [],
    sources: partial.sources ?? [],
    managedByStudioSwitch: false,
    studioSwitch: null,
    kind: "skill",
    pluginName: null,
    lastSeenAt: null,
    scopeLabel: partial.scopeLabel,
    ...partial,
  } as AgentManagementSkill;
}

describe("skill inventory scope", () => {
  const fleet = ["opencode", "grok", "onmyagent"];

  const poolOnly = skill({
    name: "write",
    path: "/Users/me/.agents/skills/write",
    root: "/Users/me/.agents/skills",
    agents: [AGENTS_SKILLS_SOURCE_KEY],
    sources: [{
      agent: AGENTS_SKILLS_SOURCE_KEY,
      label: "Agent Skills",
      scope: "agents",
      root: "/Users/me/.agents/skills",
      path: "/Users/me/.agents/skills/write",
      managedByStudioSwitch: false,
      kind: "skill",
      pluginName: null,
    }],
    scopeLabel: "Agent Skills",
  });

  const fleetNative = skill({
    name: "12306",
    path: "/Users/me/.grok/skills/12306",
    agents: ["grok"],
    sources: [{
      agent: "grok",
      label: "Grok Build",
      scope: "custom",
      root: "/Users/me/.grok/skills",
      path: "/Users/me/.grok/skills/12306",
      managedByStudioSwitch: false,
      kind: "skill",
      pluginName: null,
    }],
  });

  const both = skill({
    name: "wiki-query",
    path: "/Users/me/.claude/skills/wiki-query",
    agents: ["claude", AGENTS_SKILLS_SOURCE_KEY],
    sources: [
      {
        agent: "claude",
        label: "Claude Code",
        scope: "global",
        root: "/Users/me/.claude/skills",
        path: "/Users/me/.claude/skills/wiki-query",
        managedByStudioSwitch: false,
        kind: "skill",
        pluginName: null,
      },
      {
        agent: AGENTS_SKILLS_SOURCE_KEY,
        label: "Agent Skills",
        scope: "agents",
        root: "/Users/me/.agents/skills",
        path: "/Users/me/.agents/skills/wiki-query",
        managedByStudioSwitch: false,
        kind: "skill",
        pluginName: null,
      },
    ],
  });

  test("detects shared Agent Skills pool", () => {
    expect(isAgentsSkillsPoolSkill(poolOnly)).toBe(true);
    expect(isAgentsSkillsPoolSkill(fleetNative)).toBe(false);
    expect(isAgentsSkillsPoolSkill(both)).toBe(true);
  });

  test("fleet-related excludes pure shared pool", () => {
    expect(isFleetRelatedSkill(poolOnly, fleet)).toBe(false);
    expect(isFleetRelatedSkill(fleetNative, fleet)).toBe(true);
    // both has claude which is not in this fleet set
    expect(isFleetRelatedSkill(both, fleet)).toBe(false);
    expect(isFleetRelatedSkill(both, ["claude", "grok"])).toBe(true);
  });

  test("scope filters match product defaults", () => {
    const all = [poolOnly, fleetNative, both];
    expect(filterSkillsByInventoryScope(all, "all", fleet).map((s) => s.name)).toEqual([
      "write",
      "12306",
      "wiki-query",
    ]);
    expect(filterSkillsByInventoryScope(all, "fleet", fleet).map((s) => s.name)).toEqual(["12306"]);
    expect(filterSkillsByInventoryScope(all, "shared", fleet).map((s) => s.name)).toEqual([
      "write",
      "wiki-query",
    ]);
    expect(countFleetRelatedSkills(all, fleet)).toBe(1);
    expect(countSharedPoolSkills(all)).toBe(2);
  });

  test("empty fleet excludes all fleet-related", () => {
    expect(isFleetRelatedSkill(fleetNative, [])).toBe(false);
    expect(filterSkillsByInventoryScope([fleetNative, poolOnly], "fleet", []).map((s) => s.name)).toEqual([]);
  });

  test("unknown agent key is not fleet-related", () => {
    const unknownOnly = skill({
      name: "mystery",
      path: "/tmp/mystery",
      agents: ["unknown"],
    });
    expect(isFleetRelatedSkill(unknownOnly, fleet)).toBe(false);
  });

  test("source summary matches matrix columns only (not full-disk scan labels)", () => {
    const multi = skill({
      name: "arkcli-auth",
      path: "/Users/me/.opencode/skills/arkcli-auth",
      agents: ["claude", "gemini", "kiro", "qwen", "opencode", "grok"],
      sources: [
        { agent: "claude", label: "Claude Code", scope: "global", root: "/c", path: "/c/arkcli-auth", managedByStudioSwitch: false, kind: "skill", pluginName: null },
        { agent: "gemini", label: "Gemini CLI", scope: "global", root: "/g", path: "/g/arkcli-auth", managedByStudioSwitch: false, kind: "skill", pluginName: null },
        { agent: "kiro", label: "Kiro CLI", scope: "global", root: "/k", path: "/k/arkcli-auth", managedByStudioSwitch: false, kind: "skill", pluginName: null },
        { agent: "qwen", label: "Qwen Code CLI", scope: "global", root: "/q", path: "/q/arkcli-auth", managedByStudioSwitch: false, kind: "skill", pluginName: null },
        { agent: "opencode", label: "OpenCode CLI", scope: "global", root: "/o", path: "/o/arkcli-auth", managedByStudioSwitch: false, kind: "skill", pluginName: null },
        { agent: "grok", label: "Grok Build", scope: "custom", root: "/x", path: "/x/arkcli-auth", managedByStudioSwitch: false, kind: "skill", pluginName: null },
      ],
      scopeLabel: "many",
    });
    const matrix = ["opencode", "grok"];
    expect(skillSourceSummaryForMatrix(multi, matrix)).toBe("OpenCode CLI · Grok Build");
    expect(skillSourceSummaryForMatrix(multi, matrix)).not.toContain("Claude");
    expect(skillSourceSummaryForMatrix(multi, matrix)).not.toContain("Gemini");
    expect(skillPrimaryPathForMatrix(multi, matrix)).toBe("/o/arkcli-auth");
    expect(skillSourcesForMatrix(multi, matrix).map((s) => s.agent)).toEqual(["opencode", "grok"]);
  });
});
