import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntimeSession } from "@onmyagent/types/agent-runtime";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { startServer } from "../src/server.js";
import type {
  AgentRuntimeAdapter,
  RuntimeAdapterCreatedSession,
  RuntimeAdapterSessionInput,
} from "../src/services/primary-runtime-registry.js";
import {
  AGENT_RUNTIME_PROMPT_AGGREGATE_MAX_BYTES,
  AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES,
} from "../src/services/agent-runtime-prompt-parts.js";

describe("agent runtime routes", () => {
  test("keeps default OpenCode and rejects selecting an unavailable runtime", async () => {
    const fixture = await startFixture([]);
    try {
      const selection = await fixture.request("/agent-runtime/selection");
      expect(selection.status).toBe(200);
      expect(await selection.json()).toMatchObject({
        state: "missing",
        config: { defaultRuntimeKind: "opencode" },
        availableRuntimeKinds: [],
        selectableDefaultRuntimeKinds: [],
        rollout: {
          version: 1,
          sessionCount: 0,
          runtimeCounts: [],
          bindingSetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          complete: true,
          failureCount: 0,
        },
      });
      const update = await fixture.request("/agent-runtime/selection/default", {
        method: "POST",
        body: JSON.stringify({ runtimeKind: "grok-build", expectedRevision: 0 }),
      });
      expect(update.status).toBe(409);
      expect(await update.json()).toMatchObject({ code: "agent_runtime_unavailable" });
    } finally {
      await fixture.stop();
    }
  });

  test("creates by selection and reads/deletes by sticky product binding", async () => {
    const native = adapter("grok-build");
    const fixture = await startFixture([native]);
    try {
      const configure = await fixture.request("/agent-runtime/selection/grok-build", {
        method: "POST",
        body: JSON.stringify({ selection: { profileId: "system" }, expectedRevision: 0 }),
      });
      expect(configure.status).toBe(200);
      const select = await fixture.request("/agent-runtime/selection/default", {
        method: "POST",
        body: JSON.stringify({ runtimeKind: "grok-build", expectedRevision: 1 }),
      });
      expect(select.status).toBe(200);
      const create = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions`,
        {
          method: "POST",
          body: JSON.stringify({
            productSessionId: "product-session",
            modelRef: { modelId: "grok-4.5", variant: "low" },
            mode: "plan",
          }),
        },
      );
      expect(create.status).toBe(201);
      expect(await create.json()).toMatchObject({
        session: {
          productSessionId: "product-session",
          runtimeKind: "grok-build",
          runtimeSessionId: "native-product-session",
          mode: "plan",
        },
      });
      const rollout = await fixture.request("/agent-runtime/selection");
      const rolloutBody = await rollout.json();
      expect(rolloutBody.rollout).toMatchObject({
        version: 1,
        sessionCount: 1,
        runtimeCounts: [{ runtimeKind: "grok-build", count: 1 }],
        bindingSetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        complete: true,
        failureCount: 0,
      });
      expect(JSON.stringify(rolloutBody.rollout)).not.toContain("product-session");
      expect(JSON.stringify(rolloutBody.rollout)).not.toContain("native-product-session");
      const forbiddenOverride = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions`,
        {
          method: "POST",
          body: JSON.stringify({ runtimeKind: "opencode" }),
        },
      );
      expect(forbiddenOverride.status).toBe(400);
      expect(await forbiddenOverride.json()).toMatchObject({
        code: "agent_runtime_explicit_selection_forbidden",
      });
      const list = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions`,
      );
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({
        complete: true,
        failures: [],
        items: [{ productSessionId: "product-session", runtimeKind: "grok-build", mode: "plan" }],
      });
      const read = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session`,
      );
      expect(read.status).toBe(200);
      expect(native.seen.get).toEqual(["product-session"]);
      const mode = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/mode`,
        { method: "POST", body: JSON.stringify({ mode: "fast" }) },
      );
      expect(mode.status).toBe(200);
      expect(await mode.json()).toMatchObject({ session: { mode: "fast" } });
      expect(native.seen.modes).toEqual([{ productSessionId: "product-session", mode: "fast" }]);
      const rename = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/rename`,
        { method: "POST", body: JSON.stringify({ title: "Renamed" }) },
      );
      expect(rename.status).toBe(200);
      expect(await rename.json()).toMatchObject({ session: { title: "Renamed" } });
      expect(native.seen.renames).toEqual([{ productSessionId: "product-session", title: "Renamed" }]);
      const fork = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/fork`,
        { method: "POST", body: JSON.stringify({ productSessionId: "fork-product" }) },
      );
      expect(fork.status).toBe(201);
      expect(await fork.json()).toMatchObject({
        session: {
          productSessionId: "fork-product",
          parentProductSessionId: "product-session",
          runtimeKind: "grok-build",
        },
      });
      expect(native.seen.forks).toEqual([{
        productSessionId: "product-session",
        newProductSessionId: "fork-product",
      }]);
      const missingEvents = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/missing/events`,
      );
      expect(missingEvents.status).toBe(404);
      expect(await missingEvents.json()).toMatchObject({
        code: "runtime_session_binding_not_found",
      });
      const eventController = new AbortController();
      const eventResponse = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/events`,
        { signal: eventController.signal },
      );
      expect(eventResponse.status).toBe(200);
      const eventReader = eventResponse.body!.getReader();
      const generationChunk = await eventReader.read();
      expect(new TextDecoder().decode(generationChunk.value)).toContain("event: generation");
      const prompt = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/prompt`,
        { method: "POST", body: JSON.stringify({ text: "hello" }) },
      );
      expect(prompt.status).toBe(202);
      expect(await prompt.json()).toMatchObject({ ok: true });
      await Bun.sleep(0);
      expect(native.seen.get).toContain("prompt:product-session");
      let busyText = "";
      while (!busyText.includes('"kind":"session.status"')) {
        const busyChunk = await eventReader.read();
        if (busyChunk.done) break;
        busyText += new TextDecoder().decode(busyChunk.value);
      }
      expect(busyText).toContain("event: runtime-event");
      expect(busyText).toContain('"kind":"session.status"');
      expect(busyText).toContain('"type":"busy"');
      const snapshot = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/event-snapshot?afterSequence=0&limit=10`,
      );
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({
        productSessionId: "product-session",
        complete: true,
        events: [
          expect.objectContaining({ kind: "session.created", sequence: 1 }),
          expect.objectContaining({ kind: "session.updated", sequence: 2 }),
          expect.objectContaining({ kind: "message.completed", sequence: 3 }),
          expect.objectContaining({ kind: "session.status", sequence: 4 }),
        ],
      });
      const messages = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/messages`,
      );
      expect(messages.status).toBe(200);
      expect(await messages.json()).toMatchObject({
        productSessionId: "product-session",
        complete: true,
        messages: [expect.objectContaining({
          role: "user",
          parts: [expect.objectContaining({ type: "text", text: "hello" })],
        })],
      });
      const commands = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/commands`,
      );
      expect(commands.status).toBe(200);
      expect(await commands.json()).toMatchObject({
        productSessionId: "product-session",
        complete: true,
        items: [{ name: "compact" }],
      });
      const command = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/commands/compact`,
        { method: "POST", body: JSON.stringify({ arguments: "keep auth" }) },
      );
      expect(command.status).toBe(202);
      expect(await command.json()).toMatchObject({ ok: true, turnId: expect.any(String) });
      expect(native.seen.commands).toEqual([{
        productSessionId: "product-session",
        name: "compact",
        arguments: "keep auth",
      }]);
      eventController.abort();
      await eventReader.cancel().catch(() => undefined);
      const cancel = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/cancel`,
        { method: "POST", body: JSON.stringify({}) },
      );
      expect(cancel.status).toBe(200);
      expect(native.seen.get).toContain("cancel:product-session");
      const close = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/close`,
        { method: "POST", body: JSON.stringify({}) },
      );
      expect(close.status).toBe(200);
      expect(native.seen.get).toContain("close:product-session");
      expect((await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session`,
      )).status).toBe(200);
      const resume = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/resume`,
        { method: "POST", body: JSON.stringify({}) },
      );
      expect(resume.status).toBe(200);
      expect(native.seen.get).toContain("resume:product-session");
      const authenticate = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-authenticate`,
        {
          method: "POST",
          body: JSON.stringify({
            runtimeKind: "grok-build",
            methodId: "grok.com",
          }),
        },
      );
      expect(authenticate.status).toBe(200);
      expect(await authenticate.json()).toMatchObject({
        runtimeKind: "grok-build",
        auth: { state: "ready", methods: [{ id: "grok.com" }] },
      });
      const question = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session/questions/question%2Fid`,
        {
          method: "POST",
          body: JSON.stringify({ answers: [["Local"], []] }),
        },
      );
      expect(question.status).toBe(200);
      expect(native.seen.questions).toEqual([{
        productSessionId: "product-session",
        questionId: "question/id",
        answers: [["Local"], []],
      }]);
      const remove = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/product-session`,
        { method: "DELETE" },
      );
      expect(remove.status).toBe(200);
      expect(native.seen.delete).toEqual(["product-session"]);
    } finally {
      await fixture.stop();
    }
  });

  test("accepts only host-provided Grok profiles and matching home modes", async () => {
    const fixture = await startFixture([adapter("grok-build")]);
    try {
      const managed = await fixture.request("/agent-runtime/selection/grok-build", {
        method: "POST",
        body: JSON.stringify({
          selection: { profileId: "managed", homeMode: "managed", binaryMode: "system" },
          expectedRevision: 0,
        }),
      });
      expect(managed.status).toBe(200);
      expect(await managed.json()).toMatchObject({
        config: { grokBuild: { profileId: "managed", homeMode: "managed" } },
      });

      for (const [selection, code] of [
        [{ profileId: "unknown" }, "agent_runtime_profile_unavailable"],
        [{ profileId: "system", homeMode: "managed" }, "invalid_payload"],
      ] as const) {
        const response = await fixture.request("/agent-runtime/selection/grok-build", {
          method: "POST",
          body: JSON.stringify({ selection, expectedRevision: 1 }),
        });
        expect(response.status).toBe(selection.profileId === "system"
          && "homeMode" in selection ? 400 : 409);
        expect(await response.json()).toMatchObject({ code });
      }

      const bundled = await fixture.request("/agent-runtime/selection/grok-build", {
        method: "POST",
        body: JSON.stringify({
          selection: { profileId: "system", homeMode: "system", binaryMode: "bundled" },
          expectedRevision: 1,
        }),
      });
      expect(bundled.status).toBe(409);
      expect(await bundled.json()).toMatchObject({ code: "agent_runtime_profile_unavailable" });
    } finally {
      await fixture.stop();
    }
  });

  test("reports redacted connector availability for the selected runtime", async () => {
    const fixture = await startFixture([adapter("grok-build")], async () => ({
      descriptors: [{
        name: "kdocs",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer fixture-secret" },
      }],
      accounts: [
        { connectorId: "kdocs", accountConnected: true, opencodeAvailable: true },
        { connectorId: "dingtalk", accountConnected: true, opencodeAvailable: true },
      ],
      complete: true,
    }));
    try {
      const response = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-connectors?runtimeKind=grok-build`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        runtimeKind: "grok-build",
        workspaceId: fixture.workspace.id,
        complete: true,
        items: expect.arrayContaining([
          expect.objectContaining({ connectorId: "kdocs", toolAvailable: true }),
          expect.objectContaining({ connectorId: "dingtalk", toolAvailable: false }),
        ]),
      });
      expect(JSON.stringify(body)).not.toContain("fixture-secret");
      expect(JSON.stringify(body)).not.toContain("example.test");
    } finally {
      await fixture.stop();
    }
  });

  test("registers newly created workspaces with the canonical runtime registry", async () => {
    const native = adapter("grok-build");
    const fixture = await startFixture([native]);
    try {
      const folderPath = join(fixture.root, "created-after-server-start");
      const createWorkspace = await fixture.request("/workspaces/local", {
        method: "POST",
        body: JSON.stringify({ folderPath, name: "Created Later" }),
      });
      expect(createWorkspace.status).toBe(201);
      const created = await createWorkspace.json();
      const workspaceId = created.activeId as string;

      const catalog = await fixture.request(
        `/workspace/${workspaceId}/runtime-models?runtimeKind=grok-build`,
      );
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toMatchObject({
        runtimeKind: "grok-build",
        workspaceId,
        defaultModelRef: { modelId: "grok-4.5", variant: "low" },
      });

      expect((await fixture.request("/agent-runtime/selection/grok-build", {
        method: "POST",
        body: JSON.stringify({ selection: { profileId: "system" }, expectedRevision: 0 }),
      })).status).toBe(200);
      expect((await fixture.request("/agent-runtime/selection/default", {
        method: "POST",
        body: JSON.stringify({ runtimeKind: "grok-build", expectedRevision: 1 }),
      })).status).toBe(200);

      const createSession = await fixture.request(
        `/workspace/${workspaceId}/runtime-sessions`,
        {
          method: "POST",
          body: JSON.stringify({ productSessionId: "created-workspace-session" }),
        },
      );
      expect(createSession.status).toBe(201);
      expect(native.seen.create).toContain("created-workspace-session");

      const removeWorkspace = await fixture.request(`/workspaces/${workspaceId}`, {
        method: "DELETE",
      });
      expect(removeWorkspace.status).toBe(200);
      const removedCatalog = await fixture.request(
        `/workspace/${workspaceId}/runtime-models?runtimeKind=grok-build`,
      );
      expect(removedCatalog.status).toBe(404);
      expect(await removedCatalog.json()).toMatchObject({ code: "workspace_not_found" });
    } finally {
      await fixture.stop();
    }
  });

  test("rejects oversized prompt payloads before the adapter and still accepts an in-limit prompt", async () => {
    const native = adapter("grok-build");
    const fixture = await startFixture([native]);
    try {
      expect((await fixture.request("/agent-runtime/selection/grok-build", {
        method: "POST",
        body: JSON.stringify({ selection: { profileId: "system" }, expectedRevision: 0 }),
      })).status).toBe(200);
      expect((await fixture.request("/agent-runtime/selection/default", {
        method: "POST",
        body: JSON.stringify({ runtimeKind: "grok-build", expectedRevision: 1 }),
      })).status).toBe(200);
      expect((await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions`,
        {
          method: "POST",
          body: JSON.stringify({ productSessionId: "limit-session" }),
        },
      )).status).toBe(201);

      const overBody = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/limit-session/prompt`,
        {
          method: "POST",
          headers: { Connection: "close" },
          body: JSON.stringify({
            text: "x".repeat(AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES + 8),
          }),
        },
      );
      expect(overBody.status).toBe(413);
      expect(await overBody.json()).toMatchObject({ code: "payload_too_large" });

      const overAggregate = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/limit-session/prompt`,
        {
          method: "POST",
          body: JSON.stringify({
            text: "ok",
            parts: [
              { type: "text", text: "a".repeat(AGENT_RUNTIME_PROMPT_AGGREGATE_MAX_BYTES / 2) },
              { type: "text", text: "b".repeat(AGENT_RUNTIME_PROMPT_AGGREGATE_MAX_BYTES / 2) },
            ],
          }),
        },
      );
      expect(overAggregate.status).toBe(413);
      expect(await overAggregate.json()).toMatchObject({ code: "payload_too_large" });
      expect(native.seen.get.filter((entry) => entry.startsWith("prompt:"))).toEqual([]);

      const allowed = await fixture.request(
        `/workspace/${fixture.workspace.id}/runtime-sessions/limit-session/prompt`,
        { method: "POST", body: JSON.stringify({ text: "hello" }) },
      );
      expect(allowed.status).toBe(202);
      await Bun.sleep(0);
      expect(native.seen.get).toContain("prompt:limit-session");
    } finally {
      await fixture.stop();
    }
  });

});

function adapter(runtimeKind: "opencode" | "grok-build") {
  const seen = {
    create: [] as string[],
    get: [] as string[],
    delete: [] as string[],
    questions: [] as Array<{
      productSessionId: string;
      questionId: string;
      answers: string[][];
    }>,
    modes: [] as Array<{ productSessionId: string; mode: string }>,
    renames: [] as Array<{ productSessionId: string; title: string }>,
    forks: [] as Array<{ productSessionId: string; newProductSessionId: string }>,
    commands: [] as Array<{ productSessionId: string; name: string; arguments?: string }>,
  };
  return {
    runtimeKind,
    seen,
    supportsProfile(profileId) {
      return profileId === "system" || profileId === "managed";
    },
    async probeCapabilities() {
      return { health: { runtimeKind, health: "ready" as const, checkedAt: 1 } };
    },
    async createSession(input: RuntimeAdapterSessionInput): Promise<RuntimeAdapterCreatedSession> {
      seen.create.push(input.productSessionId);
      const runtimeSessionId = `native-${input.productSessionId}`;
      return {
        runtimeSessionId,
        cwd: input.workspace.path,
        runtimeHome: `/runtime/${runtimeKind}`,
        profileId: input.profileId,
        modelRef: input.modelRef,
        session: session(input, runtimeSessionId),
      };
    },
    async getSession(binding) {
      seen.get.push(binding.productSessionId);
      return {
        productSessionId: binding.productSessionId,
        runtimeKind,
        runtimeSessionId: binding.runtimeSessionId,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
        createdAt: binding.createdAt,
        updatedAt: binding.createdAt,
        status: { type: "idle" as const },
      };
    },
    async deleteSession(binding) { seen.delete.push(binding.productSessionId); },
    async prompt(binding) {
      seen.get.push(`prompt:${binding.productSessionId}`);
      return { turnId: "turn-fixture" };
    },
    async cancel(binding) {
      seen.get.push(`cancel:${binding.productSessionId}`);
    },
    async close(binding) {
      seen.get.push(`close:${binding.productSessionId}`);
    },
    async resume(binding) {
      seen.get.push(`resume:${binding.productSessionId}`);
      return {
        productSessionId: binding.productSessionId,
        runtimeKind,
        runtimeSessionId: binding.runtimeSessionId,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
        createdAt: binding.createdAt,
        updatedAt: binding.createdAt,
        status: { type: "idle" as const },
      };
    },
    async setModel() {},
    async setMode(binding, mode) {
      seen.modes.push({ productSessionId: binding.productSessionId, mode });
    },
    async renameSession(binding, title) {
      seen.renames.push({ productSessionId: binding.productSessionId, title });
    },
    async forkSession(binding, newProductSessionId) {
      seen.forks.push({ productSessionId: binding.productSessionId, newProductSessionId });
      const runtimeSessionId = `native-${newProductSessionId}`;
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
          status: { type: "idle" as const },
        },
      };
    },
    async listCommands() {
      return { complete: true, items: [{ id: `${runtimeKind}:compact`, name: "compact", source: "command" as const }] };
    },
    async executeCommand(binding, name, input) {
      seen.commands.push({ productSessionId: binding.productSessionId, name, ...input });
      return { turnId: "command-turn" };
    },
    async respondQuestion(binding, questionId, answers) {
      seen.questions.push({
        productSessionId: binding.productSessionId,
        questionId,
        answers,
      });
    },
    async authenticate(input, methodId) {
      return {
        runtimeKind,
        profileId: input.profileId,
        workspaceId: input.workspace.id,
        models: [],
        auth: { state: "ready" as const, methods: [{ id: methodId }] },
        complete: true,
      };
    },
    async getModelCatalog(input) {
      return {
        runtimeKind,
        profileId: input.profileId,
        workspaceId: input.workspace.id,
        models: [{
          ref: { modelId: "grok-4.5", variant: "low" },
          label: "Grok 4.5 Low",
        }],
        defaultModelRef: { modelId: "grok-4.5", variant: "low" },
        auth: { state: "ready" as const, methods: [] },
        complete: true,
      };
    },
    async stop() {},
  } satisfies AgentRuntimeAdapter & { seen: typeof seen };
}

function session(
  input: RuntimeAdapterSessionInput,
  runtimeSessionId: string,
): AgentRuntimeSession {
  return {
    productSessionId: input.productSessionId,
    runtimeKind: "grok-build",
    runtimeSessionId,
    workspaceId: input.workspace.id,
    cwd: input.workspace.path,
    profileId: input.profileId,
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    ...(input.modelRef ? { modelRef: input.modelRef } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
  };
}

async function startFixture(
  adapters: AgentRuntimeAdapter[],
  readConnectorMcpProjection?: import("../src/services/primary-runtime-composition.js").PrimaryRuntimeServerPolicy["readConnectorMcpProjection"],
) {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-runtime-routes-"));
  const workspace: WorkspaceInfo = {
    id: "workspace",
    name: "Workspace",
    path: join(root, "workspace"),
    preset: "starter",
    workspaceType: "local",
  };
  await mkdir(workspace.path, { recursive: true });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: [],
    workspaces: [workspace],
    authorizedRoots: [workspace.path],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
  const dataRoot = join(root, "data");
  const server = await startServer(config, {
    primaryRuntime: { dataRoot, readConnectorMcpProjection },
    primaryRuntimeAdapters: adapters,
  });
  return {
    root,
    workspace,
    request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer token");
      headers.set("X-OnMyAgent-Host-Token", "host-token");
      if (init.body) headers.set("Content-Type", "application/json");
      return fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers });
    },
    async stop() {
      await server.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("forks across runtimes with provenance and context", async () => {
  const seen = { create: [] as Array<{ runtimeKind: string; profile?: { systemPrompt?: string } }> };
  function crossAdapter(runtimeKind: "opencode" | "grok-build"): AgentRuntimeAdapter {
    return {
      runtimeKind,
      supportsProfile: () => true,
      async probeCapabilities() {
        return { health: { runtimeKind, health: "ready" as const, checkedAt: Date.now() } };
      },
      async createSession(input: RuntimeAdapterSessionInput) {
        seen.create.push({
          runtimeKind,
          profile: input.profile as { systemPrompt?: string } | undefined,
        });
        const runtimeSessionId = `native-${input.productSessionId}-${runtimeKind}`;
        return {
          runtimeSessionId,
          cwd: input.workspace.path,
          runtimeHome: `/runtime/${runtimeKind}`,
          profileId: input.profileId,
          session: {
            productSessionId: input.productSessionId,
            runtimeKind,
            runtimeSessionId,
            workspaceId: input.workspace.id,
            cwd: input.workspace.path,
            profileId: input.profileId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: { type: "idle" as const },
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
          updatedAt: Date.now(),
          status: { type: "idle" as const },
        };
      },
      async deleteSession() {},
      async prompt() { return {}; },
      async cancel() {},
      async setModel() {},
      async stop() {},
    };
  }
  const fixture = await startFixture([crossAdapter("opencode"), crossAdapter("grok-build")]);
  try {
    // host sets default runtime = opencode; create inherits it (D-01)
    const sel = await fixture.request("/agent-runtime/selection/default", {
      method: "POST",
      body: JSON.stringify({ runtimeKind: "opencode", expectedRevision: 0 }),
    });
    expect(sel.status).toBe(200);
    const created = await fixture.request("/workspace/workspace/runtime-sessions", {
      method: "POST",
      body: JSON.stringify({ productSessionId: "src-session" }),
    });
    expect(created.status).toBe(201);

    // fork it cross-runtime into grok-build
    const fork = await fixture.request(
      "/workspace/workspace/runtime-sessions/src-session/fork",
      { method: "POST", body: JSON.stringify({ productSessionId: "cross-fork", targetRuntimeKind: "grok-build" }) },
    );
    expect(fork.status).toBe(201);
    const forkBody = await fork.json();
    expect(forkBody.session).toMatchObject({
      productSessionId: "cross-fork",
      runtimeKind: "grok-build",
      parentProductSessionId: "src-session",
    });

    // binding carries provenance
    const list = await fixture.request("/workspace/workspace/runtime-sessions", {});
    const sessions = await list.json();
    const cross = sessions.items.find((s: { productSessionId: string }) =>
      s.productSessionId === "cross-fork");
    expect(cross).toMatchObject({ runtimeKind: "grok-build" });

    // target adapter received the cross-runtime create
    expect(seen.create.some((c) => c.runtimeKind === "grok-build")).toBe(true);
    expect(seen.create.some((c) => c.runtimeKind === "opencode")).toBe(true);
  } finally {
    await fixture.stop();
  }
});
