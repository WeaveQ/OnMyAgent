/**
 * Pure helpers for opt-in agent-ready desktop alerts.
 * Intentionally free of domain-to-domain imports so shell-feedback can
 * export this without depending on session.
 */

/** Minimal activity phase set (mirrors session activity, no cross-domain import). */
export type AgentActivityPhase =
  | "idle"
  | "thinking"
  | "responding"
  | "retrying"
  | "error"
  | "compacting"
  | "waiting";

/**
 * Whether an activity transition should fire an agent-ready desktop
 * notification (opt-in prefs only; callers still check the preference).
 */
export function shouldNotifyAgentReadyTransition(
  previous: AgentActivityPhase | undefined,
  next: AgentActivityPhase,
): boolean {
  if (next !== "idle") return false;
  if (!previous) return false;
  return (
    previous === "thinking" ||
    previous === "responding" ||
    previous === "retrying" ||
    previous === "compacting" ||
    previous === "waiting"
  );
}

const SNIPPET_MAX_CHARS = 28;

export function looksLikeSessionId(text: string): boolean {
  return /^ses_[a-z0-9]+$/i.test(text.trim());
}

/** Truncated user prompt / human session title for “xxx 任务完成了”. */
export function resolveAgentReadyTaskSnippet(input: {
  userSnippet?: string | null;
  sessionTitle?: string | null;
}): string {
  const user = collapseOneLine(input.userSnippet);
  if (user && !looksLikeSessionId(user)) return truncateSnippet(user);
  const title = collapseOneLine(input.sessionTitle);
  if (title && !looksLikeSessionId(title)) return truncateSnippet(title);
  return "";
}

export function buildAgentReadyNotificationBody(input: {
  sessionTitle: string | null | undefined;
  userSnippet: string | null | undefined;
  fallbackBody: string;
  bodyWithSnippet: (snippet: string) => string;
}): string {
  const snippet = resolveAgentReadyTaskSnippet({
    userSnippet: input.userSnippet,
    sessionTitle: input.sessionTitle,
  });
  if (snippet) return input.bodyWithSnippet(snippet);
  return input.fallbackBody;
}

function collapseOneLine(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function truncateSnippet(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARS) return text;
  return `${text.slice(0, SNIPPET_MAX_CHARS).trimEnd()}…`;
}
