/**
 * Inventory scope for the skill matrix: rows are a full-disk catalog;
 * fleet columns only cover managed agents. Shared pool = ~/.agents/skills.
 */
import type { AgentManagementSkill } from "../../../../app/lib/desktop";

/** Source agent key for the cross-agent skill pool (not a fleet column). */
export const AGENTS_SKILLS_SOURCE_KEY = "agents-skills";

export type SkillInventoryScope = "fleet" | "all" | "shared";

export function isAgentsSkillsPoolSkill(skill: AgentManagementSkill): boolean {
  const agentKeys = (skill.agents ?? []) as ReadonlyArray<string>;
  if (agentKeys.includes(AGENTS_SKILLS_SOURCE_KEY)) return true;
  if (skill.scopeLabel === "Agent Skills") return true;
  for (const source of skill.sources ?? []) {
    if (String(source.agent ?? "") === AGENTS_SKILLS_SOURCE_KEY) return true;
    if (source.scope === "agents") return true;
    if (String(source.label ?? "").toLowerCase() === "agent skills") return true;
    const path = `${source.path ?? ""}\n${source.root ?? ""}`.toLowerCase();
    if (path.includes("/.agents/skills") || path.includes("\\.agents\\skills")) return true;
  }
  const own = `${skill.path ?? ""}\n${skill.root ?? ""}`.toLowerCase();
  return own.includes("/.agents/skills") || own.includes("\\.agents\\skills");
}

/** True if the skill is tied to any fleet matrix column agent. */
export function isFleetRelatedSkill(
  skill: AgentManagementSkill,
  fleetAgents: ReadonlyArray<string>,
): boolean {
  const fleet = new Set(
    fleetAgents.map((agent) => String(agent).trim().toLowerCase()).filter(Boolean),
  );
  if (fleet.size === 0) return false;

  const isFleetKey = (raw: string) => {
    const key = String(raw ?? "").trim().toLowerCase();
    if (!key || key === "unknown" || key === AGENTS_SKILLS_SOURCE_KEY) return false;
    return fleet.has(key);
  };

  if ((skill.agents ?? []).some(isFleetKey)) return true;
  if ((skill.sources ?? []).some((source) => isFleetKey(source.agent))) return true;
  return false;
}

export function filterSkillsByInventoryScope(
  skills: ReadonlyArray<AgentManagementSkill>,
  scope: SkillInventoryScope,
  fleetAgents: ReadonlyArray<string>,
): AgentManagementSkill[] {
  if (scope === "all") return [...skills];
  if (scope === "shared") return skills.filter((skill) => isAgentsSkillsPoolSkill(skill));
  // fleet (default): tied to a matrix column, or only pool skills that are also
  // installed on a fleet agent (already covered by agents/sources). Pure pool-only
  // rows are hidden until the user picks "all" or "shared".
  return skills.filter((skill) => isFleetRelatedSkill(skill, fleetAgents));
}

export function countFleetRelatedSkills(
  skills: ReadonlyArray<AgentManagementSkill>,
  fleetAgents: ReadonlyArray<string>,
): number {
  return skills.filter((skill) => isFleetRelatedSkill(skill, fleetAgents)).length;
}

export function countSharedPoolSkills(skills: ReadonlyArray<AgentManagementSkill>): number {
  return skills.filter((skill) => isAgentsSkillsPoolSkill(skill)).length;
}
