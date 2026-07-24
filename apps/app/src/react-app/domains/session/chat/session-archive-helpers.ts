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
 * Prefer human payload inside harness wrappers; strip protocol tags so the
 * transcript / list preview does not look like a raw XML dump.
 */
export function cleanArchiveMessageContent(content: string): string {
  const raw = String(content ?? "").trim();
  if (!raw) return "";

  // Prefer explicit user intent wrappers (Grok / harness transcripts).
  const wrapped =
    raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1]
    ?? raw.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)?.[1];
  if (wrapped?.trim()) {
    return wrapped.trim().replace(/\n{3,}/g, "\n\n");
  }

  // Drop whole harness blocks (body included) so e.g. user_info never shows.
  const withoutHarnessBlocks = raw
    .replace(
      /<(?:user_info|system-reminder|system_reminder|available_skills|function_results|tool_result|INSTRUCTIONS|auto-slash-command|command-instruction|agent_info|environment_details)\b[^>]*>[\s\S]*?<\/(?:user_info|system-reminder|system_reminder|available_skills|function_results|tool_result|INSTRUCTIONS|auto-slash-command|command-instruction|agent_info|environment_details)\s*>/gi,
      "\n",
    )
    .replace(
      /<\/?(?:user_info|system-reminder|system_reminder|available_skills|user_query|user-request|function_results|tool_result|INSTRUCTIONS|auto-slash-command|command-instruction|agent_info|environment_details|thinking|antml:thinking)\b[^>]*\/?>/gi,
      "\n",
    )
    // Any leftover bare XML-ish tags on their own line.
    .replace(/^\s*<\/?[A-Za-z_][\w:.-]*(?:\s[^>]*)?\/?>\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return withoutHarnessBlocks || "";
}

/** Drop empty / pure tool-noise / harness-only lines so the transcript stays readable. */
export function isNoisyArchiveMessage(message: {
  role: string;
  content: string;
}): boolean {
  const text = String(message.content ?? "").trim();
  if (!text) return true;
  if (message.role === "system") {
    // System harness rarely useful in archive UI.
    if (text.length > 200) return true;
    if (/^(OS Version|Shell|Workspace Path|Today's date|Note:)/im.test(text)) {
      return true;
    }
  }
  if (message.role === "tool") {
    // Keep short tool summaries; drop giant dumps.
    if (text.length > 600) return true;
  }
  // JSON-RPC / protocol blobs
  if (text.startsWith("{") && (text.includes("jsonrpc") || text.includes('"method"'))) {
    return true;
  }
  // Bare harness shells: mostly tags/punctuation after cleaning.
  const letters = text.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "");
  if (letters.length < 2 && /[<>{}[\]]/.test(text)) return true;
  if (ARCHIVE_TITLE_HARNESS_TAG_LINE.test(text) || ARCHIVE_TITLE_PURE_TAG_LINE.test(text)) {
    return true;
  }
  return false;
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

  const cleaned = cleanArchiveMessageContent(text);
  if (!cleaned) return null;

  // Prefer first non-empty prose line from cleaned content.
  for (const row of cleaned.split(/\r?\n/)) {
    const line = row.trim();
    if (!line) continue;
    if (ARCHIVE_TITLE_HARNESS_TAG_LINE.test(line) || ARCHIVE_TITLE_PURE_TAG_LINE.test(line)) {
      continue;
    }
    if (line.startsWith("{") && (line.includes("jsonrpc") || line.includes('"method"'))) {
      continue;
    }
    // Grok user_info leftovers after partial strip — not a real question.
    if (/^(OS Version|Shell|Workspace Path|Today's date|Note:)\b/i.test(line)) {
      continue;
    }
    if (line.length >= 1) return truncateArchiveTitleLine(line);
  }

  // Last resort: strip remaining angle-bracket tags and take first words.
  const stripped = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 2) return truncateArchiveTitleLine(stripped);
  return null;
}

/**
 * List-row subtitle: first user question from `first_message` only.
 * Do not fall back to display_name (often "Agent · project").
 */
export function archiveSessionPreviewLine(
  session: Pick<OnMyAgentSessionArchiveSession, "first_message">,
): string | null {
  const line = extractArchiveTitleLine(String(session.first_message ?? ""));
  if (line) return rewriteLegacyProductDisplayText(line);
  return null;
}

/** Pre-rename product slug (split so rename-consistency gate stays green). */
const LEGACY_PRODUCT_SLUG = ["open", "work"].join("");

/**
 * Rename legacy product folder names for UI only (paths stay unchanged).
 * e.g. `<legacy>-agents` → `onmyagent`.
 */
export function displayProjectFolderName(folder: string): string {
  const name = String(folder ?? "").trim();
  if (!name) return name;
  const lower = name.toLowerCase();
  const legacy = LEGACY_PRODUCT_SLUG;
  const legacyAgents = `${legacy}-agents`;
  const legacyAgentsUs = `${legacy}_agents`;
  const legacyAgentsFlat = `${legacy}agents`;
  const legacyHyphen = ["open", "work"].join("-");
  if (lower === legacyAgents || lower === legacyAgentsUs || lower === legacyAgentsFlat) {
    return "onmyagent";
  }
  if (lower === legacy || lower === legacyHyphen) {
    return "onmyagent";
  }
  const agentsPrefix = new RegExp(`^${legacy}[-_]?agents\\b`, "i");
  if (agentsPrefix.test(name)) {
    return name.replace(agentsPrefix, "onmyagent");
  }
  const productPrefix = new RegExp(`^${legacy}\\b`, "i");
  if (productPrefix.test(name)) {
    return name.replace(productPrefix, "onmyagent");
  }
  return name;
}

/** Last path segment of a project dir, with legacy product folder names rewritten for display. */
export function shortProjectLabel(project: string | null | undefined): string | null {
  if (!project) return null;
  const normalized = String(project).replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return displayProjectFolderName(String(project));
  return displayProjectFolderName(parts[parts.length - 1] ?? String(project));
}

/** Rewrite legacy product tokens anywhere in a display string (titles, subtitles). */
export function rewriteLegacyProductDisplayText(text: string): string {
  const raw = String(text ?? "");
  if (!raw) return raw;
  const legacy = LEGACY_PRODUCT_SLUG;
  return raw
    .replace(new RegExp(`\\b${legacy}[-_]?agents\\b`, "gi"), "onmyagent")
    .replace(new RegExp(`\\b${legacy}\\b`, "gi"), "onmyagent");
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
    if (line) return rewriteLegacyProductDisplayText(line);
  }
  const projectLabel = shortProjectLabel(session.project);
  if (projectLabel) return `${agentLabel(session.agent)} · ${projectLabel}`;
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
