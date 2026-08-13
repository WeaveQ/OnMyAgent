import {
  boundedText,
  redactSensitiveText,
  safeText,
} from "./durable-redaction.mjs";
export { redactSensitiveText } from "./durable-redaction.mjs";

const TEXT_LIMITS = Object.freeze({
  method: 120,
  kind: 120,
  command: 8_000,
  cwd: 4_096,
  paramName: 160,
  paramValue: 4_000,
  diff: 24_000,
  title: 240,
  summary: 4_000,
});

const MAX_PARAMS = 50;
const MAX_PARAM_DEPTH = 6;
const REDACTED = "[REDACTED]";

const SENSITIVE_NAME_PATTERN = /(?:authorization|api[_-]?key|token|bearer|client[_-]?secret|private[_-]?key|secret|password|passwd|credential|cookie|session[_-]?(?:key|token)|aws[_-]?(?:secret|access[_-]?key))/i;

function optionalText(value, limit) {
  const sanitized = redactSensitiveText(value, limit);
  return sanitized.trim() ? sanitized : null;
}

function isSensitiveName(value) {
  return SENSITIVE_NAME_PATTERN.test(safeText(value));
}

function paramLeafValue(value) {
  if (value === undefined) return "[undefined]";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return safeText(value);
  }
  if (typeof value === "symbol") return safeText(value);
  if (typeof value === "function") return "[Function]";
  return "[Object]";
}

function appendParam(output, name, value, sensitive) {
  if (output.length >= MAX_PARAMS) return;
  const safeName = boundedText(name || "value", TEXT_LIMITS.paramName) || "value";
  const safeValue = sensitive
    ? REDACTED
    : redactSensitiveText(paramLeafValue(value), TEXT_LIMITS.paramValue);
  output.push({ name: safeName, value: safeValue });
}

function flattenParamValue(value, path, output, seen, depth, inheritedSensitive) {
  if (output.length >= MAX_PARAMS) return;
  const sensitive = inheritedSensitive || isSensitiveName(path.at(-1));
  if (sensitive) {
    appendParam(output, path.join("."), value, true);
    return;
  }
  if (!value || typeof value !== "object") {
    appendParam(output, path.join("."), value, false);
    return;
  }
  if (seen.has(value)) {
    appendParam(output, path.join("."), "[Circular]", false);
    return;
  }
  if (depth >= MAX_PARAM_DEPTH) {
    appendParam(output, path.join("."), "[Max depth]", false);
    return;
  }

  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  if (entries.length === 0) appendParam(output, path.join("."), Array.isArray(value) ? "[]" : "{}", false);
  for (const [key, item] of entries) {
    flattenParamValue(item, [...path, boundedText(key, TEXT_LIMITS.paramName)], output, seen, depth + 1, false);
    if (output.length >= MAX_PARAMS) break;
  }
  seen.delete(value);
}

export function sanitizeOperationParams(params) {
  if (!params || typeof params !== "object") return [];
  const output = [];
  const seen = new Set();
  for (const [key, value] of Object.entries(params)) {
    flattenParamValue(value, [boundedText(key, TEXT_LIMITS.paramName)], output, seen, 0, false);
    if (output.length >= MAX_PARAMS) break;
  }
  return output;
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && safeText(value).trim());
}

function parameterValue(params, ...names) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
  }
  return null;
}

function commandValue(approval, params) {
  const direct = firstPresent(
    approval?.command,
    parameterValue(params, "command", "cmd", "shellCommand"),
  );
  if (direct !== undefined) return direct;
  const argv = parameterValue(params, "argv", "args");
  return Array.isArray(argv) ? argv.map((value) => safeText(value)).join(" ") : null;
}

