// Personal Local Agent host-status / connection / registry IPC types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

import type {
  PersonalLocalAgent,
  PersonalLocalAgentProvider,
  PersonalLocalAgentStatus,
} from "./desktop-ipc-local-agents.js";

export type PersonalLocalAgentHostStatusInput = {
  workspaceRoot: string;
  conversationId?: string | null;
  additionalSkillRoots?: string[];
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentHostStatusSkillEntry = {
  id: string;
  name: string;
  indexFile: string;
  source: string;
  provenance: "workspace";
};

export type PersonalLocalAgentHostStatusSkillRoot = {
  path: string;
  exists: boolean;
  count: number;
};

export type PersonalLocalAgentHostStatusMcpServer = {
  name: string;
  transport: string | null;
  connected: boolean;
  toolCount: number;
  source?: string;
  sourceFile?: string;
};

export type PersonalLocalAgentHostStatusPermissionItem = {
  id: string;
  state: "pending" | "approved" | "denied";
  summary: string;
  method: string;
  at: number | null;
};

export type PersonalLocalAgentHostStatusResult = {
  workspaceRoot: string;
  agentId: string | null;
  conversationId: string | null;
  skill: {
    skills: PersonalLocalAgentHostStatusSkillEntry[];
    roots: PersonalLocalAgentHostStatusSkillRoot[];
    error: string | null;
  };
  mcp: {
    servers: PersonalLocalAgentHostStatusMcpServer[];
    error: string | null;
    sourceErrors?: Array<{ file: string; message: string }>;
  };
  permission: {
    pending: number;
    approved: number;
    denied: number;
    remembered: number;
    items: PersonalLocalAgentHostStatusPermissionItem[];
  };
};

export type PersonalLocalAgentTestConnectionResult = {
  ok: boolean;
  status: PersonalLocalAgentStatus;
  step: "fail_cli" | "fail_acp" | "needs_auth" | "online" | string;
  error: string | null;
  capabilities: Record<string, unknown> | null;
  models: Array<{ id: string; label: string }>;
  configOptions: unknown[];
  checkedAt: number;
};

export type PersonalLocalAgentProviderHealthResult =
  PersonalLocalAgentTestConnectionResult & {
    healthy: boolean;
    reason: string | null;
  };

export type PersonalLocalAgentTestCustomAgentResult = {
  step: "success" | "fail_cli" | "fail_acp";
  error: string | null;
  durationMs: number;
};

export type UserAgentRegistryFile = {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
};

export type UserAgentRegistryWriteResult = {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
};
