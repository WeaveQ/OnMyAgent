/**
 * Engine registry — resolves the agent engine for a workspace and owns
 * workspace-scoped engine instances.
 *
 * Business services call `getEngine(config, workspace)` and never import
 * engine-specific SDKs directly.
 */

import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import type { AgentEngine, EngineId } from "./types.js";
import { resolveEngineId } from "./types.js";
import { OpenCodeEngine } from "./opencode/opencode-engine.js";
import { PiEngine } from "./pi/pi-engine.js";

export type { AgentEngine, AgentEngineCapabilities, EngineEvent, EngineId, SessionRef, SessionSummary } from "./types.js";
export { resolveEngineId } from "./types.js";

const instances = new WeakMap<ServerConfig, Map<string, AgentEngine>>();

export function getEngine(config: ServerConfig, workspace: WorkspaceInfo): AgentEngine {
  const engineId = resolveEngineId(config, workspace);
  // Key by config + workspace.id (not the workspace object): resolveWorkspace
  // returns a fresh clone per request ({ ...workspace, path: resolved }), so
  // object-identity caching would spawn a new PiEngine per request and lose
  // the process pool / pending approvals between calls.
  let byWorkspace = instances.get(config);
  if (!byWorkspace) {
    byWorkspace = new Map();
    instances.set(config, byWorkspace);
  }
  const cacheKey = `${workspace.id}::${engineId}`;
  let engine = byWorkspace.get(cacheKey);
  if (!engine) {
    engine = createEngine(engineId, config, workspace);
    byWorkspace.set(cacheKey, engine);
  }
  return engine;
}

export function createEngine(engineId: EngineId, config: ServerConfig, workspace: WorkspaceInfo): AgentEngine {
  switch (engineId) {
    case "pi":
      return new PiEngine(config, workspace);
    case "opencode":
    default:
      return new OpenCodeEngine(config, workspace);
  }
}

/** Drop cached engine instances for a workspace (config reload, logout). */
export function clearEngineInstances(config: ServerConfig, workspace: WorkspaceInfo): void {
  const byWorkspace = instances.get(config);
  if (!byWorkspace) return;
  byWorkspace.delete(`${workspace.id}::opencode`);
  byWorkspace.delete(`${workspace.id}::pi`);
}
