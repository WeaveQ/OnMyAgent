export function classifyErrorInfo(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  let code = typeof error?.code === "string" && error.code.trim() ? error.code.trim() : "unknown";
  if (code !== "unknown") return { code, message, debug: message || null };
  if (/unsupported format of modelid|expected: modelid\[effort\]|set_model failed/.test(lower)) code = "codex_acp_model_format";
  else if (/set_mode failed|modeid|codex_acp_mode_failed/.test(lower)) code = "codex_acp_mode_failed";
  else if (/conversation interrupted/.test(lower)) code = "acp_bridge_interrupted";
  else if (/acp_bridge_interrupted_after_retry/.test(lower)) code = "acp_bridge_interrupted_after_retry";
  else if (/did not finish cleanly|incomplete output/.test(lower)) code = "acp_incomplete_output";
  else if (/tool call failed/.test(lower)) code = "acp_tool_failed";
  // Empty assistant output: match before the broad "provider" token so
  // "custom ACP completed without assistant text" is not mislabeled.
  else if (
    /empty|no assistant|without assistant|no parseable|no output|completed without/.test(lower)
    || /没有.*回复|空输出|无助手文本/.test(message)
  ) {
    code = "empty_output";
  }
  else if (/sandbox|network|could not resolve host|permission denied|operation not permitted/.test(lower)) code = "sandbox_or_network_refusal";
  else if (/not found|no such file|enoent|command not found|未配置|命令不可用/.test(lower)) code = "missing_binary";
  else if (/auth|login|unauthorized|forbidden|api key|认证|登录/.test(lower)) code = "auth_required";
  else if (/version|版本|update/.test(lower)) code = "version_unsupported";
  else if (/timeout|timed out|超时/.test(lower)) code = "timeout";
  // ACP session/prompt (or session/new) failed with a generic Internal error —
  // treat as agent-side prompt failure so UI can show a short localized tip.
  else if (/session\/prompt|session\/new/.test(lower) || /acp.*(prompt|session).*(fail|error|internal)/.test(lower)) {
    code = "acp_prompt_failed";
  }
  else if (/\b5\d\d\b|bad gateway|service unavailable|upstream|rate limit/.test(lower)) code = "provider_failed";
  else if (/parse|json|解析/.test(lower)) code = "parse_failed";
  else if (/cancel|取消/.test(lower)) code = "cancelled";
  else if (message.trim()) code = "provider_failed";
  return { code, message, debug: message || null };
}

export function buildErrorTip(errorInfo) {
  const code = String(errorInfo?.code ?? "unknown");
  const message = String(errorInfo?.message ?? "Unknown local agent error");
  let ownership = "unknown";
  let target = "details";
  let kind = "inspect";
  if (code === "missing_binary" || code === "version_unsupported" || code === "auth_required" || code === "codex_acp_model_format" || code === "codex_acp_mode_failed") {
    ownership = "agent";
    target = "agent_settings";
    kind = code === "auth_required" ? "authenticate" : "configure";
  } else if (code === "empty_output" || code === "acp_incomplete_output" || code === "acp_prompt_failed") {
    // Empty/truncated ACP replies and session/prompt Internal errors are
    // agent/protocol issues, not cloud provider outages.
    ownership = "agent";
    target = "agent_settings";
    kind = "retry";
  } else if (code === "provider_failed" || code === "timeout" || code === "acp_tool_failed") {
    ownership = code === "timeout" ? "unknown" : "provider";
    target = code === "timeout" ? "details" : "provider";
    kind = code === "timeout" ? "retry" : "inspect";
  } else if (code === "sandbox_or_network_refusal" || code === "acp_bridge_interrupted" || code === "acp_bridge_interrupted_after_retry" || code === "parse_failed") {
    ownership = "platform";
    target = "runtime";
    kind = "inspect";
  }
  return { type: "tips", text: message, category: "error", ownership, resolution: { target, kind, message } };
}
