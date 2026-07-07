import type { AgentManagementSkillAgent } from "../../../../../app/lib/desktop";

export const SKILL_AGENT_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  codex: "Codex",
  gemini: "Gemini",
  onmyagent: "OnMyAgent",
  unknown: "未识别",
};

export const STUDIO_SWITCH_SKILL_AGENT_OPTIONS: AgentManagementSkillAgent[] = ["opencode", "codex", "claude", "gemini", "hermes", "openclaw", "onmyagent"];

export const SKILL_AGENT_TONES: Record<string, { active: string; badge: string; iconActive: string; dot: string }> = {
  opencode: {
    active: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100",
    badge: "bg-blue-50 text-blue-700",
    iconActive: "bg-blue-50 hover:bg-blue-100",
    dot: "bg-blue-500",
  },
  codex: {
    active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100",
    badge: "bg-emerald-50 text-emerald-700",
    iconActive: "bg-emerald-50 hover:bg-emerald-100",
    dot: "bg-emerald-500",
  },
  gemini: {
    active: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100",
    badge: "bg-indigo-50 text-indigo-700",
    iconActive: "bg-indigo-50 hover:bg-indigo-100",
    dot: "bg-indigo-500",
  },
  claude: {
    active: "bg-orange-50 text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100",
    badge: "bg-orange-50 text-orange-700",
    iconActive: "bg-orange-50 hover:bg-orange-100",
    dot: "bg-orange-500",
  },
  hermes: {
    active: "bg-sky-50 text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100",
    badge: "bg-sky-50 text-sky-700",
    iconActive: "bg-sky-50 hover:bg-sky-100",
    dot: "bg-sky-500",
  },
  openclaw: {
    active: "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100",
    badge: "bg-rose-50 text-rose-700",
    iconActive: "bg-rose-50 hover:bg-rose-100",
    dot: "bg-rose-500",
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