export function operationDetails(approval = {}) {
  const params = approval?.params && typeof approval.params === "object" ? approval.params : null;
  const diff = firstPresent(
    approval?.diff,
    parameterValue(params, "diff", "patch"),
  );
  return {
    method: optionalText(approval?.method, TEXT_LIMITS.method),
    kind: optionalText(approval?.kind, TEXT_LIMITS.kind),
    command: optionalText(commandValue(approval, params), TEXT_LIMITS.command),
    cwd: optionalText(
      firstPresent(approval?.cwd, parameterValue(params, "cwd", "workdir", "directory")),
      TEXT_LIMITS.cwd,
    ),
    params: sanitizeOperationParams(params),
    diff: diff === undefined ? null : optionalText(diff, TEXT_LIMITS.diff),
    readOnly: approval?.readonly === true || approval?.readOnly === true,
  };
}

function operationSearchText(operation) {
  return [
    operation.method,
    operation.kind,
    operation.command,
    ...operation.params.flatMap((entry) => [entry.name, entry.value]),
  ].filter(Boolean).join("\n").toLowerCase();
}

function isDestructiveOperation(operation) {
  if (operation.diff && /(?:^|\n)(?:deleted file mode\b|\+\+\+\s+\/dev\/null\b)/i.test(operation.diff)) {
    return true;
  }
  const text = operationSearchText(operation);
  if (!text) return false;

  const deletesFiles = /(?:^|[\s/_.-])(?:rm|rmdir|unlink|shred|truncate|delete|remove|purge|wipe|destroy)(?:[\s/_.(-]|$)|\bfind\b[^\n]*\s-delete\b|\bgit\s+(?:clean\b|reset\s+--hard\b|checkout\s+--\s|restore\s+(?:--source\s+\S+\s+)?(?:--worktree\s+)?(?:\.\s*$|[^\n]+))|\b(?:remove-item|del|erase)\b/i.test(text);
  if (deletesFiles) return true;

  const pushesOrReleases = /\bgit\s+push\b|\b(?:npm|pnpm|yarn|cargo|gem|twine)\s+publish\b|\bdocker\s+push\b|\b(?:deploy|publish|release)(?:[\s/_.(-]|$)|\b(?:vercel|netlify|flyctl)\b[^\n]*(?:deploy|--prod)\b|\bkubectl\s+(?:apply|delete|patch|replace|rollout|scale)\b|\bhelm\s+(?:install|upgrade|uninstall|rollback)\b|\bterraform\s+(?:apply|destroy|import)\b|\bpulumi\s+(?:up|destroy|import)\b/i.test(text);
  if (pushesOrReleases) return true;

  const outboundNetwork = /(?:^|[\s/_.-])(?:curl|wget|httpie|fetch|webhook|network-request|http-request)(?:[\s/_.(-]|$)|(?:network|https?)[/_.-](?:request|call|post|send|put|patch|delete)\b|https?:\/\/|\b(?:ssh|scp|sftp|ftp|telnet|netcat|nc)\b|\b(?:gh|glab)\s+(?:api|issue\s+(?:create|comment|close)|pr\s+(?:create|comment|merge|close)|release\s+create)\b/i.test(text);
  if (outboundNetwork) return true;

  return /\b(?:send|post|publish|deliver|reply|notify)(?:[\s/_.-]+)?(?:message|email|mail|sms|notification|webhook)\b|\b(?:slack|discord|telegram|feishu|lark|weixin|wechat|dingtalk|teams|whatsapp)[\s/_.-]*(?:send|post|message|reply|notify|publish)\b|\b(?:sendmail|mailx)\b/i.test(text);
}

export function classifyOperationRisk(operation) {
  if (isDestructiveOperation(operation)) return "destructive";
  if (operation.readOnly) return "safe";
  return "careful";
}

export function approvalGateDetails(approval = {}) {
  const operation = operationDetails(approval);
  const risk = classifyOperationRisk(operation);
  const title = optionalText(
    firstPresent(approval?.title, approval?.kind, "Agent approval required"),
    TEXT_LIMITS.title,
  );
  const summary = optionalText(
    firstPresent(
      approval?.summary,
      approval?.command,
      approval?.method,
      "The local agent requested approval.",
    ),
    TEXT_LIMITS.summary,
  );
  return {
    kind: risk === "destructive" ? "high-risk-action" : "personal-runtime-approval",
    risk,
    operation,
    title: title || "Agent approval required",
    summary: summary || "The local agent requested approval.",
  };
}
