/**
 * Pure layout/state helpers for the skill matrix (sticky grid + cell state).
 * Kept separate from the React matrix surface so layout contracts can be tested
 * without mounting the virtualizer.
 */
import { t } from "@/i18n";
import type {
  AgentManagementSkill,
  AgentManagementSkillAgent,
} from "../../../../app/lib/desktop";
import { skillAgentLabel } from "./agent-management-skill-model";

export type SkillCellState =
  | "native"
  | "managed"
  | "available"
  | "readonly"
  | "busy"
  | "unavailable";

export const SKILL_MATRIX_AGENT_COL = "48px";
export const SKILL_MATRIX_ACTION_COL = "64px";

/** Header + body must share one overflow scroller for sticky alignment. */
export function skillMatrixGridStyle(agentColCount: number) {
  const n = Math.max(1, agentColCount);
  return {
    gridTemplateColumns: `minmax(12rem,1fr) repeat(${n}, ${SKILL_MATRIX_AGENT_COL}) ${SKILL_MATRIX_ACTION_COL}`,
  } as const;
}

export function resolveSkillCellState(
  skill: AgentManagementSkill,
  agent: AgentManagementSkillAgent,
  busyKey: string | null,
  agentUnavailable = false,
): { state: SkillCellState; tooltip: string } {
  const label = skillAgentLabel(agent);
  if (agentUnavailable) {
    return {
      state: "unavailable",
      tooltip: t("skills.matrix_tooltip_agent_missing", { label }),
    };
  }
  const enabled = skill.agents.includes(agent);
  const ownsSource = skill.sources.some(
    (source) =>
      source.agent === agent &&
      source.path === skill.path &&
      !source.managedByStudioSwitch,
  );
  const sourceKind =
    skill.kind ?? skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const canSync =
    sourceKind === "skill" &&
    skill.sources.some(
      (source) =>
        source.kind !== "runtime-skill" && source.kind !== "slash-command",
    );
  const busy = busyKey === `${skill.path}:${agent}`;
  if (busy)
    return { state: "busy", tooltip: t("skills.matrix_tooltip_busy", { label }) };
  if (enabled && ownsSource)
    return {
      state: "native",
      tooltip: t("skills.matrix_tooltip_native", { label }),
    };
  if (enabled)
    return {
      state: "managed",
      tooltip: t("skills.matrix_tooltip_managed", { label }),
    };
  if (!canSync)
    return {
      state: "readonly",
      tooltip: t("skills.matrix_tooltip_readonly", { label }),
    };
  return {
    state: "available",
    tooltip: t("skills.matrix_tooltip_available", { label }),
  };
}

/** Structural contract: sticky header lives inside the same overflow parent. */
export function skillMatrixUsesSharedOverflowScroller(source: string): boolean {
  const hasOverflow =
    source.includes("overflow-auto") || source.includes("overflow-y-auto");
  return (
    hasOverflow &&
    source.includes("sticky") &&
    source.includes("skillMatrixGridStyle")
  );
}
