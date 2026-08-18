import type {
  AgentRuntimeCapabilities,
  AgentRuntimeCommand,
  AgentRuntimeCommandListResponse,
  AgentRuntimeHealthSnapshot,
  AgentRuntimeKind,
  AgentRuntimeMessage,
  AgentRuntimePart,
  AgentRuntimeEvent,
  AgentRuntimeMessagesResponse,
  AgentRuntimeModelRef,
  AgentRuntimeModelCatalog,
  AgentRuntimePromptInput,
  AgentRuntimeRolloutSnapshot,
  AgentRuntimeSessionProfile,
  AgentRuntimeSession,
  AgentRuntimeSessionListResponse,
  RuntimeSessionBinding,
} from "@onmyagent/types/agent-runtime";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ApiError } from "../core/errors.js";
import type { AgentRuntimeSelectionStore } from "./agent-runtime-selection.js";
import { RuntimeSessionBindingStore } from "./runtime-session-bindings.js";
import type { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";

export type RuntimeAdapterSessionInput = {
  productSessionId: string;
  workspace: WorkspaceInfo;
  /** Server-owned working directory override; never accepted from renderer input. */
  cwd?: string;
  profileId: string;
  modelRef?: AgentRuntimeModelRef;
  mode?: string;
  profile?: AgentRuntimeSessionProfile;
};

export type RuntimeAdapterCreatedSession = {
  runtimeSessionId: string;
  cwd: string;
  runtimeHome: string;
  profileId: string;
  sandboxProfile?: string;
  modelRef?: AgentRuntimeModelRef;
  session: AgentRuntimeSession;
};

export interface AgentRuntimeAdapter {
  readonly runtimeKind: AgentRuntimeKind;
  supportsProfile?(profileId: string): boolean;
  probeCapabilities(): Promise<{
    health: AgentRuntimeHealthSnapshot;
    capabilities?: AgentRuntimeCapabilities;
  }>;
  getModelCatalog?(input: RuntimeAdapterSessionInput): Promise<AgentRuntimeModelCatalog>;
  authenticate?(
    input: RuntimeAdapterSessionInput,
    methodId: string,
  ): Promise<AgentRuntimeModelCatalog>;
  createSession(input: RuntimeAdapterSessionInput): Promise<RuntimeAdapterCreatedSession>;
  refreshSessions?(bindings: readonly RuntimeSessionBinding[]): Promise<{
    sessions: AgentRuntimeSession[];
    missingRuntimeSessionIds: string[];
    failedRuntimeSessionIds: string[];
    complete: boolean;
  }>;
  getSession(binding: RuntimeSessionBinding): Promise<AgentRuntimeSession>;
  forkSession?(
    binding: RuntimeSessionBinding,
    newProductSessionId: string,
  ): Promise<RuntimeAdapterCreatedSession>;
  renameSession?(binding: RuntimeSessionBinding, title: string): Promise<void>;
  readMessages?(binding: RuntimeSessionBinding): Promise<{
    messages: AgentRuntimeMessage[];
    complete: boolean;
  }>;
  deleteSession(binding: RuntimeSessionBinding): Promise<void>;
  validatePrompt?(binding: RuntimeSessionBinding, input: AgentRuntimePromptInput): void;
  prompt(binding: RuntimeSessionBinding, input: AgentRuntimePromptInput): Promise<{ turnId?: string }>;
  /**
   * When true, `prompt` / `executeCommand` resolve only after the native turn
   * ends. The registry then emits `turn.completed` + idle if the runtime did
   * not already publish a terminal update (ACP `session/prompt` return is the
   * turn boundary; `turn_completed` notifications are optional).
   * OpenCode must leave this unset: its prompt() returns immediately.
   */
  readonly promptResolvesWhenTurnEnds?: boolean;
  cancel(binding: RuntimeSessionBinding): Promise<void>;
  close?(binding: RuntimeSessionBinding): Promise<void>;
  resume?(binding: RuntimeSessionBinding): Promise<AgentRuntimeSession>;
  setModel(binding: RuntimeSessionBinding, modelRef: AgentRuntimeModelRef): Promise<void>;
  setMode?(binding: RuntimeSessionBinding, mode: string): Promise<void>;
  listCommands?(binding: RuntimeSessionBinding): Promise<{
    items: AgentRuntimeCommand[];
    complete: boolean;
  }>;
  listWorkspaceCommands?(workspace: WorkspaceInfo): Promise<{
    items: AgentRuntimeCommand[];
    complete: boolean;
  }>;
  executeCommand?(
    binding: RuntimeSessionBinding,
    name: string,
    input: { arguments?: string },
  ): Promise<{ turnId?: string }>;
  respondQuestion?(
    binding: RuntimeSessionBinding,
    questionId: string,
    answers: string[][],
  ): Promise<void> | void;
  stop(): Promise<void>;
}

type BindingStore = Pick<RuntimeSessionBindingStore, "get" | "list" | "upsert" | "delete" | "updateModelRef" | "updateMode">;

export class PrimaryRuntimeRegistry {
  readonly #workspaces = new Map<string, WorkspaceInfo>();
  readonly #selection: Pick<AgentRuntimeSelectionStore, "read" | "resolve">;
  readonly #adapters: ReadonlyMap<AgentRuntimeKind, AgentRuntimeAdapter>;
  readonly #bindingStore: (workspace: WorkspaceInfo) => BindingStore;
  readonly #opencodeProfileId: string;
  readonly #events?: PrimaryRuntimeEventBus;
  readonly #grokNewSessionsEnabled: boolean;
  readonly #grokWorkspaceAllowlist: ReadonlySet<string> | null;
  #draining = false;

  get opencodeProfileId(): string { return this.#opencodeProfileId; }

  constructor(input: {
    workspaces: readonly WorkspaceInfo[];
    selection: Pick<AgentRuntimeSelectionStore, "read" | "resolve">;
    adapters: readonly AgentRuntimeAdapter[];
    bindingStore?: (workspace: WorkspaceInfo) => BindingStore;
    opencodeProfileId?: string;
    runtimeRollout?: {
      grokNewSessionsEnabled: boolean;
      grokWorkspaceAllowlist?: readonly string[];
    };
    events?: PrimaryRuntimeEventBus;
  }) {
    this.syncWorkspaces(input.workspaces);
    this.#selection = input.selection;
    this.#adapters = new Map(input.adapters.map((adapter) => [adapter.runtimeKind, adapter]));
    this.#bindingStore = input.bindingStore ?? ((workspace) =>
      new RuntimeSessionBindingStore({ workspace }));
    this.#opencodeProfileId = input.opencodeProfileId?.trim()
      || "primary-opencode";
    this.#events = input.events;
    this.#grokNewSessionsEnabled = input.runtimeRollout?.grokNewSessionsEnabled
      ?? true;
    const allowlist = input.runtimeRollout?.grokWorkspaceAllowlist
      ?.map((workspaceId) => workspaceId.trim())
      .filter(Boolean);
    this.#grokWorkspaceAllowlist = allowlist?.length
      ? new Set(allowlist)
      : null;
  }

  /** Keep the server-owned runtime registry aligned with the mutable workspace catalog. */
  syncWorkspaces(workspaces: readonly WorkspaceInfo[]): void {
    const nextIds = new Set(workspaces.map((workspace) => workspace.id));
    for (const workspaceId of this.#workspaces.keys()) {
      if (!nextIds.has(workspaceId)) this.#workspaces.delete(workspaceId);
    }
    for (const workspace of workspaces) {
      this.#workspaces.set(workspace.id, workspace);
    }
  }

  async createSession(input: {
    productSessionId: string;
    workspaceId: string;
    runtimeKind?: AgentRuntimeKind;
    modelRef?: AgentRuntimeModelRef;
    mode?: string;
    profile?: AgentRuntimeSessionProfile;
    /** Server-owned working directory override for trusted secondary flows. */
    workingDirectory?: string;
    /** Server-owned authorized roots for a trusted secondary working directory. */
    workingDirectoryRoots?: readonly string[];
  }): Promise<AgentRuntimeSession> {
    this.#assertAccepting();
    const workspace = this.#requireWorkspace(input.workspaceId);
    const selected = input.runtimeKind
      ? { runtimeKind: input.runtimeKind, source: "explicit" as const }
      : await this.#selection.resolve(workspace.id);
    this.assertRuntimeSelectable(selected.runtimeKind, workspace.id);
    const adapter = this.#requireAdapter(selected.runtimeKind);
    const workingDirectory = input.workingDirectory?.trim();
    if (workingDirectory) {
      assertAuthorizedWorkingDirectory(
        workingDirectory,
        input.workingDirectoryRoots?.length
          ? input.workingDirectoryRoots
          : [workspace.path],
      );
    }
    const mode = input.mode?.trim();
    if (mode && !adapter.setMode) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime session mode is not supported by this adapter",
      );
    }
    const selection = await this.#selection.read();
    const profileId = selected.runtimeKind === "grok-build"
      ? selectedGrokProfileId(selection.config?.grokBuild)
      : this.#opencodeProfileId;
    const created = await callAdapter("create", () => adapter.createSession({
      productSessionId: input.productSessionId,
      workspace,
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
      profileId,
      modelRef: input.modelRef,
      ...(mode ? { mode } : {}),
      profile: input.profile,
    }));
    const binding: RuntimeSessionBinding = {
      productSessionId: input.productSessionId,
      runtimeKind: selected.runtimeKind,
      runtimeSessionId: created.runtimeSessionId,
      workspaceId: workspace.id,
      cwd: created.cwd,
      profileId: created.profileId,
      runtimeHome: created.runtimeHome,
      ...(created.modelRef ? { modelRef: created.modelRef } : {}),
      ...(mode ? { mode } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(created.sandboxProfile ? { sandboxProfile: created.sandboxProfile } : {}),
      createdAt: Date.now(),
      source: selected.source,
    };
    try {
      await this.#bindingStore(workspace).upsert(binding);
    } catch (error) {
      await adapter.deleteSession(binding).catch(() => undefined);
      throw error;
    }
    this.#events?.bindNativeSession(
      binding.runtimeKind,
      binding.runtimeSessionId,
      binding.productSessionId,
      {
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
      },
    );
    this.#events?.emitForNative(
      binding.runtimeKind,
      binding.runtimeSessionId,
      { kind: "session.created", session: created.session },
    );
    return created.session;
  }

  async getSession(workspaceId: string, productSessionId: string): Promise<AgentRuntimeSession> {
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    this.#bindEventSession(binding);
    return callAdapter("read", () =>
      this.#requireAdapter(binding.runtimeKind).getSession(binding));
  }

  async renameSession(
    workspaceId: string,
    productSessionId: string,
    title: string,
  ): Promise<AgentRuntimeSession> {
    this.#assertAccepting();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle.length > 500) {
      throw new ApiError(400, "invalid_payload", "Runtime session title is invalid");
    }
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.renameSession) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime session rename is not supported by this adapter",
      );
    }
    await callAdapter("update", () => adapter.renameSession!(binding, normalizedTitle));
    const session = { ...await adapter.getSession(binding), title: normalizedTitle };
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.updated",
      session,
    });
    return session;
  }

  async forkSession(
    workspaceId: string,
    productSessionId: string,
    newProductSessionId: string = randomUUID(),
    targetRuntimeKind?: AgentRuntimeKind,
  ): Promise<AgentRuntimeSession> {
    this.#assertAccepting();
    const workspace = this.#requireWorkspace(workspaceId);
    const source = await this.#requireBinding(workspaceId, productSessionId);
    if (source.profile?.kind === "expert") {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Expert sessions cannot be forked without a new isolated runtime profile",
      );
    }
    const normalizedProductId = newProductSessionId.trim();
    if (!normalizedProductId || normalizedProductId === productSessionId) {
      throw new ApiError(400, "invalid_payload", "A distinct fork product session id is required");
    }
    const targetKind = targetRuntimeKind?.trim() as AgentRuntimeKind | undefined;
    const crossRuntime = targetKind && targetKind !== source.runtimeKind;
    if (crossRuntime) {
      return this.#forkSessionCrossRuntime(
        workspace,
        source,
        normalizedProductId,
        targetKind,
      );
    }
    const adapter = this.#requireAdapter(source.runtimeKind);
    if (!adapter.forkSession) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime session fork is not supported by this adapter",
      );
    }
    const forked = await callAdapter("create", () =>
      adapter.forkSession!(source, normalizedProductId));
    const binding: RuntimeSessionBinding = {
      productSessionId: normalizedProductId,
      runtimeKind: source.runtimeKind,
      runtimeSessionId: forked.runtimeSessionId,
      workspaceId: workspace.id,
      cwd: forked.cwd,
      profileId: forked.profileId,
      runtimeHome: forked.runtimeHome,
      parentProductSessionId: source.productSessionId,
      ...(forked.modelRef ? { modelRef: forked.modelRef } : {}),
      ...(source.mode ? { mode: source.mode } : {}),
      ...(source.profile ? { profile: source.profile } : {}),
      ...(forked.sandboxProfile ? { sandboxProfile: forked.sandboxProfile } : {}),
      createdAt: Date.now(),
      source: "explicit",
    };
    try {
      await this.#bindingStore(workspace).upsert(binding);
    } catch (error) {
      await adapter.deleteSession(binding).catch(() => undefined);
      throw error;
    }
    this.#events?.bindNativeSession(
      binding.runtimeKind,
      binding.runtimeSessionId,
      binding.productSessionId,
      {
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
      },
    );
    const session = { ...forked.session, parentProductSessionId: source.productSessionId };
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.created",
      session,
    });
    return session;
  }

  async #forkSessionCrossRuntime(
    workspace: WorkspaceInfo,
    source: RuntimeSessionBinding,
    newProductSessionId: string,
    targetKind: AgentRuntimeKind,
  ): Promise<AgentRuntimeSession> {
    const targetAdapter = this.#requireAdapter(targetKind);
    this.assertRuntimeSelectable(targetKind, workspace.id);
    // Read the source conversation so the new runtime can continue the thread.
    let contextText = "";
    try {
      const read = await this.readSessionMessages(workspace.id, source.productSessionId);
      const parts = read.messages
        .filter((message) => message.role === "assistant" || message.role === "user")
        .flatMap((message) => message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text))
        .filter(Boolean);
      contextText = parts.join("\n").trim().slice(0, 16_000);
    } catch {
      // Context is best-effort; a bare cross-runtime fork remains valid.
    }
    const selection = await this.#selection.read();
    const profileId = targetKind === "grok-build"
      ? selectedGrokProfileId(selection.config?.grokBuild)
      : this.#opencodeProfileId;
    const systemPrompt = contextText
      ? [
          "Continue the conversation below from its previous runtime.",
          "Only respond to the newest user message; treat the earlier text as context.",
          "",
          "--- previous conversation ---",
          contextText,
          "--- end previous conversation ---",
        ].join("\n")
      : undefined;
    const created = await callAdapter("create", () => targetAdapter.createSession({
      productSessionId: newProductSessionId,
      workspace,
      profileId,
      profile: systemPrompt
        ? { kind: "assistant" as const, systemPrompt }
        : { kind: "assistant" as const },
    }));
    const binding: RuntimeSessionBinding = {
      productSessionId: newProductSessionId,
      runtimeKind: targetKind,
      runtimeSessionId: created.runtimeSessionId,
      workspaceId: workspace.id,
      cwd: created.cwd,
      profileId: created.profileId,
      runtimeHome: created.runtimeHome,
      parentProductSessionId: source.productSessionId,
      parentRuntimeKind: source.runtimeKind,
      ...(created.modelRef ? { modelRef: created.modelRef } : {}),
      ...(source.mode ? { mode: source.mode } : {}),
      ...(created.sandboxProfile ? { sandboxProfile: created.sandboxProfile } : {}),
      createdAt: Date.now(),
      source: "explicit",
    };
    try {
      await this.#bindingStore(workspace).upsert(binding);
    } catch (error) {
      await targetAdapter.deleteSession(binding).catch(() => undefined);
      throw error;
    }
    this.#events?.bindNativeSession(
      binding.runtimeKind,
      binding.runtimeSessionId,
      binding.productSessionId,
      {
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
      },
    );
    const session = {
      ...created.session,
      parentProductSessionId: source.productSessionId,
    };
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.created",
      session,
    });
    return session;
  }

  async listSessions(workspaceId: string): Promise<AgentRuntimeSessionListResponse> {
    const workspace = this.#requireWorkspace(workspaceId);
    const file = await this.#bindingStore(workspace).list();
    if (!file.complete && file.state !== "missing") {
      return { items: [], complete: false, failures: [] };
    }
    const itemByProductId = new Map(file.bindings.map((binding) => [
      binding.productSessionId,
      sessionProjectionFromBinding(binding),
    ]));
    const failures: AgentRuntimeSessionListResponse["failures"] = [];
    let complete = true;
    const byRuntime = new Map<AgentRuntimeKind, RuntimeSessionBinding[]>();
    for (const binding of file.bindings) {
      const group = byRuntime.get(binding.runtimeKind) ?? [];
      group.push(binding);
      byRuntime.set(binding.runtimeKind, group);
    }
    await Promise.all([...byRuntime].map(async ([runtimeKind, bindings]) => {
      const adapter = this.#adapters.get(runtimeKind);
      if (!adapter) {
        complete = false;
        for (const binding of bindings) {
          failures.push({
            productSessionId: binding.productSessionId,
            runtimeKind,
            code: "runtime_session_source_unavailable",
          });
        }
        return;
      }
      if (!adapter.refreshSessions) return;
      try {
        const refreshed = await callAdapter("read", () =>
          adapter.refreshSessions!(bindings));
        for (const session of refreshed.sessions) {
          itemByProductId.set(session.productSessionId, session);
        }
        const bindingByRuntimeId = new Map(bindings.map((binding) => [
          binding.runtimeSessionId,
          binding,
        ]));
        for (const runtimeSessionId of refreshed.missingRuntimeSessionIds) {
          const binding = bindingByRuntimeId.get(runtimeSessionId);
          if (!binding) continue;
          failures.push({
            productSessionId: binding.productSessionId,
            runtimeKind,
            code: "runtime_session_native_missing",
          });
        }
        for (const runtimeSessionId of refreshed.failedRuntimeSessionIds) {
          const binding = bindingByRuntimeId.get(runtimeSessionId);
          if (!binding) continue;
          failures.push({
            productSessionId: binding.productSessionId,
            runtimeKind,
            code: "runtime_session_source_unavailable",
          });
        }
        if (!refreshed.complete) complete = false;
      } catch {
        complete = false;
        for (const binding of bindings) {
          failures.push({
            productSessionId: binding.productSessionId,
            runtimeKind,
            code: "runtime_session_source_unavailable",
          });
        }
      }
    }));
    const items = [...itemByProductId.values()];
    items.sort((left, right) =>
      right.updatedAt - left.updatedAt
      || left.productSessionId.localeCompare(right.productSessionId));
    return {
      items,
      complete,
      failures: failures.sort((left, right) =>
        left.productSessionId.localeCompare(right.productSessionId)),
    };
  }

  async rolloutSnapshot(): Promise<AgentRuntimeRolloutSnapshot> {
    const bindings: RuntimeSessionBinding[] = [];
    let failureCount = 0;
    for (const workspace of this.#workspaces.values()) {
      try {
        const file = await this.#bindingStore(workspace).list();
        if (!file.complete && file.state !== "missing") {
          failureCount += 1;
          continue;
        }
        bindings.push(...file.bindings);
      } catch {
        failureCount += 1;
      }
    }
    const runtimeCounts = (["opencode", "grok-build"] as const)
      .map((runtimeKind) => ({
        runtimeKind,
        count: bindings.filter((binding) => binding.runtimeKind === runtimeKind).length,
      }))
      .filter((entry) => entry.count > 0);
    const bindingSetHash = createHash("sha256")
      .update(bindings.map((binding) => [
        binding.workspaceId,
        binding.productSessionId,
        binding.runtimeKind,
        binding.runtimeSessionId,
        binding.profileId,
        binding.runtimeHome,
      ].join("\u0000")).sort().join("\n"))
      .digest("hex");
    return {
      version: 1,
      generatedAt: Date.now(),
      sessionCount: bindings.length,
      runtimeCounts,
      bindingSetHash,
      complete: failureCount === 0,
      failureCount,
    };
  }

  /** Server-internal authoritative identities; never serialized with runtimeHome. */
  async listSessionBindings(workspaceId: string): Promise<RuntimeSessionBinding[]> {
    const workspace = this.#requireWorkspace(workspaceId);
    const file = await this.#bindingStore(workspace).list();
    if (!file.complete && file.state !== "missing") {
      throw new ApiError(
        409,
        "runtime_session_bindings_unavailable",
        "Runtime session bindings are unavailable",
      );
    }
    return file.bindings;
  }

  async listExpertSessionBindings(
    workspaceId: string,
    agentId: string,
    packageName: string,
  ): Promise<RuntimeSessionBinding[]> {
    const workspace = this.#requireWorkspace(workspaceId);
    const file = await this.#bindingStore(workspace).list();
    if (!file.complete) {
      throw new ApiError(
        409,
        "runtime_session_bindings_unavailable",
        "Runtime session bindings are unavailable",
      );
    }
    return file.bindings.filter((binding) =>
      binding.profile?.kind === "expert"
      && binding.profile.expertId === agentId
      && (binding.profile.packageName ?? binding.profile.expertId) === packageName,
    );
  }

  async deleteSession(workspaceId: string, productSessionId: string): Promise<void> {
    this.#assertAccepting();
    const workspace = this.#requireWorkspace(workspaceId);
    const store = this.#bindingStore(workspace);
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    await callAdapter("delete", () =>
      this.#requireAdapter(binding.runtimeKind).deleteSession(binding));
    await store.delete(productSessionId);
    this.#events?.emitForNative(
      binding.runtimeKind,
      binding.runtimeSessionId,
      { kind: "session.deleted", reason: "user_delete" },
    );
    this.#events?.unbindNativeSession(binding.runtimeKind, binding.runtimeSessionId);
    this.#events?.forgetProductSession(binding.productSessionId);
  }

  async promptSession(
    workspaceId: string,
    productSessionId: string,
    input: AgentRuntimePromptInput,
  ): Promise<{ turnId?: string }> {
    this.#assertAccepting();
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    this.#bindEventSession(binding);
    const turnId = randomUUID();
    const messageId = input.messageId?.trim() || `message-${randomUUID()}`;
    const promptInput = { ...input, messageId };
    const adapter = this.#requireAdapter(binding.runtimeKind);
    adapter.validatePrompt?.(binding, promptInput);
    this.#events?.beginTurn(
      binding.runtimeKind,
      binding.runtimeSessionId,
      turnId,
    );
    const now = Date.now();
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "message.completed",
      message: {
        id: messageId,
        productSessionId: binding.productSessionId,
        role: "user",
        parts: [{
          type: "text",
          id: `user-text-${turnId}`,
          text: input.text,
        }],
        createdAt: now,
        completedAt: now,
      },
    });
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.status",
      status: { type: "busy", turnId, startedAt: now },
    });
    void callAdapter("prompt", () =>
      adapter.prompt(binding, promptInput)).then(
      () => {
        this.#settleBlockingPromptTurn(adapter, binding);
      },
      () => {
        this.#events?.endTurn(binding.runtimeKind, binding.runtimeSessionId);
        this.#events?.emitForNative(
          binding.runtimeKind,
          binding.runtimeSessionId,
          {
            kind: "session.error",
            error: {
              code: "agent_runtime_prompt_failed",
              message: "Runtime prompt failed",
              retriable: true,
            },
          },
        );
      },
    );
    return { turnId };
  }

  async listRuntimeCommands(
    workspaceId: string,
    runtimeKind?: AgentRuntimeKind,
  ): Promise<{
    runtimeKind: AgentRuntimeKind;
    items: AgentRuntimeCommand[];
    complete: boolean;
  }> {
    const workspace = this.#requireWorkspace(workspaceId);
    const selected = runtimeKind
      ? { runtimeKind }
      : await this.#selection.resolve(workspace.id);
    this.assertRuntimeSelectable(selected.runtimeKind, workspace.id);
    const adapter = this.#requireAdapter(selected.runtimeKind);
    if (!adapter.listWorkspaceCommands && !adapter.listCommands) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime commands are not supported by this adapter",
      );
    }
    const listed = adapter.listWorkspaceCommands
      ? await callAdapter("read", () => adapter.listWorkspaceCommands!(workspace))
      : { items: [], complete: false };
    return {
      runtimeKind: selected.runtimeKind,
      items: listed.items,
      complete: listed.complete,
    };
  }

  async listSessionCommands(
    workspaceId: string,
    productSessionId: string,
  ): Promise<AgentRuntimeCommandListResponse> {
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.listCommands) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime commands are not supported by this adapter",
      );
    }
    const result = await callAdapter("read", () => adapter.listCommands!(binding));
    if (result.items.length > 0) {
      this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
        kind: "command.catalog.updated",
        items: result.items.map((item) => ({
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
        })),
        complete: result.complete,
      });
    }
    return { productSessionId, items: result.items, complete: result.complete };
  }

  async executeSessionCommand(
    workspaceId: string,
    productSessionId: string,
    name: string,
    input: { arguments?: string },
  ): Promise<{ turnId?: string }> {
    this.#assertAccepting();
    const commandName = name.trim();
    if (!commandName) {
      throw new ApiError(400, "invalid_payload", "command name is required");
    }
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.executeCommand) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime command execution is not supported by this adapter",
      );
    }
    this.#bindEventSession(binding);
    const turnId = randomUUID();
    this.#events?.beginTurn(binding.runtimeKind, binding.runtimeSessionId, turnId);
    const argumentsText = input.arguments?.trim();
    const commandText = `/${commandName}${argumentsText ? ` ${argumentsText}` : ""}`;
    const now = Date.now();
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "message.completed",
      message: {
        id: `user-${turnId}`,
        productSessionId,
        role: "user",
        parts: [{ type: "text", id: `user-text-${turnId}`, text: commandText }],
        createdAt: now,
        completedAt: now,
      },
    });
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.status",
      status: { type: "busy", turnId, startedAt: now },
    });
    void callAdapter("prompt", () => adapter.executeCommand!(
      binding,
      commandName,
      { ...(argumentsText ? { arguments: argumentsText } : {}) },
    )).then(
      () => {
        this.#settleBlockingPromptTurn(adapter, binding);
      },
      () => {
        this.#events?.endTurn(binding.runtimeKind, binding.runtimeSessionId);
        this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
          kind: "session.error",
          error: {
            code: "agent_runtime_command_failed",
            message: "Runtime command failed",
            retriable: true,
          },
        });
      },
    );
    return { turnId };
  }

  async readSessionMessages(
    workspaceId: string,
    productSessionId: string,
  ): Promise<AgentRuntimeMessagesResponse> {
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    this.#bindEventSession(binding);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (adapter.readMessages) {
      const read = await callAdapter("read", () => adapter.readMessages!(binding));
      return {
        productSessionId,
        messages: read.messages,
        complete: read.complete,
      };
    }
    // ACP session/load replays durable native history. Reattach before reading
    // the canonical event snapshot so a server restart does not turn a sticky
    // Grok session into an empty channel transcript.
    await callAdapter("read", () => adapter.getSession(binding));
    const snapshot = this.#events?.snapshot(productSessionId) ?? {
      events: [],
      complete: false,
    };
    const byId = projectRuntimeMessages(snapshot.events);
    return {
      productSessionId,
      messages: [...byId.values()].sort((left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
      complete: snapshot.complete,
    };
  }

  async cancelSession(workspaceId: string, productSessionId: string): Promise<void> {
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    this.#bindEventSession(binding);
    await callAdapter("cancel", () =>
      this.#requireAdapter(binding.runtimeKind).cancel(binding));
  }

  async closeSession(workspaceId: string, productSessionId: string): Promise<void> {
    this.#assertAccepting();
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.close) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime session close is not supported by this adapter",
      );
    }
    await callAdapter("update", () => adapter.close!(binding));
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.status",
      status: { type: "idle" },
    });
  }

  async resumeSession(
    workspaceId: string,
    productSessionId: string,
  ): Promise<AgentRuntimeSession> {
    this.#assertAccepting();
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.resume) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime session resume is not supported by this adapter",
      );
    }
    this.#bindEventSession(binding);
    return callAdapter("update", () => adapter.resume!(binding));
  }

  async setSessionModel(
    workspaceId: string,
    productSessionId: string,
    modelRef: AgentRuntimeModelRef,
  ): Promise<AgentRuntimeSession> {
    this.#assertAccepting();
    const workspace = this.#requireWorkspace(workspaceId);
    const store = this.#bindingStore(workspace);
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    const updated = await store.updateModelRef(productSessionId, modelRef);
    try {
      await callAdapter("update", () => adapter.setModel(updated, modelRef));
    } catch (runtimeError) {
      try {
        await store.updateModelRef(productSessionId, binding.modelRef);
      } catch {
        throw new ApiError(
          500,
          "runtime_session_model_rollback_failed",
          "Runtime model update failed and the durable binding could not be restored",
        );
      }
      throw runtimeError;
    }
    return sessionProjectionFromBinding(updated);
  }

  async setSessionMode(
    workspaceId: string,
    productSessionId: string,
    mode: string,
  ): Promise<AgentRuntimeSession> {
    this.#assertAccepting();
    const normalized = mode.trim();
    if (!normalized) {
      throw new ApiError(400, "invalid_payload", "mode is required");
    }
    const workspace = this.#requireWorkspace(workspaceId);
    const store = this.#bindingStore(workspace);
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.setMode) {
      throw new ApiError(409, "agent_runtime_capability_unsupported", "Runtime session mode is not supported by this adapter");
    }
    const updated = await store.updateMode(productSessionId, normalized);
    try {
      await callAdapter("update", () => adapter.setMode!(updated, normalized));
    } catch (runtimeError) {
      try {
        await store.updateMode(productSessionId, binding.mode);
      } catch {
        throw new ApiError(
          500,
          "runtime_session_mode_rollback_failed",
          "Runtime mode update failed and the durable binding could not be restored",
        );
      }
      throw runtimeError;
    }
    return sessionProjectionFromBinding(updated);
  }

  async respondSessionQuestion(
    workspaceId: string,
    productSessionId: string,
    questionId: string,
    answers: string[][],
  ): Promise<void> {
    this.#assertAccepting();
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    const adapter = this.#requireAdapter(binding.runtimeKind);
    if (!adapter.respondQuestion) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime questions are not supported by this adapter",
      );
    }
    await callAdapter("update", async () => {
      await adapter.respondQuestion!(binding, questionId, answers);
    });
  }

  async ensureEventSession(
    workspaceId: string,
    productSessionId: string,
  ): Promise<void> {
    const binding = await this.#requireBinding(workspaceId, productSessionId);
    this.#bindEventSession(binding);
  }

  async stop(): Promise<void> {
    this.beginDrain();
    await Promise.all([...this.#adapters.values()].map((adapter) => adapter.stop()));
  }

  beginDrain(): void {
    this.#draining = true;
  }

  availableRuntimeKinds(): AgentRuntimeKind[] {
    return [...this.#adapters.keys()];
  }

  selectableRuntimeKinds(workspaceId?: string): AgentRuntimeKind[] {
    return this.availableRuntimeKinds().filter((runtimeKind) => {
      try {
        if (workspaceId) this.assertRuntimeSelectable(runtimeKind, workspaceId);
        else this.assertDefaultRuntimeSelectable(runtimeKind);
        return true;
      } catch {
        return false;
      }
    });
  }

  assertRuntimeSelectable(
    runtimeKind: AgentRuntimeKind,
    workspaceId?: string,
  ): void {
    this.#requireAdapter(runtimeKind);
    if (runtimeKind !== "grok-build") return;
    if (!this.#grokNewSessionsEnabled) {
      throw new ApiError(
        409,
        "agent_runtime_new_sessions_disabled",
        "New Grok sessions are disabled by the host rollout policy",
      );
    }
    if (
      workspaceId
      && this.#grokWorkspaceAllowlist
      && !this.#grokWorkspaceAllowlist.has(workspaceId)
    ) {
      throw new ApiError(
        409,
        "agent_runtime_workspace_not_allowed",
        "Grok sessions are not enabled for this workspace",
      );
    }
  }

  assertDefaultRuntimeSelectable(runtimeKind: AgentRuntimeKind): void {
    this.assertRuntimeSelectable(runtimeKind);
    if (
      runtimeKind === "grok-build"
      && this.#grokWorkspaceAllowlist
      && [...this.#workspaces.keys()].some(
        (workspaceId) => !this.#grokWorkspaceAllowlist!.has(workspaceId),
      )
    ) {
      throw new ApiError(
        409,
        "agent_runtime_default_not_allowed",
        "Grok cannot be the global default while its workspace allowlist is restricted",
      );
    }
  }

  async probeRuntime(runtimeKind: AgentRuntimeKind): Promise<{
    health: AgentRuntimeHealthSnapshot;
    capabilities?: AgentRuntimeCapabilities;
  }> {
    const result = await this.#requireAdapter(runtimeKind).probeCapabilities();
    return {
      ...result,
      health: canonicalHealthSnapshot(result.health),
    };
  }

  async getModelCatalog(
    workspaceId: string,
    runtimeKind?: AgentRuntimeKind,
  ): Promise<AgentRuntimeModelCatalog> {
    const workspace = this.#requireWorkspace(workspaceId);
    const selected = runtimeKind
      ? { runtimeKind, source: "explicit" as const }
      : await this.#selection.resolve(workspace.id);
    this.assertRuntimeSelectable(selected.runtimeKind, workspace.id);
    const selection = await this.#selection.read();
    const profileId = selected.runtimeKind === "grok-build"
      ? selectedGrokProfileId(selection.config?.grokBuild)
      : this.#opencodeProfileId;
    const adapter = this.#requireAdapter(selected.runtimeKind);
    if (!adapter.getModelCatalog) {
      throw new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        "Runtime model catalog is unavailable",
      );
    }
    return callAdapter("read", () => adapter.getModelCatalog!({
      productSessionId: "catalog-probe",
      workspace,
      profileId,
    }));
  }

  async authenticateRuntime(
    workspaceId: string,
    runtimeKind: AgentRuntimeKind,
    methodId: string,
  ): Promise<AgentRuntimeModelCatalog> {
    this.#assertAccepting();
    const workspace = this.#requireWorkspace(workspaceId);
    const adapter = this.#requireAdapter(runtimeKind);
    if (!adapter.authenticate) {
      throw new ApiError(
        409,
        "agent_runtime_auth_unsupported",
        "Runtime authentication is managed outside OnMyAgent",
      );
    }
    const selection = await this.#selection.read();
    const profileId = runtimeKind === "grok-build"
      ? selectedGrokProfileId(selection.config?.grokBuild)
      : this.#opencodeProfileId;
    return callAdapter("update", () => adapter.authenticate!({
      productSessionId: "authentication",
      workspace,
      profileId,
    }, methodId));
  }

  #assertAccepting(): void {
    if (this.#draining) throw new ApiError(503, "primary_runtime_draining", "Primary runtime is shutting down");
  }

  #requireWorkspace(workspaceId: string): WorkspaceInfo {
    const workspace = this.#workspaces.get(workspaceId);
    if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found");
    return workspace;
  }

  #requireAdapter(runtimeKind: AgentRuntimeKind): AgentRuntimeAdapter {
    const adapter = this.#adapters.get(runtimeKind);
    if (!adapter) throw new ApiError(409, "agent_runtime_unavailable", `Runtime ${runtimeKind} is unavailable`);
    return adapter;
  }

  assertGrokProfileSelectable(profileId: string): void {
    const adapter = this.#requireAdapter("grok-build");
    if (adapter.supportsProfile && !adapter.supportsProfile(profileId)) {
      throw new ApiError(
        409,
        "agent_runtime_profile_unavailable",
        "Configured Grok profile is unavailable",
      );
    }
  }

  async #requireBinding(workspaceId: string, productSessionId: string): Promise<RuntimeSessionBinding> {
    const binding = await this.#bindingStore(this.#requireWorkspace(workspaceId)).get(productSessionId);
    if (!binding) throw new ApiError(404, "runtime_session_binding_not_found", "Runtime session binding not found");
    return binding;
  }

  #settleBlockingPromptTurn(
    adapter: AgentRuntimeAdapter,
    binding: RuntimeSessionBinding,
  ): void {
    if (!adapter.promptResolvesWhenTurnEnds) return;
    const activeTurnId = this.#events?.activeTurnId(
      binding.runtimeKind,
      binding.runtimeSessionId,
    );
    if (activeTurnId) {
      this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
        kind: "turn.completed",
        turnId: activeTurnId,
        outcome: "completed",
      });
      this.#events?.endTurn(binding.runtimeKind, binding.runtimeSessionId);
    }
    this.#events?.emitForNative(binding.runtimeKind, binding.runtimeSessionId, {
      kind: "session.status",
      status: { type: "idle" },
    });
  }

  #bindEventSession(binding: RuntimeSessionBinding): void {
    this.#events?.bindNativeSession(
      binding.runtimeKind,
      binding.runtimeSessionId,
      binding.productSessionId,
      {
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
      },
    );
  }
}

