const EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT = 7;

export type ExpertCreationRolePromptValidation = {
  valid: boolean;
  missingSectionCount: number;
};

type ParsedRolePromptSection = {
  body: string;
};

function readRolePromptSections(value: string): ParsedRolePromptSection[] {
  const headingPattern = /^##(?!#)\s*([^\n]+)(?:\n|$)([\s\S]*?)(?=^##(?!#)\s*|$)/gm;
  return [...value.matchAll(headingPattern)].map((match) => ({
    body: (match[2] ?? "").replace(/\s+/g, " ").trim(),
  }));
}

export function validateExpertCreationRolePrompt(
  value: string,
): ExpertCreationRolePromptValidation {
  const sections = readRolePromptSections(value);
  const validSections = sections.filter(
    (section) => section.body.length > 0 && !section.body.includes("[TODO]"),
  );
  const missingSectionCount = Math.max(
    0,
    EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT - validSections.length,
  );
  return {
    valid:
      sections.length >= EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT &&
      validSections.length === sections.length,
    missingSectionCount,
  };
}

export function buildExpertCreationCoachWorkflowInstructions(): string {
  return [
    "Use a staged expert-design workflow: positioning, capabilities, rules, boundaries, workflow, deliverables, and communication style.",
    "Ask one focused question at a time when any stage is missing; do not emit a complete proposal early.",
    "A complete role prompt must contain seven non-empty level-two Markdown sections before it can be proposed.",
    "Keep the proposal fields separate: userNote is only the seven-section runtime role prompt; agentMemory is only concise stable facts about the user's project, audience, preferences, or recurring context.",
    "Write agentMemory as a short numbered or bulleted list of durable facts (for example, 1. The project is an AI design tool. 2. The target users are designers.). Never put role-prompt headings, capabilities, rules, workflow, or deliverable instructions in agentMemory.",
    "When stable facts are available, generate agentMemory together with the role prompt, but treat it as a suggestion that requires the user's confirmation in the form.",
    "Only propose skill IDs present in the enabled catalog, and explain what work each selected skill supports.",
    "Write executable rules and checks, not vague adjectives or generic encouragement.",
  ].join("\n");
}
