/**
 * OpenCode engine — wraps the managed `opencode serve` HTTP SDK client behind
 * the AgentEngine interface.
 *
 * Internal implementation (SDK client, pool, directory header) lives here so
 * business services never import `@opencode-ai/sdk` directly.
 */

import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import type {
  AgentEngine,
  AgentEngineCapabilities,
  EngineEvent,
  EngineEventCallback,
  ModelInfo,
  SessionDetail,
  SessionRef,
  SessionSummary,
  Unsubscribe,
} from "../types.js";
import { getWorkspaceOpencodeClient } from "./client-pool.js";
import { unwrapOpencodeResult } from "../../services/opencode-proxy.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const CAPABILITIES: AgentEngineCapabilities = {
  todo: true,
  mcp: true,
  skills: true,
  skillsLoad: true,
  approvals: "native",
  archive: "sqlite",
  multiSession: "server-multi",
  sessionList: { search: true, pagination: true, multiRoot: true },
  models: "engine-native",
};

export class OpenCodeEngine implements AgentEngine {
  readonly id = "opencode" as const;

  constructor(
    private readonly config: ServerConfig,
    private readonly workspace: WorkspaceInfo,
  ) {}

  getCapabilities(): AgentEngineCapabilities {
    return CAPABILITIES;
  }

  private client() {
    return getWorkspaceOpencodeClient(this.config, this.workspace);
  }

  async createSession(input: {
    title?: string;
    directory?: string;
    agentId?: string;
    model?: { providerID: string; modelID: string };
  }): Promise<SessionRef> {
    const client = this.client();
    const result = unwrapOpencodeResult(
      await client.session.create({
        title: input.title,
        directory: input.directory,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      }),
      "/session",
    );
    const created = asRecord(result);
    const sessionId = String(created.id ?? created.sessionID ?? "");
    if (!sessionId) {
      throw new Error("OpenCode session.create returned no session id");
    }
    return { id: sessionId, engine: "opencode" };
  }

  async listSessions(opts?: {
    directories?: string[];
    start?: number;
    limit?: number;
    search?: string;
  }): Promise<SessionSummary[]> {
    const client = this.client();
    const result = unwrapOpencodeResult(
      await client.session.list({
        // The OpenCode SDK treats roots as a boolean flag (all roots); the
        // AgentEngine directories array narrows to specific directories via
        // the workspace-scoped client (x-opencode-directory header).
        roots: opts?.directories && opts.directories.length > 0 ? true : undefined,
        ...(opts?.start != null ? { start: opts.start } : {}),
        ...(opts?.limit != null ? { limit: opts.limit } : {}),
        ...(opts?.search ? { search: opts.search } : {}),
      }),
      "/session",
    );
    return (Array.isArray(result) ? result : []).map((item) => {
      const record = asRecord(item);
      const time = asRecord(record.time);
      return {
        id: String(record.id ?? record.sessionID ?? ""),
        engine: "opencode" as const,
        title: typeof record.title === "string" ? record.title : undefined,
        createdAt:
          typeof time.created === "string"
            ? time.created
            : typeof record.createdAt === "string"
              ? record.createdAt
              : undefined,
        updatedAt:
          typeof time.updated === "string"
            ? time.updated
            : typeof record.updatedAt === "string"
              ? record.updatedAt
              : undefined,
        directory: typeof record.directory === "string" ? record.directory : undefined,
        model: typeof record.model === "string" ? record.model : undefined,
      };
    });
  }

  async getSession(id: string): Promise<SessionDetail> {
    const client = this.client();
    const result = unwrapOpencodeResult(
      await client.session.get({ sessionID: id }),
      `/session/${id}`,
    );
    return {
      id,
      engine: "opencode",
      title: typeof asRecord(result).title === "string" ? String(asRecord(result).title) : undefined,
      directory:
        typeof asRecord(result).directory === "string"
          ? String(asRecord(result).directory)
          : undefined,
    };
  }

  async deleteSession(id: string): Promise<void> {
    const client = this.client();
    await client.session.delete({ sessionID: id });
  }

  async sendMessage(
    sessionId: string,
    input: { prompt: string; tools?: string[]; model?: { providerID: string; modelID: string } },
  ): Promise<void> {
    const client = this.client();
    const body: Record<string, unknown> = { message: input.prompt };
    if (input.model) {
      body.model = input.model;
    }
    await client.session.prompt({ sessionID: sessionId }, body as never);
  }

  async abort(sessionId: string): Promise<void> {
    const client = this.client();
    await client.session.abort({ sessionID: sessionId });
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const client = this.client();
    const result = unwrapOpencodeResult(
      await client.session.messages({ sessionID: sessionId }),
      `/session/${sessionId}/messages`,
    );
    return Array.isArray(result) ? result : [];
  }

  async getTodo(sessionId: string): Promise<unknown[]> {
    const client = this.client();
    const result = unwrapOpencodeResult(
      await client.session.todo({ sessionID: sessionId }),
      `/session/${sessionId}/todo`,
    );
    return Array.isArray(result) ? result : [];
  }

  async listModels(): Promise<ModelInfo[]> {
    const client = this.client();
    try {
      const result = unwrapOpencodeResult(await client.provider.list(), "/provider");
      return (Array.isArray(result) ? result : []).map((item) => {
        const record = asRecord(item);
        return {
          id: String(record.id ?? ""),
          name: typeof record.name === "string" ? record.name : undefined,
          provider: typeof record.provider === "string" ? record.provider : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  async listMcpServers(): Promise<never[]> {
    const client = this.client();
    try {
      await unwrapOpencodeResult(await client.mcp.status(), "/mcp");
      return [];
    } catch {
      return [];
    }
  }

  async disconnectMcp(server: string): Promise<void> {
    const client = this.client();
    await client.mcp.disconnect({ name: server });
  }

  async listSkills(): Promise<never[]> {
    // OpenCode skills enumeration is exposed through the workspace REST
    // surface; keep the interface honest for now.
    return [];
  }

  onEvent(_cb: EngineEventCallback): Unsubscribe {
    // OpenCode events are consumed through the SDK session streams by the
    // server layer; the engine event bridge is added in P2 alongside pi.
    return () => {};
  }

  async approvePermission(_sessionId: string, _requestId: string, _allow: boolean): Promise<void> {
    // OpenCode permission replies are routed through the HTTP proxy
    // (/permission/:id/reply); see opencode-proxy.
  }
}

export { CAPABILITIES as OPENCODE_CAPABILITIES };
