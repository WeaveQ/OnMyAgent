import { mkdir } from "node:fs/promises";
import path from "node:path";

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
  return path.join(personalAgentRoot(workspaceRoot), "workdirs", `${provider}-${agentId}`);
}

export async function ensureProviderWorkdir(workspaceRoot, provider, agentId = "default") {
  const dir = providerWorkdir(workspaceRoot, provider, agentId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureRunLogPath(workspaceRoot, runId) {
  const root = runLogRoot(workspaceRoot);
  await mkdir(root, { recursive: true });
  return path.join(root, `${runId}.jsonl`);
}
