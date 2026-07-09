import path from "node:path";
import { rm } from "node:fs/promises";

import { readJsonLikeFile, writeJsonFile } from "./utils.mjs";
import { legacyPersonalAgentRoot, personalAgentRoot } from "./runtime-state.mjs";

const SESSION_DIR = "sessions";

export function legacySessionRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".opencode", "personal-local-agent-sessions");
}

export function legacyPersonalAssistantSessionRoot(workspaceRoot) {
  return path.join(legacyPersonalAgentRoot(workspaceRoot), SESSION_DIR);
}

export function sessionRoot(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), SESSION_DIR);
}

export function sessionFile(workspaceRoot, provider, agentId = "default") {
  return path.join(sessionRoot(workspaceRoot), `${provider}-${agentId}.json`);
}

export function legacySessionFile(workspaceRoot, provider, agentId = "default") {
  return path.join(legacySessionRoot(workspaceRoot), `${provider}-${agentId}.json`);
}

export function legacyPersonalAssistantSessionFile(workspaceRoot, provider, agentId = "default") {
  return path.join(legacyPersonalAssistantSessionRoot(workspaceRoot), `${provider}-${agentId}.json`);
}

export async function readSession(workspaceRoot, provider, agentId = "default") {
  const current = await readJsonLikeFile(sessionFile(workspaceRoot, provider, agentId));
  if (current) return current;
  const legacyPersonalAssistant = await readJsonLikeFile(legacyPersonalAssistantSessionFile(workspaceRoot, provider, agentId));
  if (legacyPersonalAssistant) return legacyPersonalAssistant;
  return (await readJsonLikeFile(legacySessionFile(workspaceRoot, provider, agentId))) ?? {};
}

export async function writeSession(workspaceRoot, provider, agentId, data) {
  // Merge into the existing session file so callers writing partial patches
  // (e.g. conversation-store persisting just sessionId/workdir/updatedAt on
  // conversation updates) do not clobber unrelated fields like
  // sessionMetadata / availableCommands captured during warmup.
  const prior = await readJsonLikeFile(sessionFile(workspaceRoot, provider, agentId));
  const base = prior && typeof prior === "object" && !Array.isArray(prior) ? prior : {};
  const patch = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  await writeJsonFile(sessionFile(workspaceRoot, provider, agentId), { ...base, ...patch });
}

export async function clearSession(workspaceRoot, provider, agentId = "default") {
  const targets = [
    sessionFile(workspaceRoot, provider, agentId),
    legacyPersonalAssistantSessionFile(workspaceRoot, provider, agentId),
    legacySessionFile(workspaceRoot, provider, agentId),
  ];
  const removed = [];
  const missing = [];
  const errors = [];
  for (const target of targets) {
    try {
      await rm(target, { force: false });
      removed.push(target);
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing.push(target);
      } else {
        errors.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { ok: errors.length === 0, removed, missing, errors };
}
