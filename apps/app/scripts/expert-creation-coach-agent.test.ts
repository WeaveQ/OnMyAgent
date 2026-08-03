import { describe, expect, test } from "bun:test";

import { EXPERT_CREATION_COACH_AGENT_ID } from "../src/react-app/domains/agents/agent-builtin";
import { createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-default-registry";
import { createBlankWizardDraft } from "../src/react-app/domains/agents/agent-registry";
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

  test("system prompt uses coach identity and live draft fields", () => {
    const registry = createDefaultAgentRegistry();
    const coach = resolveExpertCreationCoachAgent(registry);
    expect(coach).toBeTruthy();
    const draft = createBlankWizardDraft(registry);
    draft.name = "运营专家";
    draft.userNote = "角色草稿";
    const prompt = buildExpertCreationCoachSystemPrompt(coach!, draft);
    expect(prompt).toContain(coach!.name);
    expect(prompt).toContain("运营专家");
    expect(prompt).toContain("角色草稿");
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
  });
});
