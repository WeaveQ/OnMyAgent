import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import {
  isExpertPromptProxyRequest,
  isLegacyOpencodeProxyPath,
  parseExpertPromptProxyPath,
  parseWorkspaceOpencodeMount,
  proxyOpencodeRequest,
} from "../src/services/opencode-proxy.js";
import {
  estimateExpertPromptTokens,
  EXPERT_PROMPT_TOKEN_LIMIT,
  resolveExpertRuntimeDirectoryCandidate,
} from "../src/services/expert-runtime-contract.js";
import { createExpertSessionRuntimeDirectory } from "../src/services/expert-session-runtime.js";
import { getExpertLifecycleEventsSnapshot, resetExpertLifecycleEventsForTest } from "../src/services/expert-lifecycle-events.js";

let root = "";
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "onmyagent-opencode-proxy-"));
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
  delete process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
  resetExpertLifecycleEventsForTest();
});

describe("OpenCode proxy mounts", () => {
  test("only /workspace/:id/opencode is canonical; /w and unscoped /opencode are legacy", () => {
    expect(parseWorkspaceOpencodeMount("/workspace/ws_1/opencode/session")).toEqual({
      workspaceId: "ws_1",
      restPath: "/opencode/session",
    });
    expect(isLegacyOpencodeProxyPath("/opencode/session")).toBe(true);
    expect(isLegacyOpencodeProxyPath("/w/ws_1/opencode/session")).toBe(true);
    expect(isLegacyOpencodeProxyPath("/workspace/ws_1/opencode/session")).toBe(false);
    expect(isLegacyOpencodeProxyPath("/w/ws_1/health")).toBe(false);
  });
});

