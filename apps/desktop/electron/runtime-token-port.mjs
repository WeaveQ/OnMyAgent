/**
 * OnMyAgent server token + preferred-port persistence.
 * Extracted from runtime.mjs (factory; re-used by createRuntimeManager).
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowMs } from "./runtime-engine-state.mjs";
import { normalizeWorkspaceKey } from "./runtime-helpers.mjs";
import { findFreePort, portAvailable } from "./runtime-path-env.mjs";

/**
 * @param {{
 *   userDataDir: string,
 *   readJsonFile: (targetPath: string, fallback: unknown) => Promise<any>,
 * }} deps
 */
export function createRuntimeTokenPortStore({ userDataDir, readJsonFile }) {
  function onmyagentServerTokenStorePath() {
    return path.join(userDataDir, "onmyagent-server-tokens.json");
  }

  function onmyagentServerStatePath() {
    return path.join(userDataDir, "onmyagent-server-state.json");
  }

  async function loadTokenStore() {
    return readJsonFile(onmyagentServerTokenStorePath(), { version: 1, workspaces: {} });
  }

  async function saveTokenStore(store) {
    const filePath = onmyagentServerTokenStorePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async function loadPortState() {
    return readJsonFile(onmyagentServerStatePath(), {
      version: 3,
      workspacePorts: {},
      preferredPort: null,
    });
  }

  async function savePortState(state) {
    const filePath = onmyagentServerStatePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async function loadOrCreateWorkspaceTokens(workspaceKey) {
    const store = await loadTokenStore();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (store.workspaces?.[normalized]) {
      return store.workspaces[normalized];
    }
    const next = {
      clientToken: randomUUID(),
      hostToken: randomUUID(),
      ownerToken: null,
      updatedAt: nowMs(),
    };
    store.workspaces ??= {};
    store.workspaces[normalized] = next;
    await saveTokenStore(store);
    return next;
  }

  async function persistWorkspaceOwnerToken(workspaceKey, ownerToken) {
    const store = await loadTokenStore();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (!store.workspaces?.[normalized]) return;
    store.workspaces[normalized].ownerToken = ownerToken;
    store.workspaces[normalized].updatedAt = nowMs();
    await saveTokenStore(store);
  }

  async function readPreferredOnMyAgentPort(workspaceKey) {
    const state = await loadPortState();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (normalized && state.workspacePorts?.[normalized]) {
      return state.workspacePorts[normalized];
    }
    return state.preferredPort ?? null;
  }

  async function persistPreferredOnMyAgentPort(workspaceKey, port) {
    const state = await loadPortState();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    state.version = 3;
    state.workspacePorts ??= {};
    if (normalized) {
      state.workspacePorts[normalized] = port;
      state.preferredPort = null;
    } else {
      state.preferredPort = port;
    }
    await savePortState(state);
  }

  async function resolveOnMyAgentPort(host, workspaceKey) {
    const preferredPort = await readPreferredOnMyAgentPort(workspaceKey);
    if (preferredPort && (await portAvailable(host, preferredPort))) {
      return preferredPort;
    }
    return findFreePort(host);
  }

  return {
    loadOrCreateWorkspaceTokens,
    persistWorkspaceOwnerToken,
    persistPreferredOnMyAgentPort,
    resolveOnMyAgentPort,
  };
}
