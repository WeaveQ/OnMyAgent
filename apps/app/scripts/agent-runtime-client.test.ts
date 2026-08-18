import { afterEach, describe, expect, test } from "bun:test";
import { createOnMyAgentServerClient } from "../src/app/lib/onmyagent-server/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("agent runtime client", () => {
  test("uses canonical runtime session paths and host/client auth", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return Response.json({
        session: {
          productSessionId: "product/session",
          runtimeKind: "grok-build",
          runtimeSessionId: "native",
          workspaceId: "workspace/id",
          cwd: "/workspace",
          profileId: "system",
          createdAt: 1,
          updatedAt: 1,
          status: { type: "idle" },
        },
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096/",
      token: "client-token",
      hostToken: "host-token",
    });
    await client.createRuntimeSession("workspace/id", {
      productSessionId: "product/session",
      modelRef: { modelId: "grok-4.5", variant: "low" },
    });
    await client.getRuntimeSession("workspace/id", "product/session");
    expect(seen.map((request) => request.url)).toEqual([
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions",
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession",
    ]);
    expect(seen[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      productSessionId: "product/session",
      modelRef: { modelId: "grok-4.5", variant: "low" },
    });
    const headers = new Headers(seen[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer client-token");
    expect(headers.get("x-onmyagent-host-token")).toBe("host-token");
  });

  test("opens the canonical SSE endpoint with caller cancellation", async () => {
    let signal: AbortSignal | null = null;
    globalThis.fetch = async (_input, init) => {
      signal = init?.signal ?? null;
      return new Response("event: generation\ndata: {}\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    const caller = new AbortController();
    const response = await client.openRuntimeSessionEvents(
      "workspace",
      "product",
      { signal: caller.signal },
    );
    expect(response.status).toBe(200);
    expect(signal).toBe(caller.signal);
  });

  test("resumes a canonical runtime session without deleting its binding", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({ session: {} });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.resumeRuntimeSession("workspace/id", "product/session");
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession/resume",
    );
  });

  test("renames through the canonical product-session route", async () => {
    let requested: { url: string; method: string; body: unknown } | null = null;
    globalThis.fetch = async (input, init) => {
      requested = {
        url: String(input),
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ session: {} });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.renameRuntimeSession("workspace/id", "product/session", "Renamed");
    expect(requested).toEqual({
      url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession/rename",
      method: "POST",
      body: { title: "Renamed" },
    });
  });

  test("forks through the canonical product-session route", async () => {
    let requested: { url: string; method: string; body: unknown } | null = null;
    globalThis.fetch = async (input, init) => {
      requested = {
        url: String(input),
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ session: {} });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.forkRuntimeSession("workspace/id", "product/session", "fork/product");
    expect(requested).toEqual({
      url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession/fork",
      method: "POST",
      body: { productSessionId: "fork/product" },
    });
  });

  test("updates session mode through the canonical product-session route", async () => {
    let requestedUrl = "";
    let body = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      body = String(init?.body ?? "");
      return Response.json({ session: {} });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.setRuntimeSessionMode("workspace/id", "product/session", "plan");
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession/mode",
    );
    expect(JSON.parse(body)).toEqual({ mode: "plan" });
  });

  test("lists and executes commands through canonical runtime routes", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return Response.json(init?.method === "POST"
        ? { ok: true, turnId: "turn" }
        : { productSessionId: "product/session", items: [], complete: true });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.listRuntimeSessionCommands("workspace/id", "product/session");
    await client.listRuntimeWorkspaceCommands("workspace/id", "grok-build");
    await client.executeRuntimeSessionCommand(
      "workspace/id",
      "product/session",
      "review/code",
      { arguments: "src" },
    );
    expect(seen.map((request) => request.url)).toEqual([
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession/commands",
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-commands?runtimeKind=grok-build",
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fsession/commands/review%2Fcode",
    ]);
    expect(JSON.parse(String(seen[2]?.init?.body))).toEqual({ arguments: "src" });
  });

  test("loads runtime selection in a workspace rollout context", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        state: "missing",
        complete: true,
        config: {
          version: 1,
          revision: 0,
          defaultRuntimeKind: "opencode",
          workspaceOverrides: {},
        },
        availableRuntimeKinds: ["opencode", "grok-build"],
        selectableDefaultRuntimeKinds: ["opencode"],
        selectableWorkspaceRuntimeKinds: ["opencode", "grok-build"],
        health: [],
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.getAgentRuntimeSelection("workspace/id");
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/agent-runtime/selection?workspaceId=workspace%2Fid",
    );
  });

  test("loads redacted connector availability for one runtime", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        runtimeKind: "grok-build",
        workspaceId: "workspace/id",
        items: [],
        complete: true,
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.getAgentRuntimeConnectorTools("workspace/id", "grok-build");
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-connectors?runtimeKind=grok-build",
    );
  });

  test("loads a bounded canonical event replay", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        productSessionId: "product",
        generation: 1,
        latestSequence: 7,
        events: [],
        complete: true,
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.getRuntimeSessionEventSnapshot("workspace", "product", {
      afterSequence: 4,
      limit: 20,
    });
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/workspace/workspace/runtime-sessions/product/event-snapshot?afterSequence=4&limit=20",
    );
  });

  test("loads canonical runtime messages without a native endpoint", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        productSessionId: "product/id",
        messages: [],
        complete: true,
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.getRuntimeSessionMessages("workspace/id", "product/id");
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fid/messages",
    );
  });

  test("responds to a canonical runtime approval through the host route", async () => {
    let requested: { url: string; body: unknown } | null = null;
    globalThis.fetch = async (input, init) => {
      requested = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ ok: true, allowed: false });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      hostToken: "host-token",
    });
    await client.respondRuntimePermission("permission/id", "deny");
    expect(requested).toEqual({
      url: "http://127.0.0.1:4096/approvals/permission%2Fid",
      body: { reply: "deny" },
    });
  });

  test("starts runtime authentication only through the host route", async () => {
    let requested: { url: string; body: unknown; hostToken: string | null } | null = null;
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requested = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
        hostToken: headers.get("x-onmyagent-host-token"),
      };
      return Response.json({
        runtimeKind: "grok-build",
        profileId: "system",
        workspaceId: "workspace/id",
        models: [],
        auth: { state: "ready", methods: [{ id: "grok.com" }] },
        complete: true,
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
      hostToken: "host-token",
    });
    await client.authenticateAgentRuntime("workspace/id", "grok-build", "grok.com");
    expect(requested).toEqual({
      url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-authenticate",
      body: { runtimeKind: "grok-build", methodId: "grok.com" },
      hostToken: "host-token",
    });
  });

  test("loads the runtime-scoped model catalog and durably updates a sticky session", async () => {
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      seen.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.includes("/runtime-models")) {
        return Response.json({
          runtimeKind: "grok-build",
          profileId: "system",
          workspaceId: "workspace/id",
          models: [{
            ref: { modelId: "grok-4.5" },
            displayName: "Grok 4.5",
            available: true,
            capabilities: {
              text: true,
              imageInput: true,
              tools: true,
              reasoning: true,
            },
          }],
          defaultModelRef: { modelId: "grok-4.5" },
          auth: { state: "ready", methods: [] },
          complete: true,
        });
      }
      return Response.json({
        session: {
          productSessionId: "product/id",
          runtimeKind: "grok-build",
          runtimeSessionId: "native/id",
          workspaceId: "workspace/id",
          cwd: "/workspace",
          profileId: "system",
          modelRef: { modelId: "grok-4.5", variant: "low" },
          createdAt: 1,
          updatedAt: 2,
          status: { type: "idle" },
        },
      });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.getAgentRuntimeModelCatalog("workspace/id", "grok-build");
    await client.setRuntimeSessionModel(
      "workspace/id",
      "product/id",
      { modelId: "grok-4.5", variant: "low" },
    );
    expect(seen).toEqual([
      {
        url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-models?runtimeKind=grok-build",
        method: "GET",
        body: null,
      },
      {
        url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fid/model",
        method: "POST",
        body: { modelRef: { modelId: "grok-4.5", variant: "low" } },
      },
    ]);
  });

  test("posts bounded question answers through the canonical runtime session path", async () => {
    let requested: { url: string; body: unknown } | null = null;
    globalThis.fetch = async (input, init) => {
      requested = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ ok: true });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.respondRuntimeQuestion(
      "workspace/id",
      "product/id",
      "question/id",
      [["Local"], []],
    );
    expect(requested).toEqual({
      url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fid/questions/question%2Fid",
      body: { answers: [["Local"], []] },
    });
  });

  test("closes a canonical runtime session without deleting its binding", async () => {
    let requested: { url: string; method: string } | null = null;
    globalThis.fetch = async (input, init) => {
      requested = { url: String(input), method: init?.method ?? "GET" };
      return Response.json({ ok: true });
    };
    const client = createOnMyAgentServerClient({
      baseUrl: "http://127.0.0.1:4096",
      token: "client-token",
    });
    await client.closeRuntimeSession("workspace/id", "product/id");
    expect(requested).toEqual({
      url: "http://127.0.0.1:4096/workspace/workspace%2Fid/runtime-sessions/product%2Fid/close",
      method: "POST",
    });
  });
});