export function selectedGrokProfileId(
  selection?: {
    profileId?: string;
    homeMode?: "system" | "managed";
    binaryMode?: "system" | "bundled";
  },
): string {
  // 显式 profileId 必须是 host 已知值（system/managed）；其余一律原样返回，
  // 交给 assertGrokProfileSelectable 拒绝（D-03/D-07：不得静默归一化成 system）。
  if (selection?.profileId && !["system", "managed"].includes(selection.profileId)) {
    return selection.profileId;
  }
  const homeMode = selection?.homeMode === "managed" ? "managed" : "system";
  const base = selection?.profileId === "managed" ? "managed" : homeMode;
  return selection?.binaryMode === "bundled" ? `${base}-bundled` : base;
}

function projectRuntimeMessages(
  events: readonly AgentRuntimeEvent[],
): Map<string, AgentRuntimeMessage> {
  const messages = new Map<string, AgentRuntimeMessage>();
  for (const event of events) {
    if (event.kind === "message.started" || event.kind === "message.completed") {
      messages.set(event.message.id, event.message);
      continue;
    }
    if (event.kind === "message.delta" || event.kind === "reasoning.delta") {
      const message = messages.get(event.messageId) ?? {
        id: event.messageId,
        productSessionId: event.productSessionId,
        role: "assistant" as const,
        parts: [],
        createdAt: event.emittedAt,
      };
      const type = event.kind === "message.delta" ? "text" : "reasoning";
      messages.set(event.messageId, {
        ...message,
        parts: appendRuntimeTextPart(
          message.parts,
          event.partId,
          type,
          event.delta,
        ),
      });
      continue;
    }
    if (event.kind === "reasoning.completed") {
      const message = messages.get(event.messageId) ?? {
        id: event.messageId,
        productSessionId: event.productSessionId,
        role: "assistant" as const,
        parts: [],
        createdAt: event.emittedAt,
      };
      messages.set(event.messageId, {
        ...message,
        parts: upsertRuntimePart(message.parts, event.part),
      });
      continue;
    }
    if (
      event.kind === "tool.started"
      || event.kind === "tool.updated"
      || event.kind === "tool.completed"
    ) {
      const messageId = event.messageId ?? `assistant-${event.part.toolCallId}`;
      const message = messages.get(messageId) ?? {
        id: messageId,
        productSessionId: event.productSessionId,
        role: "assistant" as const,
        parts: [],
        createdAt: event.emittedAt,
      };
      messages.set(messageId, {
        ...message,
        parts: upsertRuntimePart(message.parts, event.part),
      });
      continue;
    }
    if (event.kind === "turn.completed") {
      for (const [id, message] of messages) {
        if (message.role === "assistant" && message.completedAt === undefined) {
          messages.set(id, { ...message, completedAt: event.emittedAt });
        }
      }
    }
  }
  return messages;
}

