import type {
  ArtifactPluginManifest,
  ArtifactPluginRuntimeConfig,
} from "./artifact-plugin.js";

export type WorkspaceType = "local" | "remote";

export type RemoteType = "opencode" | "onmyagent";

export type ApprovalMode = "manual" | "auto";

export type TokenScope = "owner" | "collaborator" | "viewer";

export type SandboxBackend = "none" | "docker" | "container";

export type ProviderPlacement = "in-sandbox" | "host-machine" | "client-machine" | "external";

export type LogFormat = "pretty" | "json";

export interface WorkspaceConfig {
  id?: string;
  path: string;
  name?: string;
  preset?: string;
  workspaceType?: WorkspaceType;
  remoteType?: RemoteType;
  baseUrl?: string;
  directory?: string;
  displayName?: string;
  onmyagentHostUrl?: string;
  onmyagentToken?: string;
  onmyagentWorkspaceId?: string;
  onmyagentWorkspaceName?: string;
  sandboxBackend?: string;
  sandboxRunId?: string;
  sandboxContainerName?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  preset: string;
  workspaceType: WorkspaceType;
  remoteType?: RemoteType;
  baseUrl?: string;
  directory?: string;
  displayName?: string;
  onmyagentHostUrl?: string;
  onmyagentToken?: string;
  onmyagentWorkspaceId?: string;
  onmyagentWorkspaceName?: string;
  sandboxBackend?: string;
  sandboxRunId?: string;
  sandboxContainerName?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  opencode?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  };
}

export interface OpencodeConfigFile {
  path: string;
  exists: boolean;
  content: string | null;
}

export interface ApprovalConfig {
  mode: ApprovalMode;
  timeoutMs: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  token: string;
  hostToken: string;
  configPath?: string;
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  approval: ApprovalConfig;
  corsOrigins: string[];
  workspaces: WorkspaceInfo[];
  authorizedRoots: string[];
  readOnly: boolean;
  startedAt: number;
  tokenSource: "cli" | "env" | "file" | "generated";
  hostTokenSource: "cli" | "env" | "file" | "generated";
  logFormat: LogFormat;
  logRequests: boolean;
}

export interface Capabilities {
  schemaVersion: number;
  serverVersion: string;
  opencodeVersion: string;
  skills: { read: boolean; write: boolean; source: "onmyagent" | "opencode" };
  hub: {
    skills: {
      read: boolean;
      install: boolean;
      repo: { owner: string; name: string; ref: string };
    };
  };
  plugins: { read: boolean; write: boolean };
  mcp: { read: boolean; write: boolean };
  commands: { read: boolean; write: boolean };
  config: { read: boolean; write: boolean };

  approvals: { mode: ApprovalMode; timeoutMs: number };
  sandbox: { enabled: boolean; backend: SandboxBackend };
  ui: { toy: boolean };
  tokens: { scoped: boolean; scopes: TokenScope[] };
  proxy: {
    opencode: boolean;
  };
  toolProviders: {
    browser: {
      enabled: boolean;
      placement: ProviderPlacement;
      mode: "none" | "headless" | "interactive";
    };
    files: {
      injection: boolean;
      outbox: boolean;
      inboxPath: string;
      outboxPath: string;
      maxBytes: number;
    };
  };
}

export type ReloadReason = "plugins" | "skills" | "mcp" | "config" | "agents" | "commands";

export type ReloadTrigger = {
  type: "skill" | "plugin" | "config" | "mcp" | "agent" | "command";
  name?: string;
  action?: "added" | "removed" | "updated";
  path?: string;
};

