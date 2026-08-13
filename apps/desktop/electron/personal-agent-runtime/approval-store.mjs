import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { personalAgentRoot } from "./runtime-state.mjs";
import { normalizeApprovalExpiry } from "./run-helpers.mjs";

// Approval decisions are small JSON state, but read-modify-write races can
// silently drop another provider's key. Serialize each workspace in-process
// and replace the file atomically so remember/forget compensation is safe.
const storeTails = new Map();

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
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function withStoreLock(workspaceRoot, operation) {
  const key = approvalStoreFile(workspaceRoot);
  const previous = storeTails.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  let tracked;
  tracked = result.finally(() => {
    if (storeTails.get(key) === tracked) storeTails.delete(key);
  });
  storeTails.set(key, tracked);
  return tracked;
}

export async function getStoredApprovalDecision(workspaceRoot, input) {
  if (!workspaceRoot) return null;
  return withStoreLock(workspaceRoot, async () => {
    const key = approvalDecisionKey(input);
    const entry = (await readStore(workspaceRoot)).decisions[key];
    if (entry?.decision !== "acceptForSession") return null;
    const expiresAt = normalizeApprovalExpiry(entry);
    if (expiresAt !== null && expiresAt <= Date.now()) return null;
    return { key, ...entry };
  });
}

export async function rememberApprovalDecision(workspaceRoot, input) {
  if (!workspaceRoot || input?.decision !== "acceptForSession") return null;
  return withStoreLock(workspaceRoot, async () => {
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
      // Keep the provider's original TTL on the remembered record.  A late
      // read must fail closed even if the compensating forget raced or failed.
      expiresAt: normalizeApprovalExpiry(approval),
      updatedAt: Date.now(),
    };
    await writeStore(workspaceRoot, store);
    return { key, ...store.decisions[key] };
  });
}

/**
 * Compensating delete for a remembered approval written by a caller that
 * crossed its TTL/abort boundary while the durable write was in flight. The
 * expected record guard prevents a late cleanup from deleting a newer user
 * decision for the same approval key.
 */
export async function forgetRememberedApprovalDecision(workspaceRoot, input = {}) {
  if (!workspaceRoot) return { removed: false };
  return withStoreLock(workspaceRoot, async () => {
    const key = String(input.key ?? approvalDecisionKey(input)).trim();
    if (!key) return { removed: false };
    const store = await readStore(workspaceRoot);
    const existing = store.decisions[key];
    if (!existing || existing.decision !== "acceptForSession") return { removed: false, key };
    const expected = input.expected;
    if (expected && typeof expected === "object") {
      if (expected.updatedAt !== undefined && Number(existing.updatedAt) !== Number(expected.updatedAt)) return { removed: false, key };
      if (expected.provider !== undefined && String(existing.provider ?? "") !== String(expected.provider ?? "")) return { removed: false, key };
      if (expected.agentId !== undefined && String(existing.agentId ?? "") !== String(expected.agentId ?? "")) return { removed: false, key };
    }
    delete store.decisions[key];
    await writeStore(workspaceRoot, store);
    return { removed: true, key };
  });
}

export async function listRememberedApprovalDecisions(workspaceRoot) {
  if (!workspaceRoot) return [];
  return withStoreLock(workspaceRoot, async () => {
    const store = await readStore(workspaceRoot);
    return Object.entries(store.decisions).map(([key, entry]) => ({ key, ...entry }));
  });
}
