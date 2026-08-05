/**
 * Merge OpenCode command.list rows with OnMyAgent skill cards for the slash menu.
 */
import type { SlashCommandOption } from "../../../../../app/types";
import type { SkillCard } from "../../../../../app/types";
import { isComposerManagedSkill } from "./skill-catalog";

export function mergeSlashCommandsWithSkills(
  cmds: SlashCommandOption[],
  skillCards: SkillCard[],
): { commands: SlashCommandOption[]; skillsForState: SkillCard[] | null } {
  const managedSkills = skillCards.filter(isComposerManagedSkill);
  const byName = new Map<string, SlashCommandOption>();
  for (const skill of managedSkills) {
    const name = String(skill.name ?? "").trim();
    if (!name) continue;
    byName.set(name, {
      id: `skill:${name}`,
      name,
      description: skill.description ? String(skill.description) : undefined,
      source: "skill",
    });
  }
  const managedNames = new Set(byName.keys());
  for (const cmd of cmds) {
    const name = String(cmd.name ?? "").trim();
    if (!name) continue;
    // Keep non-skill commands (custom slash commands). Skill rows only if managed.
    if (cmd.source === "skill" || !cmd.source) {
      if (!managedNames.has(name)) continue;
    }
    byName.set(name, cmd);
  }
  return {
    commands: Array.from(byName.values()),
    skillsForState: managedSkills.length ? managedSkills : null,
  };
}
