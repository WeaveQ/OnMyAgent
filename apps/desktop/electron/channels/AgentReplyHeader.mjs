/**
 * AgentReplyHeader — channel-agnostic helper that prefixes agent replies with
 * a small identity header, so users can tell which agent responded when
 * multiple agents reply into the same IM chat.
 *
 * Rendered format (single line, followed by a blank line and the body):
 *   ▎<AgentName> · HH:MM
 *
 * Only applied to substantive agent replies (final output / approval prompts).
 * System notices (mode/agent switch, cancel, help) intentionally do NOT use
 * this to keep signal-to-noise high.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatClock(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function resolveAgentName(agent) {
  if (!agent) return "Agent";
  const name = String(agent.name ?? "").trim();
  if (name) return name;
  const id = String(agent.id ?? "").trim();
  if (id) return id;
  const provider = String(agent.provider ?? "").trim();
  return provider || "Agent";
}

/**
 * Prefix a reply body with an agent identity header. Idempotent: if the body
 * already starts with the same header, returns it unchanged.
 *
 * @param {{ agent?: { id?: string, name?: string, provider?: string } | null, text: string, at?: number | Date }} params
 * @returns {string}
 */
export function formatAgentReply({ agent, text, at }) {
  const body = String(text ?? "");
  if (!body.trim()) return body;
  const name = resolveAgentName(agent);
  const clock = formatClock(at instanceof Date ? at : at ? new Date(at) : new Date());
  const header = `▎${name} · ${clock}`;
  if (body.startsWith(`${header}\n`)) return body;
  return `${header}\n\n${body}`;
}

export default formatAgentReply;
