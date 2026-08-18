import type {
  AgentRuntimeCapabilities,
  AgentRuntimeCommand,
  AgentRuntimeHealthSnapshot,
  AgentRuntimeMessage,
  AgentRuntimeModelCatalog,
  AgentRuntimePromptInput,
  AgentRuntimeSession,
  RuntimeSessionBinding,
} from "@onmyagent/types/agent-runtime";
import type { ServerConfig } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { getWorkspaceOpencodeClient } from "./opencode-client-pool.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import { unwrapOpencodeResult } from "./opencode-proxy.js";
import type { PrimaryOpencodeHostIdentity } from "./primary-runtime-host-state.js";
import type {
  AgentRuntimeAdapter,
  RuntimeAdapterCreatedSession,
  RuntimeAdapterSessionInput,
} from "./primary-runtime-registry.js";
import { ensureAndAssertExpertRuntimeContract } from "./expert-runtime-contract.js";
import { buildSessionMessages } from "./session-read-model.js";

type NativeSession = {
  id?: unknown;
  title?: unknown;
  time?: { created?: unknown; updated?: unknown };
};

type CompiledOpenCodeSessionProfile = {
  cwd?: string;
  cleanup?: () => void | Promise<void>;
  bindRuntimeIdentity?: (runtimeSessionId: string) => void | Promise<void>;
};

const OPENCODE_CAPABILITIES: AgentRuntimeCapabilities = {
  protocolVersion: "opencode-sdk-v2",
  features: [
    "session.create",
    "session.list",
    "session.load",
    "session.delete",
    "session.rename",
    "session.fork",
    "turn.prompt",
    "turn.cancel",
    "event.subscribe",
    "permission.respond",
    "config.set_model",
    "history.read",
    "usage.read",
    "command.list",
    "command.execute",
  ],
};

