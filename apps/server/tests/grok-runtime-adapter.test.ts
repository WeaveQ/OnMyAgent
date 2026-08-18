import { describe, expect, test } from "bun:test";
import type { RuntimeSessionBinding } from "@onmyagent/types/agent-runtime";
import { ApiError } from "../src/core/errors.js";
import { GrokRuntimeAdapter, capabilitiesFromInitialize, catalogFromInitialize } from "../src/services/grok-runtime-adapter.js";

function processFixture(input: { extensions?: string[] } = {}) {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const initialized = {
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {}, close: {} } },
    _meta: { agentVersion: "1.0.0", extensionMethods: input.extensions ?? [] },
  };
  return {
    requests,
    handle: {
      initialized,
      isAlive: () => true,
      async stop() {},
      transport: {
        async request(method: string, params: Record<string, unknown>) {
          requests.push({ method, params });
          if (method === "session/new") return { sessionId: "native-session" };
          return {};
        },
      },
    },
  };
}

const binding: RuntimeSessionBinding = {
  productSessionId: "product-session",
  runtimeKind: "grok-build",
  runtimeSessionId: "native-session",
  workspaceId: "workspace",
  cwd: "/workspace",
  profileId: "system",
  runtimeHome: "/runtime/grok",
  createdAt: 1,
};

