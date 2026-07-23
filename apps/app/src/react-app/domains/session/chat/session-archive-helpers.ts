import type {
  OnMyAgentSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";

export type SessionArchiveResumeRequest = {
  agent: string;
  providerSessionId: string;
  project: string | null;
  sessionId: string;
  title: string;
};

/**
 * Friendly labels for session-archive agent keys (registry / scanner ids).
 * Fallback is the raw agent id so new sources still show something readable.
 */
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
  mimocode: "MiMo Code",
  mimo: "MiMo Code",
  grok: "Grok Build",
  workbuddy: "WorkBuddy",
  codebuddy: "WorkBuddy",
  kilo: "Kilo",
  kiro: "Kiro",
  "kiro-ide": "Kiro IDE",
  kimi: "Kimi",
  qoder: "Qoder",
  amp: "Amp",
  pi: "Pi",
  omp: "OhMyPi",
  cowork: "Claude Cowork",
  openhands: "OpenHands",
  zencoder: "Zencoder",
  "vscode-copilot": "VS Code Copilot",
  "visualstudio-copilot": "Visual Studio Copilot",
  commandcode: "Command Code",
  "deepseek-tui": "DeepSeek TUI",
  qclaw: "QClaw",
  cortex: "Cortex Code",
  forge: "Forge",
  piebald: "Piebald",
  warp: "Warp",
  positron: "Positron",
  zed: "Zed",
  antigravity: "Antigravity",
  "antigravity-cli": "Antigravity CLI",
  qwenpaw: "QwenPaw",
  gptme: "gptme",
  shelley: "Shelley",
  vibe: "Mistral Vibe",
  reasonix: "Reasonix",
};

/** Map archive agent key → brand icon id (local agent-icons / AgentSkillIcon). */
const ARCHIVE_ICON_ID: Record<string, string> = {
  mimocode: "mimo",
  mimo: "mimo",
  grok: "grok",
  workbuddy: "workbuddy",
  codebuddy: "workbuddy",
  opencode: "opencode",
  codex: "codex",
  claude: "claude",
  hermes: "hermes",
  openclaw: "openclaw",
  gemini: "gemini",
  copilot: "copilot",
  "vscode-copilot": "vscode-copilot",
  "visualstudio-copilot": "visualstudio-copilot",
  "cursor-agent": "cursor-agent",
  cursor: "cursor",
  kiro: "kiro",
  "kiro-ide": "kiro-ide",
  kimi: "kimi",
  qwen: "qwen",
  goose: "goose",
  onmyagent: "onmyagent",
};

export function agentLabel(agent: string): string {
  const key = String(agent ?? "").trim();
  return AGENT_LABEL[key] ?? AGENT_LABEL[key.toLowerCase()] ?? agent;
}

/** Icon lookup id for archive filter chips / list rows. */
export function archiveAgentIconId(agent: string): string {
  const key = String(agent ?? "").trim();
  return ARCHIVE_ICON_ID[key] ?? ARCHIVE_ICON_ID[key.toLowerCase()] ?? key.toLowerCase();
}

/**
 * Agents the archive UI is willing to surface.
 * Option A: any backend-scanned source with sessions is visible — no tight
 * whitelist. Kept as a predicate so call sites stay explicit; always true
 * except for empty / unknown placeholders with no useful id.
 */
export function isVisibleArchiveAgent(agent: string): boolean {
  const key = String(agent ?? "").trim();
  return key.length > 0 && key !== "unknown";
}

/**
 * @deprecated Prefer {@link isVisibleArchiveAgent}. Historical tight set of
 * five agents; retained for re-exports. New UI uses the predicate above.
 */
export const VISIBLE_AGENTS = new Set([
  "opencode",
  "codex",
  "claude",
  "openclaw",
  "hermes",
  "mimocode",
  "gemini",
  "copilot",
  "cursor",
  "kiro",
  "kimi",
  "qwen",
  "kilo",
  "onmyagent",
  "aider",
  "pi",
  "openhands",
  "cowork",
  "amp",
  "iflow",
]);

/** Agents that support "restore" into a live local-agent session. */
export const RESUMABLE_AGENTS = new Set(["opencode", "codex", "claude", "openclaw", "hermes"]);

export function groupSessionsByAgent(
  sessions: ReadonlyArray<OnMyAgentSessionArchiveSession>,
): Array<{ agent: string; sessions: OnMyAgentSessionArchiveSession[] }> {
  const byAgent = new Map<string, OnMyAgentSessionArchiveSession[]>();
  for (const session of sessions) {
    const list = byAgent.get(session.agent) ?? [];
    list.push(session);
    byAgent.set(session.agent, list);
  }
  return Array.from(byAgent.entries())
    .map(([agent, items]) => ({ agent, sessions: items }))
    .sort((a, b) => b.sessions.length - a.sessions.length);
}

