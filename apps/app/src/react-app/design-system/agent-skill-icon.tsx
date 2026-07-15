/** @jsxImportSource react */
import type { AgentManagementMcpApp, AgentManagementSkillAgent } from "../../app/lib/desktop";
import onmyagentIconUrl from "../../../../desktop/resources/icons/icon.png";
import claudeIconUrl from "@/assets/agent-icons/claude.svg";
import codexIconUrl from "@/assets/agent-icons/openai.svg";
import hermesIconUrl from "@/assets/agent-icons/hermes.png";
import openclawIconUrl from "@/assets/agent-icons/claw.svg";
import opencodeIconUrl from "@/assets/agent-icons/opencode-logo-light.svg";
import geminiIconUrl from "@/assets/agent-icons/gemini.svg";

type AgentIconId = AgentManagementSkillAgent | AgentManagementMcpApp;

export function AgentSkillIcon(props: { agent: AgentIconId }) {
  const icons: Partial<Record<AgentIconId, string>> = {
    opencode: opencodeIconUrl,
    codex: codexIconUrl,
    claude: claudeIconUrl,
    gemini: geminiIconUrl,
    hermes: hermesIconUrl,
    openclaw: openclawIconUrl,
    onmyagent: onmyagentIconUrl,
  };
  const src = icons[props.agent];
  if (src) {
    return <img src={src} alt="" className="size-3.5 object-contain" loading="lazy" />;
  }
  return <span className="text-xs font-medium leading-none">?</span>;
}