export class OpenCodeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtimeKind = "opencode" as const;
  readonly #config: ServerConfig;
  readonly #identity: PrimaryOpencodeHostIdentity;
  readonly #client: typeof getWorkspaceOpencodeClient;
  readonly #onNativeEvent: (value: unknown) => void;
  readonly #compileSessionProfile: (
    input: RuntimeAdapterSessionInput,
  ) => CompiledOpenCodeSessionProfile | Promise<CompiledOpenCodeSessionProfile>;
  readonly #cleanupSession: (binding: RuntimeSessionBinding) => void | Promise<void>;
  readonly #eventStreams = new Map<string, {
    controller: AbortController;
    ready: Promise<void>;
  }>();

  constructor(input: {
    config: ServerConfig;
    identity: PrimaryOpencodeHostIdentity;
    getClient?: typeof getWorkspaceOpencodeClient;
    onNativeEvent?: (value: unknown) => void;
    compileSessionProfile?: (
      input: RuntimeAdapterSessionInput,
    ) => CompiledOpenCodeSessionProfile | Promise<CompiledOpenCodeSessionProfile>;
    cleanupSession?: (binding: RuntimeSessionBinding) => void | Promise<void>;
  }) {
    this.#config = input.config;
    this.#identity = input.identity;
    this.#client = input.getClient ?? getWorkspaceOpencodeClient;
    this.#onNativeEvent = input.onNativeEvent ?? (() => undefined);
    this.#compileSessionProfile = input.compileSessionProfile ?? (() => ({}));
    this.#cleanupSession = input.cleanupSession ?? (() => undefined);
  }

  async probeCapabilities(): Promise<{
    health: AgentRuntimeHealthSnapshot;
    capabilities?: AgentRuntimeCapabilities;
  }> {
    const available = this.#config.workspaces.some((workspace) =>
      Boolean(resolveWorkspaceOpencodeConnection(this.#config, workspace).baseUrl));
    const health: AgentRuntimeHealthSnapshot = available
      ? {
          runtimeKind: this.runtimeKind,
          health: "ready",
          checkedAt: Date.now(),
          capabilities: OPENCODE_CAPABILITIES,
        }
      : {
          runtimeKind: this.runtimeKind,
          health: "missing",
          checkedAt: Date.now(),
          error: {
            code: "opencode_runtime_unavailable",
            message: "OpenCode runtime is not configured",
            retriable: true,
          },
        };
    return available
      ? { health, capabilities: OPENCODE_CAPABILITIES }
      : { health };
  }

  async getModelCatalog(input: RuntimeAdapterSessionInput): Promise<AgentRuntimeModelCatalog> {
    const client = this.#client(this.#config, input.workspace);
    const raw = unwrapOpencodeResult(
      await client.provider.list({ directory: input.workspace.path }),
      "/provider",
    ) as { all?: unknown[]; connected?: unknown[]; default?: Record<string, unknown> };
    const connected = new Set((raw.connected ?? []).filter((id): id is string => typeof id === "string"));
    const models = (raw.all ?? []).flatMap((provider) => {
      if (!provider || typeof provider !== "object") return [];
      const value = provider as { id?: unknown; models?: unknown };
      if (typeof value.id !== "string" || !connected.has(value.id) || !value.models || typeof value.models !== "object") return [];
      return Object.entries(value.models as Record<string, unknown>).flatMap(([modelId, model]) => {
        const info = model && typeof model === "object" ? model as Record<string, unknown> : {};
        return [{
          ref: { providerId: value.id as string, modelId },
          displayName: typeof info.name === "string" && info.name.trim() ? info.name : modelId,
          available: true,
          capabilities: { text: true, imageInput: true, tools: true, reasoning: true },
        }];
      });
    });
    return {
      runtimeKind: this.runtimeKind,
      profileId: input.profileId,
      workspaceId: input.workspace.id,
      models,
      auth: { state: connected.size ? "ready" : "needs_auth", methods: [] },
      complete: true,
    };
  }

  async createSession(
    input: RuntimeAdapterSessionInput,
  ): Promise<RuntimeAdapterCreatedSession> {
    assertOpenCodeModelRef(input.modelRef);
    const compiled = await this.#compileSessionProfile(input);
    const cwd = compiled.cwd?.trim() || input.cwd?.trim() || input.workspace.path;
    const client = this.#client(this.#config, input.workspace, cwd);
    let native: NativeSession;
    let runtimeSessionId: string | null = null;
    try {
      native = asNativeSession(
        unwrapOpencodeResult(
          await client.session.create({ directory: cwd }),
          "/session",
        ),
      );
      runtimeSessionId = requireSessionId(native.id);
      await compiled.bindRuntimeIdentity?.(runtimeSessionId);
    } catch (error) {
      if (runtimeSessionId) {
        await client.session.delete({ sessionID: runtimeSessionId }).catch(() => undefined);
      }
      await compiled.cleanup?.();
      throw error;
    }
    if (!runtimeSessionId) {
      await compiled.cleanup?.();
      throw new ApiError(502, "agent_runtime_session_create_failed", "OpenCode did not return a session id");
    }
    return {
      runtimeSessionId,
      cwd,
      runtimeHome: this.#identity.runtimeHome,
      profileId: this.#identity.profileId,
      ...(this.#identity.sandboxProfile
        ? { sandboxProfile: this.#identity.sandboxProfile }
        : {}),
      ...(input.modelRef ? { modelRef: input.modelRef } : {}),
      session: sessionFromNative({
        native,
        productSessionId: input.productSessionId,
        runtimeSessionId,
        workspaceId: input.workspace.id,
        cwd,
        identity: this.#identity,
        modelRef: input.modelRef,
      }),
    };
  }

  async getSession(binding: RuntimeSessionBinding): Promise<AgentRuntimeSession> {
    await this.#ensureEventStream(binding);
    const workspace = this.#config.workspaces.find(
      (item) => item.id === binding.workspaceId,
    );
    if (!workspace) {
      throw new ApiError(404, "workspace_not_found", "Workspace not found");
    }
    const client = this.#client(
      this.#config,
      workspace,
      binding.cwd,
    );
    const native = asNativeSession(
      unwrapOpencodeResult(
        await client.session.get({ sessionID: binding.runtimeSessionId }),
        `/session/${encodeURIComponent(binding.runtimeSessionId)}`,
      ),
    );
    return sessionFromNative({
      native,
      productSessionId: binding.productSessionId,
      runtimeSessionId: binding.runtimeSessionId,
      workspaceId: binding.workspaceId,
      cwd: binding.cwd,
      identity: {
        profileId: binding.profileId,
        runtimeHome: binding.runtimeHome,
        ...(binding.sandboxProfile
          ? { sandboxProfile: binding.sandboxProfile }
          : {}),
      },
      modelRef: binding.modelRef,
      fallbackCreatedAt: binding.createdAt,
    });
  }

  async refreshSessions(bindings: readonly RuntimeSessionBinding[]): Promise<{
    sessions: AgentRuntimeSession[];
    missingRuntimeSessionIds: string[];
    failedRuntimeSessionIds: string[];
    complete: boolean;
  }> {
    const sessions: AgentRuntimeSession[] = [];
    const missingRuntimeSessionIds: string[] = [];
    const failedRuntimeSessionIds: string[] = [];
    const byDirectory = new Map<string, RuntimeSessionBinding[]>();
    for (const binding of bindings) {
      const group = byDirectory.get(binding.cwd) ?? [];
      group.push(binding);
      byDirectory.set(binding.cwd, group);
    }
    await Promise.all([...byDirectory].map(async ([directory, group]) => {
      try {
        const client = this.#clientForBinding(group[0]!);
        const raw = unwrapOpencodeResult(
          await client.session.list({ directory, roots: true, limit: 1_001 }),
          "/session",
        );
        const nativeSessions = Array.isArray(raw) ? raw : [];
        if (nativeSessions.length > 1_000) {
          failedRuntimeSessionIds.push(...group.map((binding) => binding.runtimeSessionId));
          return;
        }
        const byId = new Map(nativeSessions.slice(0, 1_000).flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const native = entry as NativeSession;
          const id = typeof native.id === "string" ? native.id.trim() : "";
          return id ? [[id, native] as const] : [];
        }));
        for (const binding of group) {
          const native = byId.get(binding.runtimeSessionId);
          if (!native) {
            missingRuntimeSessionIds.push(binding.runtimeSessionId);
            continue;
          }
          sessions.push(sessionFromNative({
            native,
            productSessionId: binding.productSessionId,
            runtimeSessionId: binding.runtimeSessionId,
            workspaceId: binding.workspaceId,
            cwd: binding.cwd,
            identity: {
              profileId: binding.profileId,
              runtimeHome: binding.runtimeHome,
              ...(binding.sandboxProfile ? { sandboxProfile: binding.sandboxProfile } : {}),
            },
            modelRef: binding.modelRef,
            fallbackCreatedAt: binding.createdAt,
          }));
        }
      } catch {
        failedRuntimeSessionIds.push(...group.map((binding) => binding.runtimeSessionId));
      }
    }));
    return {
      sessions,
      missingRuntimeSessionIds,
      failedRuntimeSessionIds,
      complete: failedRuntimeSessionIds.length === 0,
    };
  }

  async readMessages(binding: RuntimeSessionBinding): Promise<{
    messages: AgentRuntimeMessage[];
    complete: boolean;
  }> {
    const client = this.#clientForBinding(binding);
    const nativeMessages = buildSessionMessages(unwrapOpencodeResult(
      await client.session.messages({
        sessionID: binding.runtimeSessionId,
        directory: binding.cwd,
        limit: 1_000,
      }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}/message`,
    ));
    const messages = nativeMessages.flatMap((message) => {
      const role = normalizeMessageRole(message.info.role);
      if (!role) return [];
      const parts = message.parts.map((part, index) => {
        const value = part as Record<string, unknown>;
        const id = part.id?.trim() || `${message.info.id}-part-${index}`;
        if (value.type === "text" && typeof value.text === "string") {
          return { type: "text" as const, id, text: value.text };
        }
        if (value.type === "reasoning" && typeof value.text === "string") {
          return { type: "reasoning" as const, id, text: value.text };
        }
        return {
          type: "unknown" as const,
          id,
          nativeType: typeof value.type === "string" && value.type.trim()
            ? value.type.trim()
            : "unknown",
        };
      });
      return [{
        id: message.info.id,
        productSessionId: binding.productSessionId,
        role,
        parts,
        ...(message.info.parentID ? { parentMessageId: message.info.parentID } : {}),
        createdAt: message.info.time?.created ?? binding.createdAt,
        ...(message.info.time?.completed
          ? { completedAt: message.info.time.completed }
          : {}),
      }];
    });
    return { messages, complete: nativeMessages.length < 1_000 };
  }

  async deleteSession(binding: RuntimeSessionBinding): Promise<void> {
    const workspace = this.#config.workspaces.find(
      (item) => item.id === binding.workspaceId,
    );
    if (!workspace) {
      throw new ApiError(404, "workspace_not_found", "Workspace not found");
    }
    const client = this.#client(
      this.#config,
      workspace,
      binding.cwd,
    );
    unwrapOpencodeResult(
      await client.session.delete({ sessionID: binding.runtimeSessionId }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}`,
    );
    await this.#cleanupSession(binding);
  }

  async renameSession(binding: RuntimeSessionBinding, title: string): Promise<void> {
    const client = this.#clientForBinding(binding);
    unwrapOpencodeResult(
      await client.session.update({
        sessionID: binding.runtimeSessionId,
        directory: binding.cwd,
        title,
      }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}`,
    );
  }

  async forkSession(
    binding: RuntimeSessionBinding,
    newProductSessionId: string,
  ): Promise<RuntimeAdapterCreatedSession> {
    const client = this.#clientForBinding(binding);
    const native = asNativeSession(unwrapOpencodeResult(
      await client.session.fork({
        sessionID: binding.runtimeSessionId,
        directory: binding.cwd,
      }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}/fork`,
    ));
    const runtimeSessionId = requireSessionId(native.id);
    return {
      runtimeSessionId,
      cwd: binding.cwd,
      runtimeHome: binding.runtimeHome,
      profileId: binding.profileId,
      ...(binding.sandboxProfile ? { sandboxProfile: binding.sandboxProfile } : {}),
      ...(binding.modelRef ? { modelRef: binding.modelRef } : {}),
      session: sessionFromNative({
        native,
        productSessionId: newProductSessionId,
        runtimeSessionId,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        identity: {
          profileId: binding.profileId,
          runtimeHome: binding.runtimeHome,
          ...(binding.sandboxProfile ? { sandboxProfile: binding.sandboxProfile } : {}),
        },
        modelRef: binding.modelRef,
        fallbackCreatedAt: Date.now(),
      }),
    };
  }

  async prompt(
    binding: RuntimeSessionBinding,
    input: AgentRuntimePromptInput,
  ): Promise<{ turnId?: string }> {
    await this.#assertExpertContract(binding, input.text);
    await this.#ensureEventStream(binding);
    const client = this.#clientForBinding(binding);
    unwrapOpencodeResult(
      await client.session.promptAsync({
        sessionID: binding.runtimeSessionId,
        directory: binding.cwd,
        ...(binding.modelRef?.providerId && binding.modelRef.modelId
          ? {
              model: {
                providerID: binding.modelRef.providerId,
                modelID: binding.modelRef.modelId,
              },
            }
          : {}),
        ...(binding.modelRef?.variant
          ? { variant: binding.modelRef.variant }
          : {}),
        parts: toOpencodePromptParts(input),
        ...(input.messageId ? { messageID: input.messageId } : {}),
        ...(input.agentId ? { agent: input.agentId } : {}),
        ...(input.toolAccess ? { tools: input.toolAccess } : {}),
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
      }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}/prompt`,
    );
    return {};
  }

  async listCommands(binding: RuntimeSessionBinding): Promise<{
    items: AgentRuntimeCommand[];
    complete: boolean;
  }> {
    const client = this.#clientForBinding(binding);
    const raw = unwrapOpencodeResult(
      await client.command.list({ directory: binding.cwd }),
      "/command",
    );
    const list = Array.isArray(raw) ? raw : [];
    return {
      items: list.slice(0, 256).flatMap((entry, index) => {
        const value = entry && typeof entry === "object"
          ? entry as Record<string, unknown>
          : {};
        const name = typeof value.name === "string" ? value.name.trim() : "";
        if (!name) return [];
        const source = value.source === "skill" ? "skill" : "command";
        return [{
          id: `opencode:${source}:${name || index}`,
          name,
          ...(typeof value.description === "string" && value.description.trim()
            ? { description: value.description.trim() }
            : {}),
          source,
        } satisfies AgentRuntimeCommand];
      }),
      complete: list.length <= 256,
    };
  }

  async executeCommand(
    binding: RuntimeSessionBinding,
    name: string,
    input: { arguments?: string },
  ): Promise<{ turnId?: string }> {
    await this.#assertExpertContract(
      binding,
      `/${name}${input.arguments ? ` ${input.arguments}` : ""}`,
    );
    await this.#ensureEventStream(binding);
    const client = this.#clientForBinding(binding);
    unwrapOpencodeResult(
      await client.session.command({
        sessionID: binding.runtimeSessionId,
        directory: binding.cwd,
        command: name,
        arguments: input.arguments ?? "",
        ...(binding.modelRef?.providerId && binding.modelRef.modelId
          ? { model: `${binding.modelRef.providerId}/${binding.modelRef.modelId}` }
          : {}),
        ...(binding.modelRef?.variant ? { variant: binding.modelRef.variant } : {}),
      }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}/command`,
    );
    return {};
  }

  async cancel(binding: RuntimeSessionBinding): Promise<void> {
    const client = this.#clientForBinding(binding);
    unwrapOpencodeResult(
      await client.session.abort({
        sessionID: binding.runtimeSessionId,
        directory: binding.cwd,
      }),
      `/session/${encodeURIComponent(binding.runtimeSessionId)}/abort`,
    );
  }

  async setModel(
    _binding: RuntimeSessionBinding,
    modelRef: NonNullable<RuntimeSessionBinding["modelRef"]>,
  ): Promise<void> {
    assertOpenCodeModelRef(modelRef);
    // OpenCode's canonical path applies the bound model on each prompt.
  }

  async stop(): Promise<void> {
    for (const stream of this.#eventStreams.values()) stream.controller.abort();
    await Promise.allSettled([...this.#eventStreams.values()].map((stream) => stream.ready));
    this.#eventStreams.clear();
  }

  #clientForBinding(binding: RuntimeSessionBinding) {
    const workspace = this.#config.workspaces.find(
      (item) => item.id === binding.workspaceId,
    );
    if (!workspace) {
      throw new ApiError(404, "workspace_not_found", "Workspace not found");
    }
    return this.#client(this.#config, workspace, binding.cwd);
  }

  #ensureEventStream(binding: RuntimeSessionBinding): Promise<void> {
    const key = binding.cwd;
    const existing = this.#eventStreams.get(key);
    if (existing) return existing.ready;
    const controller = new AbortController();
    const client = this.#clientForBinding(binding);
    const ready = (async () => {
      const subscription = await client.event.subscribe(undefined, {
        signal: controller.signal,
      });
      void (async () => {
        try {
          for await (const event of subscription.stream as AsyncIterable<unknown>) {
            this.#onNativeEvent(event);
          }
        } catch {
          // A dropped native stream is retried on the next bound operation.
        } finally {
          if (this.#eventStreams.get(key)?.controller === controller) {
            this.#eventStreams.delete(key);
          }
        }
      })();
    })().catch((error) => {
      if (this.#eventStreams.get(key)?.controller === controller) {
        this.#eventStreams.delete(key);
      }
      throw error;
    });
    this.#eventStreams.set(key, { controller, ready });
    return ready;
  }

  async #assertExpertContract(
    binding: RuntimeSessionBinding,
    text: string,
  ): Promise<void> {
    if (binding.profile?.kind !== "expert") return;
    const workspace = this.#config.workspaces.find(
      (item) => item.id === binding.workspaceId,
    );
    if (!workspace) {
      throw new ApiError(404, "workspace_not_found", "Workspace not found");
    }
    await ensureAndAssertExpertRuntimeContract({
      workspace,
      sessionId: binding.runtimeSessionId,
      runtimeKind: "opencode",
      runtimeSessionId: binding.runtimeSessionId,
      profileId: binding.profileId,
      directory: binding.cwd,
      agent: "onmyagent",
      agentId: binding.profile.expertId,
      packageName: binding.profile.packageName ?? binding.profile.expertId,
      declaredSkills: binding.profile.declaredSkillNames,
      approvedAgentIds: binding.profile.approvedAgentIds,
      promptBody: {
        agent: "onmyagent",
        parts: [{ type: "text", text }],
      },
    });
  }
}

