// Runtime / sandbox / orchestrator desktop IPC wire types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

import type { EngineInfo, OnMyAgentServerInfo } from "./desktop-ipc-system.js";

export type OrchestratorDetachedHost = {
  onmyagentUrl: string;
  token: string;
  ownerToken?: string | null;
  hostToken: string;
  port: number;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type SandboxDoctorResult = {
  installed: boolean;
  daemonRunning: boolean;
  permissionOk: boolean;
  ready: boolean;
  clientVersion?: string | null;
  serverVersion?: string | null;
  error?: string | null;
  debug?: {
    candidates: string[];
    selectedBin?: string | null;
    versionCommand?: {
      status: number;
      stdout: string;
      stderr: string;
    } | null;
    infoCommand?: {
      status: number;
      stdout: string;
      stderr: string;
    } | null;
  } | null;
};

export type OnMyAgentDockerCleanupResult = {
  candidates: string[];
  removed: string[];
  errors: string[];
};

export type SandboxDebugProbeResult = {
  startedAt: number;
  finishedAt: number;
  runId: string;
  workspacePath: string;
  ready: boolean;
  doctor: SandboxDoctorResult;
  detachedHost?: OrchestratorDetachedHost | null;
  dockerInspect?: {
    status: number;
    stdout: string;
    stderr: string;
  } | null;
  dockerLogs?: {
    status: number;
    stdout: string;
    stderr: string;
  } | null;
  cleanup: {
    containerName?: string | null;
    containerRemoved: boolean;
    removeResult?: {
      status: number;
      stdout: string;
      stderr: string;
    } | null;
    workspaceRemoved: boolean;
    errors: string[];
  };
  error?: string | null;
};

// ---------------------------------------------------------------------------
// Runtime — bootstrap / status / orchestrator / sandbox stop
// ---------------------------------------------------------------------------

export type RuntimeLifecycleState =
  | "idle"
  | "cleaning"
  | "starting"
  | "healthy"
  | "error"
  | (string & {});

export type RuntimeStatus = {
  lifecycleState: RuntimeLifecycleState;
  engine: EngineInfo;
  onmyagentServer: OnMyAgentServerInfo;
};

export type RuntimeBootstrapResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped: false;
      engine: EngineInfo;
      onmyagentServer: OnMyAgentServerInfo;
      workspaceId: string | null;
    }
  | { ok: false; error: string };

export type OrchestratorDaemonSnapshot = {
  baseUrl: string | null;
  port: number | null;
  pid: number | null;
  runtime: string;
};

export type OrchestratorOpencodeSnapshot = {
  baseUrl: string | null;
  port: number | null;
  pid: number | null;
  projectDir: string | null;
  runtime: string;
};

export type OrchestratorStatus = {
  running: boolean;
  dataDir: string | null;
  daemon: OrchestratorDaemonSnapshot | null;
  opencode: OrchestratorOpencodeSnapshot | null;
  cliVersion: string | null;
  sidecar: unknown;
  binaries: unknown;
  activeId: string | null;
  workspaceCount: number;
  workspaces: Array<{ id: string; path: string; name: string }>;
  lastError: string | null;
};

export type OrchestratorWorkspaceActivateInput = {
  workspacePath: string;
  name?: string | null;
};

export type OrchestratorWorkspaceActivateResult = {
  id: string;
  path: string;
  name: string;
};

/** Docker `stop` / shell-style result used by sandbox + opencode helpers. */
export type ShellCommandResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

export type SandboxStopResult = ShellCommandResult;
