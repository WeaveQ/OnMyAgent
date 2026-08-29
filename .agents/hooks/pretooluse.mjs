#!/usr/bin/env node
/**
 * Shared PreToolUse path guard for Claude Code, Cursor, and Codex.
 * Decision SoT: AGENTS.md path table. Do not fork copies per harness.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "../..");

export const HUMAN_GATE_FILES = new Set(["package.json", "pnpm-lock.yaml"]);
export const HUMAN_GATE_PREFIXES = [
  "apps/server/src/",
  "apps/desktop/electron/",
  "apps/orchestrator/src/",
];

const SECRET_RE = /(^|\/)\.env($|\.|\/)|(^|\/)\.secrets(\/|$)|(^|\/)secrets(\/|$)/;
const GENERATED_RE = /(^|\/)node_modules(\/|$)|(^|\/)?graphify-out(\/|$)/;

export function toPosixRel(rawPath, root = REPO_ROOT) {
  if (typeof rawPath !== "string") return null;
  const cleaned = rawPath.trim().replace(/^['"]|['"]$/g, "");
  if (!cleaned) return null;

  const abs = isAbsolute(cleaned) || /^[A-Za-z]:[\\/]/.test(cleaned)
    ? cleaned
    : join(root, cleaned);
  let rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

export function isTestPath(rel) {
  if (!rel) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return true;
  if (/(^|\/)__tests__\//.test(rel)) return true;
  if (/(^|\/)tests?\//.test(rel) && /\.[cm]?[jt]sx?$/.test(rel)) return true;
  return false;
}

export function classifyPath(rel) {
  if (!rel) return "ok";
  const n = rel.replace(/^\.\//, "");
  const base = n.split("/").pop() ?? n;
  if (SECRET_RE.test(n) || /^\.env/.test(base)) return "denylist-secret";
  if (GENERATED_RE.test(n) || n === "graphify-out") return "denylist-generated";
  if (
    HUMAN_GATE_FILES.has(n) ||
    HUMAN_GATE_PREFIXES.some((prefix) => n === prefix.slice(0, -1) || n.startsWith(prefix))
  ) {
    return "human-gate";
  }
  if (isTestPath(n)) return "test";
  return "ok";
}

export function isGraphifyCommand(command) {
  return /\bgraphify\b/.test(command) || /\bpnpm\s+task\s+graphify\b/.test(command);
}

export function isPackageManagerMutate(command) {
  return /\b(?:pnpm|npm|yarn)\s+(?:install|add|remove|update|i)\b/.test(command);
}

export function isReadLikeTool(toolName) {
  return /^(read|beforeReadFile)$/i.test(String(toolName ?? ""));
}

export function extractCommand(payload) {
  if (typeof payload?.command === "string") return payload.command;
  const input = payload?.tool_input ?? payload?.toolInput;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed?.command === "string") return parsed.command;
    } catch {
      return input;
    }
  }
  if (input && typeof input === "object" && typeof input.command === "string") {
    return input.command;
  }
  return null;
}

export function collectPaths(payload, root = REPO_ROOT) {
  const found = new Set();
  const add = (value) => {
    const rel = toPosixRel(value, root);
    if (rel) found.add(rel);
  };

  add(payload?.file_path);
  add(payload?.path);

  let input = payload?.tool_input ?? payload?.toolInput;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = null;
    }
  }
  if (input && typeof input === "object") {
    add(input.file_path);
    add(input.path);
    add(input.target_file);
  }

  const command = extractCommand(payload);
  if (command) {
    for (const token of command.match(/(?:[\w.@+-]+\/)+[\w.@+-]+|package\.json|pnpm-lock\.yaml|\.env[\w.-]*/g) ?? []) {
      add(token);
    }
  }

  return [...found];
}

export function decide({
  toolName,
  paths,
  command,
  allowHumanGate = false,
  lockTests = false,
}) {
  const reasons = [];
  const readLike = isReadLikeTool(toolName);

  for (const rel of paths) {
    const kind = classifyPath(rel);
    if (kind === "denylist-secret") {
      reasons.push(
        `Denylist: ${rel} is a secret path. Do not read or edit .env* / secrets.`,
      );
      continue;
    }
    if (kind === "denylist-generated" && !readLike) {
      if (command && isGraphifyCommand(command) && rel.startsWith("graphify-out")) {
        continue;
      }
      reasons.push(
        `Denylist: do not hand-edit generated path ${rel} (node_modules / graphify-out).`,
      );
      continue;
    }
    if (kind === "human-gate" && !readLike && !allowHumanGate) {
      reasons.push(
        `Human gate: ${rel} needs explicit user approval. After they confirm, retry with ONMYAGENT_ALLOW_HUMAN_GATE=1.`,
      );
      continue;
    }
    if (kind === "test" && !readLike && lockTests) {
      reasons.push(
        `Test lock: ${rel} is locked for this fix. Write the failing test first, then set ONMYAGENT_LOCK_TEST_EDITS=1 or .loop/state/lock-tests.`,
      );
    }
  }

  if (command && isPackageManagerMutate(command) && !allowHumanGate) {
    reasons.push(
      "Human gate: package install/update can change pnpm-lock.yaml. Get user approval first.",
    );
  }

  return reasons.length > 0
    ? { decision: "deny", reasons }
    : { decision: "allow", reasons: [] };
}

export function formatDecision(format, decision, reasons) {
  const reason = reasons.join(" ");
  if (format === "cursor") {
    const payload = { continue: true, permission: decision };
    if (decision === "deny") {
      payload.user_message = reason;
      payload.agent_message = reason;
    }
    return payload;
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason || "ok",
    },
  };
}

export function parseFormat(argv = process.argv.slice(2)) {
  const flag = argv.find((arg) => arg.startsWith("--format="));
  const value = flag?.slice("--format=".length) ?? "claude";
  return value === "cursor" || value === "codex" || value === "claude" ? value : "claude";
}

export function lockTestsEnabled(env = process.env, root = REPO_ROOT) {
  return env.ONMYAGENT_LOCK_TEST_EDITS === "1" || existsSync(join(root, ".loop/state/lock-tests"));
}

export function evaluatePayload(payload, options = {}) {
  const toolName = payload?.tool_name ?? payload?.toolName ?? options.event ?? "";
  const command = extractCommand(payload);
  const paths = collectPaths(payload, options.root ?? REPO_ROOT);
  return decide({
    toolName,
    paths,
    command,
    allowHumanGate: options.allowHumanGate ?? process.env.ONMYAGENT_ALLOW_HUMAN_GATE === "1",
    lockTests: options.lockTests ?? lockTestsEnabled(process.env, options.root ?? REPO_ROOT),
  });
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    raw = "";
  }

  let payload = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      process.stdout.write(`${JSON.stringify(formatDecision(parseFormat(), "allow", []))}\n`);
      process.exit(0);
    }
  }

  const result = evaluatePayload(payload);
  process.stdout.write(`${JSON.stringify(formatDecision(parseFormat(), result.decision, result.reasons))}\n`);
  process.exit(0);
}
