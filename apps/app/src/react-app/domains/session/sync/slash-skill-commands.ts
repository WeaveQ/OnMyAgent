/** Slash names that must inject SKILL.md even if command.list omits source=skill. */
export const CORE_SLASH_SKILL_COMMAND_NAMES = [
  "skill-creator",
  "expert-manager",
  "find-skills",
  "create-automation",
  "knowledge-vault",
] as const;

export function isInjectedSkillCommand(
  commandName: string,
  commandSource?: string | null,
): boolean {
  const name = commandName.trim();
  if (!name) return false;
  if (commandSource === "skill") return true;
  return (CORE_SLASH_SKILL_COMMAND_NAMES as readonly string[]).includes(name);
}

export type SlashSkillSendDecision =
  | {
      kind: "inject";
      systemPrompt: string;
      visiblePrompt: string;
    }
  | { kind: "fail"; commandName: string }
  | { kind: "command" };

export function buildSkillCommandSystemPrompt(
  commandName: string,
  skillContent: string,
): string {
  return [
    `The user invoked the /${commandName} skill. Read and follow this SKILL.md content for this turn.`,
    "The user-facing prompt may start with a [[skill:name]] marker; treat it as UI metadata and focus on the arguments after it.",
    "",
    "```markdown",
    skillContent,
    "```",
  ].join("\n");
}

export function buildSkillCommandVisiblePrompt(
  commandName: string,
  skillArguments: string,
): string {
  return `[[skill:${commandName}]] ${skillArguments.trim() || commandName}`.trim();
}

export async function resolveSlashSkillSend(input: {
  commandName: string;
  commandSource?: string | null;
  arguments: string;
  loadSkillContent: (name: string) => Promise<string | null>;
}): Promise<SlashSkillSendDecision> {
  const commandName = input.commandName.trim();
  if (!isInjectedSkillCommand(commandName, input.commandSource)) {
    return { kind: "command" };
  }
  let content: string | null = null;
  try {
    content = await input.loadSkillContent(commandName);
  } catch {
    content = null;
  }
  const trimmed = content?.trim() ?? "";
  if (!trimmed) {
    return { kind: "fail", commandName };
  }
  return {
    kind: "inject",
    systemPrompt: buildSkillCommandSystemPrompt(commandName, trimmed),
    visiblePrompt: buildSkillCommandVisiblePrompt(commandName, input.arguments),
  };
}

export function createInjectedSkillContentLoader(deps: {
  getSkill: (name: string) => Promise<string>;
  ensureInstalled?: (name: string) => Promise<void>;
  readInstalled?: (name: string) => Promise<string | null>;
  bundledByName?: Readonly<Record<string, string>>;
}): (name: string) => Promise<string | null> {
  return async (name: string) => {
    if (deps.ensureInstalled) {
      try {
        await deps.ensureInstalled(name);
      } catch {
        // still try getSkill / disk / bundled
      }
    }
    try {
      const primary = await deps.getSkill(name);
      if (primary.trim()) return primary;
    } catch {
      // keep falling through
    }
    if (deps.readInstalled) {
      try {
        const installed = await deps.readInstalled(name);
        if (installed?.trim()) return installed;
      } catch {
        // keep falling through
      }
    }
    const bundled = deps.bundledByName?.[name];
    return bundled?.trim() ? bundled : null;
  };
}
