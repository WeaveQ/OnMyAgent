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
