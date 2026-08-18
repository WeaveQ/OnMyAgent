import { describe, expect, test } from "bun:test";
import type {
  AgentRuntimeKind,
  RuntimeSessionBinding,
} from "@onmyagent/types/agent-runtime";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import {
  PrimaryRuntimeRegistry,
  type AgentRuntimeAdapter,
} from "../src/services/primary-runtime-registry.js";
import { ApiError } from "../src/core/errors.js";
import { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";

const workspace: WorkspaceInfo = {
  id: "workspace-a",
  name: "Workspace A",
  path: "/fixture/workspace-a",
  preset: "starter",
  workspaceType: "local",
};

function adapter(runtimeKind: AgentRuntimeKind) {
  const created: string[] = [];
  const deleted: string[] = [];
  const modelUpdates: Array<{ productSessionId: string; modelId: string }> = [];
  const modeUpdates: Array<{ productSessionId: string; mode: string }> = [];
  let stopped = false;
  const value: AgentRuntimeAdapter = {
    runtimeKind,
    async probeCapabilities() {
      return {
        health: { runtimeKind, health: "ready", checkedAt: 1 },
      };
    },
    async createSession(input) {
      created.push(input.productSessionId);
      const runtimeSessionId = `${runtimeKind}-${input.productSessionId}`;
      return {
        runtimeSessionId,
        cwd: input.cwd ?? input.workspace.path,
        runtimeHome: `/runtime/${runtimeKind}`,
        profileId: input.profileId,
        session: {
          productSessionId: input.productSessionId,
          runtimeKind,
          runtimeSessionId,
          workspaceId: input.workspace.id,
          cwd: input.cwd ?? input.workspace.path,
          profileId: input.profileId,
          createdAt: 1,
          updatedAt: 1,
          status: { type: "idle" },
        },
      };
    },
    async getSession(binding) {
      return {
        productSessionId: binding.productSessionId,
        runtimeKind,
        runtimeSessionId: binding.runtimeSessionId,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
        createdAt: binding.createdAt,
        updatedAt: binding.createdAt,
        status: { type: "idle" },
      };
    },
    async forkSession(binding, newProductSessionId) {
      const runtimeSessionId = `${runtimeKind}-${newProductSessionId}`;
      return {
        runtimeSessionId,
        cwd: binding.cwd,
        runtimeHome: binding.runtimeHome,
        profileId: binding.profileId,
        session: {
          productSessionId: newProductSessionId,
          runtimeKind,
          runtimeSessionId,
          workspaceId: binding.workspaceId,
          cwd: binding.cwd,
          profileId: binding.profileId,
          createdAt: 2,
          updatedAt: 2,
          status: { type: "idle" },
        },
      };
    },
    async deleteSession(binding) { deleted.push(binding.productSessionId); },
    async prompt() { return {}; },
    async cancel() {},
    async setModel(binding, modelRef) {
      modelUpdates.push({
        productSessionId: binding.productSessionId,
        modelId: modelRef.modelId,
      });
    },
    async setMode(binding, mode) {
      modeUpdates.push({ productSessionId: binding.productSessionId, mode });
    },
    async stop() { stopped = true; },
  };
  return { value, created, deleted, modelUpdates, modeUpdates, stopped: () => stopped };
}

function memoryBindings() {
  const values = new Map<string, RuntimeSessionBinding>();
  return {
    values,
    store: {
      async get(id: string) { return values.get(id) ?? null; },
      async list() {
        return {
          version: 1 as const,
          revision: values.size,
          bindings: [...values.values()],
          complete: true,
          state: "ok" as const,
        };
      },
      async upsert(binding: RuntimeSessionBinding) {
        if (values.has(binding.productSessionId)) throw new Error("immutable");
        values.set(binding.productSessionId, binding);
        return binding;
      },
      async delete(id: string) { return values.delete(id); },
      async updateModelRef(id: string, modelRef: RuntimeSessionBinding["modelRef"]) {
        const current = values.get(id);
        if (!current) throw new Error("missing");
        const next = { ...current };
        if (modelRef) next.modelRef = modelRef;
        else delete next.modelRef;
        values.set(id, next);
        return next;
      },
      async updateMode(id: string, mode: string | undefined) {
        const current = values.get(id);
        if (!current) throw new Error("missing");
        const next = { ...current };
        if (mode) next.mode = mode;
        else delete next.mode;
        values.set(id, next);
        return next;
      },
    },
  };
}

describe("PrimaryRuntimeRegistry", () => {
  test("routes new sessions through selection and persists a sticky binding", async () => {
    const openCode = adapter("opencode");
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "workspace-override" as const, revision: 2 }; },
        async read() {
          return {
            state: "ok" as const,
            complete: true,
            config: { version: 1 as const, revision: 2, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {}, grokBuild: { profileId: "system" } },
          };
        },
      },
      adapters: [openCode.value, grok.value],
      bindingStore: () => bindings.store,
    });
    const session = await registry.createSession({ productSessionId: "product-a", workspaceId: workspace.id });
    expect(session.runtimeKind).toBe("grok-build");
    expect(grok.created).toEqual(["product-a"]);
    expect(openCode.created).toEqual([]);
    expect(bindings.values.get("product-a")).toMatchObject({
      runtimeKind: "grok-build",
      runtimeSessionId: "grok-build-product-a",
      profileId: "system",
      source: "workspace-override",
    });
  });

  test("allows only server-authorized secondary working directories", async () => {
    const openCode = adapter("opencode");
    const bindings = memoryBindings();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [openCode.value],
      bindingStore: () => bindings.store,
    });
    const externalRoot = "/fixture/authorized-external";
    const created = await registry.createSession({
      productSessionId: "authorized-secondary",
      workspaceId: workspace.id,
      workingDirectory: `${externalRoot}/task-output`,
      workingDirectoryRoots: [workspace.path, externalRoot],
    });
    expect(created.cwd).toBe(`${externalRoot}/task-output`);
    expect(bindings.values.get("authorized-secondary")?.cwd)
      .toBe(`${externalRoot}/task-output`);
    await expect(registry.createSession({
      productSessionId: "unauthorized-secondary",
      workspaceId: workspace.id,
      workingDirectory: "/fixture/not-authorized/task-output",
      workingDirectoryRoots: [workspace.path, externalRoot],
    })).rejects.toMatchObject({
      code: "agent_runtime_working_directory_invalid",
      status: 400,
    });
  });

  test("existing binding remains sticky after selection changes", async () => {
    const openCode = adapter("opencode");
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("existing", {
      productSessionId: "existing",
      runtimeKind: "opencode",
      runtimeSessionId: "native-existing",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "primary-opencode",
      runtimeHome: "/runtime/opencode",
      createdAt: 1,
    });
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 3 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [openCode.value, grok.value],
      bindingStore: () => bindings.store,
    });
    expect((await registry.getSession(workspace.id, "existing")).runtimeKind).toBe("opencode");
  });

  test("forks an Assistant into a new sticky product binding and rejects Expert fork", async () => {
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    const source: RuntimeSessionBinding = {
      productSessionId: "source",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-source",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      profile: { kind: "assistant" },
      createdAt: 1,
    };
    bindings.values.set(source.productSessionId, source);
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
    });
    await expect(registry.forkSession(workspace.id, "source", "forked"))
      .resolves.toMatchObject({
        productSessionId: "forked",
        parentProductSessionId: "source",
        runtimeKind: "grok-build",
      });
    expect(bindings.values.get("forked")).toMatchObject({
      parentProductSessionId: "source",
      runtimeKind: "grok-build",
      source: "explicit",
    });
    bindings.values.set("expert-source", {
      ...source,
      productSessionId: "expert-source",
      runtimeSessionId: "native-expert",
      profile: {
        kind: "expert",
        expertId: "expert",
        name: "Expert",
        description: "Fixture",
        systemPrompt: "Instructions",
        declaredSkillNames: [],
        activatedSkillNames: [],
        approvedAgentIds: [],
      },
    });
    await expect(registry.forkSession(workspace.id, "expert-source", "unsafe-fork"))
      .rejects.toMatchObject({ code: "agent_runtime_capability_unsupported" });
  });

  test("deletes the exact native fork when sticky binding persistence fails", async () => {
    const grok = adapter("grok-build");
    const source: RuntimeSessionBinding = {
      productSessionId: "source",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-source",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      profile: { kind: "assistant" },
      createdAt: 1,
    };
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => ({
        async get(id: string) { return id === source.productSessionId ? source : null; },
        async list() { return { version: 1 as const, revision: 1, bindings: [source], complete: true, state: "ok" as const }; },
        async upsert() { throw new Error("binding disk unavailable"); },
        async delete() { return false; },
        async updateModelRef() { throw new Error("unused"); },
        async updateMode() { throw new Error("unused"); },
      }),
    });
    await expect(registry.forkSession(workspace.id, "source", "fork-failed"))
      .rejects.toThrow("binding disk unavailable");
    expect(grok.deleted).toEqual(["fork-failed"]);
  });

  test("projects event-backed messages for adapters without native history reads", async () => {
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("event-backed", {
      productSessionId: "event-backed",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-event",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      createdAt: 1,
    });
    const events = new PrimaryRuntimeEventBus();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
      events,
    });
    await registry.promptSession(workspace.id, "event-backed", { text: "hello" });
    events.emitForNative("grok-build", "native-event", {
      kind: "message.delta",
      messageId: "assistant-turn",
      partId: "assistant-text",
      delta: "hello ",
    });
    events.emitForNative("grok-build", "native-event", {
      kind: "message.delta",
      messageId: "assistant-turn",
      partId: "assistant-text",
      delta: "back",
    });
    events.emitForNative("grok-build", "native-event", {
      kind: "turn.completed",
      turnId: "turn",
      outcome: "completed",
    });
    const response = await registry.readSessionMessages(workspace.id, "event-backed");
    expect(response).toMatchObject({ productSessionId: "event-backed", complete: true });
    expect(response.messages.find((message) => message.role === "user"))
      .toEqual(expect.objectContaining({
      role: "user",
      parts: [expect.objectContaining({ type: "text", text: "hello" })],
    }));
    expect(response.messages.find((message) => message.role === "assistant"))
      .toEqual(expect.objectContaining({
      role: "assistant",
      completedAt: expect.any(Number),
      parts: [expect.objectContaining({ type: "text", text: "hello back" })],
    }));
  });

  test("idles a blocking Grok prompt when session/prompt returns without turn_completed", async () => {
    const grok = adapter("grok-build");
    grok.value.promptResolvesWhenTurnEnds = true;
    let releasePrompt: (() => void) | undefined;
    grok.value.prompt = () => new Promise((resolve) => {
      releasePrompt = () => resolve({});
    });
    const bindings = memoryBindings();
    const events = new PrimaryRuntimeEventBus();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "grok-build" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
      events,
    });
    await registry.createSession({ productSessionId: "blocking-prompt", workspaceId: workspace.id });
    await registry.promptSession(workspace.id, "blocking-prompt", { text: "hello" });
    expect(events.snapshot("blocking-prompt").events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "session.status",
        status: expect.objectContaining({ type: "busy" }),
      }),
    ]));
    expect(events.snapshot("blocking-prompt").events.some((event) => event.kind === "turn.completed"))
      .toBe(false);
    releasePrompt?.();
    await Bun.sleep(0);
    const kinds = events.snapshot("blocking-prompt").events.map((event) => event.kind);
    expect(kinds).toContain("turn.completed");
    expect(events.snapshot("blocking-prompt").events.at(-1)).toMatchObject({
      kind: "session.status",
      status: { type: "idle" },
    });
    expect(events.activeTurnId("grok-build", "grok-build-blocking-prompt")).toBeNull();
  });

  test("does not idle OpenCode when prompt() returns before native session.idle", async () => {
    const openCode = adapter("opencode");
    const bindings = memoryBindings();
    const events = new PrimaryRuntimeEventBus();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [openCode.value],
      bindingStore: () => bindings.store,
      events,
    });
    await registry.createSession({ productSessionId: "async-prompt", workspaceId: workspace.id });
    await registry.promptSession(workspace.id, "async-prompt", { text: "hello" });
    await Bun.sleep(0);
    expect(events.snapshot("async-prompt").events.some((event) => event.kind === "turn.completed"))
      .toBe(false);
    expect(events.snapshot("async-prompt").events.at(-1)).toMatchObject({
      kind: "session.status",
      status: expect.objectContaining({ type: "busy" }),
    });
    expect(events.activeTurnId("opencode", "opencode-async-prompt")).toBeTruthy();
  });


  test("refreshes native list metadata and retains partial or missing sticky bindings", async () => {
    const openCode = adapter("opencode");
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("older", {
      productSessionId: "older",
      runtimeKind: "opencode",
      runtimeSessionId: "native-older",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "primary-opencode",
      runtimeHome: "/runtime/opencode",
      createdAt: 1,
    });
    bindings.values.set("missing-native", {
      productSessionId: "missing-native",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-missing",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      createdAt: 2,
    });
    grok.value.getSession = async () => { throw new Error("must not load"); };
    openCode.value.refreshSessions = async () => ({
      sessions: [{
        productSessionId: "older",
        runtimeKind: "opencode",
        runtimeSessionId: "native-older",
        workspaceId: workspace.id,
        cwd: workspace.path,
        profileId: "primary-opencode",
        title: "Native title",
        createdAt: 1,
        updatedAt: 9,
        status: { type: "idle" },
      }],
      missingRuntimeSessionIds: [],
      failedRuntimeSessionIds: [],
      complete: true,
    });
    grok.value.refreshSessions = async () => ({
      sessions: [],
      missingRuntimeSessionIds: ["native-missing"],
      failedRuntimeSessionIds: [],
      complete: true,
    });
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [openCode.value, grok.value],
      bindingStore: () => bindings.store,
    });
    expect(await registry.listSessions(workspace.id)).toEqual({
      items: [
        expect.objectContaining({ productSessionId: "older", runtimeKind: "opencode", title: "Native title", updatedAt: 9 }),
        expect.objectContaining({ productSessionId: "missing-native", runtimeKind: "grok-build" }),
      ],
      complete: true,
      failures: [{
        productSessionId: "missing-native",
        runtimeKind: "grok-build",
        code: "runtime_session_native_missing",
      }],
    });
  });

  test("retains sticky sessions when one native refresh source is unavailable", async () => {
    const openCode = adapter("opencode");
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("open", {
      productSessionId: "open", runtimeKind: "opencode", runtimeSessionId: "native-open",
      workspaceId: workspace.id, cwd: workspace.path, profileId: "primary-opencode",
      runtimeHome: "/runtime/opencode", createdAt: 1,
    });
    bindings.values.set("grok", {
      productSessionId: "grok", runtimeKind: "grok-build", runtimeSessionId: "native-grok",
      workspaceId: workspace.id, cwd: workspace.path, profileId: "system",
      runtimeHome: "/runtime/grok", createdAt: 2,
    });
    openCode.value.refreshSessions = async () => {
      throw new Error("source offline");
    };
    grok.value.refreshSessions = async () => ({
      sessions: [],
      missingRuntimeSessionIds: ["native-grok"],
      failedRuntimeSessionIds: [],
      complete: true,
    });
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [openCode.value, grok.value],
      bindingStore: () => bindings.store,
    });
    expect(await registry.listSessions(workspace.id)).toEqual({
      items: [
        expect.objectContaining({ productSessionId: "grok" }),
        expect.objectContaining({ productSessionId: "open" }),
      ],
      complete: false,
      failures: [
        { productSessionId: "grok", runtimeKind: "grok-build", code: "runtime_session_native_missing" },
        { productSessionId: "open", runtimeKind: "opencode", code: "runtime_session_source_unavailable" },
      ],
    });
  });

  test("rolls back native create if binding persistence fails and drains adapters", async () => {
    const grok = adapter("grok-build");
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "explicit" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => ({
        async get() { return null; },
        async list() { return { version: 1, revision: 0, bindings: [], complete: true, state: "ok" }; },
        async upsert() { throw new Error("disk unavailable"); },
        async delete() { return false; },
      }),
    });
    await expect(registry.createSession({ productSessionId: "product-b", workspaceId: workspace.id }))
      .rejects.toThrow("disk unavailable");
    expect(grok.deleted).toEqual(["product-b"]);
    await registry.stop();
    expect(grok.stopped()).toBe(true);
    await expect(registry.createSession({ productSessionId: "late", workspaceId: workspace.id }))
      .rejects.toMatchObject({ code: "primary_runtime_draining" });
  });

  test("normalizes native adapter errors at the canonical boundary", async () => {
    const openCode = adapter("opencode");
    const bindings = memoryBindings();
    bindings.values.set("existing", {
      productSessionId: "existing",
      runtimeKind: "opencode",
      runtimeSessionId: "native-existing",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "primary-opencode",
      runtimeHome: "/runtime/opencode",
      createdAt: 1,
    });
    openCode.value.getSession = async () => {
      throw new ApiError(404, "opencode_session_not_found", "native secret detail");
    };
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "opencode" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [openCode.value],
      bindingStore: () => bindings.store,
    });
    await expect(registry.getSession(workspace.id, "existing")).rejects.toMatchObject({
      status: 404,
      code: "agent_runtime_session_not_found",
      message: "Agent runtime session not found",
    });
  });

  test("normalizes runtime health errors before exposing them to clients", async () => {
    const grok = adapter("grok-build");
    grok.value.probeCapabilities = async () => ({
      health: {
        runtimeKind: "grok-build",
        health: "needs_auth",
        checkedAt: 1,
        error: {
          code: "grok_auth_required",
          message: "native auth detail",
          retriable: true,
        },
      },
    });
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
    });
    await expect(registry.probeRuntime("grok-build")).resolves.toMatchObject({
      health: {
        health: "needs_auth",
        error: {
          code: "agent_runtime_auth_required",
          message: "The selected agent runtime requires authentication",
        },
      },
    });
  });

  test("kill switch blocks only new Grok sessions and preserves sticky bindings", async () => {
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("existing", {
      productSessionId: "existing",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-existing",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      createdAt: 1,
    });
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "workspace-override" as const, revision: 1 }; },
        async read() { return { state: "ok" as const, complete: true, config: { version: 1 as const, revision: 1, defaultRuntimeKind: "opencode" as const, workspaceOverrides: { [workspace.id]: "grok-build" as const }, grokBuild: { profileId: "system" } } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
      runtimeRollout: { grokNewSessionsEnabled: false },
    });
    expect(registry.availableRuntimeKinds()).toEqual(["grok-build"]);
    expect(registry.selectableRuntimeKinds()).toEqual([]);
    await expect(registry.createSession({
      productSessionId: "new",
      workspaceId: workspace.id,
    })).rejects.toMatchObject({ code: "agent_runtime_new_sessions_disabled" });
    expect((await registry.getSession(workspace.id, "existing")).runtimeKind)
      .toBe("grok-build");
    await registry.cancelSession(workspace.id, "existing");
    await registry.deleteSession(workspace.id, "existing");
    expect(grok.deleted).toEqual(["existing"]);
  });

  test("workspace allowlist blocks non-opted-in creates and global default", async () => {
    const grok = adapter("grok-build");
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace, { ...workspace, id: "workspace-b", path: "/fixture/workspace-b" }],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "workspace-override" as const, revision: 1 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      runtimeRollout: {
        grokNewSessionsEnabled: true,
        grokWorkspaceAllowlist: [workspace.id],
      },
    });
    expect(() => registry.assertDefaultRuntimeSelectable("grok-build"))
      .toThrow(expect.objectContaining({ code: "agent_runtime_default_not_allowed" }));
    expect(() => registry.assertRuntimeSelectable("grok-build", "workspace-b"))
      .toThrow(expect.objectContaining({ code: "agent_runtime_workspace_not_allowed" }));
    expect(() => registry.assertRuntimeSelectable("grok-build", workspace.id))
      .not.toThrow();
  });

  test("records canonical user turns and releases retained event history on delete", async () => {
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    const events = new PrimaryRuntimeEventBus();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "grok-build" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
      events,
    });
    await registry.createSession({ productSessionId: "product-turns", workspaceId: workspace.id });
    const prompt = await registry.promptSession(
      workspace.id,
      "product-turns",
      { text: "hello", messageId: "product-user" },
    );
    const beforeDelete = events.snapshot("product-turns");
    expect(prompt.turnId).toBeString();
    expect(beforeDelete.events).toContainEqual(expect.objectContaining({
      kind: "message.completed",
      message: expect.objectContaining({
        id: "product-user",
        role: "user",
        parts: [expect.objectContaining({ text: "hello" })],
      }),
    }));
    await registry.deleteSession(workspace.id, "product-turns");
    expect(events.snapshot("product-turns")).toMatchObject({
      latestSequence: 0,
      events: [],
      complete: true,
    });
  });

  test("validates prompt capability before recording an accepted turn", async () => {
    const grok = adapter("grok-build");
    grok.value.validatePrompt = (_binding, input) => {
      if (input.systemPrompt) {
        throw new ApiError(
          409,
          "agent_runtime_capability_unsupported",
          "Unsupported prompt shape",
        );
      }
    };
    const bindings = memoryBindings();
    const events = new PrimaryRuntimeEventBus();
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "grok-build" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
      events,
    });
    await registry.createSession({ productSessionId: "prompt-validation", workspaceId: workspace.id });
    const before = events.snapshot("prompt-validation").latestSequence;
    await expect(registry.promptSession(workspace.id, "prompt-validation", {
      text: "hello",
      systemPrompt: "unsupported",
    })).rejects.toMatchObject({ code: "agent_runtime_capability_unsupported" });
    expect(events.snapshot("prompt-validation").latestSequence).toBe(before);
  });

  test("persists a model update before applying it to the native runtime", async () => {
    const order: string[] = [];
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("model-session", {
      productSessionId: "model-session",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-model-session",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      createdAt: 1,
    });
    const originalUpdate = bindings.store.updateModelRef;
    bindings.store.updateModelRef = async (id, modelRef) => {
      order.push(`persist:${modelRef?.modelId ?? "default"}`);
      return originalUpdate(id, modelRef);
    };
    grok.value.setModel = async (_binding, modelRef) => {
      order.push(`native:${modelRef.modelId}`);
    };
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "grok-build" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
    });

    await expect(registry.setSessionModel(workspace.id, "model-session", {
      modelId: "grok-4.5",
    })).resolves.toMatchObject({ modelRef: { modelId: "grok-4.5" } });
    expect(order).toEqual(["persist:grok-4.5", "native:grok-4.5"]);
    expect(bindings.values.get("model-session")?.modelRef).toEqual({ modelId: "grok-4.5" });
  });

  test("restores the durable model binding when the native runtime rejects the update", async () => {
    const grok = adapter("grok-build");
    const bindings = memoryBindings();
    bindings.values.set("model-session", {
      productSessionId: "model-session",
      runtimeKind: "grok-build",
      runtimeSessionId: "native-model-session",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "system",
      runtimeHome: "/runtime/grok-build",
      modelRef: { modelId: "grok-4.5" },
      createdAt: 1,
    });
    grok.value.setModel = async () => {
      throw new ApiError(409, "grok_model_unavailable", "fixture");
    };
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "grok-build" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value],
      bindingStore: () => bindings.store,
    });

    await expect(registry.setSessionModel(workspace.id, "model-session", {
      modelId: "other-model",
    })).rejects.toMatchObject({ code: "agent_runtime_model_unavailable" });
    expect(bindings.values.get("model-session")?.modelRef).toEqual({ modelId: "grok-4.5" });
  });

  test("persists runtime mode before applying it to Grok and rejects unsupported adapters", async () => {
    const grok = adapter("grok-build");
    const openCode = adapter("opencode");
    delete openCode.value.setMode;
    const bindings = memoryBindings();
    bindings.values.set("grok-mode", {
      productSessionId: "grok-mode", runtimeKind: "grok-build", runtimeSessionId: "native-grok",
      workspaceId: workspace.id, cwd: workspace.path, profileId: "system",
      runtimeHome: "/runtime/grok", createdAt: 1,
    });
    bindings.values.set("opencode-mode", {
      productSessionId: "opencode-mode", runtimeKind: "opencode", runtimeSessionId: "native-open",
      workspaceId: workspace.id, cwd: workspace.path, profileId: "primary-opencode",
      runtimeHome: "/runtime/opencode", createdAt: 1,
    });
    const registry = new PrimaryRuntimeRegistry({
      workspaces: [workspace],
      selection: {
        async resolve() { return { runtimeKind: "grok-build" as const, source: "global-default" as const, revision: 0 }; },
        async read() { return { state: "missing" as const, complete: true, config: { version: 1 as const, revision: 0, defaultRuntimeKind: "opencode" as const, workspaceOverrides: {} } }; },
      },
      adapters: [grok.value, openCode.value],
      bindingStore: () => bindings.store,
    });
    await expect(registry.setSessionMode(workspace.id, "grok-mode", "plan"))
      .resolves.toMatchObject({ mode: "plan" });
    expect(grok.modeUpdates).toEqual([{ productSessionId: "grok-mode", mode: "plan" }]);
    await expect(registry.setSessionMode(workspace.id, "opencode-mode", "plan"))
      .rejects.toMatchObject({ code: "agent_runtime_capability_unsupported" });
    expect(bindings.values.get("opencode-mode")?.mode).toBeUndefined();
  });
});
