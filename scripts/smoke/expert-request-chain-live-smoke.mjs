#!/usr/bin/env bun

/**
 * Live Expert request-chain smoke.
 *
 * Uses a disposable workspace/runtime, the production Expert runtime owner,
 * the production OnMyAgent OpenCode proxy, and the host's configured OpenCode
 * provider for one real model response. No user config or model is mutated.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  findFreePort,
  makeClient,
  spawnOpencodeServe,
  waitForHealthy,
} from "../../apps/app/scripts/_util.mjs";
import {
  createExpertSessionRuntimeDirectory,
  ensureExpertSessionRuntimeIsolation,
} from "../../apps/server/src/services/expert-session-runtime.ts";
import { proxyOpencodeRequest } from "../../apps/server/src/services/opencode-proxy.ts";
import {
  getExpertLifecycleEventsSnapshot,
  resetExpertLifecycleEventsForTest,
} from "../../apps/server/src/services/expert-lifecycle-events.ts";

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-live-"));
const workspaceRoot = path.join(fixtureRoot, "workspace");
const runtimeRoot = path.join(fixtureRoot, "runtime");
await mkdir(workspaceRoot, { recursive: true });
process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = runtimeRoot;

const port = await findFreePort();
const server = await spawnOpencodeServe({ directory: workspaceRoot, port });
let sessionId = "";
let expertClient;

try {
  const workspace = {
    id: "expert-live-smoke",
    name: "Expert live smoke",
    path: workspaceRoot,
    preset: "default",
    workspaceType: "local",
    baseUrl: server.baseUrl,
  };
  const config = {
    host: "127.0.0.1",
    port: 0,
    token: "fixture-token",
    hostToken: "fixture-host-token",
    approval: { mode: "auto", timeoutMs: 30_000 },
    corsOrigins: [],
    workspaces: [workspace],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };

  const rootClient = makeClient({ baseUrl: server.baseUrl, directory: workspaceRoot });
  await waitForHealthy(rootClient, { server, timeoutMs: 30_000 });
  const runtime = await createExpertSessionRuntimeDirectory({
    workspace,
    runtimeRoot,
    agentName: "Live Smoke Expert",
    agentId: "live-smoke-expert",
    packageName: "live-smoke-package",
    skillNames: [],
    approvedAgentIds: [],
  });
  expertClient = makeClient({ baseUrl: server.baseUrl, directory: runtime.directory });
  const session = await expertClient.session.create({ title: "Expert live request smoke" });
  sessionId = session.id;
  assert.ok(sessionId, "OpenCode must create the Expert session");
  const bound = await ensureExpertSessionRuntimeIsolation({
    workspace,
    directory: runtime.directory,
    runtimeRoot,
    agentId: "live-smoke-expert",
    packageName: "live-smoke-package",
    sessionId,
    skillNames: [],
    approvedAgentIds: [],
  });
  assert.equal(bound?.isolationVersion, 3, "Expert marker must bind at v3");

  resetExpertLifecycleEventsForTest();
  const payload = {
    agent: "onmyagent",
    parts: [{ type: "text", text: "Reply with exactly: Expert live chain OK" }],
  };
  const proxyPath = `/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`;
  const requestUrl = `http://onmyagent.test/w/${workspace.id}${proxyPath}?directory=${encodeURIComponent(runtime.directory)}`;
  const response = await proxyOpencodeRequest({
    config,
    workspace,
    proxyPath,
    url: new URL(requestUrl),
    request: new Request(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": workspaceRoot,
      },
      body: JSON.stringify(payload),
    }),
  });
  assert.ok(response.ok, `Expert proxy prompt must be accepted (${response.status})`);

  let messages = [];
  let assistantText = "";
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    messages = await expertClient.session.messages({ sessionID: sessionId, limit: 20 });
    assistantText = messages
      .filter((message) => message?.info?.role === "assistant")
      .flatMap((message) => message.parts ?? [])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n");
    if (assistantText) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.match(
    assistantText,
    /Expert live chain OK/i,
    "Expert prompt must produce the requested real model response",
  );
  const contractEvents = getExpertLifecycleEventsSnapshot().events.filter(
    (event) => event.kind === "contract_assertion",
  );
  assert.equal(
    contractEvents.filter((event) => event.outcome === "succeeded").length,
    1,
    "proxy must record one successful Expert contract assertion",
  );
  assert.equal(
    contractEvents.filter((event) => event.outcome === "failed").length,
    0,
    "live request must not record a contract failure",
  );

  console.log(JSON.stringify({
    ok: true,
    providerRequest: "real",
    sessionId,
    messageCount: messages.length,
    assistantResponseVerified: true,
    contractAssertions: contractEvents.map((event) => ({
      outcome: event.outcome,
      code: event.code,
    })),
    fixtureContained: true,
  }, null, 2));
} finally {
  if (expertClient && sessionId) {
    await expertClient.session.delete({ sessionID: sessionId }).catch(() => undefined);
  }
  await server.close();
  delete process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
  resetExpertLifecycleEventsForTest();
  await rm(fixtureRoot, { recursive: true, force: true });
}