function appendRuntimeTextPart(
  parts: readonly AgentRuntimePart[],
  partId: string,
  type: "text" | "reasoning",
  delta: string,
): AgentRuntimePart[] {
  const existing = parts.find((part) => part.id === partId);
  const next: AgentRuntimePart = existing?.type === type
    ? { ...existing, text: `${existing.text}${delta}` }
    : { type, id: partId, text: delta };
  return upsertRuntimePart(parts, next);
}

function upsertRuntimePart(
  parts: readonly AgentRuntimePart[],
  next: AgentRuntimePart,
): AgentRuntimePart[] {
  const index = parts.findIndex((part) => part.id === next.id);
  if (index < 0) return [...parts, next];
  return parts.map((part, current) => current === index ? next : part);
}

function canonicalHealthSnapshot(
  health: AgentRuntimeHealthSnapshot,
): AgentRuntimeHealthSnapshot {
  if (!health.error || health.error.code.startsWith("agent_runtime_")) {
    return health;
  }
  const error = health.health === "needs_auth"
    ? {
        code: "agent_runtime_auth_required",
        message: "The selected agent runtime requires authentication",
        retriable: true,
        remediation: "Sign in to the selected runtime profile",
      }
    : health.health === "degraded" && /model/i.test(health.error.code)
      ? {
          code: "agent_runtime_model_unavailable",
          message: "The selected runtime model is unavailable",
          retriable: false,
          remediation: "Choose a model available to the selected runtime profile",
        }
      : {
          code: "agent_runtime_unavailable",
          message: "The selected agent runtime is unavailable",
          retriable: health.error.retriable,
        };
  return { ...health, error };
}

