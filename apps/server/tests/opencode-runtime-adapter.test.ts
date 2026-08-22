import { describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { OpenCodeRuntimeAdapter } from "../src/services/opencode-runtime-adapter.js";

const workspace: WorkspaceInfo = {
  id: "workspace",
  name: "Workspace",
  path: "/workspace",
  preset: "starter",
  workspaceType: "local",
};

const config = {
  opencodeBaseUrl: "http://127.0.0.1:1",
  workspaces: [workspace],
} as ServerConfig;

describe("OpenCodeRuntimeAdapter", () => {
  test("maps native create/get/delete while preserving product identity", async () => {
    const calls: string[] = [];
    const createdInputs: unknown[] = [];
    const boundNativeIds: string[] = [];
    const cleanedProductIds: string[] = [];
    const client = {
      event: { async subscribe() { return { stream: { async *[Symbol.asyncIterator]() { await new Promise(() => undefined); } } }; } },
      session: {
        async create(input: unknown) {
          calls.push("create");
          createdInputs.push(input);
          return response({ id: "native", title: "Created", time: { created: 10, updated: 11 } });
        },
        async get() {
          calls.push("get");
          return response({ id: "native", title: "Loaded", time: { created: 10, updated: 12 } });
        },
        async delete() {
          calls.push("delete");
          return response(true);
        },
      },
    };
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: {
        profileId: "desktop-managed",
        runtimeHome: "/runtime/opencode",
        sandboxProfile: "desktop-managed",
      },
      getClient: () => client as never,
      compileSessionProfile: async () => ({
        cwd: "/runtime/expert",
        bindRuntimeIdentity: async (runtimeSessionId) => {
          boundNativeIds.push(runtimeSessionId);
        },
      }),
      cleanupSession: async (binding) => {
        cleanedProductIds.push(binding.productSessionId);
      },
    });
    const created = await adapter.createSession({
      productSessionId: "product",
      profileId: "desktop-managed",
      workspace,
    });
    expect(created).toMatchObject({
      runtimeSessionId: "native",
      runtimeHome: "/runtime/opencode",
      profileId: "desktop-managed",
      sandboxProfile: "desktop-managed",
      session: {
        productSessionId: "product",
        runtimeKind: "opencode",
        runtimeSessionId: "native",
        title: "Created",
      },
    });
    const binding = {
      productSessionId: "product",
      runtimeKind: "opencode" as const,
      runtimeSessionId: "native",
      workspaceId: "workspace",
      cwd: "/runtime/expert",
      profileId: "desktop-managed",
      runtimeHome: "/runtime/opencode",
      createdAt: 10,
    };
    await expect(adapter.getSession(binding)).resolves.toMatchObject({
      productSessionId: "product",
      updatedAt: 12,
      title: "Loaded",
    });
    await adapter.deleteSession(binding);
    expect(calls).toEqual(["create", "get", "delete"]);
    expect(createdInputs).toEqual([{ directory: "/runtime/expert" }]);
    expect(boundNativeIds).toEqual(["native"]);
    expect(cleanedProductIds).toEqual(["product"]);
  });

  test("cleans an isolated profile when native creation fails", async () => {
    let cleanupCount = 0;
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => ({
        session: {
          async create() { throw new Error("native create failed"); },
        },
      }) as never,
      compileSessionProfile: async () => ({
        cwd: "/runtime/expert",
        cleanup: async () => { cleanupCount += 1; },
      }),
    });
    await expect(adapter.createSession({
      productSessionId: "product",
      profileId: "desktop-managed",
      workspace,
    })).rejects.toThrow("native create failed");
    expect(cleanupCount).toBe(1);
  });

  test("deletes the exact native session when expert identity binding fails", async () => {
    const deleted: unknown[] = [];
    let cleanupCount = 0;
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => ({
        session: {
          async create() { return response({ id: "native-orphan" }); },
          async delete(input: unknown) { deleted.push(input); return response(true); },
        },
      }) as never,
      compileSessionProfile: async () => ({
        cwd: "/runtime/expert",
        bindRuntimeIdentity: async () => { throw new Error("marker bind failed"); },
        cleanup: async () => { cleanupCount += 1; },
      }),
    });
    await expect(adapter.createSession({
      productSessionId: "product",
      profileId: "desktop-managed",
      workspace,
    })).rejects.toThrow("marker bind failed");
    expect(deleted).toEqual([{ sessionID: "native-orphan" }]);
    expect(cleanupCount).toBe(1);
  });

  test("rejects runtime-only model references before creating a native session", async () => {
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: {
        profileId: "desktop-managed",
        runtimeHome: "/runtime/opencode",
      },
      getClient: () => {
        throw new Error("model validation must happen before client creation");
      },
    });
    await expect(adapter.createSession({
      productSessionId: "product-session",
      profileId: "primary-opencode",
      modelRef: { modelId: "model-without-provider" },
      workspace,
    })).rejects.toMatchObject({ code: "agent_runtime_model_ref_invalid" });
  });

  test("normalizes native text and reasoning messages behind the canonical read model", async () => {
    const client = {
      session: {
        async messages() {
          return response([{
            info: {
              id: "assistant-1",
              sessionID: "native",
              role: "assistant",
              time: { created: 20, completed: 21 },
            },
            parts: [
              { id: "reasoning-1", messageID: "assistant-1", sessionID: "native", type: "reasoning", text: "think" },
              { id: "text-1", messageID: "assistant-1", sessionID: "native", type: "text", text: "answer" },
            ],
          }]);
        },
      },
    };
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => client as never,
    });
    await expect(adapter.readMessages({
      productSessionId: "product",
      runtimeKind: "opencode",
      runtimeSessionId: "native",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "desktop-managed",
      runtimeHome: "/runtime/opencode",
      createdAt: 10,
    })).resolves.toEqual({
      complete: true,
      messages: [expect.objectContaining({
        id: "assistant-1",
        productSessionId: "product",
        role: "assistant",
        createdAt: 20,
        completedAt: 21,
        parts: [
          { id: "reasoning-1", type: "reasoning", text: "think" },
          { id: "text-1", type: "text", text: "answer" },
        ],
      })],
    });
  });

  test("forks a native Assistant session without changing its runtime identity", async () => {
    const calls: unknown[] = [];
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => ({
        session: {
          async fork(input: unknown) {
            calls.push(input);
            return response({ id: "native-fork", title: "Fork", time: { created: 30, updated: 30 } });
          },
        },
      }) as never,
    });
    const forked = await adapter.forkSession({
      productSessionId: "source-product",
      runtimeKind: "opencode",
      runtimeSessionId: "native-source",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "desktop-managed",
      runtimeHome: "/runtime/opencode",
      createdAt: 10,
    }, "fork-product");
    expect(calls).toEqual([{
      sessionID: "native-source",
      directory: workspace.path,
    }]);
    expect(forked).toMatchObject({
      runtimeSessionId: "native-fork",
      session: { productSessionId: "fork-product", title: "Fork" },
    });
  });

  test("normalizes and executes native OpenCode commands", async () => {
    const calls: unknown[] = [];
    const client = {
      event: { async subscribe() { return { stream: { async *[Symbol.asyncIterator]() { await new Promise(() => undefined); } } }; } },
      command: {
        async list() {
          return response([
            { name: "compact", description: "Compact", source: "command" },
            { name: "review", description: "Review", source: "skill" },
          ]);
        },
      },
      session: {
        async command(input: unknown) {
          calls.push(input);
          return response({});
        },
      },
    };
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => client as never,
    });
    const binding = {
      productSessionId: "product",
      runtimeKind: "opencode" as const,
      runtimeSessionId: "native",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "desktop-managed",
      runtimeHome: "/runtime/opencode",
      createdAt: 10,
    };
    await expect(adapter.listCommands(binding)).resolves.toEqual({
      complete: true,
      items: [
        { id: "opencode:command:compact", name: "compact", description: "Compact", source: "command" },
        { id: "opencode:skill:review", name: "review", description: "Review", source: "skill" },
      ],
    });
    await adapter.executeCommand(binding, "compact", { arguments: "keep auth" });
    expect(calls).toEqual([{
      sessionID: "native",
      directory: "/workspace",
      command: "compact",
      arguments: "keep auth",
    }]);
  });

  test("refreshes native list metadata without loading each sticky session", async () => {
    const client = {
      session: {
        async list() {
          return response([{ id: "native", title: "Fresh", time: { created: 10, updated: 20 } }]);
        },
      },
    };
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => client as never,
    });
    const binding = {
      productSessionId: "product",
      runtimeKind: "opencode" as const,
      runtimeSessionId: "native",
      workspaceId: workspace.id,
      cwd: workspace.path,
      profileId: "desktop-managed",
      runtimeHome: "/runtime/opencode",
      createdAt: 10,
    };
    await expect(adapter.refreshSessions([binding])).resolves.toEqual({
      sessions: [expect.objectContaining({ productSessionId: "product", title: "Fresh", updatedAt: 20 })],
      missingRuntimeSessionIds: [],
      failedRuntimeSessionIds: [],
      complete: true,
    });
  });

  test("establishes one directory event stream before prompt and stops it", async () => {
    let subscribeCalls = 0;
    let aborted = false;
    const nativeEvents: unknown[] = [];
    const client = {
      event: {
        async subscribe(_input: unknown, options: { signal: AbortSignal }) {
          subscribeCalls += 1;
          options.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
          return { stream: { async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve) => {
              if (options.signal.aborted) resolve();
              else options.signal.addEventListener("abort", () => resolve(), { once: true });
            });
          } } };
        },
      },
      session: {
        async get() { return response({ id: "native", time: { created: 10 } }); },
        async promptAsync() { return response({}); },
      },
    };
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => client as never,
      onNativeEvent: (value) => nativeEvents.push(value),
    });
    const binding = {
      productSessionId: "product", runtimeKind: "opencode" as const,
      runtimeSessionId: "native", workspaceId: workspace.id, cwd: workspace.path,
      profileId: "desktop-managed", runtimeHome: "/runtime/opencode", createdAt: 10,
    };
    await adapter.getSession(binding);
    await adapter.prompt(binding, { text: "hello" });
    expect(subscribeCalls).toBe(1);
    expect(nativeEvents).toEqual([]);
    await adapter.stop();
    expect(aborted).toBe(true);
  });

  test("forwards the complete canonical prompt shape to OpenCode", async () => {
    const prompts: unknown[] = [];
    const client = {
      event: { async subscribe() { return { stream: { async *[Symbol.asyncIterator]() { await new Promise(() => undefined); } } }; } },
      session: {
        async promptAsync(input: unknown) {
          prompts.push(input);
          return response({});
        },
      },
    };
    const adapter = new OpenCodeRuntimeAdapter({
      config,
      identity: { profileId: "desktop-managed", runtimeHome: "/runtime/opencode" },
      getClient: () => client as never,
    });
    await adapter.prompt({
      productSessionId: "product", runtimeKind: "opencode",
      runtimeSessionId: "native", workspaceId: workspace.id, cwd: workspace.path,
      profileId: "desktop-managed", runtimeHome: "/runtime/opencode", createdAt: 10,
      modelRef: { providerId: "provider", modelId: "model", variant: "low" },
    }, {
      text: "visible",
      messageId: "message",
      systemPrompt: "system",
      agentId: "assistant-agent",
      toolAccess: { bash: false },
      parts: [
        { type: "text", text: "visible" },
        { type: "file", url: "data:text/plain;base64,QQ==", filename: "a.txt", mime: "text/plain" },
      ],
    });
    expect(prompts).toEqual([{
      sessionID: "native",
      directory: "/workspace",
      model: { providerID: "provider", modelID: "model" },
      variant: "low",
      parts: [
        { type: "text", text: "visible" },
        { type: "file", url: "data:text/plain;base64,QQ==", filename: "a.txt", mime: "text/plain" },
      ],
      messageID: "message",
      agent: "assistant-agent",
      tools: { bash: false },
      system: "system",
    }]);
    await adapter.stop();
  });
});

function response<T>(data: T) {
  return {
    data,
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
}