export interface ReloadEvent {
  id: string;
  seq: number;
  workspaceId: string;
  reason: ReloadReason;
  trigger?: ReloadTrigger;
  timestamp: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface PluginItem {
  spec: string;
  source: "config" | "dir.project" | "dir.global";
  scope: "project" | "global";
  path?: string;
}

export interface ArtifactPluginSkillItem {
  id: string;
  enabled: boolean;
  defaultEnabled: boolean;
}

export interface ArtifactPluginCatalogItem {
  id: string;
  manifest: ArtifactPluginManifest;
  runtime: ArtifactPluginRuntimeConfig;
  enabled: boolean;
  skills: ArtifactPluginSkillItem[];
}

export interface McpItem {
  name: string;
  config: Record<string, unknown>;
  source: "config.project" | "config.global" | "config.remote";
  disabledByTools?: boolean;
}

export interface SkillItem {
  name: string;
  path: string;
  description: string;
  scope: "project" | "global" | "built-in" | "onmyagent" | "local";
  trigger?: string;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
}

export interface HubSkillItem {
  name: string;
  description: string;
  trigger?: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  };
}

export interface CommandItem {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string | null;
  subtask?: boolean;
  scope: "workspace" | "global";
}

export type AutomationScene = "office" | "code";
export type AutomationFrequencyMode = "weekly" | "interval" | "once";
export type AutomationCycle = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
export type AutomationAccessMode = "default" | "full";
export type AutomationRunSource = "scheduled" | "manual";
export type AutomationRunStatus = "success" | "failed" | "skipped";

export interface AutomationModelRef {
  providerID: string;
  modelID: string;
}

export interface AutomationAgentSelection {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: Record<string, boolean>;
  model?: AutomationModelRef;
}

export interface AutomationSchedule {
  mode: AutomationFrequencyMode;
  day: AutomationCycle;
  time: string;
  intervalMinutes?: number;
  weekdays?: number[];
  onceAt?: number;
  timezone?: string;
}

export interface AutomationEffectiveRange {
  startDate?: string;
  endDate?: string;
}

export interface AutomationRunSummary {
  status: AutomationRunStatus;
  source: AutomationRunSource;
  ranAt: number;
  sessionId?: string;
  groupName?: string;
  outputDirectory?: string;
  error?: string;
}

export interface AutomationRunLease {
  leaseId: string;
  startedAt: number;
  expiresAt: number;
  attempt: number;
  scheduledForAt: number;
  sessionId?: string;
  groupName?: string;
  outputDirectory?: string;
}

export interface AutomationTaskItem {
  id: string;
  scene: AutomationScene;
  title: string;
  prompt: string;
  workspaceDirectory?: string;
  model?: AutomationModelRef;
  agent?: AutomationAgentSelection;
  accessMode?: AutomationAccessMode;
  schedule: AutomationSchedule;
  effectiveRange: AutomationEffectiveRange;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  running: AutomationRunLease | null;
  lastRun: AutomationRunSummary | null;
  runs: AutomationRunSummary[];
}

export interface AutomationTaskInput {
  scene: AutomationScene;
  title: string;
  prompt: string;
  workspaceDirectory?: string | null;
  model?: AutomationModelRef | null;
  agent?: AutomationAgentSelection | null;
  accessMode?: AutomationAccessMode | null;
  schedule: AutomationSchedule;
  effectiveRange?: AutomationEffectiveRange;
  enabled?: boolean;
}

export interface AutomationRunHistoryResult {
  item: AutomationTaskItem;
  runs: AutomationRunSummary[];
  total: number;
}

export interface Actor {
  type: "remote" | "host";
  clientId?: string;
  tokenHash?: string;
  scope?: TokenScope;
}

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  action: string;
  summary: string;
  paths: string[];
  createdAt: number;
  actor: Actor;
}

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actor: Actor;
  action: string;
  target: string;
  summary: string;
  timestamp: number;
}

export interface SkillContentResponse {
  item: SkillItem;
  content: string;
}

export interface WorkspaceFileContentResponse {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
}

export interface WorkspaceFileWriteResponse {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
  revision?: string;
}

export interface WorkspaceExportResponse {
  workspaceId: string;
  exportedAt: number;
  opencode?: Record<string, unknown>;
  onmyagent?: Record<string, unknown>;
  skills?: Array<{ name: string; description?: string; trigger?: string; content: string }>;
  commands?: Array<{ name: string; description?: string; template?: string }>;
  files?: Array<{ path: string; content: string }>;
}

