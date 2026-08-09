// Agent management desktop IPC wire types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

import type { PersonalLocalAgent } from "./desktop-ipc-local-agents.js";
import type { LocalSkillCard } from "./desktop-ipc-skills.js";

export type AgentManagementManagedProviderModel = {
  id: string;
  name: string;
  contextWindow?: number | string | null;
  outputTokenLimit?: number | string | null;
};

export type AgentManagementManagedProvider = {
  id: string;
  appType: "opencode" | "codex" | "claude" | "openclaw" | "hermes";
  name: string;
  settingsConfig: Record<string, unknown>;
  websiteUrl?: string | null;
  category?: string | null;
  createdAt?: number | null;
  sortIndex?: number | null;
  notes?: string | null;
  icon?: string | null;
  iconColor?: string | null;
  meta?: Record<string, unknown>;
  isCurrent: boolean;
  inFailoverQueue: boolean;
  costMultiplier?: string;
  providerType?: string | null;
  liveManaged: boolean;
  livePresent: boolean;
  configPath: string;
  models: AgentManagementManagedProviderModel[];
};

export type AgentManagementProvidersSnapshot = {
  databasePath: string;
  total: number;
  byAgent: Record<"opencode" | "codex" | "claude" | "openclaw" | "hermes", AgentManagementManagedProvider[]>;
};

export type AgentManagementUsageSummary = {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalDurationMs: number;
  lastRunAt: number | null;
  lastStatus: string | null;
};

/** Product columns plus catalog/custom fleet keys (e.g. workbuddy). */
export type AgentManagementSkillAgent =
  | "opencode"
  | "claude"
  | "openclaw"
  | "hermes"
  | "codex"
  | "gemini"
  | "onmyagent"
  | "unknown"
  | (string & {});

export type AgentManagementSkillSource = {
  agent: AgentManagementSkillAgent;
  label: string;
  scope: string;
  root: string;
  path: string;
  managedByStudioSwitch: boolean;
  kind?: "skill" | "runtime-skill" | "slash-command" | "plugin";
  pluginName?: string | null;
};

export type AgentManagementStudioSwitchSkill = {
  id?: string;
  name?: string;
  description?: string | null;
  directory: string;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  readmeUrl?: string | null;
  agents: AgentManagementSkillAgent[];
  installedAt?: number | null;
  contentHash?: string | null;
  updatedAt?: number | null;
};

export type AgentManagementSkill = LocalSkillCard & {
  agents: AgentManagementSkillAgent[];
  scopeLabel: string;
  sources: AgentManagementSkillSource[];
  managedByStudioSwitch: boolean;
  studioSwitch: AgentManagementStudioSwitchSkill | null;
  kind?: "skill" | "runtime-skill" | "slash-command" | "plugin";
  pluginName?: string | null;
  lastSeenAt?: number | null;
};

export type AgentManagementAgent = PersonalLocalAgent & {
  usage: AgentManagementUsageSummary;
  skillCount: number;
};

/** Selective snapshot domains for lazy management loads. */
export type AgentManagementSnapshotDomain = "core" | "skills" | "providers";

export type AgentManagementSnapshotInput = {
  workspaceRoot: string;
  /** When set, only these domains are loaded. Omit for full legacy snapshot. */
  domains?: AgentManagementSnapshotDomain[];
  /** Default false for domain-aware loads; true for full legacy snapshot. */
  includeModels?: boolean;
  includeDiscoverable?: boolean;
};

export type AgentManagementSnapshot = {
  generatedAt: number;
  workspaceRoot: string;
  agents: AgentManagementAgent[];
  skills: AgentManagementSkill[];
  providers: AgentManagementProvidersSnapshot;
  /** Domains actually populated in this response (partial loads omit others). */
  loadedDomains?: AgentManagementSnapshotDomain[];
};

export type AgentManagementProviderActionInput =
  | { action: "importLive"; appType: AgentManagementManagedProvider["appType"]; workspaceRoot?: string }
  | { action: "save"; appType: AgentManagementManagedProvider["appType"]; workspaceRoot?: string; syncLive?: boolean; provider: Omit<Partial<AgentManagementManagedProvider>, "settingsConfig"> & { settingsConfig?: Record<string, unknown> | string; simple?: Record<string, unknown> } }
  | { action: "delete" | "switch" | "syncLive"; appType: AgentManagementManagedProvider["appType"]; workspaceRoot?: string; providerId: string };

export type AgentManagementProviderActionResult = {
  ok: boolean;
  action: string;
  appType: AgentManagementManagedProvider["appType"];
  providerId?: string;
  /** Default model id chosen for this provider after save (OpenCode etc.). */
  defaultModelId?: string | null;
  /** Canonical default model ref applied after save. */
  defaultModel?: { providerID: string; modelID: string } | null;
  imported?: number;
  providers: AgentManagementProvidersSnapshot;
};

export type AgentManagementFetchedModel = {
  id: string;
  name: string;
  contextWindow?: number | string | null;
  outputTokenLimit?: number | string | null;
};

export type AgentManagementFetchModelsInput = {
  appType: AgentManagementManagedProvider["appType"];
  baseUrl: string;
  apiKey?: string;
};

export type AgentManagementFetchModelsResult = {
  ok: boolean;
  endpoint: string;
  models: AgentManagementFetchedModel[];
};

export type AgentManagementTestModelInput = {
  appType: AgentManagementManagedProvider["appType"];
  baseUrl: string;
  apiKey?: string;
  modelId: string;
};

export type AgentManagementTestModelResult = {
  ok: boolean;
  endpoint: string;
  modelId: string;
  elapsedMs: number;
};

export type AgentManagementSkillActionInput = {
  action: "enable" | "disable" | "import" | "open";
  agent: AgentManagementSkillAgent;
  directory: string;
  sourcePath?: string;
  displayName?: string;
  description?: string;
  kind?: "skill" | "runtime-skill" | "slash-command" | "plugin";
};

export type AgentManagementSkillActionResult = {
  ok: boolean;
  action?: string;
  agent?: AgentManagementSkillAgent;
  directory?: string;
  path?: string;
  result?: string;
};
