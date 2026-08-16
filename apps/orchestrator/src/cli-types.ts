/**
 * Shared CLI types. Extracted from cli-shared.ts so leaf modules can import
 * types without pulling the compatibility barrel (avoids cycles).
 */
import type { ChildProcess } from "node:child_process";
import type { BinarySourcePreference } from "./cli-args.js";
import type { SidecarTarget } from "./sidecar-config.js";

export type ChildHandle = {
  name: string;
  child: ChildProcess;
};

export type SidecarName = "onmyagent-server" | "opencode-router" | "opencode";

export type RemoteSidecarAsset = {
  asset?: string;
  url?: string;
  sha256?: string;
  size?: number;
};

export type RemoteSidecarEntry = {
  version: string;
  targets: Record<string, RemoteSidecarAsset>;
};

export type RemoteSidecarManifest = {
  version: string;
  generatedAt?: string;
  entries: Record<string, RemoteSidecarEntry>;
};

export type BinarySource = "bundled" | "external" | "downloaded";

export type ResolvedBinary = {
  bin: string;
  source: BinarySource;
  expectedVersion?: string;
};

export type BinaryDiagnostics = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

export type RuntimeServiceName = "onmyagent-server" | "opencode" | "opencode-router";

export type RuntimeServiceSnapshot = {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  source?: BinarySource;
  path?: string;
  targetVersion?: string;
  actualVersion?: string;
  upgradeAvailable: boolean;
};

export type RuntimeUpgradeState = {
  status: "idle" | "running" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  operationId: string | null;
  services: RuntimeServiceName[];
};

export type SidecarDiagnostics = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

export type WorkerActivityHeartbeatConfig = {
  enabled: boolean;
  workerId: string;
  url: string;
  token: string;
  intervalMs: number;
  activeWindowMs: number;
};

export type RouterWorkspaceType = "local" | "remote";

export type RouterWorkspace = {
  id: string;
  name: string;
  path: string;
  workspaceType: RouterWorkspaceType;
  baseUrl?: string;
  directory?: string;
  createdAt: number;
  lastUsedAt?: number;
};

export type RouterDaemonState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

export type RouterOpencodeState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

export type RouterBinaryInfo = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

export type RouterBinaryState = {
  opencode?: RouterBinaryInfo;
};

export type RouterSidecarState = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

export type RouterState = {
  version: number;
  daemon?: RouterDaemonState;
  opencode?: RouterOpencodeState;
  cliVersion?: string;
  sidecar?: RouterSidecarState;
  binaries?: RouterBinaryState;
  activeId: string;
  workspaces: RouterWorkspace[];
};

export type OpencodeStateLayout = {
  devMode: boolean;
  rootDir: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  importConfigDir?: string;
  importDataDir?: string;
};

export type FieldsResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};
