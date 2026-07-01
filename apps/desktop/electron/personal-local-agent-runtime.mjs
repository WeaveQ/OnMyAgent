export function stripAnsiControl(value) {
  return String(value ?? "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function isPersonalAgentFatalStderr(line) {
  const text = stripAnsiControl(line);
  // Codex can write plugin sync/git diagnostics to stderr even after producing
  // a valid assistant answer. These diagnostics must not override the result.
  if (/git_binary="git"|codex_core_plugins|curated plugin sync|startup remote plugin sync|startup_sync|featured plugin ids cache|Reading additional input from stdin/i.test(text)) {
    return false;
  }
  return /\b(apierror|unknownerror|fatal|uncaught|exception|traceback|invalid api[-_ ]?key|model not found|permission denied|authentication failed|unauthorized|rate limit|quota exceeded|config invalid|invalid config|unrecognized key)\b/i.test(
    text,
  );
}

export function isPersonalAgentDiagnosticStderr(line) {
  const text = stripAnsiControl(line).trim();
  return (
    /^\[(?:agent|diagnostic|model-fallback)\]/i.test(text) ||
    /git_binary="git"|codex_core_plugins|curated plugin sync|startup remote plugin sync|startup_sync|featured plugin ids cache|Reading additional input from stdin/i.test(text)
  );
}

export function isRecoverableCodexDiagnosticError(error) {
  const lines = stripAnsiControl(error)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => isPersonalAgentDiagnosticStderr(line));
}

export function isRecoverableOpenClawFallbackLine(line) {
  const text = stripAnsiControl(line).trim();
  if (!text) return false;
  return (
    /\bmonth allocated quota exceeded\b/i.test(text) ||
    /\bquota exceeded\b/i.test(text) ||
    /\breason=rate_limit\b/i.test(text) ||
    /\bFailoverError:\s*.*quota exceeded\b/i.test(text) ||
    /\[model-fallback\].*\bdecision=candidate_failed\b/i.test(text)
  );
}

export function isOpenClawFallbackSuccessLine(line) {
  const text = stripAnsiControl(line).trim();
  return /\[model-fallback\].*\bdecision=candidate_succeeded\b/i.test(text);
}

export function extractOpenClawPayloadText(parsed) {
  const payloads = Array.isArray(parsed?.payloads) ? parsed.payloads : [];
  const payloadText = payloads
    .map((payload) => (typeof payload?.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean);
  if (payloadText.length) return payloadText.join("\n");

  const content = Array.isArray(parsed?.message?.content) ? parsed.message.content : [];
  const contentText = content
    .map((part) => (part?.type === "text" && typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean);
  if (contentText.length) return contentText.join("\n");

  return null;
}
