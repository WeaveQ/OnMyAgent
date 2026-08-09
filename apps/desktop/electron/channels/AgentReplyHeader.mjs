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

/**
 * Preserve a provider's partial output without presenting a known truncated
 * turn as a normal completed reply in messaging channels.
 *
 * @param {{ output?: unknown, truncated?: unknown, stopReason?: unknown, metadata?: { truncated?: unknown, stopReason?: unknown } | null } | null | undefined} result
 * @returns {string}
 */
export function formatAgentResultOutput(result) {
  const body = String(result?.output ?? "");
  const truncated = Boolean(result?.truncated || result?.metadata?.truncated);
  if (!truncated || !body.trim()) return body;
  const rawStopReason = String(result?.stopReason ?? result?.metadata?.stopReason ?? "").trim().toLowerCase();
  const stopReason = /^[a-z0-9._-]{1,64}$/.test(rawStopReason) ? rawStopReason : "";
  const reason = stopReason ? `（stopReason=${stopReason}）` : "";
  const contextReasons = new Set(["context_length", "context_window", "context_window_exceeded"]);
  const outputReasons = new Set(["max_tokens", "length", "token_limit", "max_output_tokens"]);
  const cancelledReasons = new Set(["cancelled", "canceled", "interrupted"]);
  const refusalReasons = new Set(["refusal", "refused", "content_filter", "safety"]);
  let warning;
  if (contextReasons.has(stopReason)) {
    warning = `⚠️ 模型上下文窗口已满，本次回复未完整结束${reason}。以下仅为已生成的部分内容；请先压缩上下文或新建会话。`;
  } else if (outputReasons.has(stopReason)) {
    warning = `⚠️ 本次回复因输出限制未完整结束${reason}。以下仅为已生成的部分内容；请重试或缩小任务范围。`;
  } else if (cancelledReasons.has(stopReason)) {
    warning = `⚠️ 本次回复已被中断，未完整结束${reason}。以下仅为中断前生成的部分内容。`;
  } else if (refusalReasons.has(stopReason)) {
    warning = `⚠️ 模型未完成本次回复${reason}。以下仅为已生成的部分内容；请调整请求后重试。`;
  } else {
    warning = `⚠️ 本次回复未正常完成${reason}。以下仅为已生成的部分内容；请在 Studio 查看本地 Agent 状态后重试。`;
  }
  return `${warning}\n\n${body}`;
}

export default formatAgentReply;
