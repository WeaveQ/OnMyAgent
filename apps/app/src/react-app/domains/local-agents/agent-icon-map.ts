// Central brand-icon map for local/custom/discoverable agents.
// Used by the local-agent chat page, sidebar list, header, and management
// cards so every surface shows the real agent glyph instead of a generic
// robot fallback.
import type { PersonalLocalAgent, PersonalLocalAgentProvider } from "../../../app/lib/desktop";
import augmentIconUrl from "../../../assets/agent-icons/augment.svg";
import claudeIconUrl from "../../../assets/agent-icons/claude.svg";
import codebuddyIconUrl from "../../../assets/agent-icons/codebuddy.svg";
import codexIconUrl from "../../../assets/agent-icons/openai.svg";
import copilotIconUrl from "../../../assets/agent-icons/copilot.svg";
import cursorAgentIconUrl from "../../../assets/agent-icons/cursor-agent.svg";
import geminiIconUrl from "../../../assets/agent-icons/gemini.svg";
import gooseIconUrl from "../../../assets/agent-icons/goose.svg";
import grokIconUrl from "../../../assets/agent-icons/grok.svg";
import hermesIconUrl from "../../../assets/agent-icons/hermes.png";
import kimiIconUrl from "../../../assets/agent-icons/kimi.svg";
import kiroIconUrl from "../../../assets/agent-icons/kiro.svg";
import mimoIconUrl from "../../../assets/agent-icons/mimo.svg";
import nanobotIconUrl from "../../../assets/agent-icons/nanobot.svg";
import openclawIconUrl from "../../../assets/agent-icons/claw.svg";
import opencodeIconUrl from "../../../assets/agent-icons/opencode-logo-light.svg";
import qoderIconUrl from "../../../assets/agent-icons/qoder.svg";
import qwenIconUrl from "../../../assets/agent-icons/qwen.svg";
import snowIconUrl from "../../../assets/agent-icons/snow.svg";
import traeIconUrl from "../../../assets/agent-icons/trae.svg";
// Same host mark AgentSkillIcon used (skill matrix / archive host column).
import onmyagentIconUrl from "../../../../../desktop/resources/icons/icon.png";

const AGENT_ICON_BY_ID: Record<string, string> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  hermes: hermesIconUrl,
  openclaw: openclawIconUrl,
  gemini: geminiIconUrl,
  kiro: kiroIconUrl,
  goose: gooseIconUrl,
  "cursor-agent": cursorAgentIconUrl,
  qwen: qwenIconUrl,
  kimi: kimiIconUrl,
  copilot: copilotIconUrl,
  "vscode-copilot": copilotIconUrl,
  "visualstudio-copilot": copilotIconUrl,
  qoder: qoderIconUrl,
  augment: augmentIconUrl,
  snow: snowIconUrl,
  nanobot: nanobotIconUrl,
  codebuddy: codebuddyIconUrl,
  // WorkBuddy embeds CodeBuddy CLI; share the same brand mark.
  workbuddy: codebuddyIconUrl,
  trae: traeIconUrl,
  mimo: mimoIconUrl,
  mimocode: mimoIconUrl,
  grok: grokIconUrl,
  onmyagent: onmyagentIconUrl,
};

const AGENT_ICON_BY_PROVIDER: Partial<Record<PersonalLocalAgentProvider, string>> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  hermes: hermesIconUrl,
  openclaw: openclawIconUrl,
};

// Try known-id catalog first (covers built-in + discoverable custom agents
// like grok/codebuddy/gemini), then fall back to provider-family brand.
export function resolveAgentIconUrl(input: { id: string; provider: string }): string | null {
  const id = String(input.id ?? "").trim().toLowerCase();
  const provider = String(input.provider ?? "").trim().toLowerCase();
  const byId = AGENT_ICON_BY_ID[id];
  if (byId) return byId;
  const byProvider = AGENT_ICON_BY_PROVIDER[provider as PersonalLocalAgentProvider];
  return byProvider ?? null;
}

export function resolveAgentIconUrlFor(agent: Pick<PersonalLocalAgent, "id" | "provider">): string | null {
  return resolveAgentIconUrl({ id: agent.id, provider: agent.provider });
}
