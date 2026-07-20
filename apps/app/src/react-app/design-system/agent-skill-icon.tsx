/** @jsxImportSource react */
import type { AgentManagementMcpApp, AgentManagementSkillAgent } from "../../app/lib/desktop";
import onmyagentIconUrl from "../../../../desktop/resources/icons/icon.png";
import claudeIconUrl from "@/assets/agent-icons/claude.svg";
import codexIconUrl from "@/assets/agent-icons/openai.svg";
import hermesIconUrl from "@/assets/agent-icons/hermes.png";
import openclawIconUrl from "@/assets/agent-icons/claw.svg";
import opencodeIconUrl from "@/assets/agent-icons/opencode-logo-light.svg";
import geminiIconUrl from "@/assets/agent-icons/gemini.svg";
import kimiIconUrl from "@/assets/agent-icons/kimi.svg";
import kiroIconUrl from "@/assets/agent-icons/kiro.svg";
import mimoIconUrl from "@/assets/agent-icons/mimo.svg";
import qwenIconUrl from "@/assets/agent-icons/qwen.svg";
import copilotIconUrl from "@/assets/agent-icons/copilot.svg";
import cursorAgentIconUrl from "@/assets/agent-icons/cursor-agent.svg";
import gooseIconUrl from "@/assets/agent-icons/goose.svg";
import grokIconUrl from "@/assets/agent-icons/grok.svg";
import qoderIconUrl from "@/assets/agent-icons/qoder.svg";
import codebuddyIconUrl from "@/assets/agent-icons/codebuddy.svg";
import nanobotIconUrl from "@/assets/agent-icons/nanobot.svg";
import traeIconUrl from "@/assets/agent-icons/trae.svg";
import snowIconUrl from "@/assets/agent-icons/snow.svg";
import augmentIconUrl from "@/assets/agent-icons/augment.svg";
import { cn } from "@/lib/utils";

/** Skill matrix keys + archive/scanner aliases (mimocode, vscode-copilot, grok…). */
type AgentIconId = AgentManagementSkillAgent | AgentManagementMcpApp | string;

const ICONS: Record<string, string> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  gemini: geminiIconUrl,
  hermes: hermesIconUrl,
  openclaw: openclawIconUrl,
  onmyagent: onmyagentIconUrl,
  mimo: mimoIconUrl,
  mimocode: mimoIconUrl,
  kimi: kimiIconUrl,
  kiro: kiroIconUrl,
  "kiro-ide": kiroIconUrl,
  qwen: qwenIconUrl,
  copilot: copilotIconUrl,
  // Archive scanner keys for GitHub Copilot surfaces.
  "vscode-copilot": copilotIconUrl,
  "visualstudio-copilot": copilotIconUrl,
  "cursor-agent": cursorAgentIconUrl,
  cursor: cursorAgentIconUrl,
  goose: gooseIconUrl,
  grok: grokIconUrl,
  qoder: qoderIconUrl,
  codebuddy: codebuddyIconUrl,
  workbuddy: codebuddyIconUrl,
  nanobot: nanobotIconUrl,
  trae: traeIconUrl,
  snow: snowIconUrl,
  cortex: snowIconUrl,
  augment: augmentIconUrl,
};

export function AgentSkillIcon(props: { agent: AgentIconId; className?: string }) {
  const key = String(props.agent ?? "").trim().toLowerCase();
  const src = ICONS[key] ?? ICONS[String(props.agent)];
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn("size-3.5 object-contain", props.className)}
        loading="lazy"
      />
    );
  }
  return (
    <span className={cn("text-xs font-medium leading-none", props.className)}>?</span>
  );
}
