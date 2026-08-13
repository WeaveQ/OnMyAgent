import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { personalAgentPartitionName } from "./path-segments.mjs";
import { legacyPersonalAgentRoot, personalAgentRoot } from "./runtime-state.mjs";

export function runLogRoot(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), "runs");
}

export function legacyRunLogRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".opencode", "personal-local-agent-runs");
}

export function legacyPersonalAssistantRunLogRoot(workspaceRoot) {
  return path.join(legacyPersonalAgentRoot(workspaceRoot), "runs");
}

export function providerWorkdir(workspaceRoot, provider, agentId = "default") {
  return path.join(personalAgentRoot(workspaceRoot), "workdirs", personalAgentPartitionName(provider, agentId));
}

export async function ensureProviderWorkdir(workspaceRoot, provider, agentId = "default") {
  const dir = providerWorkdir(workspaceRoot, provider, agentId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function resolveAgentExecutionWorkdirs(workspaceRoot, provider, agentId, conversationWorkdir) {
  let executionWorkdir = null;
  if (conversationWorkdir !== undefined && conversationWorkdir !== null) {
    const requested = String(conversationWorkdir).trim();
    if (!requested) throw new Error("conversation workdir must not be empty");
    if (!path.isAbsolute(requested)) throw new Error("conversation workdir must be absolute");
    const info = await stat(requested).catch(() => null);
    if (!info?.isDirectory()) throw new Error("conversation workdir must be an existing directory");
    executionWorkdir = path.resolve(requested);
  }
  const providerDirectory = await ensureProviderWorkdir(workspaceRoot, provider, agentId);
  return {
    providerWorkdir: providerDirectory,
    executionWorkdir: executionWorkdir ?? providerDirectory,
  };
}

export async function ensureRunLogPath(workspaceRoot, runId) {
  const root = runLogRoot(workspaceRoot);
  await mkdir(root, { recursive: true });
  return path.join(root, `${runId}.jsonl`);
}
