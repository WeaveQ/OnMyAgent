const EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT = 7;

export type ExpertCreationRolePromptValidation = {
  valid: boolean;
  missingSectionCount: number;
};

function rolePromptHeadingPattern(): RegExp {
  return /^##(?!#)\s*([^\n]+)(?:\n|$)([\s\S]*?)(?=^##(?!#)\s*|$)/gm;
}

function rolePromptSectionBody(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isValidRolePromptSectionBody(body: string): boolean {
  return body.length > 0 && !body.includes("[TODO]");
}

function decodeMaybeEscapedNewlines(value: string): string {
  if (value.includes("\n") || value.includes("\r")) return value;
  if (!value.includes("\\n")) return value;
  return value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}

function matchRolePromptSections(value: string): RegExpMatchArray[] {
  return [...decodeMaybeEscapedNewlines(value).matchAll(rolePromptHeadingPattern())];
}

function clipTrailingProposalProse(value: string): string {
  return value.replace(
    /\n{2,}(?:请审阅|Please review|If you(?:'d)? like|如果你|角色提示词[:：]|Role prompt[:：]|[•\-\*]\s).*$/isu,
    "",
  ).trim();
}

/** Pull a complete seven-section role prompt out of coach text or a tagged payload. */
export function extractExpertCreationRolePrompt(value: string): string | undefined {
  const decoded = decodeMaybeEscapedNewlines(value).trim();
  if (!decoded) return undefined;
  const matches = [...decoded.matchAll(rolePromptHeadingPattern())];
  const valid = matches.filter((match) => (
    isValidRolePromptSectionBody(rolePromptSectionBody(match[2] ?? ""))
  ));
  if (valid.length < EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT) return undefined;
  const start = valid[0]?.index;
  const last = valid[valid.length - 1];
  if (start === undefined || last?.index === undefined) return undefined;
  return clipTrailingProposalProse(
    decoded.slice(start, last.index + last[0].length).trim(),
  );
}

export function validateExpertCreationRolePrompt(
  value: string,
): ExpertCreationRolePromptValidation {
  const validCount = matchRolePromptSections(value).filter((match) => (
    isValidRolePromptSectionBody(rolePromptSectionBody(match[2] ?? ""))
  )).length;
  const missingSectionCount = Math.max(
    0,
    EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT - validCount,
  );
  return {
    valid: validCount >= EXPERT_CREATION_ROLE_PROMPT_SECTION_COUNT,
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
    "When stable facts are available, generate agentMemory together with the role prompt as the same proposal; keep both fields in one update and do not ask for separate memory confirmation.",
    "Only propose skill IDs present in the enabled catalog, and explain what work each selected skill supports.",
    "Write executable rules and checks, not vague adjectives or generic encouragement.",
  ].join("\n");
}
