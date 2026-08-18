import { ApiError } from "../core/errors.js";
import {
  assertSafeGrokExpertProfile,
  closeGrokToolDependencies,
} from "./grok-expert-profile-guard.js";

export type GrokExpertProfile = {
  name: string;
  description: string;
  promptMode: "full";
  promptBody: string;
  permissionMode: "default";
  discoverSkills: false;
  inheritSkills: false;
  injectDefaultTools: false;
  agentsMd: false;
  skills: string[];
  mcpInheritance: "none";
  toolConfig: {
    tools: Array<{ id: string; params: null; name_override: null; params_name_overrides: Record<string, string> }>;
  };
};

export function compileMinimalGrokExpertProfile(input: {
  expertId: string;
  description: string;
  systemPrompt: string;
  declaredSkillNames: readonly string[];
  activatedSkillNames?: readonly string[];
  allowedBuiltInToolIds: readonly string[];
}): { agentProfile: GrokExpertProfile; materializedSkillNames: string[] } {
  const declared = uniqueIds(input.declaredSkillNames, "skill");
  const activated = uniqueIds(input.activatedSkillNames ?? [], "activated skill");
  if (activated.some((skill) => !declared.includes(skill))) {
    throw new ApiError(400, "grok_expert_skill_not_declared", "Activated Grok skill is not declared by the Expert");
  }
  const tools = closeGrokToolDependencies(uniqueIds(input.allowedBuiltInToolIds, "tool"));
  const agentProfile = {
    name: requireText(input.expertId, "expertId"),
    description: requireText(input.description, "description"),
    promptMode: "full" as const,
    promptBody: requireText(input.systemPrompt, "systemPrompt"),
    permissionMode: "default" as const,
    discoverSkills: false as const,
    inheritSkills: false as const,
    injectDefaultTools: false as const,
    agentsMd: false as const,
    skills: activated,
    mcpInheritance: "none" as const,
    toolConfig: {
      tools: tools.map((id) => ({ id, params: null, name_override: null, params_name_overrides: {} })),
    },
  };
  assertSafeGrokExpertProfile(agentProfile);
  return {
    agentProfile,
    materializedSkillNames: declared,
  };
}

function uniqueIds(values: readonly string[], label: string): string[] {
  return [...new Set(values.map((value) => requireText(value, label)))].sort();
}

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new ApiError(400, "invalid_payload", `${label} is required`);
  return text;
}
