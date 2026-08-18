import type {
  AgentRuntimeCapabilities,
  AgentRuntimeCapability,
  AgentRuntimeCommand,
  AgentRuntimeHealthSnapshot,
  AgentRuntimeModelCatalog,
  AgentRuntimePromptInput,
  AgentRuntimeSession,
  RuntimeSessionBinding,
} from "@onmyagent/types/agent-runtime";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { randomUUID } from "node:crypto";
import type {
  AgentRuntimeAdapter,
  RuntimeAdapterCreatedSession,
  RuntimeAdapterSessionInput,
} from "./primary-runtime-registry.js";
import type {
  GrokProcessHandle,
  GrokProcessKey,
  GrokProcessPolicy,
  GrokProcessSupervisor,
} from "./grok-process-supervisor.js";
import type { GrokAcpMcpServer } from "./runtime-mcp-projection.js";
import { GrokExtensionClient } from "./grok-extension-client.js";
import { grokExtensionFor } from "./grok-extension-registry.js";
import { assertSafeGrokExpertProfile } from "./grok-expert-profile-guard.js";
import {
  buildGrokPromptFromRuntimeParts,
  cleanupGrokStagedAttachments,
} from "./grok-attachment-staging.js";
import { factsFromAdvertisedFeatures } from "./grok-capability-facts.js";

type JsonObject = Record<string, unknown>;
type CompiledGrokSessionProfile = {
  meta: JsonObject;
  cwd?: string;
  cleanup?: () => void | Promise<void>;
  /** Bind the native id only after ACP session/new returns it. */
  bindRuntimeIdentity?: (runtimeSessionId: string) => void | Promise<void>;
};