/** Whole-line harness / protocol tags that must never appear as archive list titles. */
const ARCHIVE_TITLE_HARNESS_TAG_LINE =
  /^<\/?(?:user_info|user_query|user-request|system-reminder|system_reminder|available_skills|tool_call|function_call|INSTRUCTIONS|auto-slash-command|command-instruction|function_results|tool_result|mediaimage|img)(?:\s[^>]*)?\/?>$/i;

/** Pure XML/HTML tag line (e.g. `<user_info>` or `</user_info>`). */
const ARCHIVE_TITLE_PURE_TAG_LINE = /^<\/?[A-Za-z_][\w:.-]*(?:\s[^>]*)?\/?>$/;

function truncateArchiveTitleLine(line: string): string {
  const text = line.trim();
  if (text.length <= 80) return text;
  return `${text.slice(0, 77)}…`;
}

/**
 * Pull a human-readable first line from raw archive title / first_message text.
 * Prefer real user intent inside `<user_query>` / `<user-request>`; never surface
 * harness shells like `<user_info>` or `<system-reminder>` as the list title.
 */
export function extractArchiveTitleLine(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text.startsWith("{") && (text.includes("jsonrpc") || text.includes('"method"'))) {
    return null;
  }
  if (text.startsWith("[") && text.length > 80) return null;

  // Prefer explicit user intent wrappers (Grok / harness transcripts).
  const wrapped =
    text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1]
    ?? text.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)?.[1];
  if (wrapped?.trim()) {
    const line = wrapped.trim().split(/\r?\n/).find((row) => row.trim().length > 0)?.trim();
    if (line && line.length >= 1 && !ARCHIVE_TITLE_PURE_TAG_LINE.test(line)) {
      return truncateArchiveTitleLine(line);
    }
  }

  // Drop whole harness blocks (not just the open/close tags) so block body
  // like "OS Version: …" never becomes the list title either.
  const withoutHarnessBlocks = text
    .replace(
      /<(?:user_info|system-reminder|system_reminder|available_skills|function_results|tool_result|INSTRUCTIONS|auto-slash-command|command-instruction)\b[^>]*>[\s\S]*?<\/(?:user_info|system-reminder|system_reminder|available_skills|function_results|tool_result|INSTRUCTIONS|auto-slash-command|command-instruction)\s*>/gi,
      "\n",
    )
    // Unclosed opening tags that are pure noise lines.
    .replace(
      /<\/?(?:user_info|system-reminder|system_reminder|available_skills|user_query|user-request|function_results|tool_result)\b[^>]*\/?>/gi,
      "\n",
    );

  // Walk lines: skip pure tags and harness noise; take first meaningful prose.
  for (const row of withoutHarnessBlocks.split(/\r?\n/)) {
    const line = row.trim();
    if (!line) continue;
    if (ARCHIVE_TITLE_HARNESS_TAG_LINE.test(line) || ARCHIVE_TITLE_PURE_TAG_LINE.test(line)) {
      continue;
    }
    if (line.startsWith("{") && (line.includes("jsonrpc") || line.includes('"method"'))) {
      continue;
    }
    if (line.length >= 1) return truncateArchiveTitleLine(line);
  }

  // Last resort: strip all angle-bracket tags and take first remaining words.
  const stripped = withoutHarnessBlocks
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 2) return truncateArchiveTitleLine(stripped);
  return null;
}

/**
 * Drop protocol noise (JSON-RPC, harness tags, empty) so list titles stay human-readable.
 * Hermes first_message is often `{"jsonrpc":"2.0",...}` — never show that.
 * Grok first_message often starts with `<user_info>` — prefer `<user_query>` body.
 */
export function humanizeArchiveTitle(
  session: Pick<OnMyAgentSessionArchiveSession, "display_name" | "first_message" | "id" | "project" | "agent">,
): string {
  const candidates = [session.display_name, session.first_message];
  for (const raw of candidates) {
    const line = extractArchiveTitleLine(String(raw ?? ""));
    if (line) return line;
  }
  const project = String(session.project ?? "").trim();
  if (project) {
    const base = project.split(/[/\\]/).filter(Boolean).pop();
    if (base) return `${agentLabel(session.agent)} · ${base}`;
  }
  return agentLabel(session.agent) || session.id;
}

export function buildResumeRequest(
  session: OnMyAgentSessionArchiveSession | null,
): SessionArchiveResumeRequest | null {
  if (!session || !RESUMABLE_AGENTS.has(session.agent)) return null;
  const providerSessionId = session.id;
  if (!providerSessionId) return null;
  return {
    agent: session.agent,
    providerSessionId,
    project: session.project || null,
    sessionId: session.id,
    title: humanizeArchiveTitle(session),
  };
}
