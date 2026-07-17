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

export function buildAgentReadyNotificationBody(input: {
  sessionTitle: string | null | undefined;
  userSnippet: string | null | undefined;
  assistantSnippet: string | null | undefined;
  fallbackBody: string;
}): string {
  const lines: string[] = [];
  const user = collapseOneLine(input.userSnippet);
  const assistant = lastNonEmptyLine(input.assistantSnippet);
  if (user) lines.push(`User: ${user}`);
  if (assistant) lines.push(`Assistant: ${assistant}`);
  if (lines.length > 0) return lines.join("\n");
  return input.fallbackBody;
}

function collapseOneLine(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);
}

function lastNonEmptyLine(text: string | null | undefined): string {
  if (!text) return "";
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 160);
}
