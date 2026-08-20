/**
 * OnMyAgent server token + preferred-port persistence.
 * Extracted from runtime.mjs (factory; re-used by createRuntimeManager).
 */
import { randomUUID } from "node:crypto";

import { nowMs } from "./runtime-engine-state.mjs";
import { normalizeWorkspaceKey } from "./runtime-helpers.mjs";
import { findFreePort, portAvailable } from "./runtime-path-env.mjs";
import { createDurableStateRegistry } from "./durable-state.mjs";

/** @param {{ userDataDir: string }} deps */
export function createRuntimeTokenPortStore({ userDataDir }) {
  const durableState = createDurableStateRegistry({
    rootDir: userDataDir,
    definitions: {
      serverTokens: {
        fileName: "onmyagent-server-tokens.json",
        owner: "desktop.runtime.server-tokens",
        schemaVersion: 1,
        sensitivity: "secret",
        defaultValue: { version: 1, workspaces: {} },
      },
      serverState: {
        fileName: "onmyagent-server-state.json",
        owner: "desktop.runtime.server-state",
        schemaVersion: 3,
        sensitivity: "private",
        defaultValue: { version: 3, workspacePorts: {}, preferredPort: null },
      },
    },
  });

  async function loadTokenStore() {
    return durableState.read("serverTokens");
  }

  async function saveTokenStore(store) {
    await durableState.write("serverTokens", store);
  }

  async function loadPortState() {
    return durableState.read("serverState");
  }

  async function savePortState(state) {
    await durableState.write("serverState", state);
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
