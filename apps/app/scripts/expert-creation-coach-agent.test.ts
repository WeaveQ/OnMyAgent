import { describe, expect, test } from "bun:test";

import {
  buildBuiltinAgentRecords,
  EXPERT_CREATION_COACH_AGENT_ID,
} from "../src/react-app/domains/agents/agent-builtin";
import { createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-default-registry";
import { createBlankWizardDraft } from "../src/react-app/domains/agents/agent-registry";
import { currentLocale, setLocale, type Language } from "../src/i18n";
import {
  buildExpertCreationCoachPendingContext,
  buildExpertCreationCoachSystemPrompt,
  buildExpertCreationCoachToolAccess,
  resolveExpertCreationCoachAgent,
} from "../src/react-app/domains/agents/expert-creation-coach-agent";

describe("expert creation coach agent binding", () => {
  test("resolves the builtin coach from the default registry", () => {
    const registry = createDefaultAgentRegistry();
    const coach = resolveExpertCreationCoachAgent(registry);
    expect(coach?.id).toBe(EXPERT_CREATION_COACH_AGENT_ID);
    expect(coach?.builtin).toBe(true);
  });

  test("falls back to product builtin when registry cache omitted the coach", () => {
    const registry = createDefaultAgentRegistry();
    registry.agents = registry.agents.filter(
      (agent) => agent.id !== EXPERT_CREATION_COACH_AGENT_ID,
    );
    const coach = resolveExpertCreationCoachAgent(registry);
    expect(coach?.id).toBe(EXPERT_CREATION_COACH_AGENT_ID);
    expect(coach?.builtin).toBe(true);
  });

  test("system prompt uses creation-coach role and live draft fields", () => {
    const registry = createDefaultAgentRegistry();
    const coach = resolveExpertCreationCoachAgent(registry);
    expect(coach).toBeTruthy();
    const draft = createBlankWizardDraft(registry);
    draft.name = "运营专家";
    draft.userNote = "角色草稿";
    const prompt = buildExpertCreationCoachSystemPrompt(coach!, draft);
    expect(prompt).toContain("expert-creation coach");
    expect(prompt).toContain("help the user design and create");
    expect(prompt).not.toContain("Your identity is now:");
    expect(prompt).toContain("运营专家");
    expect(prompt).toContain("角色草稿");
  });

  test("current coach prompt includes the staged quality workflow and enabled skill catalog", () => {
    const registry = createDefaultAgentRegistry();
    const coach = resolveExpertCreationCoachAgent(registry);
    const skills = [{
      id: "research",
      category: "research",
      group: "",
      name: "Research",
      description: "Find and compare evidence.",
      enabled: true,
    }];
    expect(coach).toBeTruthy();
    if (!coach) return;

    const prompt = buildExpertCreationCoachSystemPrompt(
      coach,
      createBlankWizardDraft(registry),
      skills,
    );

    expect(prompt).toContain("seven non-empty level-two Markdown sections");
    expect(prompt).toContain("skill IDs");
    expect(prompt).toContain(skills[0].id);
    expect(prompt).toContain("userNote");
    expect(prompt).toContain("agentMemory");
    expect(prompt).toContain("stable facts");
    expect(prompt).toContain("<expert-update>");
    expect(prompt).toContain("<user-note>");
    expect(prompt).toContain("<agent-memory>");
    expect(prompt).toContain("reply with an explicit confirmation");
    expect(prompt).toContain("overwrite risk");
  });

  test("bundled coach copy describes the structured workflow in every locale", () => {
    const previousLocale = currentLocale();
    const expectations: readonly [Language, string, string][] = [
      ["en", "seven", "stable facts"],
      ["zh", "七个", "稳定事实"],
      ["zh-TW", "七個", "穩定事實"],
    ];

    try {
      for (const [language, marker, memoryMarker] of expectations) {
        setLocale(language);
        const coach = buildBuiltinAgentRecords()[0];
        expect(coach?.userNote).toContain(marker);
        expect(coach?.userNote).toContain(memoryMarker);
      }
    } finally {
      setLocale(previousLocale);
    }
  });

  test("coach tool access disables tools when enabledToolIds is empty", () => {
    const registry = createDefaultAgentRegistry();
    const coach = resolveExpertCreationCoachAgent(registry);
    expect(coach).toBeTruthy();
    const tools = buildExpertCreationCoachToolAccess(coach!);
    expect(tools).toBeDefined();
    expect(Object.values(tools ?? {}).every((enabled) => enabled === false)).toBe(true);
  });

  test("pending context keeps coach id and live draft system prompt", () => {
    const registry = createDefaultAgentRegistry();
    const draft = createBlankWizardDraft(registry);
    draft.name = "测试专家";
    const pending = buildExpertCreationCoachPendingContext(registry, draft);
    expect(pending?.id).toBe(EXPERT_CREATION_COACH_AGENT_ID);
    expect(pending?.systemPrompt).toContain("测试专家");
    expect(pending?.draftSource).toBe("agent-selection");
    expect(pending?.name).toBeTruthy();
    expect(pending?.avatar.avatarUrl).toContain("expert-creation-coach-avatar");
    expect(pending?.description).toBe("");
  });
});
