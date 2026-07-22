/**
 * Merge OpenCode command.list rows with OnMyAgent skill cards for the slash menu.
 */
import type { SlashCommandOption } from "../../../../../app/types";
import type { SkillCard } from "../../../../../app/types";

export function mergeSlashCommandsWithSkills(
  cmds: SlashCommandOption[],
  skillCards: SkillCard[],
): { commands: SlashCommandOption[]; skillsForState: SkillCard[] | null } {
  const byName = new Map<string, SlashCommandOption>();
  for (const skill of skillCards) {
    const name = String(skill.name ?? "").trim();
    if (!name) continue;
    byName.set(name, {
      id: `skill:${name}`,
      name,
      description: skill.description ? String(skill.description) : undefined,
      source: "skill",
    });
  }
  for (const cmd of cmds) {
    const name = String(cmd.name ?? "").trim();
    if (!name) continue;
    byName.set(name, cmd);
  }
  return {
    commands: Array.from(byName.values()),
    skillsForState: skillCards.length ? skillCards : null,
  };
}