export class GrokRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtimeKind = "grok-build" as const;
  readonly promptResolvesWhenTurnEnds = true;
  readonly #supervisor: Pick<GrokProcessSupervisor, "start" | "stopAll">;
  readonly #policy: (input: RuntimeAdapterSessionInput) => GrokProcessPolicy;
  readonly #policyFromBinding: (binding: RuntimeSessionBinding) => GrokProcessPolicy;
  readonly #sessionProfile: (input: RuntimeAdapterSessionInput) => CompiledGrokSessionProfile | Promise<CompiledGrokSessionProfile>;
  readonly #boundSessionProfile: (binding: RuntimeSessionBinding) => JsonObject | Promise<JsonObject>;
  readonly #bindPermissionSession: (
    runtimeSessionId: string,
    productSessionId: string,
    workspace: { id: string; path: string },
  ) => void;
  readonly #unbindPermissionSession: (runtimeSessionId: string) => void;
  readonly #cleanupSession: (binding: RuntimeSessionBinding) => void | Promise<void>;
  readonly #assertPromptContract: (binding: RuntimeSessionBinding, input: { text: string }) => void | Promise<void>;
  readonly #respondQuestion: (
    productSessionId: string,
    questionId: string,
    answers: string[][],
  ) => void | Promise<void>;
  readonly #resolveMcpServers: (
    profile: RuntimeAdapterSessionInput["profile"] | RuntimeSessionBinding["profile"],
  ) => readonly GrokAcpMcpServer[] | Promise<readonly GrokAcpMcpServer[]>;
  readonly #availableProfileIds: ReadonlySet<string> | null;
  readonly #readCommandCatalog: (runtimeSessionId: string) => Array<{ name: string; description?: string }>;
  #lastCommandCatalog: AgentRuntimeCommand[] = [];
  readonly #attachedSessions = new WeakMap<object, Set<string>>();
  readonly #attachRequests = new WeakMap<object, Map<string, Promise<void>>>();
  readonly #authenticatedProcesses = new WeakSet<object>();
  #health: AgentRuntimeHealthSnapshot = {
    runtimeKind: "grok-build",
    health: "process_ready",
    checkedAt: Date.now(),
  };
  #capabilities: AgentRuntimeCapabilities | undefined;

  constructor(input: {
    supervisor: Pick<GrokProcessSupervisor, "start" | "stopAll">;
    resolvePolicy: (input: RuntimeAdapterSessionInput) => GrokProcessPolicy;
    resolveBindingPolicy?: (binding: RuntimeSessionBinding) => GrokProcessPolicy;
    compileSessionProfile?: (input: RuntimeAdapterSessionInput) => CompiledGrokSessionProfile | Promise<CompiledGrokSessionProfile>;
    compileBoundSessionProfile?: (binding: RuntimeSessionBinding) => JsonObject | Promise<JsonObject>;
    bindPermissionSession?: (
      runtimeSessionId: string,
      productSessionId: string,
      workspace: { id: string; path: string },
    ) => void;
    unbindPermissionSession?: (runtimeSessionId: string) => void;
    cleanupSession?: (binding: RuntimeSessionBinding) => void | Promise<void>;
    assertPromptContract?: (binding: RuntimeSessionBinding, input: { text: string }) => void | Promise<void>;
    respondQuestion?: (
      productSessionId: string,
      questionId: string,
      answers: string[][],
    ) => void | Promise<void>;
    resolveMcpServers?: (
      profile: RuntimeAdapterSessionInput["profile"] | RuntimeSessionBinding["profile"],
    ) => readonly GrokAcpMcpServer[] | Promise<readonly GrokAcpMcpServer[]>;
    availableProfileIds?: readonly string[];
    readCommandCatalog?: (runtimeSessionId: string) => Array<{ name: string; description?: string }>;
  }) {
    this.#supervisor = input.supervisor;
    this.#policy = input.resolvePolicy;
    this.#policyFromBinding = input.resolveBindingPolicy ?? ((binding) => ({
      binaryPath: "grok",
      runtimeHome: binding.runtimeHome,
    }));
    this.#sessionProfile = input.compileSessionProfile ?? (() => ({ meta: {} }));
    this.#boundSessionProfile = input.compileBoundSessionProfile ?? (() => ({}));
    this.#bindPermissionSession = input.bindPermissionSession ?? (() => undefined);
    this.#unbindPermissionSession = input.unbindPermissionSession ?? (() => undefined);
    this.#cleanupSession = input.cleanupSession ?? (() => undefined);
    this.#assertPromptContract = input.assertPromptContract ?? (() => undefined);
    this.#respondQuestion = input.respondQuestion ?? (() => {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Grok runtime questions are unavailable",
      );
    });
    this.#resolveMcpServers = input.resolveMcpServers ?? (() => []);
    this.#availableProfileIds = input.availableProfileIds?.length
      ? new Set(input.availableProfileIds)
      : null;
    this.#readCommandCatalog = input.readCommandCatalog ?? (() => []);
  }

  supportsProfile(profileId: string): boolean {
    return this.#availableProfileIds?.has(profileId) ?? true;
  }

  async probeCapabilities(): Promise<{ health: AgentRuntimeHealthSnapshot; capabilities?: AgentRuntimeCapabilities }> {
    return this.#capabilities
      ? { health: this.#health, capabilities: this.#capabilities }
      : { health: this.#health };
  }

  async getModelCatalog(input: RuntimeAdapterSessionInput): Promise<AgentRuntimeModelCatalog> {
    const process = await this.#process(input, this.#policy(input), input.workspace.path);
    const initialized = asObject(process.initialized);
    this.#recordReady(initialized);
    return this.#catalogForProcess(process, initialized, input);
  }

  async authenticate(
    input: RuntimeAdapterSessionInput,
    methodId: string,
  ): Promise<AgentRuntimeModelCatalog> {
    const process = await this.#process(input, this.#policy(input), input.workspace.path);
    const initialized = asObject(process.initialized);
    const normalizedMethodId = methodId.trim();
    const allowedMethodIds = new Set(catalogFromInitialize(initialized, input)
      .auth.methods.map((method) => method.id));
    if (!normalizedMethodId || !allowedMethodIds.has(normalizedMethodId)) {
      throw new ApiError(
        400,
        "agent_runtime_auth_method_invalid",
        "Runtime authentication method is unavailable",
      );
    }
    await process.transport.request("authenticate", { methodId: normalizedMethodId });
    this.#authenticatedProcesses.add(process);
    this.#recordReady(initialized);
    return this.#catalogForProcess(process, initialized, input);
  }

  #catalogForProcess(
    process: GrokProcessHandle,
    initialized: JsonObject,
    input: RuntimeAdapterSessionInput,
  ): AgentRuntimeModelCatalog {
    const catalog = catalogFromInitialize(initialized, input);
    return this.#authenticatedProcesses.has(process)
      ? { ...catalog, auth: { ...catalog.auth, state: "ready" } }
      : catalog;
  }

  async createSession(input: RuntimeAdapterSessionInput): Promise<RuntimeAdapterCreatedSession> {
    assertGrokModelRef(input.modelRef);
    const policy = this.#policy(input);
    const compiled = await this.#sessionProfile(input);
    const sessionCwd = compiled.cwd?.trim() || input.cwd?.trim() || input.workspace.path;
    const process = await this.#process(input, policy, sessionCwd).catch(async (error) => {
      await compiled.cleanup?.();
      this.#recordFailure(error);
      throw error;
    });
    const capabilities = this.#recordReady(process.initialized);
    requireCapability(capabilities, "session.create");
    const mcpServers = [...await this.#resolveMcpServers(input.profile)];
    const agentProfile = asObject(
      compiled.meta.agentProfileObject ?? (
        compiled.meta.agentProfile && typeof compiled.meta.agentProfile === "object"
          ? compiled.meta.agentProfile
          : {}
      ),
    );
    if (typeof agentProfile.promptBody === "string" || typeof agentProfile.name === "string") {
      assertSafeGrokExpertProfile(agentProfile);
    }
    const result = asObject(await process.transport.request("session/new", {
      cwd: sessionCwd,
      mcpServers,
      _meta: {
        ...compiled.meta,
        yoloMode: false,
        autoMode: false,
      },
    }).catch(async (error) => {
      await compiled.cleanup?.();
      this.#recordFailure(error);
      throw error;
    }));
    const runtimeSessionId = sessionIdFrom(result);
    try {
      if (input.profile?.kind === "expert") {
        await assertExpertIdentityApplied(process, {
          runtimeSessionId,
          cwd: sessionCwd,
          expectedExpertId: input.profile.expertId,
        });
      }
      await applySessionModel(process, runtimeSessionId, input.modelRef);
      if (input.mode) {
        await applySessionMode(process, runtimeSessionId, input.mode);
      }
      await compiled.bindRuntimeIdentity?.(runtimeSessionId);
    } catch (error) {
      await cleanupCreatedSession(process, capabilities, runtimeSessionId, sessionCwd);
      await compiled.cleanup?.();
      this.#recordFailure(error);
      throw error;
    }
    this.#bindPermissionSession(runtimeSessionId, input.productSessionId, {
      id: input.workspace.id,
      path: sessionCwd,
    });
    this.#markAttached(process, runtimeSessionId);
    return {
      runtimeSessionId,
      cwd: sessionCwd,
      runtimeHome: policy.runtimeHome,
      profileId: input.profileId,
      ...(policy.sandboxProfile
        ? { sandboxProfile: policy.sandboxProfile }
        : {}),
      ...(input.modelRef ? { modelRef: input.modelRef } : {}),
      session: sessionFromBinding({
        productSessionId: input.productSessionId,
        runtimeKind: this.runtimeKind,
        runtimeSessionId,
        workspaceId: input.workspace.id,
        cwd: sessionCwd,
        profileId: input.profileId,
        runtimeHome: policy.runtimeHome,
        ...(policy.sandboxProfile
          ? { sandboxProfile: policy.sandboxProfile }
          : {}),
        ...(input.modelRef ? { modelRef: input.modelRef } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        createdAt: Date.now(),
      }),
    };
  }

  async getSession(binding: RuntimeSessionBinding): Promise<AgentRuntimeSession> {
    const process = await this.#processFromBinding(binding);
    const capabilities = this.#recordReady(process.initialized);
    requireCapability(capabilities, "session.load");
    this.#bindPermissionSession(
      binding.runtimeSessionId,
      binding.productSessionId,
      {
        id: binding.workspaceId,
        path: binding.cwd,
      },
    );
    await this.#ensureAttached(process, binding);
    await applySessionModel(process, binding.runtimeSessionId, binding.modelRef);
    return sessionFromBinding(binding);
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
    const byProcessKey = new Map<string, RuntimeSessionBinding[]>();
    for (const binding of bindings) {
      const key = [binding.profileId, binding.runtimeHome, binding.cwd].join("\0");
      const group = byProcessKey.get(key) ?? [];
      group.push(binding);
      byProcessKey.set(key, group);
    }
    await Promise.all([...byProcessKey.values()].map(async (group) => {
      try {
        const process = await this.#processFromBinding(group[0]!);
        requireCapability(this.#recordReady(process.initialized), "session.list");
        const seen = new Set<string>();
        let cursor: string | undefined;
        let truncated = false;
        for (let page = 0; page < 20; page += 1) {
          const result = asObject(await process.transport.request("session/list", {
            cwd: group[0]!.cwd,
            ...(cursor ? { cursor } : {}),
          }));
          const pageSessions = Array.isArray(result.sessions) ? result.sessions : [];
          for (const entry of pageSessions) {
            const value = asObject(entry);
            const id = typeof value.sessionId === "string"
              ? value.sessionId.trim()
              : typeof value.session_id === "string"
                ? value.session_id.trim()
                : typeof value.id === "string"
                  ? value.id.trim()
                  : "";
            if (id) seen.add(id);
          }
          const next = typeof result.nextCursor === "string"
            ? result.nextCursor.trim()
            : typeof result.next_cursor === "string"
              ? result.next_cursor.trim()
              : "";
          if (!next) break;
          cursor = next;
          if (page === 19) {
            truncated = true;
            failedRuntimeSessionIds.push(...group.map((binding) => binding.runtimeSessionId));
          }
        }
        if (truncated) return;
        for (const binding of group) {
          if (seen.has(binding.runtimeSessionId)) sessions.push(sessionFromBinding(binding));
          else missingRuntimeSessionIds.push(binding.runtimeSessionId);
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

  async deleteSession(binding: RuntimeSessionBinding): Promise<void> {
    const process = await this.#processFromBinding(binding);
    const capabilities = capabilitiesFromInitialize(process.initialized);
    requireCapability(capabilities, "session.delete");
    const deleted = await new GrokExtensionClient(process.transport).call(
      "session.delete",
      { sessionId: binding.runtimeSessionId, cwd: binding.cwd },
      () => undefined,
    );
    if (!deleted.ok) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Grok native session delete is unavailable",
      );
    }
    if (capabilities.features.includes("session.close")) {
      await process.transport.request("session/close", {
        sessionId: binding.runtimeSessionId,
      }).catch(() => undefined);
    }
    this.#attachedSessions.get(process)?.delete(binding.runtimeSessionId);
    this.#unbindPermissionSession(binding.runtimeSessionId);
    await cleanupGrokStagedAttachments({ sessionId: binding.productSessionId });
    await this.#cleanupSession(binding);
  }

  async renameSession(binding: RuntimeSessionBinding, title: string): Promise<void> {
    const process = await this.#processFromBinding(binding);
    const capabilities = this.#recordReady(process.initialized);
    requireCapability(capabilities, "session.rename");
    const renamed = await new GrokExtensionClient(process.transport).call(
      "session.rename",
      {
        sessionId: binding.runtimeSessionId,
        cwd: binding.cwd,
        title,
        kind: "session",
        resetToAuto: false,
      },
      () => undefined,
    );
    if (!renamed.ok) {
      throw new ApiError(409, "agent_runtime_capability_unsupported", "Grok runtime does not advertise session rename");
    }
  }

  async forkSession(
    binding: RuntimeSessionBinding,
    newProductSessionId: string,
  ): Promise<RuntimeAdapterCreatedSession> {
    const process = await this.#processFromBinding(binding);
    const capabilities = this.#recordReady(process.initialized);
    requireCapability(capabilities, "session.fork");
    const requestedNativeId = randomUUID();
    const forked = await new GrokExtensionClient(process.transport).call(
      "session.fork",
      {
        sourceSessionId: binding.runtimeSessionId,
        sourceCwd: binding.cwd,
        newCwd: binding.cwd,
        newSessionId: requestedNativeId,
        ...(binding.modelRef?.modelId ? { newModelId: binding.modelRef.modelId } : {}),
        sessionKind: "fork",
      },
      (value) => asObject(value),
    );
    if (!forked.ok) {
      throw new ApiError(409, "agent_runtime_capability_unsupported", "Grok runtime does not advertise session fork");
    }
    const response = forked.value;
    const runtimeSessionId = sessionIdFrom({
      sessionId: response.newSessionId ?? response.new_session_id ?? requestedNativeId,
    });
    return {
      runtimeSessionId,
      cwd: binding.cwd,
      runtimeHome: binding.runtimeHome,
      profileId: binding.profileId,
      ...(binding.sandboxProfile ? { sandboxProfile: binding.sandboxProfile } : {}),
      ...(binding.modelRef ? { modelRef: binding.modelRef } : {}),
      session: sessionFromBinding({
        ...binding,
        productSessionId: newProductSessionId,
        runtimeSessionId,
        parentProductSessionId: binding.productSessionId,
        createdAt: Date.now(),
        source: "explicit",
      }),
    };
  }

  validatePrompt(
    binding: RuntimeSessionBinding,
    input: AgentRuntimePromptInput,
  ): void {
    const boundSystemPrompt = binding.profile?.systemPrompt;
    if (
      (input.systemPrompt !== undefined && input.systemPrompt !== boundSystemPrompt)
      || input.agentId
      || input.toolAccess
      || input.parts?.some((part) =>
        part.type !== "text"
        && part.type !== "file"
        && part.type !== "staged_file"
        && part.type !== "image"
        && part.type !== "resource_link")
    ) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Grok per-turn instructions must match the sticky session profile",
      );
    }
  }

  async prompt(
    binding: RuntimeSessionBinding,
    input: AgentRuntimePromptInput,
  ): Promise<{ turnId?: string }> {
    this.validatePrompt(binding, input);
    await this.#assertPromptContract(binding, input);
    const process = await this.#processFromBinding(binding);
    try {
      const prompt = await buildGrokPromptBlocks(binding, input);
      const result = asObject(await process.transport.request("session/prompt", {
        sessionId: binding.runtimeSessionId,
        prompt,
      }, 30 * 60_000));
      const turnId = typeof result.promptId === "string"
        ? result.promptId.trim()
        : typeof result.prompt_id === "string"
          ? result.prompt_id.trim()
          : "";
      return turnId ? { turnId } : {};
    } finally {
      await cleanupGrokStagedAttachments({ sessionId: binding.productSessionId });
    }
  }

  async cancel(binding: RuntimeSessionBinding): Promise<void> {
    const process = await this.#processFromBinding(binding);
    await process.transport.notify("session/cancel", {
      sessionId: binding.runtimeSessionId,
    });
  }

  async close(binding: RuntimeSessionBinding): Promise<void> {
    const process = await this.#processFromBinding(binding);
    const capabilities = this.#recordReady(process.initialized);
    requireCapability(capabilities, "session.close");
    await process.transport.request("session/close", {
      sessionId: binding.runtimeSessionId,
    });
    this.#attachedSessions.get(process)?.delete(binding.runtimeSessionId);
    this.#unbindPermissionSession(binding.runtimeSessionId);
  }

  async resume(binding: RuntimeSessionBinding): Promise<AgentRuntimeSession> {
    const process = await this.#processFromBinding(binding);
    const capabilities = this.#recordReady(process.initialized);
    requireCapability(capabilities, "session.resume");
    const profile = await this.#boundSessionProfile(binding);
    await process.transport.request("session/resume", {
      sessionId: binding.runtimeSessionId,
      cwd: binding.cwd,
      mcpServers: [...await this.#resolveMcpServers(binding.profile)],
      _meta: profile,
    });
    await applySessionModel(process, binding.runtimeSessionId, binding.modelRef);
    if (binding.mode) {
      await applySessionMode(process, binding.runtimeSessionId, binding.mode);
    }
    this.#bindPermissionSession(
      binding.runtimeSessionId,
      binding.productSessionId,
      { id: binding.workspaceId, path: binding.cwd },
    );
    this.#markAttached(process, binding.runtimeSessionId);
    return sessionFromBinding(binding);
  }

  async setModel(
    binding: RuntimeSessionBinding,
    modelRef: NonNullable<RuntimeSessionBinding["modelRef"]>,
  ): Promise<void> {
    assertGrokModelRef(modelRef);
    const process = await this.#processFromBinding(binding);
    await applySessionModel(process, binding.runtimeSessionId, modelRef);
  }

  async setMode(binding: RuntimeSessionBinding, mode: string): Promise<void> {
    const process = await this.#processFromBinding(binding);
    await this.#ensureAttached(process, binding);
    await process.transport.request("session/set_mode", {
      sessionId: binding.runtimeSessionId,
      modeId: mode,
    });
  }

  async listCommands(binding: RuntimeSessionBinding): Promise<{
    items: AgentRuntimeCommand[];
    complete: boolean;
  }> {
    const process = await this.#processFromBinding(binding);
    await this.#ensureAttached(process, binding);
    let listed: { items: AgentRuntimeCommand[]; complete: boolean } | null = null;
    try {
      const result = await new GrokExtensionClient(process.transport).call(
        "commands",
        { sessionId: binding.runtimeSessionId, cwd: binding.cwd },
        decodeGrokCommandEnvelope,
      );
      if (result.ok) listed = result.value;
    } catch {
      listed = null;
    }
    if (listed && listed.items.length > 0) {
      this.#lastCommandCatalog = listed.items;
      return listed;
    }
    const cachedItems = commandsFromCatalog(
      this.#readCommandCatalog(binding.runtimeSessionId),
    );
    if (cachedItems.length > 0) {
      this.#lastCommandCatalog = cachedItems;
      return { items: cachedItems, complete: true };
    }
    if (this.#lastCommandCatalog.length > 0) {
      return { items: this.#lastCommandCatalog, complete: false };
    }
    return { items: [], complete: false };
  }

  async listWorkspaceCommands(workspace: WorkspaceInfo): Promise<{
    items: AgentRuntimeCommand[];
    complete: boolean;
  }> {
    if (this.#lastCommandCatalog.length > 0) {
      return { items: this.#lastCommandCatalog, complete: true };
    }
    const input: RuntimeAdapterSessionInput = {
      productSessionId: "grok-command-catalog",
      workspace,
      profileId: "system",
    };
    const policy = this.#policy(input);
    const process = await this.#process(input, policy, workspace.path);
    this.#recordReady(process.initialized);
    const created = asObject(await process.transport.request("session/new", {
      cwd: workspace.path,
      mcpServers: [],
    }));
    const runtimeSessionId = sessionIdFrom(created);
    try {
      const fromNotify = commandsFromCatalog(
        this.#readCommandCatalog(runtimeSessionId),
      );
      if (fromNotify.length > 0) {
        this.#lastCommandCatalog = fromNotify;
        return { items: fromNotify, complete: true };
      }
      const result = await new GrokExtensionClient(process.transport).call(
        "commands",
        { sessionId: runtimeSessionId, cwd: workspace.path },
        decodeGrokCommandEnvelope,
      );
      const items = result.ok ? result.value.items : [];
      if (items.length > 0) this.#lastCommandCatalog = items;
      return {
        items: items.length > 0 ? items : this.#lastCommandCatalog,
        complete: items.length > 0,
      };
    } finally {
      const capabilities = capabilitiesFromInitialize(process.initialized);
      if (capabilities.features.includes("session.close")) {
        await process.transport.request("session/close", {
          sessionId: runtimeSessionId,
        }).catch(() => undefined);
      }
    }
  }

  async executeCommand(
    binding: RuntimeSessionBinding,
    name: string,
    input: { arguments?: string },
  ): Promise<{ turnId?: string }> {
    const commandName = normalizeGrokCommandName(name);
    assertSafeGrokCommand(commandName);
    await this.#assertPromptContract(binding, {
      text: `/${commandName}${input.arguments ? ` ${input.arguments}` : ""}`,
    });
    const process = await this.#processFromBinding(binding);
    await this.#ensureAttached(process, binding);
    const catalog = await this.listCommands(binding);
    const known = new Set([
      ...catalog.items.map((command) => command.name),
      ...this.#lastCommandCatalog.map((command) => command.name),
    ]);
    // Empty/incomplete catalogs happen on draft-home list then session execute.
    // Native Grok still accepts `/${name}` via session/prompt; only 404 when a
    // complete non-empty catalog explicitly omits the command.
    if (known.size > 0 && catalog.complete && !known.has(commandName)) {
      throw new ApiError(
        404,
        "agent_runtime_command_not_found",
        "Runtime command is unavailable in this session",
      );
    }
    const result = asObject(await process.transport.request("session/prompt", {
      sessionId: binding.runtimeSessionId,
      prompt: [{
        type: "text",
        text: `/${commandName}${input.arguments ? ` ${input.arguments}` : ""}`,
      }],
    }));
    const turnId = typeof result.promptId === "string"
      ? result.promptId.trim()
      : typeof result.prompt_id === "string"
        ? result.prompt_id.trim()
        : "";
    return turnId ? { turnId } : {};
  }

  async respondQuestion(
    binding: RuntimeSessionBinding,
    questionId: string,
    answers: string[][],
  ): Promise<void> {
    await this.#respondQuestion(binding.productSessionId, questionId, answers);
  }

  stop(): Promise<void> { return this.#supervisor.stopAll(); }

  #process(input: RuntimeAdapterSessionInput, policy: GrokProcessPolicy, workspaceRoot: string): Promise<GrokProcessHandle> {
    const key: GrokProcessKey = {
      profileId: input.profileId,
      workspaceRoot,
      ...(policy.sandboxProfile
        ? { sandboxProfile: policy.sandboxProfile }
        : {}),
    };
    return this.#supervisor.start(key, policy);
  }

  #processFromBinding(binding: RuntimeSessionBinding): Promise<GrokProcessHandle> {
    return this.#supervisor.start(
      { profileId: binding.profileId, workspaceRoot: binding.cwd, ...(binding.sandboxProfile ? { sandboxProfile: binding.sandboxProfile } : {}) },
      this.#policyFromBinding(binding),
    );
  }

  #recordReady(initialized: unknown): AgentRuntimeCapabilities {
    const capabilities = capabilitiesFromInitialize(initialized);
    this.#capabilities = capabilities;
    this.#health = {
      runtimeKind: this.runtimeKind,
      health: "ready",
      checkedAt: Date.now(),
      capabilities,
    };
    return capabilities;
  }

  #recordFailure(error: unknown): void {
    const auth = error instanceof ApiError && error.code === "grok_auth_required";
    const model = error instanceof ApiError && error.code === "grok_model_unavailable";
    this.#health = {
      runtimeKind: this.runtimeKind,
      health: auth ? "needs_auth" : model ? "degraded" : "crashed",
      checkedAt: Date.now(),
      error: {
        code: auth
          ? "grok_auth_required"
          : model
            ? "agent_runtime_model_unavailable"
            : "grok_runtime_unavailable",
        message: auth
          ? "Grok authentication is required"
          : model
            ? "The selected Grok model is unavailable"
          : "Grok runtime is unavailable",
        retriable: !model,
        ...(auth
          ? { remediation: "Sign in to the selected Grok profile" }
          : model
            ? { remediation: "Choose a model available to the selected Grok profile" }
            : {}),
      },
    };
  }

  #markAttached(process: GrokProcessHandle, runtimeSessionId: string): void {
    const sessions = this.#attachedSessions.get(process) ?? new Set<string>();
    sessions.add(runtimeSessionId);
    this.#attachedSessions.set(process, sessions);
  }

  async #ensureAttached(
    process: GrokProcessHandle,
    binding: RuntimeSessionBinding,
  ): Promise<void> {
    if (this.#attachedSessions.get(process)?.has(binding.runtimeSessionId)) return;
    const requests = this.#attachRequests.get(process) ?? new Map<string, Promise<void>>();
    this.#attachRequests.set(process, requests);
    const existing = requests.get(binding.runtimeSessionId);
    if (existing) return existing;
    const request = process.transport.request("session/load", {
      sessionId: binding.runtimeSessionId,
      cwd: binding.cwd,
      mcpServers: [...await this.#resolveMcpServers(binding.profile)],
      _meta: {
        ...await this.#boundSessionProfile(binding),
        yoloMode: false,
        autoMode: false,
      },
    }).then(() => {
      this.#markAttached(process, binding.runtimeSessionId);
    }).finally(() => {
      requests.delete(binding.runtimeSessionId);
    });
    requests.set(binding.runtimeSessionId, request);
    return request;
  }
}

export function catalogFromInitialize(
  initialized: JsonObject,
  input: Pick<RuntimeAdapterSessionInput, "workspace" | "profileId">,
): AgentRuntimeModelCatalog {
  const meta = asObject(initialized._meta);
  const state = asObject(meta.modelState);
  const available = Array.isArray(state.availableModels) ? state.availableModels : [];
  const models = available.flatMap((entry) => {
    const model = asObject(entry);
    const modelId = typeof model.modelId === "string" ? model.modelId.trim() : "";
    if (!modelId) return [];
    return [{
      ref: { modelId },
      displayName: typeof model.name === "string" && model.name.trim() ? model.name.trim() : modelId,
      available: true,
      capabilities: { text: true, imageInput: false, tools: true, reasoning: true },
    }];
  });
  const currentModelId = typeof state.currentModelId === "string" ? state.currentModelId.trim() : "";
  const authMethods = Array.isArray(initialized.authMethods) ? initialized.authMethods : [];
  const methods = authMethods.flatMap((entry) => {
    const method = asObject(entry);
    const id = typeof method.id === "string" ? method.id.trim() : "";
    return id ? [{ id, ...(typeof method.name === "string" && method.name.trim() ? { label: method.name.trim() } : {}) }] : [];
  });
  return {
    runtimeKind: "grok-build",
    profileId: input.profileId,
    workspaceId: input.workspace.id,
    models,
    ...(currentModelId ? { defaultModelRef: { modelId: currentModelId } } : {}),
    auth: { state: models.length ? "ready" : methods.length ? "needs_auth" : "unknown", methods },
    complete: true,
  };
}

export function capabilitiesFromInitialize(value: unknown): AgentRuntimeCapabilities {
  const root = asObject(value);
  const caps = asObject(root.agentCapabilities);
  const session = asObject(caps.sessionCapabilities);
  const features: AgentRuntimeCapability[] = [
    "session.create",
    "turn.prompt",
    "turn.cancel",
    "event.subscribe",
    "permission.respond",
    "question.respond",
    "config.set_model",
    "config.set_mode",
  ];
  if (caps.loadSession === true) features.push("session.load");
  if ("list" in session) features.push("session.list");
  if ("resume" in session) features.push("session.resume");
  if ("close" in session) features.push("session.close");
  const extensions = Array.isArray(asObject(root._meta).extensionMethods)
    ? asObject(root._meta).extensionMethods as unknown[] : [];
  const nativeVersion = String(asObject(root._meta).agentVersion ?? "unknown");
  if (
    hasExtension(extensions, "commands")
    || supportsAuditedCommandExtension(nativeVersion)
  ) {
    features.push("command.list", "command.execute");
  }
  if (
    hasExtension(extensions, "session.delete")
    || supportsAuditedDeleteExtension(nativeVersion)
  ) features.push("session.delete");
  if (
    hasExtension(extensions, "session.rename")
    || supportsAuditedAdminExtensions(nativeVersion)
  ) features.push("session.rename");
  if (
    hasExtension(extensions, "session.fork")
    || supportsAuditedAdminExtensions(nativeVersion)
  ) features.push("session.fork");
  if (hasExtension(extensions, "session.usage")) features.push("usage.read");
  const uniqueFeatures = [...new Set(features)];
  return {
    protocolVersion: String(root.protocolVersion ?? "1"),
    features: uniqueFeatures,
    nativeVersion,
    featureStates: factsFromAdvertisedFeatures(uniqueFeatures),
  };
}

async function applySessionMode(
  process: GrokProcessHandle,
  runtimeSessionId: string,
  mode: string,
): Promise<void> {
  await process.transport.request("session/set_mode", {
    sessionId: runtimeSessionId,
    modeId: mode,
  });
}

function hasExtension(extensions: unknown[], feature: Parameters<typeof grokExtensionFor>[0]): boolean {
  const definition = grokExtensionFor(feature);
  return definition.methods.some((method) => extensions.includes(method))
    || (definition.aliases ?? []).some((method) => extensions.includes(method));
}

function supportsAuditedDeleteExtension(nativeVersion: string): boolean {
  return nativeVersion === "1.0.0" || nativeVersion === "1.0.1";
}

function supportsAuditedAdminExtensions(nativeVersion: string): boolean {
  return nativeVersion === "1.0.0" || nativeVersion === "1.0.1";
}

function supportsAuditedCommandExtension(nativeVersion: string): boolean {
  return nativeVersion === "1.0.0" || nativeVersion === "1.0.1";
}

const UNSAFE_GROK_COMMANDS = new Set(["always-approve", "yolo"]);

export function normalizeGrokCommandName(name: string): string {
  const trimmed = name.trim().replace(/^\/+/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) return trimmed;
  const last = parts[parts.length - 1] ?? trimmed;
  if (parts.length >= 2 && parts.every((part) => part === last)) return last;
  return last;
}

function assertSafeGrokCommand(name: string): void {
  if (!UNSAFE_GROK_COMMANDS.has(name.trim().toLowerCase())) return;
  throw new ApiError(
    409,
    "agent_runtime_command_unsafe",
    "This runtime command cannot be executed through OnMyAgent",
  );
}

function commandsFromCatalog(
  cached: ReadonlyArray<{ name: string; description?: string }>,
): AgentRuntimeCommand[] {
  return cached
    .filter((command) => command.name && command.name !== "always-approve" && command.name !== "yolo")
    .map((command) => ({
      id: `grok:command:${command.name}`,
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      source: "command" as const,
    }));
}

export function decodeGrokCommandEnvelope(value: unknown): {
  items: AgentRuntimeCommand[];
  complete: boolean;
} {
  if (Array.isArray(value)) return normalizeGrokCommands(value);
  const root = asObject(value);
  if (Array.isArray(root.commands)) return normalizeGrokCommands(root.commands);
  if (Array.isArray(root.items)) return normalizeGrokCommands(root.items);
  return { items: [], complete: false };
}

function normalizeGrokCommands(value: unknown): {
  items: AgentRuntimeCommand[];
  complete: boolean;
} {
  const list = Array.isArray(value) ? value : [];
  const items = list.slice(0, 256).flatMap((entry, index) => {
    const command = asObject(entry);
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (!name || UNSAFE_GROK_COMMANDS.has(name.toLowerCase())) return [];
    const meta = asObject(command._meta);
    const source: AgentRuntimeCommand["source"] = typeof meta.workflowSource === "string"
      ? "workflow"
      : typeof meta.path === "string"
        ? "skill"
        : "command";
    const input = asObject(command.input);
    const unstructured = asObject(input.unstructured ?? input);
    const hint = typeof command.argumentHint === "string"
      ? command.argumentHint.trim()
      : typeof command.argument_hint === "string"
        ? command.argument_hint.trim()
        : typeof unstructured.hint === "string"
          ? unstructured.hint.trim()
          : typeof unstructured.inputHint === "string"
            ? unstructured.inputHint.trim()
            : "";
    return [{
      id: `grok:${source}:${name || index}`,
      name,
      ...(typeof command.description === "string" && command.description.trim()
        ? { description: command.description.trim() }
        : {}),
      ...(hint ? { inputHint: hint } : {}),
      source,
    } satisfies AgentRuntimeCommand];
  });
  return { items, complete: list.length <= 256 };
}

function requireCapability(capabilities: AgentRuntimeCapabilities, feature: AgentRuntimeCapability): void {
  if (!capabilities.features.includes(feature)) throw new ApiError(409, "agent_runtime_capability_unsupported", `Grok runtime does not advertise ${feature}`);
}

function sessionIdFrom(value: JsonObject): string {
  const id = value.sessionId ?? value.session_id ?? value.id;
  if (typeof id !== "string" || !id.trim()) throw new ApiError(502, "grok_acp_session_id_missing", "Grok ACP returned no session id");
  return id.trim();
}

function sessionFromBinding(binding: RuntimeSessionBinding): AgentRuntimeSession {
  return {
    productSessionId: binding.productSessionId,
    runtimeKind: "grok-build",
    runtimeSessionId: binding.runtimeSessionId,
    workspaceId: binding.workspaceId,
    cwd: binding.cwd,
    profileId: binding.profileId,
    ...(binding.parentProductSessionId
      ? { parentProductSessionId: binding.parentProductSessionId }
      : {}),
    createdAt: binding.createdAt,
    updatedAt: binding.createdAt,
    status: { type: "idle" },
    ...(binding.modelRef ? { modelRef: binding.modelRef } : {}),
    ...(binding.mode ? { mode: binding.mode } : {}),
    ...(binding.profile?.kind === "expert"
      ? { profile: { kind: "expert" as const, expertId: binding.profile.expertId } }
      : binding.profile?.kind === "assistant"
        ? { profile: { kind: "assistant" as const } }
        : {}),
  };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

async function applySessionModel(
  process: GrokProcessHandle,
  runtimeSessionId: string,
  modelRef: RuntimeSessionBinding["modelRef"] | undefined,
): Promise<void> {
  if (!modelRef?.modelId) return;
  const effort = modelRef.variant;
  await process.transport.request("session/set_model", {
    sessionId: runtimeSessionId,
    modelId: modelRef.modelId,
    ...(effort === "low" || effort === "medium" || effort === "high"
      ? { _meta: { reasoningEffort: effort } }
      : {}),
  });
}

async function cleanupCreatedSession(
  process: GrokProcessHandle,
  capabilities: AgentRuntimeCapabilities,
  runtimeSessionId: string,
  cwd: string,
): Promise<void> {
  if (capabilities.features.includes("session.close")) {
    await process.transport.request("session/close", {
      sessionId: runtimeSessionId,
    }).catch(() => undefined);
  }
  if (!capabilities.features.includes("session.delete")) return;
  try {
    await new GrokExtensionClient(process.transport).call(
      "session.delete",
      { sessionId: runtimeSessionId, cwd },
      () => undefined,
    );
  } catch {
    // Best-effort native cleanup after a failed create. Product delete never
    // uses this path and must not treat a missing native history as success.
  }
}

async function assertExpertIdentityApplied(
  process: GrokProcessHandle,
  input: { runtimeSessionId: string; cwd: string; expectedExpertId: string },
): Promise<void> {
  const info = await new GrokExtensionClient(process.transport).call(
    "session.info",
    { sessionId: input.runtimeSessionId, cwd: input.cwd },
    (value) => asObject(value),
  );
  if (!info.ok) {
    await cleanupCreatedSession(
      process,
      capabilitiesFromInitialize(process.initialized),
      input.runtimeSessionId,
      input.cwd,
    );
    throw new ApiError(
      409,
      "grok_expert_profile_not_applied",
      "Grok Expert identity could not be verified",
    );
  }
  const payload = asObject(info.value.result ?? info.value);
  const agentName = typeof payload.agentName === "string"
    ? payload.agentName.trim()
    : typeof asObject(payload.agent).name === "string"
      ? String(asObject(payload.agent).name).trim()
      : "";
  if (
    agentName === input.expectedExpertId
    || agentName.endsWith(`:${input.expectedExpertId}`)
  ) return;
  await cleanupCreatedSession(
    process,
    capabilitiesFromInitialize(process.initialized),
    input.runtimeSessionId,
    input.cwd,
  );
  throw new ApiError(
    409,
    "grok_expert_profile_not_applied",
    "Grok Expert profile was not applied to the native session",
  );
}

async function buildGrokPromptBlocks(
  binding: RuntimeSessionBinding,
  input: AgentRuntimePromptInput,
): Promise<Array<{ type: "text"; text: string }>> {
  return buildGrokPromptFromRuntimeParts({
    text: input.text,
    parts: input.parts,
    workspaceRoot: binding.cwd,
    sessionId: binding.productSessionId,
  });
}

function assertGrokModelRef(
  modelRef: RuntimeSessionBinding["modelRef"] | undefined,
): void {
  if (!modelRef?.providerId) return;
  throw new ApiError(
    400,
    "agent_runtime_model_ref_invalid",
    "Grok model references must use a runtime-scoped model id",
  );
}