export interface WorkspaceImportChange {
  kind: "opencode" | "onmyagent" | "skill" | "command" | "file";
  action: "create" | "update" | "replace" | "delete" | "unchanged";
  label: string;
  path: string;
}

export interface WorkspaceImportPreviewResponse {
  fingerprint: string;
  summary: {
    total: number;
    create: number;
    update: number;
    replace: number;
    delete: number;
    unchanged: number;
  };
  changes: WorkspaceImportChange[];
}

export interface ArtifactItem {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  createdAt?: number;
  updatedAt?: number;
  mime?: string;
}

export interface ArtifactListResponse {
  items: ArtifactItem[];
}

export interface ResolvedArtifactTarget {
  id: string;
  kind: "file" | "url";
  value: string;
  name: string;
  preview: "browser" | "markdown" | "sheet" | "image" | "pdf" | "html" | "text" | "external";
  confidence: number;
  reason: string;
  exists?: boolean;
  size?: number;
  updatedAt?: number;
  contentType?: string;
}

export interface WorkspaceFileStatResponse {
  ok: boolean;
  path: string;
  exists: boolean;
  kind?: "file" | "dir" | "other";
  size?: number;
  updatedAt?: number;
}

export interface WorkspaceFileCatalogEntry {
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  revision: string;
}

export interface WorkspaceFileCatalogResponse {
  items: WorkspaceFileCatalogEntry[];
  total: number;
  truncated: boolean;
  generatedAt: number;
}

export interface InboxItem {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  updatedAt?: number;
}

export interface InboxListResponse {
  items: InboxItem[];
}

export interface InboxUploadResponse {
  ok: boolean;
  path: string;
  bytes: number;
}

/** GET /health */
export interface ServerHealthResponse {
  ok: boolean;
  version: string;
  uptimeMs: number;
}

/** Renderer-facing capabilities slice (subset of Capabilities used by the HTTP client). */
export interface ServerClientCapabilities {
  skills: { read: boolean; write: boolean; source: "onmyagent" | "opencode" };
  hub?: {
    skills?: {
      read: boolean;
      install: boolean;
      repo?: { owner: string; name: string; ref: string };
    };
  };
  plugins: { read: boolean; write: boolean };
  mcp: { read: boolean; write: boolean };
  commands: { read: boolean; write: boolean };
  config: { read: boolean; write: boolean };
  sandbox?: { enabled: boolean; backend: SandboxBackend };
  proxy?: { opencode: boolean };
  toolProviders?: {
    browser?: {
      enabled: boolean;
      placement: ProviderPlacement;
      mode: "none" | "headless" | "interactive";
    };
    files?: {
      injection: boolean;
      outbox: boolean;
      inboxPath: string;
      outboxPath: string;
      maxBytes: number;
    };
  };
}

/** GET /status diagnostics payload. */
export interface ServerStatusResponse {
  ok: boolean;
  version: string;
  uptimeMs: number;
  readOnly: boolean;
  approval: { mode: ApprovalMode; timeoutMs: number };
  corsOrigins: string[];
  workspaceCount: number;
  activeWorkspaceId?: string | null;
  selectedWorkspaceId?: string | null;
  workspace: WorkspaceInfo | null;
  authorizedRoots: string[];
  server: { host: string; port: number; configPath?: string | null };
  tokenSource: { client: string; host: string };
}

export type RuntimeServiceName = "onmyagent-server" | "opencode";

export interface RuntimeServiceSnapshot {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  targetVersion: string | null;
  actualVersion: string | null;
  upgradeAvailable: boolean;
}

/** GET /runtime/versions */
export interface RuntimeVersionsResponse {
  ok: boolean;
  orchestrator?: {
    version: string;
    startedAt: number;
  };
  worker?: {
    workspace: string;
    sandboxMode: string;
  };
  upgrade?: {
    status: "idle" | "running" | "failed";
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
    operationId: string | null;
    services: RuntimeServiceName[];
  };
  services: RuntimeServiceSnapshot[];
}