describe("OpenCode Expert prompt proxy contract", () => {
  test("matches both canonical and legacy mounted prompt_async paths", () => {
    expect(isExpertPromptProxyRequest("POST", "/session/s_1/prompt_async")).toBe(true);
    expect(isExpertPromptProxyRequest("POST", "/opencode/session/s_1/prompt_async")).toBe(true);
    expect(parseExpertPromptProxyPath("/opencode/session/s_1/prompt_async")).toBe("s_1");
    expect(isExpertPromptProxyRequest("POST", "/session/s_1/command")).toBe(false);
  });

  test("asserts an authorized Expert directory before forwarding and preserves the body", async () => {
    const workspace = testWorkspace(join(root, "workspace"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Proxy Expert",
      agentId: "proxy-expert",
      packageName: "proxy-package",
      sessionId: "session-proxy",
    });
    const requestPayload = {
      agent: "onmyagent",
      tools: { read: true },
      system: [
        "You are the selected Expert. Work only inside the isolated runtime.",
        "Respect workspace permissions, declared skills, collaboration mode, language, and user instructions.",
        "Provide concise evidence-backed results and preserve session continuity.",
      ].join("\n"),
      parts: [
        { type: "text", text: "Inspect the current workspace and prepare the first expert response." },
      ],
    };
    const requestBody = JSON.stringify(requestPayload);
    expect(estimateExpertPromptTokens(requestPayload)).toBeLessThanOrEqual(
      EXPERT_PROMPT_TOKEN_LIMIT,
    );
    let forwardedBody = "";
    let forwarded = 0;
    globalThis.fetch = (async (_input, init) => {
      forwarded += 1;
      forwardedBody = new TextDecoder().decode(init?.body as ArrayBuffer);
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const requestUrl = `http://server.test/workspace/ws_proxy/opencode/session/session-proxy/prompt_async?directory=${encodeURIComponent(created.directory)}`;
    const response = await proxyOpencodeRequest({
      config: config(workspace),
      request: new Request(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // SDK clients retain their default workspace header while the
          // per-call Expert directory is carried in the query.
          "x-opencode-directory": workspace.path,
        },
        body: requestBody,
      }),
      url: new URL(requestUrl),
      workspace,
      proxyPath: "/opencode/session/session-proxy/prompt_async",
    });
    expect(response.status).toBe(200);
    expect(forwarded).toBe(1);
    expect(forwardedBody).toBe(requestBody);
  });

  test("uses the query Expert directory when the SDK header still points at another runtime", async () => {
    const workspace = testWorkspace(join(root, "workspace-query"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-query");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const current = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Current Expert",
      agentId: "current-expert",
      packageName: "current-package",
      sessionId: "session-current",
    });
    const leftover = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Leftover Expert",
      agentId: "leftover-expert",
      packageName: "leftover-package",
      sessionId: "session-leftover",
    });
    let forwarded = 0;
    globalThis.fetch = (async () => {
      forwarded += 1;
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const requestUrl = `http://server.test/workspace/ws_query/opencode/session/session-current/prompt_async?directory=${encodeURIComponent(current.directory)}`;
    const response = await proxyOpencodeRequest({
      config: config(workspace),
      request: new Request(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": leftover.directory,
        },
        body: JSON.stringify({ agent: "onmyagent", parts: [{ type: "text", text: "hi" }] }),
      }),
      url: new URL(requestUrl),
      workspace,
      proxyPath: "/opencode/session/session-current/prompt_async",
    });
    expect(response.status).toBe(200);
    expect(forwarded).toBe(1);
  });

  test("forwards an ordinary workspace prompt when the SDK header is a leftover Expert runtime", async () => {
    const workspace = testWorkspace(join(root, "workspace-ordinary-leftover"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-ordinary-leftover");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const leftover = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Leftover Expert",
      agentId: "leftover-ordinary",
      packageName: "leftover-ordinary-package",
      sessionId: "session-leftover-ordinary",
    });
    let forwarded = 0;
    globalThis.fetch = (async () => {
      forwarded += 1;
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const requestUrl = `http://server.test/workspace/ws_ordinary_leftover/opencode/session/session-ordinary/prompt_async?directory=${encodeURIComponent(workspace.path)}`;
    const response = await proxyOpencodeRequest({
      config: config(workspace),
      request: new Request(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": leftover.directory,
        },
        body: JSON.stringify({ agent: "onmyagent", parts: [{ type: "text", text: "ordinary" }] }),
      }),
      url: new URL(requestUrl),
      workspace,
      proxyPath: "/opencode/session/session-ordinary/prompt_async",
    });
    expect(response.status).toBe(200);
    expect(forwarded).toBe(1);
  });

  test("fails closed for malformed marker instead of treating it as an ordinary prompt", async () => {
    const workspace = testWorkspace(join(root, "workspace-broken"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-broken");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Broken Expert",
      agentId: "broken-expert",
      packageName: "broken-package",
      sessionId: "session-broken",
    });
    const markerPath = join(created.directory, "onmyagent-session.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    marker.isolationVersion = 99;
    await writeFile(markerPath, "{truncated");
    let forwarded = 0;
    const violations: Array<{ violationCode: string; workspaceHash: string; directoryHash: string }> = [];
    globalThis.fetch = (async () => {
      forwarded += 1;
      return new Response("unexpected");
    }) as typeof fetch;

    await expect(proxyOpencodeRequest({
      config: config(workspace),
      request: new Request("http://server.test/w/ws_broken/opencode/session/session-broken/prompt_async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": created.directory,
        },
        body: JSON.stringify({ agent: "onmyagent", parts: [] }),
      }),
      url: new URL("http://server.test/w/ws_broken/opencode/session/session-broken/prompt_async"),
      workspace,
      proxyPath: "/opencode/session/session-broken/prompt_async",
      onExpertContractViolation: (event) => violations.push(event),
    })).rejects.toMatchObject({
      code: "expert_runtime_contract_violated",
    });
    expect(forwarded).toBe(0);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.workspaceHash).not.toBe(workspace.id);
    expect(violations[0]?.directoryHash).not.toContain("runtime-broken");
  });

  test("direct unmounted proxy cannot target an Expert directory from another workspace", async () => {
    const targetWorkspace = testWorkspace(join(root, "workspace-direct-target"));
    const expertWorkspace = {
      ...testWorkspace(join(root, "workspace-direct-expert")),
      id: "ws_direct_expert",
    };
    await mkdir(targetWorkspace.path, { recursive: true });
    await mkdir(expertWorkspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-direct");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const created = await createExpertSessionRuntimeDirectory({
      workspace: expertWorkspace,
      runtimeRoot,
      agentName: "Foreign Expert",
      agentId: "foreign-expert",
      packageName: "foreign-package",
      sessionId: "session-foreign",
    });
    let forwarded = 0;
    globalThis.fetch = (async () => {
      forwarded += 1;
      return new Response("unexpected");
    }) as typeof fetch;

    await expect(proxyOpencodeRequest({
      config: config(targetWorkspace),
      request: new Request("http://server.test/opencode/session/session-foreign/prompt_async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": created.directory,
        },
        body: JSON.stringify({ agent: "onmyagent", parts: [] }),
      }),
      url: new URL("http://server.test/opencode/session/session-foreign/prompt_async"),
      workspace: targetWorkspace,
    })).rejects.toMatchObject({
      code: "expert_runtime_contract_violated",
      violationCode: "authorized_directory",
    });
    expect(forwarded).toBe(0);
  });

  test("rejects malformed or oversized Expert JSON from the bounded clone", async () => {
    const workspace = testWorkspace(join(root, "workspace-bounded"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-bounded");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Bounded Expert",
      agentId: "bounded-expert",
      packageName: "bounded-package",
      sessionId: "session-bounded",
    });
    let forwarded = 0;
    globalThis.fetch = (async () => {
      forwarded += 1;
      return new Response("unexpected");
    }) as typeof fetch;
    await expect(proxyOpencodeRequest({
      config: config(workspace),
      request: new Request("http://server.test/w/ws_bounded/opencode/session/session-bounded/prompt_async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": created.directory,
        },
        body: "not-json",
      }),
      url: new URL("http://server.test/w/ws_bounded/opencode/session/session-bounded/prompt_async"),
      workspace,
      proxyPath: "/opencode/session/session-bounded/prompt_async",
    })).rejects.toMatchObject({ violationCode: "prompt_body_invalid" });
    expect(forwarded).toBe(0);
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) =>
      event.kind === "contract_assertion" && event.outcome === "failed",
    )).toHaveLength(1);

    resetExpertLifecycleEventsForTest();
    const oversized = JSON.stringify({ agent: "onmyagent", system: "x".repeat(600_000) });
    await expect(proxyOpencodeRequest({
      config: config(workspace),
      request: new Request("http://server.test/w/ws_bounded/opencode/session/session-bounded/prompt_async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": created.directory,
        },
        body: oversized,
      }),
      url: new URL("http://server.test/w/ws_bounded/opencode/session/session-bounded/prompt_async"),
      workspace,
      proxyPath: "/opencode/session/session-bounded/prompt_async",
    })).rejects.toMatchObject({
      violationCode: "prompt_body_too_large",
      details: { bodyLimitBytes: 512 * 1024 },
    });
    expect(forwarded).toBe(0);
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) =>
      event.kind === "contract_assertion" && event.outcome === "failed",
    )).toHaveLength(1);
  });

  test("forwards Expert prompts whose size comes from file parts, not text", async () => {
    const workspace = testWorkspace(join(root, "workspace-file-parts"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-file-parts");
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "File Expert",
      agentId: "file-expert",
      packageName: "file-package",
      sessionId: "session-file-parts",
    });
    const requestPayload = {
      agent: "onmyagent",
      parts: [
        { type: "text", text: "这是相关资料，你先看一下" },
        {
          type: "file",
          filename: "项目表.xlsx",
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          url: `data:application/octet-stream;base64,${"A".repeat(600_000)}`,
        },
      ],
    };
    const requestBody = JSON.stringify(requestPayload);
    expect(requestBody.length).toBeGreaterThan(512 * 1024);
    expect(estimateExpertPromptTokens(requestPayload)).toBeLessThanOrEqual(
      EXPERT_PROMPT_TOKEN_LIMIT,
    );
    let forwarded = 0;
    let forwardedBody = "";
    globalThis.fetch = (async (_input, init) => {
      forwarded += 1;
      forwardedBody = new TextDecoder().decode(init?.body as ArrayBuffer);
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const requestUrl = `http://server.test/workspace/ws_file/opencode/session/session-file-parts/prompt_async?directory=${encodeURIComponent(created.directory)}`;
    const response = await proxyOpencodeRequest({
      config: config(workspace),
      request: new Request(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": created.directory,
        },
        body: requestBody,
      }),
      url: new URL(requestUrl),
      workspace,
      proxyPath: "/opencode/session/session-file-parts/prompt_async",
    });
    expect(response.status).toBe(200);
    expect(forwarded).toBe(1);
    expect(forwardedBody).toBe(requestBody);
  });

  test("leaves a non-Expert workspace prompt unchanged", async () => {
    const workspace = testWorkspace(join(root, "workspace-ordinary"));
    await mkdir(workspace.path, { recursive: true });
    const requestBody = JSON.stringify({ agent: "sisyphus", parts: [{ type: "text", text: "ordinary" }] });
    let forwardedBody = "";
    globalThis.fetch = (async (_input, init) => {
      forwardedBody = new TextDecoder().decode(init?.body as ArrayBuffer);
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    await proxyOpencodeRequest({
      config: config(workspace),
      request: new Request("http://server.test/w/ws_ordinary/opencode/session/session-ordinary/prompt_async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      }),
      url: new URL("http://server.test/w/ws_ordinary/opencode/session/session-ordinary/prompt_async"),
      workspace,
      proxyPath: "/opencode/session/session-ordinary/prompt_async",
    });
    expect(forwardedBody).toBe(requestBody);
  });

  test("preview, coach, and automation workspace roots cannot target an Expert runtime", async () => {
    const workspace = testWorkspace(join(root, "workspace-inventory"));
    await mkdir(join(workspace.path, "tasks", "automation-1"), { recursive: true });
    await mkdir(join(workspace.path, "preview"), { recursive: true });
    process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = join(root, "runtime-inventory");
    expect(await resolveExpertRuntimeDirectoryCandidate({
      workspaceId: workspace.id,
      sessionRoot: workspace.path,
    })).toBeNull();
    expect(await resolveExpertRuntimeDirectoryCandidate({
      workspaceId: workspace.id,
      sessionRoot: join(workspace.path, "tasks", "automation-1"),
    })).toBeNull();
    expect(await resolveExpertRuntimeDirectoryCandidate({
      workspaceId: workspace.id,
      sessionRoot: join(workspace.path, "preview"),
    })).toBeNull();
  });
});

function testWorkspace(path: string): WorkspaceInfo {
  const idBySuffix: Record<string, string> = {
    "workspace-broken": "ws_broken",
    "workspace-ordinary": "ws_ordinary",
    "workspace-bounded": "ws_bounded",
    "workspace-inventory": "ws_inventory",
  };
  const id = Object.entries(idBySuffix).find(([suffix]) => path.endsWith(suffix))?.[1] ?? "ws_proxy";
  return {
    id,
    name: "Proxy workspace",
    path,
    preset: "default",
    workspaceType: "local",
    baseUrl: "http://opencode.test",
  };
}

function config(workspace: WorkspaceInfo): ServerConfig {
  return {
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
}
