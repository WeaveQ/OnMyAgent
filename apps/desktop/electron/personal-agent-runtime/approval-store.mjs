import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { personalAgentRoot } from "./runtime-state.mjs";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex").slice(0, 24);
}

export function approvalStoreFile(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), "approval-store.json");
}

export function approvalDecisionKey(input = {}) {
  const approval = input.approval ?? {};
  const kind = String(approval.kind ?? "unknown").trim() || "unknown";
  const method = String(approval.method ?? "unknown").trim() || "unknown";
  const command = String(approval.command ?? "").trim();
  const cwd = String(approval.cwd ?? "").trim();
  const paramsDigest = digest(approval.params ?? null);
  return [String(input.provider ?? "unknown"), String(input.agentId ?? "unknown"), kind, method, digest({ command, cwd, paramsDigest })].join(":");
}

async function readStore(workspaceRoot) {
  try {
    const parsed = JSON.parse(await readFile(approvalStoreFile(workspaceRoot), "utf8"));
    if (parsed?.version === 1 && parsed.decisions && typeof parsed.decisions === "object") return parsed;
  } catch {}
  return { version: 1, decisions: {} };
}

async function writeStore(workspaceRoot, store) {
  const file = approvalStoreFile(workspaceRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function getStoredApprovalDecision(workspaceRoot, input) {
  if (!workspaceRoot) return null;
  const key = approvalDecisionKey(input);
  const entry = (await readStore(workspaceRoot)).decisions[key];
  return entry?.decision === "acceptForSession" ? { key, ...entry } : null;
}

export async function rememberApprovalDecision(workspaceRoot, input) {
  if (!workspaceRoot || input?.decision !== "acceptForSession") return null;
  const approval = input.approval ?? {};
  const key = approvalDecisionKey(input);
  const store = await readStore(workspaceRoot);
  store.decisions[key] = {
    decision: "acceptForSession",
    provider: String(input.provider ?? "unknown"),
    agentId: String(input.agentId ?? "unknown"),
    method: String(approval.method ?? "unknown"),
    kind: String(approval.kind ?? "unknown"),
    summary: String(approval.summary ?? ""),
    command: approval.command ? String(approval.command) : null,
    updatedAt: Date.now(),
  };
  await writeStore(workspaceRoot, store);
  return { key, ...store.decisions[key] };
}