function sessionProjectionFromBinding(
  binding: RuntimeSessionBinding,
): AgentRuntimeSession {
  return {
    productSessionId: binding.productSessionId,
    runtimeKind: binding.runtimeKind,
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

async function callAdapter<T>(
  operation: "create" | "read" | "delete" | "prompt" | "cancel" | "update",
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw new ApiError(
        502,
        "agent_runtime_request_failed",
        `Agent runtime ${operation} failed`,
      );
    }
    if (error.code.startsWith("agent_runtime_")) throw error;
    if (error.status === 401 || /auth/i.test(error.code)) {
      throw new ApiError(
        401,
        "agent_runtime_auth_required",
        "The selected agent runtime requires authentication",
      );
    }
    if (error.status === 404 || /session.+not.+found/i.test(error.code)) {
      throw new ApiError(
        404,
        "agent_runtime_session_not_found",
        "Agent runtime session not found",
      );
    }
    if (/model.+(unavailable|not.+found)/i.test(error.code)) {
      throw new ApiError(
        409,
        "agent_runtime_model_unavailable",
        "The selected runtime model is unavailable",
      );
    }
    if (error.status === 503 || error.status === 504) {
      throw new ApiError(
        503,
        "agent_runtime_unavailable",
        "The selected agent runtime is unavailable",
      );
    }
    throw new ApiError(
      502,
      "agent_runtime_request_failed",
      `Agent runtime ${operation} failed`,
    );
  }
}

function assertAuthorizedWorkingDirectory(
  directory: string,
  authorizedRoots: readonly string[],
): void {
  const target = resolve(directory);
  const authorized = isAbsolute(directory) && authorizedRoots.some((candidate) => {
    const root = resolve(candidate);
    const child = relative(root, target);
    return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
  });
  if (authorized) return;
  throw new ApiError(
    400,
    "agent_runtime_working_directory_invalid",
    "Runtime working directory is outside the authorized workspace roots",
  );
}
