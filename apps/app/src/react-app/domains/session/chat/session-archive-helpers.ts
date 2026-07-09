import type {
  OpenworkSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";

export type SessionArchiveResumeRequest = {
  agent: string;
  providerSessionId: string;
  project: string | null;
  sessionId: string;
  title: string;
};

const AGENT_LABEL: Record<string, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  gemini: "Gemini",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  aider: "Aider",
  qwen: "Qwen Code",
  iflow: "iFlow",
  onmyagent: "OnMyAgent",
};

export function agentLabel(agent: string): string {
  return AGENT_LABEL[agent] ?? agent;
}

export const VISIBLE_AGENTS = new Set([
  "opencode",
  "codex",
  "claude",
  "openclaw",
  "hermes",
]);

export const RESUMABLE_AGENTS = new Set(["opencode", "codex", "claude", "openclaw", "hermes"]);

export function groupSessionsByAgent(
  sessions: ReadonlyArray<OpenworkSessionArchiveSession>,
): Array<{ agent: string; sessions: OpenworkSessionArchiveSession[] }> {
  const byAgent = new Map<string, OpenworkSessionArchiveSession[]>();
  for (const session of sessions) {
    const list = byAgent.get(session.agent) ?? [];
    list.push(session);
    byAgent.set(session.agent, list);
  }
  return Array.from(byAgent.entries())
    .map(([agent, items]) => ({ agent, sessions: items }))
    .sort((a, b) => b.sessions.length - a.sessions.length);
}

export function buildResumeRequest(
  session: OpenworkSessionArchiveSession | null,
): SessionArchiveResumeRequest | null {
  if (!session || !RESUMABLE_AGENTS.has(session.agent)) return null;
  const providerSessionId = session.id;
  if (!providerSessionId) return null;
  return {
    agent: session.agent,
    providerSessionId,
    project: session.project || null,
    sessionId: session.id,
    title: session.display_name || session.first_message || session.id,
  };
}
