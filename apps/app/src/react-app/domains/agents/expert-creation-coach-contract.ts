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
    "Only propose skill IDs present in the enabled catalog, and explain what work each selected skill supports.",
    "Write executable rules and checks, not vague adjectives or generic encouragement.",
  ].join("\n");
}
