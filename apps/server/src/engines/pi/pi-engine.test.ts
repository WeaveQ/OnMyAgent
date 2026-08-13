import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PiEngine } from "./pi-engine.js";
import { hashWorkspace, listPiSessions, managedSessionDir } from "./session-store.js";

function fakeConfig() {
  return {
    agentEngine: "pi" as const,
    host: "127.0.0.1",
    port: 0,
    token: "t",
    hostToken: "ht",
    approval: { mode: "manual" as const, timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: 0,
    tokenSource: "generated" as const,
    hostTokenSource: "generated" as const,
    logFormat: "json" as const,
    logRequests: false,
  };
}

const HAS_PI = existsSync("/opt/homebrew/bin/pi") || existsSync("/usr/local/bin/pi");

test("hashWorkspace is stable and distinct", () => {
  assert.equal(hashWorkspace("/a/b"), hashWorkspace("/a/b"));
  assert.notEqual(hashWorkspace("/a/b"), hashWorkspace("/a/c"));
});

test("listPiSessions returns [] for missing dir", async () => {
  const dir = join(tmpdir(), "pi-sessions-nonexistent-" + Date.now());
  assert.deepEqual(await listPiSessions(dir), []);
});

test("managedSessionDir nests under profile root + workspace hash", () => {
  const dir = managedSessionDir("/profiles/local", "abc123");
  assert.ok(dir.endsWith("pi-sessions/abc123"));
});

test("PiEngine end-to-end (needs real pi binary + provider)", { skip: !HAS_PI }, async () => {
  if (!HAS_PI) return;
  const config = fakeConfig();
  const workspace = { id: "w1", name: "w1", path: tmpdir(), preset: "local", workspaceType: "local" as const };
  const engine = new PiEngine(config, workspace);

  const ref = await engine.createSession({ title: "pi-engine-e2e" });
  assert.equal(ref.engine, "pi");
  assert.ok(ref.id.length > 0);

  // Send a minimal prompt and collect streamed events.
  const events: string[] = [];
  engine.onEvent((e) => events.push(e.type));
  await engine.sendMessage(ref.id, { prompt: "只回复 OK" });

  // Session file is written lazily after the first message; poll for it.
  let sessions: Awaited<ReturnType<typeof engine.listSessions>> = [];
  for (let i = 0; i < 20; i++) {
    sessions = await engine.listSessions();
    if (sessions.some((s) => s.id === ref.id)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(sessions.some((s) => s.id === ref.id), "created session listed");

  await engine.deleteSession(ref.id);
  const after = await engine.listSessions();
  assert.ok(!after.some((s) => s.id === ref.id), "deleted session gone");
});

test("PiEngine approval bridge: extension injects, request bridges, deny blocks tool", { skip: !HAS_PI }, async () => {
  if (!HAS_PI) return;
  const config = fakeConfig();
  const workspace = { id: "w2", name: "w2", path: tmpdir(), preset: "local", workspaceType: "local" as const };
  const engine = new PiEngine(config, workspace);

  // Capabilities now advertise the bridge.
  assert.equal(engine.getCapabilities().approvals, "bridge");

  const ref = await engine.createSession({ title: "pi-approval-bridge" });
  const permissions: Array<{ requestId: string; sessionId: string }> = [];
  engine.onEvent((e) => {
    if (e.type === "permission_request") {
      permissions.push({ requestId: e.requestId, sessionId: e.sessionId });
    }
  });

  // A bash call (NOT in the extension allowlist) must trigger the approval
  // bridge before executing. We deny it; the tool result must not appear.
  void engine.sendMessage(ref.id, { prompt: "用 bash 运行 echo hello-bridge-test" });

  // Poll for the permission request (bash must be gated).
  let request: { requestId: string; sessionId: string } | null = null;
  for (let i = 0; i < 40; i++) {
    const current = permissions[0] ?? null;
    if (current) {
      request = current;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(request, "expected at least one permission_request");
  assert.equal(request!.sessionId, ref.id);

  // listPermissions surfaces the pending request through the engine API.
  const listed = await engine.listPermissions(ref.id);
  assert.ok(listed.some((p) => (p as { id: string }).id === request!.requestId));

  // Deny: extension returns {block:true}, tool must NOT run.
  await engine.approvePermission(ref.id, request!.requestId, false);
  assert.equal((await engine.listPermissions(ref.id)).length, 0, "resolved request leaves pending queue");

  // Wait for the turn to settle, then verify the tool never produced output.
  await new Promise((r) => setTimeout(r, 3_000));
  const messages = (await engine.getMessages(ref.id)) as Array<{
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  // The blocked tool result carries the block reason, not the echo output.
  const toolResults = messages
    .filter((m) => m.role === "toolResult" || m.role === "tool")
    .flatMap((m) => (m.content ?? []).map((part) => part.text ?? ""));
  assert.ok(toolResults.length > 0, "tool result present after blocked call");
  assert.ok(
    toolResults.some((text) => text.includes("Blocked") || text.includes("block")),
    "block reason visible in tool result",
  );
  assert.ok(
    !toolResults.some((text) => text.includes("hello-bridge-test")),
    "blocked tool must not produce echo output",
  );

  await engine.deleteSession(ref.id);
});

test("PiEngine approval bridge: allow lets the tool execute", { skip: !HAS_PI }, async () => {
  if (!HAS_PI) return;
  const config = fakeConfig();
  const workspace = { id: "w3", name: "w3", path: tmpdir(), preset: "local", workspaceType: "local" as const };
  const engine = new PiEngine(config, workspace);

  const ref = await engine.createSession({ title: "pi-approval-bridge-allow" });
  const permissions: Array<{ requestId: string }> = [];
  engine.onEvent((e) => {
    if (e.type === "permission_request") {
      permissions.push({ requestId: e.requestId });
    }
  });

  await engine.sendMessage(ref.id, { prompt: "用 bash 运行 echo allow-bridge-test" });
  // Poll for the permission request (bash must be gated).
  let request: { requestId: string } | null = null;
  for (let i = 0; i < 30; i++) {
    if (permissions.length > 0) {
      request = permissions[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(request, "expected permission_request for bash");
  await engine.approvePermission(ref.id, request.requestId, true);

  // Allow: tool runs, output appears in the transcript.
  let found = false;
  for (let i = 0; i < 30; i++) {
    const messages = await engine.getMessages(ref.id);
    if (JSON.stringify(messages).includes("allow-bridge-test")) {
      found = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(found, "allowed tool must execute (output visible in transcript)");

  await engine.deleteSession(ref.id);
});