describe("GrokRuntimeAdapter", () => {
  test("maps initialize model/auth state into a runtime-scoped catalog without a session", () => {
    expect(catalogFromInitialize({
      authMethods: [{ id: "cached", name: "Signed in" }],
      _meta: {
        modelState: {
          currentModelId: "grok-4.5",
          availableModels: [{ modelId: "grok-4.5", name: "Grok 4.5" }],
        },
      },
    }, {
      workspace: { id: "workspace", path: "/workspace" } as never,
      profileId: "system",
    })).toEqual({
      runtimeKind: "grok-build",
      profileId: "system",
      workspaceId: "workspace",
      models: [{
        ref: { modelId: "grok-4.5" },
        displayName: "Grok 4.5",
        available: true,
        capabilities: { text: true, imageInput: false, tools: true, reasoning: true },
      }],
      defaultModelRef: { modelId: "grok-4.5" },
      auth: { state: "ready", methods: [{ id: "cached", label: "Signed in" }] },
      complete: true,
    });
  });

  test("authenticates only an advertised method and keeps the process catalog ready", async () => {
    const fixture = processFixture();
    fixture.handle.initialized.authMethods = [{ id: "grok.com", name: "Sign in to Grok" }];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    const input = {
      productSessionId: "authentication",
      profileId: "system",
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" as const },
    };

    await expect(adapter.authenticate(input, "unknown"))
      .rejects.toMatchObject({ code: "agent_runtime_auth_method_invalid" });
    await expect(adapter.authenticate(input, "grok.com"))
      .resolves.toMatchObject({ auth: { state: "ready" } });
    await expect(adapter.getModelCatalog(input))
      .resolves.toMatchObject({ auth: { state: "ready" } });
    expect(fixture.requests).toEqual([{
      method: "authenticate",
      params: { methodId: "grok.com" },
    }]);
  });

  test("maps audited version capabilities without assuming unaudited extensions", () => {
    expect(capabilitiesFromInitialize({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, close: {} } },
      _meta: { agentVersion: "1.0.0" },
    })).toMatchObject({
      protocolVersion: "1",
      nativeVersion: "1.0.0",
      features: ["session.create", "turn.prompt", "turn.cancel", "event.subscribe", "permission.respond", "question.respond", "config.set_model", "config.set_mode", "session.load", "session.list", "session.close", "command.list", "command.execute", "session.delete", "session.rename", "session.fork"],
    });
    expect(capabilitiesFromInitialize({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, close: {} } },
      _meta: { agentVersion: "1.0.0" },
    }).featureStates).toEqual(expect.arrayContaining([
      { feature: "session.delete", state: "supported", source: "initialize" },
      { feature: "command.list", state: "supported", source: "initialize" },
    ]));
    expect(capabilitiesFromInitialize({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
      _meta: { agentVersion: "future-unknown" },
    }).features).not.toContain("session.delete");
    expect(capabilitiesFromInitialize({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, close: {} } },
      _meta: { agentVersion: "1.0.3" },
    }).features).not.toEqual(expect.arrayContaining([
      "session.delete",
      "session.rename",
      "session.fork",
    ]));
  });

  test("creates with fail-closed meta and compiled minimal profile", async () => {
    const fixture = processFixture();
    const boundNativeIds: string[] = [];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      compileSessionProfile: () => ({
        meta: { agentProfile: { discoverSkills: false, injectDefaultTools: false } },
        bindRuntimeIdentity(runtimeSessionId) {
          boundNativeIds.push(runtimeSessionId);
        },
      }),
    });
    const created = await adapter.createSession({
      productSessionId: "product-session",
      profileId: "system",
      modelRef: { modelId: "grok-4.5", variant: "low" },
      mode: "plan",
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
    });
    expect(created.runtimeSessionId).toBe("native-session");
    expect(boundNativeIds).toEqual(["native-session"]);
    expect(fixture.requests).toEqual([
      { method: "session/new", params: {
        cwd: "/workspace",
        mcpServers: [],
        _meta: { agentProfile: { discoverSkills: false, injectDefaultTools: false }, yoloMode: false, autoMode: false },
      } },
      { method: "session/set_model", params: {
        sessionId: "native-session",
        modelId: "grok-4.5",
        _meta: { reasoningEffort: "low" },
      } },
      { method: "session/set_mode", params: {
        sessionId: "native-session",
        modeId: "plan",
      } },
    ]);
  });

  test("projects the same host MCP compiler into create and load without persisting credentials", async () => {
    const fixture = processFixture();
    const projected = [{
      type: "http" as const,
      name: "docs",
      url: "https://example.test/mcp",
      headers: [{ name: "Authorization", value: "Bearer fixture-secret" }],
    }];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      resolveMcpServers: async () => projected,
    });
    await adapter.createSession({
      productSessionId: "product-session",
      profileId: "system",
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
      profile: { kind: "assistant", name: "Assistant" },
    });
    await adapter.close(binding);
    await adapter.getSession(binding);
    expect(fixture.requests.filter((request) => request.method === "session/new" || request.method === "session/load"))
      .toEqual([
        { method: "session/new", params: expect.objectContaining({ mcpServers: projected }) },
        { method: "session/load", params: expect.objectContaining({ mcpServers: projected }) },
      ]);
    expect(JSON.stringify(binding)).not.toContain("fixture-secret");
  });

  test("loads via base ACP and fails closed when destructive delete is unsupported", async () => {
    const fixture = processFixture();
    fixture.handle.initialized._meta.agentVersion = "future-unknown";
    const cleaned: string[] = [];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      cleanupSession: async (session) => {
        cleaned.push(session.productSessionId);
      },
    });
    await expect(adapter.getSession(binding)).resolves.toMatchObject({ runtimeSessionId: "native-session" });
    await expect(adapter.deleteSession(binding)).rejects.toMatchObject({
      code: "agent_runtime_capability_unsupported",
    });
    expect(fixture.requests.map((request) => request.method)).toEqual(["session/load"]);
    expect(cleaned).toEqual([]);
  });

  test("does not unbind when native delete rejects", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "x.ai/session/delete") {
        throw new ApiError(502, "grok_acp_remote_error", "Grok ACP x.ai/session/delete failed", {
          jsonRpcCode: -32602,
        });
      }
      return {};
    };
    const cleaned: string[] = [];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      cleanupSession: async (session) => {
        cleaned.push(session.productSessionId);
      },
    });
    await expect(adapter.deleteSession(binding)).rejects.toMatchObject({
      code: "grok_acp_remote_error",
    });
    expect(fixture.requests.map((request) => request.method)).toEqual(["x.ai/session/delete"]);
    expect(cleaned).toEqual([]);
  });

  test("uses capability-gated native delete for an audited installed version", async () => {
    const fixture = processFixture();
    const cleaned: string[] = [];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      cleanupSession: async (session) => {
        cleaned.push(session.productSessionId);
      },
    });
    await adapter.deleteSession(binding);
    expect(fixture.requests.map((request) => request.method)).toEqual([
      "x.ai/session/delete",
      "session/close",
    ]);
    expect(cleaned).toEqual(["product-session"]);
  });

  test("prompts and cancels through base ACP without changing the sticky binding", async () => {
    const fixture = processFixture();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    fixture.handle.transport.notify = async (method: string, params: Record<string, unknown>) => {
      notifications.push({ method, params });
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    expect(adapter.promptResolvesWhenTurnEnds).toBe(true);
    await expect(adapter.prompt(binding, { text: "hello" })).resolves.toEqual({});
    await adapter.cancel(binding);
    expect(fixture.requests.at(-1)).toEqual({
      method: "session/prompt",
      params: {
        sessionId: "native-session",
        prompt: [{ type: "text", text: "hello" }],
      },
    });
    expect(notifications).toEqual([{
      method: "session/cancel",
      params: { sessionId: "native-session" },
    }]);
  });

  test("accepts only the exact sticky system profile and rejects per-turn tool overrides", async () => {
    const fixture = processFixture();
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    const profiled = {
      ...binding,
      profile: { kind: "assistant" as const, systemPrompt: "sticky instructions" },
    };
    await expect(adapter.prompt(profiled, {
      text: "hello",
      systemPrompt: "sticky instructions",
    })).resolves.toEqual({});
    expect(() => adapter.validatePrompt(profiled, {
      text: "hello",
      systemPrompt: "changed instructions",
    })).toThrow(expect.objectContaining({ code: "agent_runtime_capability_unsupported" }));
    expect(() => adapter.validatePrompt(profiled, {
      text: "hello",
      toolAccess: { bash: false },
    })).toThrow(expect.objectContaining({ code: "agent_runtime_capability_unsupported" }));
  });

  test("sets ACP session mode on the bound native session", async () => {
    const fixture = processFixture();
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await adapter.setMode(binding, "plan");
    expect(fixture.requests).toEqual([
      { method: "session/load", params: expect.objectContaining({ sessionId: "native-session" }) },
      { method: "session/set_mode", params: { sessionId: "native-session", modeId: "plan" } },
    ]);
  });

  test("renames through the audited Grok extension", async () => {
    const fixture = processFixture();
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await adapter.renameSession(binding, "New title");
    expect(fixture.requests).toEqual([{
      method: "x.ai/session/rename",
      params: {
        sessionId: "native-session",
        cwd: "/workspace",
        title: "New title",
        kind: "session",
        resetToAuto: false,
      },
    }]);
  });

  test("forks through the audited extension with an explicit native id", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "x.ai/session/fork") {
        return { newSessionId: params.newSessionId };
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    const forked = await adapter.forkSession(binding, "fork-product");
    expect(forked).toMatchObject({
      runtimeSessionId: expect.any(String),
      session: {
        productSessionId: "fork-product",
        parentProductSessionId: "product-session",
      },
    });
    expect(fixture.requests).toEqual([{
      method: "x.ai/session/fork",
      params: {
        sourceSessionId: "native-session",
        sourceCwd: "/workspace",
        newCwd: "/workspace",
        newSessionId: forked.runtimeSessionId,
        sessionKind: "fork",
      },
    }]);
  });

  test("falls back to AvailableCommandsUpdate cache when commands/list remotes fail", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "x.ai/commands/list" || method === "_x.ai/commands/list") {
        throw new ApiError(502, "grok_acp_remote_error", `Grok ACP ${method} failed`);
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      readCommandCatalog: () => [{ name: "compact", description: "Compact history" }],
    });
    await expect(adapter.listCommands(binding)).resolves.toEqual({
      complete: true,
      items: [{
        id: "grok:command:compact",
        name: "compact",
        description: "Compact history",
        source: "command",
      }],
    });
  });

  test("lists commands from a bare array without initialize extensionMethods", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "x.ai/commands/list" || method === "_x.ai/commands/list") {
        return [{ name: "compact", argumentHint: "keep" }];
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.listCommands(binding)).resolves.toEqual({
      complete: true,
      items: [{
        id: "grok:command:compact",
        name: "compact",
        inputHint: "keep",
        source: "command",
      }],
    });
  });

  test("rejects an Expert session when session/info reports a different agent", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "session/new") return { sessionId: "native-session" };
      if (method === "x.ai/session/info") return { result: { agentName: "grok-build-plan" } };
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      compileSessionProfile: () => ({
        meta: {
          agentProfile: {
            name: "kol-content-ops-specialist",
            description: "ops",
            promptMode: "full",
            promptBody: "Stay in role.",
            permissionMode: "default",
            discoverSkills: false,
            inheritSkills: false,
            injectDefaultTools: false,
            agentsMd: false,
            skills: [],
            mcpInheritance: "none",
            toolConfig: { tools: [] },
          },
        },
      }),
    });
    await expect(adapter.createSession({
      productSessionId: "expert-session",
      profileId: "system",
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
      profile: {
        kind: "expert",
        expertId: "kol-content-ops-specialist",
        name: "KOL",
        description: "ops",
        systemPrompt: "Stay in role.",
      },
    })).rejects.toMatchObject({ code: "grok_expert_profile_not_applied" });
  });

  test("rejects an Expert session when session/info is unavailable", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "session/new") return { sessionId: "native-session" };
      if (method === "x.ai/session/info" || method === "_x.ai/session/info") {
        throw new ApiError(409, "agent_runtime_capability_unsupported", "Method not found");
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      compileSessionProfile: () => ({
        meta: {
          agentProfile: {
            name: "kol-content-ops-specialist",
            description: "ops",
            promptMode: "full",
            promptBody: "Stay in role.",
            permissionMode: "default",
            discoverSkills: false,
            inheritSkills: false,
            injectDefaultTools: false,
            agentsMd: false,
            skills: [],
            mcpInheritance: "none",
            toolConfig: { tools: [] },
          },
        },
      }),
    });
    await expect(adapter.createSession({
      productSessionId: "expert-session",
      profileId: "system",
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
      profile: {
        kind: "expert",
        expertId: "kol-content-ops-specialist",
        name: "KOL",
        description: "ops",
        systemPrompt: "Stay in role.",
      },
    })).rejects.toMatchObject({ code: "grok_expert_profile_not_applied" });
  });

  test("lists workspace commands from a disposable native session without a product binding", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "session/new") return { sessionId: "native-catalog" };
      if (method === "_x.ai/commands/list" || method === "x.ai/commands/list") {
        return {
          commands: [{
            name: "compact",
            description: "Compress conversation history to save context window",
          }],
        };
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.listWorkspaceCommands({
      id: "workspace",
      name: "Workspace",
      path: "/workspace",
      preset: "starter",
      workspaceType: "local",
    })).resolves.toMatchObject({
      complete: true,
      items: [expect.objectContaining({ name: "compact" })],
    });
    expect(fixture.requests.map((request) => request.method)).toContain("session/new");
  });

  test("uses _x.ai/commands/list when the unprefixed method is missing", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "x.ai/commands/list") {
        throw new ApiError(502, "grok_acp_remote_error", "Grok ACP x.ai/commands/list failed", {
          jsonRpcCode: -32601,
        });
      }
      if (method === "_x.ai/commands/list") {
        return {
          commands: [{
            name: "compact",
            description: "Compress conversation history to save context window",
          }],
        };
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.listCommands(binding)).resolves.toMatchObject({
      complete: true,
      items: [expect.objectContaining({ name: "compact", source: "command" })],
    });
    expect(fixture.requests.map((request) => request.method)).toContain("_x.ai/commands/list");
  });

  test("lists and executes only safe ACP session commands", async () => {
    const fixture = processFixture({ extensions: ["x.ai/commands/list"] });
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "x.ai/commands/list" || method === "_x.ai/commands/list") {
        return {
          commands: [
            { name: "compact", description: "Compact history", input: { hint: "context" } },
            { name: "always-approve", description: "Unsafe" },
            { name: "review", description: "Review", _meta: { path: "/redacted/skill" } },
          ],
        };
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.listCommands(binding)).resolves.toEqual({
      complete: true,
      items: [
        { id: "grok:command:compact", name: "compact", description: "Compact history", inputHint: "context", source: "command" },
        { id: "grok:skill:review", name: "review", description: "Review", source: "skill" },
      ],
    });
    await expect(adapter.executeCommand(binding, "always-approve", {}))
      .rejects.toMatchObject({ code: "agent_runtime_command_unsafe" });
    await expect(adapter.executeCommand(binding, "compact", { arguments: "keep auth" }))
      .resolves.toEqual({});
    expect(fixture.requests.at(-1)).toEqual({
      method: "session/prompt",
      params: { sessionId: "native-session", prompt: [{ type: "text", text: "/compact keep auth" }] },
    });
  });

  test("executes compact even when this session has no live catalog", async () => {
    const { normalizeGrokCommandName } = await import("../src/services/grok-runtime-adapter.js");
    expect(normalizeGrokCommandName("/compact/compact")).toBe("compact");
    expect(normalizeGrokCommandName("compact")).toBe("compact");
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.executeCommand(binding, "/compact/compact", {}))
      .resolves.toEqual({});
    expect(fixture.requests.at(-1)).toEqual({
      method: "session/prompt",
      params: { sessionId: "native-session", prompt: [{ type: "text", text: "/compact" }] },
    });
  });

  test("closes a resident session without deleting its sticky native history", async () => {
    const fixture = processFixture();
    const unbound: string[] = [];
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
      unbindPermissionSession: (runtimeSessionId) => unbound.push(runtimeSessionId),
    });
    await adapter.close(binding);
    expect(fixture.requests).toEqual([{
      method: "session/close",
      params: { sessionId: "native-session" },
    }]);
    expect(unbound).toEqual(["native-session"]);
  });

  test("resumes a closed build session without replay and restores sticky model and mode", async () => {
    const fixture = processFixture();
    const resumedBinding = {
      ...binding,
      modelRef: { modelId: "grok-4.5", variant: "low" as const },
      mode: "plan",
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.resume(resumedBinding)).resolves.toMatchObject({
      productSessionId: "product-session",
      mode: "plan",
    });
    expect(fixture.requests).toEqual([
      { method: "session/resume", params: expect.objectContaining({ sessionId: "native-session", cwd: "/workspace" }) },
      { method: "session/set_model", params: { sessionId: "native-session", modelId: "grok-4.5", _meta: { reasoningEffort: "low" } } },
      { method: "session/set_mode", params: { sessionId: "native-session", modeId: "plan" } },
    ]);
  });

  test("walks native session/list pages without attaching product sessions", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method, params) => {
      fixture.requests.push({ method, params });
      if (method === "session/list") {
        return params.cursor
          ? { sessions: [{ sessionId: "other" }] }
          : { sessions: [{ sessionId: "native-session" }], nextCursor: "page-2" };
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.refreshSessions([binding])).resolves.toEqual({
      sessions: [expect.objectContaining({ productSessionId: "product-session" })],
      missingRuntimeSessionIds: [],
      failedRuntimeSessionIds: [],
      complete: true,
    });
    expect(fixture.requests).toEqual([
      { method: "session/list", params: { cwd: "/workspace" } },
      { method: "session/list", params: { cwd: "/workspace", cursor: "page-2" } },
    ]);
  });

  test("reports needs_auth after a typed session creation failure", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method: string, params: Record<string, unknown>) => {
      fixture.requests.push({ method, params });
      if (method === "session/new") {
        throw new ApiError(401, "grok_auth_required", "Grok authentication is required");
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.createSession({
      productSessionId: "product-session",
      profileId: "system",
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
    })).rejects.toMatchObject({ code: "grok_auth_required" });
    expect(await adapter.probeCapabilities()).toMatchObject({
      health: {
        runtimeKind: "grok-build",
        health: "needs_auth",
        error: { code: "grok_auth_required" },
      },
    });
  });

  test("cleans up a newly created native session when session model selection fails", async () => {
    const fixture = processFixture();
    fixture.handle.transport.request = async (method: string, params: Record<string, unknown>) => {
      fixture.requests.push({ method, params });
      if (method === "session/new") return { sessionId: "native-session" };
      if (method === "session/set_model") {
        throw new ApiError(409, "grok_model_unavailable", "Model unavailable");
      }
      return {};
    };
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.createSession({
      productSessionId: "product-session",
      profileId: "system",
      modelRef: { modelId: "missing-model", variant: "low" },
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
    })).rejects.toMatchObject({ code: "grok_model_unavailable" });
    expect(fixture.requests.map((request) => request.method)).toEqual([
      "session/new",
      "session/set_model",
      "session/close",
      "x.ai/session/delete",
    ]);
    expect(await adapter.probeCapabilities()).toMatchObject({
      health: {
        health: "degraded",
        error: {
          code: "agent_runtime_model_unavailable",
          retriable: false,
        },
      },
    });
  });

  test("rejects provider-scoped model references before creating a Grok session", async () => {
    const fixture = processFixture();
    const adapter = new GrokRuntimeAdapter({
      supervisor: { async start() { return fixture.handle; }, async stopAll() {} },
      resolvePolicy: () => ({ binaryPath: "grok", runtimeHome: "/runtime/grok" }),
    });
    await expect(adapter.createSession({
      productSessionId: "product-session",
      profileId: "system",
      modelRef: { providerId: "opencode", modelId: "grok-4.5" },
      workspace: { id: "workspace", name: "Workspace", path: "/workspace", preset: "starter", workspaceType: "local" },
    })).rejects.toMatchObject({ code: "agent_runtime_model_ref_invalid" });
    expect(fixture.requests).toEqual([]);
  });
});
