/**
 * Install / download URLs for agents in 未安装 state.
 * Card action logic lives in `agent-card-model.ts`.
 */

export type AgentInstallGuide = {
  url: string;
};

const INSTALL_GUIDE_BY_ID: Record<string, AgentInstallGuide> = {
  opencode: { url: "https://opencode.ai" },
  codex: { url: "https://github.com/openai/codex" },
  claude: { url: "https://docs.anthropic.com/en/docs/claude-code" },
  openclaw: { url: "https://github.com/openclaw/openclaw" },
  hermes: { url: "https://github.com/NousResearch/hermes-agent" },
  gemini: { url: "https://github.com/google-gemini/gemini-cli" },
  kiro: { url: "https://kiro.dev" },
  goose: { url: "https://block.github.io/goose/" },
  "cursor-agent": { url: "https://cursor.com" },
  qwen: { url: "https://github.com/QwenLM/qwen-code" },
  kimi: { url: "https://github.com/MoonshotAI/kimi-cli" },
  copilot: { url: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli" },
  qoder: { url: "https://qoder.com" },
  augment: { url: "https://www.augmentcode.com" },
  snow: { url: "https://github.com/snowcli/snow" },
  nanobot: { url: "https://github.com/HKUDS/nanobot" },
  codebuddy: { url: "https://copilot.tencent.com/codebuddy" },
  // Desktop product (embeds CodeBuddy CLI). Official download landing.
  workbuddy: { url: "https://www.codebuddy.cn/work/" },
  trae: { url: "https://www.trae.ai" },
  mimo: { url: "https://www.npmjs.com/package/@mimo-ai/cli" },
  grok: { url: "https://www.npmjs.com/package/@xai-official/grok" },
};

export function agentInstallGuideFor(agent: { id?: string | null; provider?: string | null }): AgentInstallGuide | null {
  const id = String(agent.id ?? "").trim().toLowerCase();
  const provider = String(agent.provider ?? "").trim().toLowerCase();
  return INSTALL_GUIDE_BY_ID[id] ?? INSTALL_GUIDE_BY_ID[provider] ?? null;
}

/** @deprecated use agentDisplayStatus from agent-card-model */
export function effectiveAgentDisplayStatus(
  agent: { status?: string | null; error?: string | null },
  healthStatus?: string | null,
): string {
  // Match agent-card-model: only 未安装 vs 健康 until user probes.
  const raw = String(agent.status ?? "").trim() || "unknown";
  const err = String(agent.error ?? "");
  if (raw === "missing" || healthStatus === "missing") return "missing";
  if (/enoent|command not found|no such file|spawn\s+\S+\s+enoent|\u672a\u5b89\u88c5/i.test(err)) return "missing";
  if (healthStatus === "passed") return "online";
  if (healthStatus === "needs_auth") return "needs_auth";
  if (healthStatus === "failed") return "offline";
  return "online";
}
