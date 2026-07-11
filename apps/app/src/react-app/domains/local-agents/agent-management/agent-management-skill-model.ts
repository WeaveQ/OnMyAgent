import { t } from "@/i18n";
import type { AgentManagementSkillAgent } from "../../../../app/lib/desktop";

export const SKILL_AGENT_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  codex: "Codex",
  gemini: "Gemini",
  onmyagent: "OnMyAgent",
  unknown: "unknown",
};

export function skillAgentLabel(agent: string) {
  if (agent === "unknown") return t("agent_manager.agent_unknown");
  return SKILL_AGENT_LABELS[agent] ?? agent;
}

export const STUDIO_SWITCH_SKILL_AGENT_OPTIONS: AgentManagementSkillAgent[] = ["opencode", "codex", "claude", "gemini", "hermes", "openclaw", "onmyagent"];

// Tailwind theme in this project overrides all built-in palettes with Radix
// steps 1-12 (see apps/app/tailwind.config.ts + styles/tailwind-colors.ts).
// The previous `blue-50 / emerald-50 / orange-50 / sky-50 / rose-50` classes
// silently resolved to nothing, so agent hues never rendered. Radix mapping:
//   step 3  = subtle bg      (equivalent to Tailwind ~50)
//   step 4  = subtle hover   (~100)
//   step 6  = subtle border  (~200 ring)
//   step 9  = solid brand    (~500 dot)
//   step 11 = accessible fg  (~700 text)
// Semantic hue mapping: emerald→jade, rose→ruby; blue/orange/sky exist as-is.
export const SKILL_AGENT_TONES: Record<string, { active: string; badge: string; iconActive: string; dot: string }> = {
  opencode: {
    active: "bg-blue-3 text-blue-11 ring-1 ring-blue-6 hover:bg-blue-4",
    badge: "bg-blue-3 text-blue-11",
    iconActive: "bg-blue-3 hover:bg-blue-4",
    dot: "bg-blue-9",
  },
  codex: {
    active: "bg-jade-3 text-jade-11 ring-1 ring-jade-6 hover:bg-jade-4",
    badge: "bg-jade-3 text-jade-11",
    iconActive: "bg-jade-3 hover:bg-jade-4",
    dot: "bg-jade-9",
  },
  gemini: {
    active: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100",
    badge: "bg-indigo-50 text-indigo-700",
    iconActive: "bg-indigo-50 hover:bg-indigo-100",
    dot: "bg-indigo-500",
  },
  claude: {
    active: "bg-orange-3 text-orange-11 ring-1 ring-orange-6 hover:bg-orange-4",
    badge: "bg-orange-3 text-orange-11",
    iconActive: "bg-orange-3 hover:bg-orange-4",
    dot: "bg-orange-9",
  },
  hermes: {
    active: "bg-sky-3 text-sky-11 ring-1 ring-sky-6 hover:bg-sky-4",
    badge: "bg-sky-3 text-sky-11",
    iconActive: "bg-sky-3 hover:bg-sky-4",
    dot: "bg-sky-9",
  },
  openclaw: {
    active: "bg-ruby-3 text-ruby-11 ring-1 ring-ruby-6 hover:bg-ruby-4",
    badge: "bg-ruby-3 text-ruby-11",
    iconActive: "bg-ruby-3 hover:bg-ruby-4",
    dot: "bg-ruby-9",
  },
  onmyagent: {
    active: "bg-dls-icon-muted-bg text-dls-secondary ring-1 ring-dls-border hover:bg-dls-active",
    badge: "bg-dls-icon-muted-bg text-dls-secondary",
    iconActive: "bg-dls-icon-muted-bg hover:bg-dls-active",
    dot: "bg-dls-secondary",
  },
  unknown: {
    active: "bg-dls-icon-muted-bg text-dls-secondary ring-1 ring-dls-border hover:bg-dls-active",
    badge: "bg-dls-icon-muted-bg text-dls-secondary",
    iconActive: "bg-dls-icon-muted-bg hover:bg-dls-active",
    dot: "bg-dls-secondary",
  },
};
