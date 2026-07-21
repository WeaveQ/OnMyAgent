import path from "node:path";

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { personalAgentRuntimeStateRoot } from "./runtime-state.mjs";

// Agent-level global handshake cache, independent of workspace.
//
// Why this exists: warmup-captured sessionMetadata (available_models,
// config_options, available_commands) was previously stored only under
// per-workspace session files. Channels that use a different workspaceRoot
// than the one where the agent was warmed up (e.g. WeChat workspace vs. a
// project workspace where CodeBuddy was opened via the local page) could
// not see the handshake, so `#model` showed an empty model list.
//
// An agent's advertised models are an agent-level property (they depend on
// the agent binary / config, not on which workspace opened it), so caching
// them globally is correct and avoids scanning other workspaces' private
// session data.

const CACHE_DIR = "agent-handshake-cache";

function cacheRoot() {
  return path.join(personalAgentRuntimeStateRoot(), "personal-assistant", CACHE_DIR);
}

function cacheFile(provider, agentId) {
  const safeProvider = String(provider ?? "default").trim() || "default";
  const safeAgentId = String(agentId ?? "default").trim() || "default";
  return path.join(cacheRoot(), `${safeProvider}-${safeAgentId}.json`);
}

export async function readAgentHandshakeCache(provider, agentId) {
  try {
    const raw = await readFile(cacheFile(provider, agentId), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function writeAgentHandshakeCache(provider, agentId, data) {
  const file = cacheFile(provider, agentId);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const prior = await readAgentHandshakeCache(provider, agentId);
    const base = prior && typeof prior === "object" ? prior : {};
    const patch = data && typeof data === "object" ? data : {};
    await writeFile(file, `${JSON.stringify({ ...base, ...patch, updatedAt: Date.now() }, null, 2)}\n`, "utf8");
  } catch {
    // best-effort cache write; callers should not fail if the cache is unavailable.
  }
}
