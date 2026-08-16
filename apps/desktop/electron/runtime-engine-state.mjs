/**
 * Engine / OnMyAgent server / orchestrator state factories and snapshots.
 * Extracted from runtime.mjs composition root (P1-D).
 */
import os from "node:os";

export const DIRECT_RUNTIME = "direct";
export const ORCHESTRATOR_RUNTIME = "onmyagent-orchestrator";

/**
 * Shipped desktop engineStart always uses in-process server (direct).
 * Callers may still pass `runtime: "onmyagent-orchestrator"` on the wire;
 * that path is isolated and must not be assigned.
 */
export function resolveShippedEngineRuntime(requested) {
  void requested;
  return DIRECT_RUNTIME;
}

export function isShippedEngineRuntime(runtime) {
  return runtime === DIRECT_RUNTIME;
}

export function nowMs() {
  return Date.now();
}

export function createEngineState() {
  return {
    child: null,
    childExited: true,
    runtime: DIRECT_RUNTIME,
    projectDir: null,
    hostname: null,
    port: null,
    baseUrl: null,
    opencodeUsername: null,
    opencodePassword: null,
    opencodeBinPath: null,
    opencodeBinSource: null,
    lastStdout: null,
    lastStderr: null,
  };
}

export function snapshotEngineState(state) {
  const child = state.childExited ? null : state.child;
  return {
    running: Boolean(child && child.exitCode === null && !child.killed),
    runtime: state.runtime,
    baseUrl: state.baseUrl,
    projectDir: state.projectDir,
    hostname: state.hostname,
    port: state.port,
    opencodeUsername: state.opencodeUsername,
    opencodePassword: state.opencodePassword,
    opencodeBinPath: state.opencodeBinPath,
    opencodeBinSource: state.opencodeBinSource,
    pid: child?.pid ?? null,
    lastStdout: state.lastStdout,
    lastStderr: state.lastStderr,
  };
}

export function createOnMyAgentServerState() {
  return {
    child: null,
    childExited: true,
    inProcess: false,
    remoteAccessEnabled: false,
    host: null,
    port: null,
    baseUrl: null,
    connectUrl: null,
    mdnsUrl: null,
    lanUrl: null,
    clientToken: null,
    ownerToken: null,
    hostToken: null,
    managedOpencodeBinPath: null,
    managedOpencodeBinSource: null,
    lastStdout: null,
    lastStderr: null,
  };
}

export function snapshotOnMyAgentServerState(state, options = {}) {
  const child = state.childExited ? null : state.child;
  const reachable = options.reachable !== false;
  const running =
    reachable &&
    (state.inProcess ||
      Boolean(child && child.exitCode === null && !child.killed));
  return {
    running,
    remoteAccessEnabled: state.remoteAccessEnabled,
    host: state.host,
    port: state.port,
    baseUrl: state.baseUrl,
    connectUrl: state.connectUrl,
    mdnsUrl: state.mdnsUrl,
    lanUrl: state.lanUrl,
    clientToken: state.clientToken,
    ownerToken: state.ownerToken,
    hostToken: state.hostToken,
    managedOpencodeBinPath: state.managedOpencodeBinPath,
    managedOpencodeBinSource: state.managedOpencodeBinSource,
    pid: child?.pid ?? null,
    lastStdout: state.lastStdout,
    lastStderr: state.lastStderr,
  };
}

export function assertOnMyAgentServerReady(snapshot) {
  if (!snapshot?.running) {
    throw new Error("OnMyAgent server did not stay running after startup.");
  }
  if (!snapshot.baseUrl) {
    throw new Error("OnMyAgent server did not report a base URL after startup.");
  }
  if (!snapshot.ownerToken && !snapshot.clientToken) {
    throw new Error(
      "OnMyAgent server did not report an access token after startup.",
    );
  }
  return snapshot;
}

export function createOrchestratorState() {
  return {
    child: null,
    childExited: true,
    dataDir: null,
    baseUrl: null,
    daemonPort: null,
    lastStdout: null,
    lastStderr: null,
  };
}

export function selectLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry && entry.family === "IPv4" && entry.internal === false) {
        return entry.address;
      }
    }
  }
  return null;
}

export function buildConnectUrls(port) {
  const hostname = os.hostname().trim();
  const mdnsUrl = hostname
    ? `http://${hostname.replace(/\.local$/i, "")}.local:${port}`
    : null;
  const lan = selectLanAddress();
  const lanUrl = lan ? `http://${lan}:${port}` : null;
  return {
    connectUrl: lanUrl ?? mdnsUrl,
    mdnsUrl,
    lanUrl,
  };
}
