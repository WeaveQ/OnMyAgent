/**
 * Agent engine abstraction — the runtime behind office sessions.
 *
 * OnMyAgent currently ships two engines:
 *  - "opencode": managed `opencode serve` (HTTP SDK client, multi-session server)
 *  - "pi": managed `pi --mode rpc` (JSONL over stdio, one process per session)
 *
 * Business services (workspace-sessions, automation-runner, …) must depend on
 * `getEngine(config, workspace)` and never import engine-specific SDKs
 * directly (except inside `engines/<engine>/`).
 */

import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { normalizeAgentEngine } from "./agent-engine-policy.js";

export type EngineId = "opencode" | "pi";

export interface AgentEngineCapabilities {
  /** Engine provides a native todo list (`session.todo` equivalent). */
  todo: boolean;
  /** Engine exposes MCP server management. */
  mcp: boolean;
  /** Engine exposes a runtime skill list/management API. */
  skills: boolean;
  /** Engine can load OnMyAgent-materialized skills at spawn time. */
  skillsLoad: boolean;
  /** Approval flow: native permission replies | OnMyAgent-side bridge | none. */
  approvals: "native" | "bridge" | "none";
  /** Archive read format. */
  archive: "sqlite" | "jsonl";
  /** Concurrency model. */
  multiSession:
    | "server-multi"
    | "process-per-session"
    | "process-per-workspace-serial";
  /** Session list query capabilities (UI may hide unsupported affordances). */
  sessionList: { search: boolean; pagination: boolean; multiRoot: boolean };
  /** How models are provided to this engine. */
  models: "engine-native" | "mapped-from-host" | "env-only";
}

export interface SessionRef {
  id: string;
  engine: EngineId;
}

export interface SessionSummary {
  id: string;
  engine: EngineId;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  directory?: string;
  model?: string;
}

export interface SessionDetail extends SessionSummary {
  messages?: unknown[];
  error?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
}

export interface McpServerInfo {
  name: string;
  enabled: boolean;
  error?: string;
}

export interface SkillInfo {
  name: string;
  description?: string;
  enabled?: boolean;
}

/**
 * Unified engine events — translated by each engine adapter and streamed to
 * workspace SSE, then mapped to UI timeline by the app (see P1.5).
 */
export type EngineEvent =
  | { type: "session_status"; sessionId: string; status: "idle" | "busy" | "error"; message?: string }
  | { type: "message_delta"; sessionId: string; role: "assistant" | "user" | "tool"; text?: string; parts?: unknown[] }
  | { type: "tool_start" | "tool_update" | "tool_end"; sessionId: string; toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean }
  | { type: "usage"; sessionId: string; inputTokens?: number; outputTokens?: number }
  | { type: "permission_request"; sessionId: string; requestId: string; permission: unknown }
  | { type: "error"; sessionId?: string; code: string; message: string };

export type EngineEventCallback = (event: EngineEvent) => void;
export type Unsubscribe = () => void;

export interface AgentEngine {
  readonly id: EngineId;
  getCapabilities(): AgentEngineCapabilities;

  /** Pending permission requests (only when capabilities.approvals === "bridge"). */
  listPermissions?(sessionId?: string): Promise<unknown[]>;
  /** Engine lifecycle hooks (opencode: spawn/stop managed server; pi: no-op). */
  start?(workspace: WorkspaceInfo): Promise<void>;
  stop?(workspace: WorkspaceInfo): Promise<void>;
  reload?(workspace: WorkspaceInfo): Promise<void>;

  createSession(input: {
    title?: string;
    directory?: string;
    agentId?: string;
    model?: { providerID: string; modelID: string };
  }): Promise<SessionRef>;

  listSessions(opts?: {
    directories?: string[];
    start?: number;
    limit?: number;
    search?: string;
  }): Promise<SessionSummary[]>;

  getSession(id: string): Promise<SessionDetail>;
  deleteSession(id: string): Promise<void>;

  sendMessage(
    sessionId: string,
    input: {
      prompt: string;
      tools?: string[];
      model?: { providerID: string; modelID: string };
    },
  ): Promise<void>;
  abort(sessionId: string): Promise<void>;
  getMessages(sessionId: string): Promise<unknown[]>;
  /** Engine todo list; call only when capabilities.todo is true. */
  getTodo?(sessionId: string): Promise<unknown[]>;

  listModels?(): Promise<ModelInfo[]>;
  listMcpServers?(sessionId: string): Promise<McpServerInfo[]>;
  disconnectMcp?(sessionId: string, server: string): Promise<void>;
  listSkills?(sessionId: string): Promise<SkillInfo[]>;

  /** Subscribe to engine events (per-workspace stream). */
  onEvent(cb: EngineEventCallback): Unsubscribe;

  /** Reply to a permission request; no-op/throws when approvals === "none". */
  approvePermission(sessionId: string, requestId: string, allow: boolean): Promise<void>;
}

/** Engine factory — each engine owns its workspace-scoped instance(s). */
export type AgentEngineFactory = (
  config: ServerConfig,
  workspace: WorkspaceInfo,
) => AgentEngine;

/** Resolve which engine a workspace uses. */
export function resolveEngineId(config: ServerConfig, workspace: WorkspaceInfo): EngineId {
  return normalizeAgentEngine(workspace.agentEngine ?? config.agentEngine);
}
