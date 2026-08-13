const REDACTED = "[REDACTED]";
const REDACTED_SENTINEL = "\uE000onmyagent-redacted\uE001";
const MAX_REDACTION_SCAN_CHARS = 2_000_000;
const SENSITIVE_TEXT_KEY = "(?:authorization|api[_-]?key|token|client[_-]?secret|private[_-]?key|secret|password|passwd|credential|cookie|session[_-]?(?:key|token)|aws[_-]?(?:secret|access[_-]?key))";
// Boundary-local equivalent of the server archive's high-confidence token
// rules. Keep this independent: Task Center must not import server business
// logic, but standalone credentials in agent prose are still durable secrets.
const DEFINITE_CREDENTIAL_PATTERNS = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bsk-ant-[0-9A-Za-z][0-9A-Za-z_-]{18,}/g,
  /\bsk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,}(?=[^0-9A-Za-z_-]|$)/g,
  /\b(?:ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,})\b/g,
  /\bglpat-[0-9A-Za-z_-]{20,}(?=[^0-9A-Za-z_-]|$)/g,
  /\bnpm_[0-9A-Za-z]{36}\b/g,
  /\bpypi-AgEIcHlwaS5vcmcC[0-9A-Za-z_-]{69,}(?=[^0-9A-Za-z_-]|$)/g,
  /\bhf_[0-9A-Za-z]{30,}\b/g,
  /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}(?=[^0-9A-Za-z_-]|$)/g,
  /\bxox[baprs]-[0-9A-Za-z]{10,}(?:-[0-9A-Za-z]+)*/g,
  /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}(?=[^0-9A-Za-z_-]|$)/g,
];

export function safeText(value) {
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return "[Unprintable]";
  }
}

export function safeStructuredText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") return serialized;
  } catch {
    // Circular and hostile values fall back to a non-throwing string view.
  }
  return safeText(value);
}

export function boundedText(value, limit) {
  const numericLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return safeStructuredText(value).slice(0, numericLimit);
}

function replacementWithRedactedValue(_match, prefix, rawValue) {
  const quote = rawValue.at(0);
  if ((quote === "\"" || quote === "'") && rawValue.at(-1) === quote) {
    return `${prefix}${quote}${REDACTED}${quote}`;
  }
  return `${prefix}${REDACTED}`;
}

function redactDefiniteCredentials(value) {
  let text = value;
  for (const pattern of DEFINITE_CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, REDACTED);
  }
  return text;
}

export function redactSensitiveText(value, limit) {
  const outputLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const scanLimit = Math.min(
    MAX_REDACTION_SCAN_CHARS,
    Math.max(64_000, outputLimit * 4),
  );
  let text = safeStructuredText(value)
    .slice(0, scanLimit)
    .replaceAll(REDACTED, REDACTED_SENTINEL);
  if (!text) return "";

  text = redactDefiniteCredentials(text);
  text = text.replace(
    /(authorization\s*[:=]\s*bearer\s+)("[^"]*"|'[^']*'|[^\s"',;&}\]]+)/gi,
    replacementWithRedactedValue,
  );
  text = text.replace(
    /(authorization\s*[:=]\s*)(?!bearer\b)("[^"]*"|'[^']*'|[^\s"',;&}\]]+)/gi,
    replacementWithRedactedValue,
  );
  text = text.replace(
    /(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi,
    `$1${REDACTED}@`,
  );
  text = text.replace(
    new RegExp(`(--${SENSITIVE_TEXT_KEY}(?:=|\\s+))("[^"]*"|'[^']*'|[^\\s"',;&}\\]]+)`, "gi"),
    replacementWithRedactedValue,
  );
  text = text.replace(
    /((?:^|\s)(?:-u|--user)(?:=|\s+))("[^"]*"|'[^']*'|[^\s"']+)/gi,
    replacementWithRedactedValue,
  );
  text = text.replace(
    new RegExp(`((?:["']?${SENSITIVE_TEXT_KEY}["']?)\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s"',;&}\\]]+)`, "gi"),
    replacementWithRedactedValue,
  );
  text = text.replace(
    /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi,
    REDACTED,
  );
  // A scan may end before a malformed or very large PEM's END marker. Once a
  // private-key BEGIN marker is present, fail closed and redact the remainder.
  text = text.replace(
    /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*/gi,
    REDACTED,
  );
  return text.replaceAll(REDACTED_SENTINEL, REDACTED).slice(0, outputLimit);
}
