import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

const SAFE_PROVIDER = /^[A-Za-z0-9_.:-]{1,160}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const GRANT_MODES = new Set(["full-allow", "task-full-allow"]);
const TASK_CONTROL_SERVER = "onmyagent-task-control";
const TASK_CONTROL_TOOLS = new Set([
  "get_task_state",
  "list_agents",
  "spawn_agent",
  "send_message",
  "wait_agent",
  "close_agent",
  "complete_task",
  "continue_task",
  "checkpoint_task",
  "block_task",
  "realign_task",
  "propose_contract",
]);
const HARD_DENY_PATTERNS = [
  /\b(?:curl|wget|fetch|httpie|nc|netcat|telnet|ssh|scp|sftp|rsync)\b/i,
  /\b(?:git\s+(?:push|fetch|pull|clone)|docker\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|vercel\s+deploy|netlify\s+deploy|kubectl\s+(?:apply|create|delete))\b/i,
  /\b(?:slack|discord|telegram|whatsapp|weixin|wechat|feishu|lark|dingtalk|email|smtp|send_message|send-message|webhook)\b/i,
  /\b(?:sudo|doas|pkexec|runas|osascript\s+-e)\b/i,
  /\b(?:printenv|env|setenv|export\s+[A-Za-z_][A-Za-z0-9_]*=)\b/i,
  /(?:^|[\s/])(?:\.env(?:\.|$)|\.npmrc(?:$|\s)|\.netrc(?:$|\s)|\.ssh(?:$|[\s/])|credentials?(?:\.json)?|secrets?(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)|known_hosts|keychain|ssh[_-]?config|ssh-agent)(?:$|[\s/])/i,
  /(?:^|[\s/])(?:\/etc|\/system|\/library|\/private\/etc|\/var\/root|\/root|~\/|\$home\b|\$HOME\b)/i,
  /\b(?:rm|find)\b[^\n]*(?:\s-[^-\n]*r|\s--recursive|\s-delete\b)/i,
  /\b(?:git\s+clean\b|git\s+reset\s+--hard\b|git\s+push\b[^\n]*(?:--force|-f\b)|\bforce\s+push\b)/i,
  /\b(?:deploy|publish|release)\b/i,
];
// A scoped grant may permit direct, workspace-bounded file/build commands, but
// it must not become a general-purpose interpreter or shell escape hatch. The
// classifier intentionally rejects these before path checks: a script can hide
// network, credentials, external messaging, deployment, or destructive work
// behind an otherwise local-looking command.
const OPAQUE_INTERPRETER_PATTERNS = [
  /(?:^|[\s"'`;&|])(?:python(?:\d+(?:\.\d+)?)?|py|node(?:js)?|ruby|perl|php|deno|bun)(?:[\s"'`]|$)/i,
  /(?:^|[\s"'`;&|])(?:bash|sh|zsh|dash|fish|ksh)(?:\s+(?:-c|--command|--eval|-e)\b|\s+eval\b)/i,
  /\b(?:eval|exec|source)\s*\(/i,
  // Shell-style eval/source do not use parentheses; they are equally opaque
  // because the runtime cannot inspect the expanded command before execution.
  /\b(?:eval|exec|source)\s+/i,
  /(?:^|[\s"'`;&|])(?:xargs|envsubst|npx|npm\s+exec|pnpm\s+exec|yarn\s+exec)(?:[\s"'`]|$)/i,
];
const INDIRECT_NETWORK_PATTERNS = [
  /\b(?:https?|ftp|ws|wss|tcp|udp)\s*:\s*\/\//i,
  /\b(?:requests?|urllib|httpx|axios|fetch|websocket|socket|net\.connect|tls\.connect|dns\.)\b/i,
  /\b(?:import|require)\s*\(?.*\b(?:https?|http|net|tls|dns|socket)\b/i,
];
const CREDENTIAL_ENV_PATTERNS = [
  /\b(?:process\.env|os\.environ|getenv|dotenv|keyring|credential|secret|token|password|api[_-]?key)\b/i,
  /(?:^|[\s/])(?:\/proc|\/dev\/fd|\/dev\/stdin|\/dev\/stdout|\/private\/var|\/var\/run)(?:[\s/]|$)/i,
  /\$(?:HOME|USER|PATH|SHELL|SSH_AUTH_SOCK|AWS_|GITHUB_|OPENAI_|ANTHROPIC_)[A-Z0-9_]*/i,
];
const DESTRUCTIVE_PATTERNS = [
  /\b(?:rm|rmdir|unlink|delete|remove|truncate|shred|wipe|mkfs|dd\s+if=|kill|pkill|killall)\b/i,
  /\b(?:git\s+(?:reset|clean)|find\b[^\n]*\s-delete)\b/i,
];

function text(value) {
  return String(value ?? "").trim();
}

function providerValues(grant) {
  const raw = grant?.providerSet ?? grant?.allowedProviders ?? grant?.providers ?? grant?.provider ?? grant?.agentProvider;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => text(typeof value === "object" ? value?.provider ?? value?.id : value)).filter(Boolean);
}

function grantMode(grant) {
  return text(grant?.permissionMode ?? grant?.mode ?? grant?.taskPermissionMode);
}

/** Return only non-secret grant fields suitable for run_meta/log persistence. */
export function sanitizeTaskPermissionGrant(grant) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return null;
  const providers = providerValues(grant).filter((value) => SAFE_PROVIDER.test(value));
  const result = {
    policyVersion: Number.isSafeInteger(grant.policyVersion) ? grant.policyVersion : null,
    grantId: text(grant.grantId ?? grant.id) || null,
    taskId: text(grant.taskId) || null,
    taskRunId: text(grant.taskRunId ?? grant.runId) || null,
    taskRevision: Number.isSafeInteger(grant.taskRevision) ? grant.taskRevision : null,
    contractHash: text(grant.contractHash ?? grant.contractSha256) || null,
    workspaceRoot: text(grant.workspaceRoot ?? grant.workspace) || null,
    realWorkspaceRoot: text(grant.realWorkspaceRoot ?? grant.realWorkspace) || null,
    providerSet: providers,
    allowedProviders: providers,
    allowedProfileIds: (Array.isArray(grant.allowedProfileIds) ? grant.allowedProfileIds : grant.profileId ? [grant.profileId] : []).map(text).filter(Boolean),
    issuedAt: Number.isSafeInteger(grant.issuedAt) ? grant.issuedAt : null,
    expiresAt: Number.isSafeInteger(grant.expiresAt ?? grant.deadlineAt) ? (grant.expiresAt ?? grant.deadlineAt) : null,
    permissionMode: grantMode(grant) || null,
  };
  return result;
}

function invalidGrant(grant) {
  const safe = sanitizeTaskPermissionGrant(grant);
  if (!safe || safe.policyVersion !== 1 || !SAFE_ID.test(safe.grantId ?? "") || !GRANT_MODES.has(safe.permissionMode) || !SAFE_ID.test(safe.taskId ?? "") || !SAFE_ID.test(safe.taskRunId ?? "") || !Number.isSafeInteger(safe.taskRevision) || safe.taskRevision <= 0 || !/^[a-f0-9]{64}$/i.test(safe.contractHash) || !safe.workspaceRoot || !safe.realWorkspaceRoot || !safe.providerSet.length || !safe.allowedProfileIds.length || safe.allowedProfileIds.some((value) => !SAFE_ID.test(value))) return "missing-or-invalid-grant";
  if (!Number.isSafeInteger(safe.issuedAt) || safe.issuedAt < 0 || !Number.isSafeInteger(safe.expiresAt) || safe.expiresAt <= safe.issuedAt) return "grant-expiry-missing";
  if (safe.providerSet.some((value) => !SAFE_PROVIDER.test(value))) return "grant-provider-invalid";
  return null;
}

async function canonicalPath(value) {
  const candidate = text(value);
  if (!candidate) return null;
  const absolute = path.resolve(candidate);
  try { return await realpath(absolute); } catch (error) {
    if (error?.code && error.code !== "ENOENT" && error.code !== "ENOTDIR") return null;
    let current = absolute;
    while (true) {
      try {
        await access(current);
        return await realpath(current);
      } catch (parentError) {
        if (parentError?.code && parentError.code !== "ENOENT" && parentError.code !== "ENOTDIR") return null;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
      }
    }
  }
}

async function existingDirectory(value) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const resolved = await realpath(path.resolve(candidate));
    const details = await stat(resolved);
    return details.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function isWithin(root, candidate) {
  if (!root || !candidate) return false;
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function operationText(operation) {
  try { return JSON.stringify(operation ?? {}).toLowerCase(); } catch { return text(operation).toLowerCase(); }
}

function taskControlOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
  const candidates = [
    operation,
    operation.input,
    operation.rawInput,
    operation.raw_input,
    operation.toolCall,
    operation.tool_call,
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  for (const value of candidates) {
    const server = text(value.server ?? value.serverName ?? value.server_name);
    const tool = text(value.tool ?? value.toolName ?? value.tool_name ?? value.name);
    if (server === TASK_CONTROL_SERVER && TASK_CONTROL_TOOLS.has(tool)) return { server, tool };
  }
  return null;
}

/**
 * Classify a Task permission request using only its structured fields and a
 * bounded command string. `opaque-interpreter` is deliberately fail-closed:
 * the runtime cannot prove what a script/eval will do before execution.
 */
export function classifyTaskOperation(operation = {}) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return { kind: "unknown", safe: false, reason: "opaque-operation" };
  }
  const structured = /** @type {Record<string, unknown>} */ (operation);
  const nestedInput = structured.input && typeof structured.input === "object" && !Array.isArray(structured.input)
    ? /** @type {Record<string, unknown>} */ (structured.input)
    : null;
  // This MCP server is created by Task Center with an attempt-scoped secret.
  // Its tools mutate only the already-serialized durable control plane; their
  // free-form worker prompts are data, not executable provider operations.
  // Classify the exact server/tool pair before scanning prompt text so phrases
  // such as "do not deploy" cannot incorrectly deny a valid delegation.
  if (taskControlOperation(structured)) {
    return { kind: "task-control", safe: true, reason: "task-control-operation" };
  }
  const value = operationText(structured);
  const command = text(structured.command ?? nestedInput?.command);
  const method = text(structured.method ?? structured.kind ?? structured.toolName).toLowerCase();
  if (OPAQUE_INTERPRETER_PATTERNS.some((pattern) => pattern.test(value))) {
    return { kind: "opaque-interpreter", safe: false, reason: "opaque-interpreter" };
  }
  if (INDIRECT_NETWORK_PATTERNS.some((pattern) => pattern.test(value))) {
    return { kind: "network", safe: false, reason: "indirect-network" };
  }
  if (CREDENTIAL_ENV_PATTERNS.some((pattern) => pattern.test(value))) {
    return { kind: "credential-or-environment", safe: false, reason: "credential-or-environment" };
  }
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(value))) {
    return { kind: "destructive", safe: false, reason: "destructive-operation" };
  }
  if (/\b(?:shell|terminal|command|exec|run)\b/.test(method) && !command) {
    return { kind: "opaque-command", safe: false, reason: "opaque-command" };
  }
  // A structured workspace file operation is inspectable. An arbitrary
  // method/tool payload with neither a typed path nor a bounded command is not
  // inspectable and therefore cannot inherit full-allow.
  const typedFile = /(?:file|fs|workspace|patch|write|edit|read|list|directory)/.test(method)
    || typeof structured.path === "string"
    || typeof structured.file_path === "string"
    || typeof structured.cwd === "string";
  if (!command && !typedFile) return { kind: "unknown", safe: false, reason: "opaque-operation" };
  return {
    kind: command ? "command" : "workspace-operation",
    safe: true,
    reason: "workspace-scoped-operation",
  };
}

function pathCandidates(operation) {
  const found = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (/^(?:cwd|workdir|path|file|filename|target|destination|source|directory|dir|root|workspace|artifact|output|input)$/i.test(key) || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("~")) found.push({ value, key });
      return;
    }
    if (Array.isArray(value)) { for (const item of value) visit(item, key); return; }
    if (value && typeof value === "object") for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };
  visit(operation);
  return found;
}

function commandPathCandidates(operation, cwd) {
  const command = text(operation?.command ?? operation?.input?.command);
  if (!command) return [];
  const candidates = [];
  const absolutePattern = /(?:^|[\s"'])((?:\/|[A-Za-z]:[\\/])[^\s"'`;&|<>]*)/g;
  for (const match of command.matchAll(absolutePattern)) candidates.push({ value: match[1], key: "command" });
  const relativePattern = /(?:^|[\s"'])(\.\.?[\\/][^\s"'`;&|<>]*|[A-Za-z0-9_.-]+\.(?:js|mjs|cjs|ts|tsx|json|md|txt|yaml|yml|toml|lock|patch))(?:$|[\s"';&|<>])/g;
  for (const match of command.matchAll(relativePattern)) candidates.push({ value: path.resolve(cwd || process.cwd(), match[1]), key: "command" });
  return candidates;
}

function hardDenyReason(operation) {
  if (taskControlOperation(operation)) return null;
  const value = operationText(operation);
  const classification = classifyTaskOperation(operation);
  if (!classification.safe) return "hard-deny-operation";
  const match = HARD_DENY_PATTERNS.find((pattern) => pattern.test(value));
  const recursive = operation?.recursive === true || operation?.isRecursive === true || /["'](?:recursive|isRecursive)["']\s*:\s*true/i.test(value);
  if (match || recursive || /\b(?:rm|find|delete|remove|unlink)\b[^\n]*[*?]/i.test(value)) return "hard-deny-operation";
  return null;
}

/**
 * Fail-closed evaluator for Task Center's scoped full-allow grant.  A grant
 * is intentionally narrower than a provider's global auto/yolo mode.
 */
async function evaluateTaskPermissionInternal(input = {}) {
  const grant = sanitizeTaskPermissionGrant(input.taskPermissionGrant ?? input.grant);
  const invalid = invalidGrant(grant);
  if (invalid) return { decision: "decline", reason: invalid, grant: null };
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  if (now >= grant.expiresAt) return { decision: "decline", reason: "grant-expired", grant };

  const taskId = text(input.taskId ?? input.task?.id);
  const runId = text(input.taskRunId ?? input.runId ?? input.task?.runId);
  const contractHash = text(input.contractHash ?? input.contractSha256);
  const provider = text(input.provider ?? input.agentProvider ?? input.agent?.provider);
  const taskRevision = input.taskRevision === undefined ? null : input.taskRevision;
  const taskProfileId = text(input.taskProfileId ?? input.profileId ?? input.agent?.id);
  if (!taskId || !runId || !provider || !taskProfileId) return { decision: "decline", reason: "grant-context-missing", grant };
  if ((taskId && taskId !== grant.taskId) || (runId && runId !== grant.taskRunId) || (taskRevision !== null && taskRevision !== grant.taskRevision) || (contractHash && contractHash !== grant.contractHash) || (provider && !grant.providerSet.includes(provider)) || (taskProfileId && !grant.allowedProfileIds.includes(taskProfileId))) {
    return { decision: "decline", reason: "grant-mismatch", grant };
  }
  const workspace = await canonicalPath(input.workspaceRoot ?? grant.realWorkspaceRoot);
  const declaredWorkspace = await existingDirectory(grant.workspaceRoot);
  const grantWorkspace = await existingDirectory(grant.realWorkspaceRoot);
  if (!workspace || !declaredWorkspace || !grantWorkspace || declaredWorkspace !== grantWorkspace || workspace !== grantWorkspace) return { decision: "decline", reason: "workspace-mismatch", grant };
  const operation = input.operation ?? input.request ?? {};
  const denied = hardDenyReason(operation);
  if (denied) return { decision: "decline", reason: denied, grant };
  const cwdValue = operation?.cwd ?? operation?.workdir ?? input.cwd ?? workspace;
  const cwd = await canonicalPath(path.isAbsolute(text(cwdValue)) ? cwdValue : path.resolve(workspace, text(cwdValue)));
  if (!cwd || !isWithin(workspace, cwd)) return { decision: "decline", reason: "cwd-outside-workspace", grant };
  const candidates = [...pathCandidates(operation), ...commandPathCandidates(operation, cwd)];
  for (const candidate of candidates) {
    const raw = text(candidate.value);
    if (!raw || raw === workspace || raw === cwd) continue;
    if (raw.includes("*") || raw.includes("?") || raw.includes("..")) {
      const resolved = await canonicalPath(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));
      if (!resolved || !isWithin(workspace, resolved)) return { decision: "decline", reason: "path-outside-workspace", grant };
      continue;
    }
    const resolved = await canonicalPath(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));
    if (!resolved || !isWithin(workspace, resolved)) return { decision: "decline", reason: "path-outside-workspace", grant };
  }
  return { decision: "accept", reason: "scoped-full-allow", grant };
}

/**
 * Public policy boundary.  Unexpected malformed input must still produce a
 * deterministic decline; permission handlers must never turn evaluator
 * failures into an implicit allow or an unhandled provider request.
 */
export async function evaluateTaskPermission(input = {}) {
  try {
    return await evaluateTaskPermissionInternal(input);
  } catch {
    return { decision: "decline", reason: "policy-evaluation-failed", grant: null };
  }
}

export function taskPermissionGrantForInput(input = {}) {
  return sanitizeTaskPermissionGrant(input.taskPermissionGrant ?? input.grant);
}

export const evaluateScopedTaskPermission = evaluateTaskPermission;
export const isTaskPermissionAllowed = async (input = {}) => (await evaluateTaskPermission(input)).decision === "accept";
export const classifyScopedTaskOperation = classifyTaskOperation;
