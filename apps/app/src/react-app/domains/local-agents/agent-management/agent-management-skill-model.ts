import { t } from "../../../../i18n";
import type { AgentManagementSkillAgent } from "../../../../app/lib/desktop";

export const SKILL_AGENT_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  codex: "Codex",
  gemini: "Gemini",
  onmyagent: "OnMyAgent",
  unknown: t("agent_manager.skill_agent_unknown"),
};

export function skillAgentLabel(agent: string) {
  if (agent === "unknown") return t("agent_manager.agent_unknown");
  return SKILL_AGENT_LABELS[agent] ?? agent;
}

export const STUDIO_SWITCH_SKILL_AGENT_OPTIONS: AgentManagementSkillAgent[] = ["opencode", "codex", "claude", "gemini", "hermes", "openclaw", "onmyagent"];

// Prefer brand-step /10 soft fills over Radix step-3 solids: in dark mode
// step 3 becomes a heavy navy/green slab (e.g. blue-3 ≈ #0d2847) that fights
// the skill-matrix green checkmarks. Opacity tints read lightly on both themes.
//   step 9  = solid brand (dots / MCP badges)
//   step 11 = accessible fg when needed
// Semantic hue mapping: emerald→jade, rose→ruby; blue/orange/sky exist as-is.
export const SKILL_AGENT_TONES: Record<string, { active: string; badge: string; iconActive: string; dot: string }> = {
  opencode: {
    active: "bg-blue-9/15 text-dls-text ring-1 ring-blue-9/35 hover:bg-blue-9/20",
    badge: "bg-blue-9/15 text-blue-11",
    iconActive: "bg-blue-9/15 hover:bg-blue-9/20",
    dot: "bg-blue-9",
  },
  codex: {
    active: "bg-jade-9/15 text-dls-text ring-1 ring-jade-9/35 hover:bg-jade-9/20",
    badge: "bg-jade-9/15 text-jade-11",
    iconActive: "bg-jade-9/15 hover:bg-jade-9/20",
    dot: "bg-jade-9",
  },
  gemini: {
    active: "bg-indigo-9/15 text-dls-text ring-1 ring-indigo-9/35 hover:bg-indigo-9/20",
    badge: "bg-indigo-9/15 text-indigo-11",
    iconActive: "bg-indigo-9/15 hover:bg-indigo-9/20",
    dot: "bg-indigo-9",
  },
  claude: {
    active: "bg-orange-9/15 text-dls-text ring-1 ring-orange-9/35 hover:bg-orange-9/20",
    badge: "bg-orange-9/15 text-orange-11",
    iconActive: "bg-orange-9/15 hover:bg-orange-9/20",
    dot: "bg-orange-9",
  },
  hermes: {
    active: "bg-sky-9/15 text-dls-text ring-1 ring-sky-9/35 hover:bg-sky-9/20",
    badge: "bg-sky-9/15 text-sky-11",
    iconActive: "bg-sky-9/15 hover:bg-sky-9/20",
    dot: "bg-sky-9",
  },
  openclaw: {
    active: "bg-ruby-9/15 text-dls-text ring-1 ring-ruby-9/35 hover:bg-ruby-9/20",
    badge: "bg-ruby-9/15 text-ruby-11",
    iconActive: "bg-ruby-9/15 hover:bg-ruby-9/20",
    dot: "bg-ruby-9",
  },
  onmyagent: {
    active: "bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border hover:bg-dls-active",
    badge: "bg-dls-surface-muted text-dls-secondary",
    iconActive: "bg-dls-surface-muted hover:bg-dls-active",
    dot: "bg-dls-secondary",
  },
  unknown: {
    active: "bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border hover:bg-dls-active",
    badge: "bg-dls-surface-muted text-dls-secondary",
    iconActive: "bg-dls-surface-muted hover:bg-dls-active",
    dot: "bg-dls-secondary",
  },
};