function normalizeMessageRole(
  value: string,
): AgentRuntimeMessage["role"] | null {
  return value === "system" || value === "user" || value === "assistant" || value === "tool"
    ? value
    : null;
}

function assertOpenCodeModelRef(
  modelRef: RuntimeSessionBinding["modelRef"] | undefined,
): void {
  if (!modelRef || modelRef.providerId) return;
  throw new ApiError(
    400,
    "agent_runtime_model_ref_invalid",
    "OpenCode model references require a provider id",
  );
}

function sessionFromNative(input: {
  native: NativeSession;
  productSessionId: string;
  runtimeSessionId: string;
  workspaceId: string;
  cwd: string;
  identity: PrimaryOpencodeHostIdentity;
  modelRef?: RuntimeSessionBinding["modelRef"];
  fallbackCreatedAt?: number;
}): AgentRuntimeSession {
  const createdAt = finiteTimestamp(input.native.time?.created)
    ?? input.fallbackCreatedAt
    ?? Date.now();
  return {
    productSessionId: input.productSessionId,
    runtimeKind: "opencode",
    runtimeSessionId: input.runtimeSessionId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    profileId: input.identity.profileId,
    title: typeof input.native.title === "string" ? input.native.title : null,
    createdAt,
    updatedAt: finiteTimestamp(input.native.time?.updated) ?? createdAt,
    status: { type: "idle" },
    ...(input.modelRef ? { modelRef: input.modelRef } : {}),
  };
}

function asNativeSession(value: unknown): NativeSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(
      502,
      "opencode_invalid_response",
      "OpenCode returned an invalid session",
    );
  }
  return value as NativeSession;
}

function requireSessionId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) {
    throw new ApiError(
      502,
      "opencode_invalid_response",
      "OpenCode returned a session without an id",
    );
  }
  return id;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function toOpencodePromptParts(input: AgentRuntimePromptInput): Array<
  | { type: "text"; text: string }
  | { type: "file"; url: string; mime: string; filename?: string }
  | { type: "agent"; name: string }
> {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; url: string; mime: string; filename?: string }
    | { type: "agent"; name: string }
  > = [];
  for (const part of input.parts ?? []) {
    if (part.type === "text") parts.push({ type: "text", text: part.text });
    else if (part.type === "file") {
      parts.push({
        type: "file",
        url: part.url,
        mime: part.mime,
        ...(part.filename ? { filename: part.filename } : {}),
      });
    } else if (part.type === "agent") {
      parts.push({ type: "agent", name: part.name });
    }
  }
  return parts.length > 0 ? parts : [{ type: "text", text: input.text }];
}
