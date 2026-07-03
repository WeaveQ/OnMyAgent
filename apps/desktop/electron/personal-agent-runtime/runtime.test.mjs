import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

import { injectPersonalAgentContext } from "./context-injection.mjs";
import { extractAcpSessionId, normalizeAcpUpdate, spawnAcpClient, textFromAcpContent } from "./acp-client.mjs";
import { probeAcpCommand } from "./acp-probe.mjs";
import { MANAGED_ACP_TOOLS, managedAcpBinPath, managedAcpToolRoot, validateManagedAcpTool } from "./managed-acp-tools.mjs";
import { personalAgentAvailableMetadataList, personalAgentMetadataFromAgent, personalAgentMetadataList, normalizeAgentStatus } from "./agent-metadata.mjs";
import { appendContractEvent, runEventsToConversationMessages } from "./contract.mjs";
import { createConversation, getConversation, getOrCreateConversation, listConversations, readConversationEvents, updateConversation } from "./conversation-store.mjs";
import { createPersonalAgentRuntime } from "./index.mjs";
import { AcpE2EStreamInjector } from "./acp-e2e-stream-injector.mjs";
import { clearAgentProcesses, flushAgentProcessRegistry, getAgentProcess, listAgentProcesses, processRegistryFile, recoverAgentProcesses, registerAgentProcess, updateAgentProcess, recordAgentCrash, crashRestartBackoffMs, clearAgentCrashHistory } from "./process-registry.mjs";
import {
  sessionArchiveDbFile,
  sessionArchiveLogRoot,
  sessionArchiveRoot,
  configurePersonalAgentRuntimeState,
  legacySessionArchiveRoot,
  runtimeStateWorkspaceRoots,
} from "./runtime-state.mjs";
import { isStaleNativeSessionError, staleNativeSessionResetMessage } from "./native-sessions.mjs";
import { clearSession, legacySessionFile, readSession, sessionFile, writeSession } from "./session-store.mjs";
import { __test__ as codexTest } from "./adapters/codex.mjs";
import { __test__ as claudeTest } from "./adapters/claude.mjs";
import { __test__ as hermesTest } from "./adapters/hermes.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { __test__ as opencodeTest } from "./adapters/opencode.mjs";
import { __test__ as openclawTest } from "./adapters/openclaw.mjs";
import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-personal-agent-runtime-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state") });
  return workspaceRoot;
}

async function cleanup(workspaceRoot) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function withTinyWebSocketServer(handler) {
  const server = http.createServer();
  const sockets = new Set();
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pendingBuffer = Buffer.alloc(0);
    socket.on("data", (buffer) => {
      pendingBuffer = Buffer.concat([pendingBuffer, buffer]);
      if (pendingBuffer.length < 6) return;
      const opcode = pendingBuffer[0] & 0x0f;
      let offset = 2;
      let length = pendingBuffer[1] & 127;
      if (length === 126) {
        if (pendingBuffer.length < 8) return;
        length = pendingBuffer.readUInt16BE(offset);
        offset += 2;
      }
      if (pendingBuffer.length < offset + 4 + length) return;
      const mask = pendingBuffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = pendingBuffer.subarray(offset, offset + length);
      pendingBuffer = pendingBuffer.subarray(offset + length);
      if (opcode !== 1 || payload.length === 0) return;
      const text = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4])).toString("utf8");
      const message = JSON.parse(text);
      const result = handler(message);
      const response = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), "utf8");
      socket.write(Buffer.concat([Buffer.from([0x81, response.length]), response]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    }),
  };
}

describe("personal agent runtime storage", () => {
  it("resolves SessionArchive archive runtime state under userData and keeps legacy repo path read-only", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const archiveRoot = sessionArchiveRoot(workspaceRoot);
      const dbFile = sessionArchiveDbFile(workspaceRoot);
      const logRoot = sessionArchiveLogRoot(workspaceRoot);
      const legacyRoot = legacySessionArchiveRoot(workspaceRoot);

      assert.match(archiveRoot, new RegExp(`${escapeRegExp(path.sep)}user-data${escapeRegExp(path.sep)}runtime-state${escapeRegExp(path.sep)}session-archive${escapeRegExp(path.sep)}workspaces${escapeRegExp(path.sep)}`));
      assert.equal(archiveRoot.startsWith(path.join(workspaceRoot, "user-data", "runtime-state")), true);
      assert.equal(dbFile, path.join(archiveRoot, "archive.sqlite"));
      assert.equal(logRoot, path.join(archiveRoot, "logs"));
      assert.equal(legacyRoot, path.join(workspaceRoot, ".session-archive"));
      assert.equal(archiveRoot.includes(`${path.sep}.session-archive`), false);
      assert.equal(dbFile.startsWith(workspaceRoot + path.sep) && !dbFile.includes(`${path.sep}user-data${path.sep}`), false);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("describes runtime-state and legacy compatibility roots from one boundary", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const roots = runtimeStateWorkspaceRoots(workspaceRoot);

      assert.equal(roots.personalAgentRoot.startsWith(path.join(workspaceRoot, "user-data", "runtime-state")), true);
      assert.equal(roots.sessionArchiveRoot.startsWith(path.join(workspaceRoot, "user-data", "runtime-state")), true);
      assert.equal(roots.legacyPersonalAgentRoot, path.join(workspaceRoot, ".opencode", "personal-assistant"));
      assert.equal(roots.legacySessionArchiveRoot, path.join(workspaceRoot, ".session-archive"));
      assert.equal(roots.personalAgentRoot.includes(`${path.sep}.opencode${path.sep}`), false);
      assert.equal(roots.sessionArchiveDbFile, path.join(roots.sessionArchiveRoot, "archive.sqlite"));
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("reads legacy session files and writes new session files outside workspace .opencode", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const legacyPath = legacySessionFile(workspaceRoot, "codex", "codex");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, JSON.stringify({ threadId: "legacy-thread" }), "utf8");

      assert.deepEqual(await readSession(workspaceRoot, "codex", "codex"), { threadId: "legacy-thread" });

      await writeSession(workspaceRoot, "codex", "codex", { sessionId: "new-session" });
      assert.deepEqual(await readSession(workspaceRoot, "codex", "codex"), { sessionId: "new-session" });
      assert.equal(await readFile(sessionFile(workspaceRoot, "codex", "codex"), "utf8").then((raw) => raw.includes("new-session")), true);
      assert.equal(sessionFile(workspaceRoot, "codex", "codex").includes(`${path.sep}.opencode${path.sep}`), false);
      await assert.rejects(readFile(path.join(workspaceRoot, ".opencode", "personal-assistant", "sessions", "codex-codex.json"), "utf8"));
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("migrates legacy personal-assistant sessions by compatible read without writing back to the repo", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const legacyPath = path.join(workspaceRoot, ".opencode", "personal-assistant", "sessions", "codex-codex.json");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, JSON.stringify({ sessionId: "legacy-pa-session" }), "utf8");

      assert.deepEqual(await readSession(workspaceRoot, "codex", "codex"), { sessionId: "legacy-pa-session" });
      await writeSession(workspaceRoot, "codex", "codex", { sessionId: "new-runtime-state-session" });

      assert.deepEqual(await readSession(workspaceRoot, "codex", "codex"), { sessionId: "new-runtime-state-session" });
      assert.equal(await readFile(legacyPath, "utf8").then((raw) => raw.includes("legacy-pa-session")), true);
      assert.equal(await readFile(legacyPath, "utf8").then((raw) => raw.includes("new-runtime-state-session")), false);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("clears current and legacy session pointers for a new conversation", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      await writeSession(workspaceRoot, "codex", "codex", { sessionId: "current-session" });
      const legacyPath = legacySessionFile(workspaceRoot, "codex", "codex");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, JSON.stringify({ sessionId: "legacy-session" }), "utf8");

      const result = await clearSession(workspaceRoot, "codex", "codex");

      assert.equal(result.ok, true);
      assert.equal(result.removed.length, 2);
      assert.deepEqual(await readSession(workspaceRoot, "codex", "codex"), {});
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("stores multiple Studio conversations for one provider agent", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      await writeSession(workspaceRoot, "codex", "codex", { sessionId: "legacy-thread", workdir: "/tmp/legacy" });

      const migrated = await listConversations(workspaceRoot, "codex", "codex");
      assert.equal(migrated.conversations.length, 1);
      assert.equal(migrated.conversations[0].providerSessionId, "legacy-thread");

      const fresh = await createConversation(workspaceRoot, "codex", "codex", { title: "Fresh" });
      const imported = await createConversation(workspaceRoot, "codex", "codex", {
        title: "Imported",
        providerSessionId: "provider-thread-2",
        source: "imported-provider-session",
      });
      await updateConversation(workspaceRoot, "codex", "codex", fresh.id, { providerSessionId: "provider-thread-1" });

      const listed = await listConversations(workspaceRoot, "codex", "codex");
      assert.equal(listed.conversations.length, 3);
      assert.equal(listed.activeConversationId, fresh.id);
      assert.equal((await getOrCreateConversation(workspaceRoot, "codex", "codex", fresh.id)).providerSessionId, "provider-thread-1");
      assert.equal((await getConversation(workspaceRoot, "codex", "codex", imported.id)).providerSessionId, "provider-thread-2");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("exposes conversation get/status facade with run identity separate from provider session", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "codex", provider: "codex", status: "online" }),
          start: async () => ({}),
          run: async () => ({}),
          status: () => ({}),
          cancel: () => ({}),
        },
        adapters: {
          codex: () => ({
            sendMessage: async () => ({
              output: "ok",
              command: "fake codex",
              connectionMode: "Codex ACP session",
              providerSessionId: "provider-session-1",
              resumeKey: "provider-session-1",
            }),
          }),
        },
      });

      const created = await runtime.createConversation({ workspaceRoot, agent: { provider: "codex" }, title: "Facade" });
      assert.equal(created.conversation.providerSessionId, null);
      const started = await runtime.startMessage({ workspaceRoot, agent: { provider: "codex" }, conversationId: created.conversation.id, prompt: "hello" });
      assert.notEqual(started.runId, "provider-session-1");
      assert.equal(started.conversationId, created.conversation.id);
      const running = await runtime.getConversationStatus({ workspaceRoot, agent: { provider: "codex" }, conversationId: created.conversation.id });
      assert.equal(running.running, true);
      assert.equal(running.activeRun.conversationId, created.conversation.id);
      await waitForConversationFacadeRun(runtime, workspaceRoot, started.runId);
      const status = await runtime.getConversationStatus({ workspaceRoot, agent: { provider: "codex" }, conversationId: created.conversation.id });
      assert.equal(status.running, false);
      assert.equal(status.status, "completed");
      assert.equal(status.conversation.providerSessionId, "provider-session-1");
      const finalRun = runtime.getRun({ runId: started.runId, workspaceRoot });
      assert.equal(finalRun.conversationMessages.some((message) => message.type === "finish" && message.text === "ok"), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("warms up a conversation by creating a provider session before the first message", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let warmed = 0;
      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "codex", provider: "codex", status: "online" }),
          start: async () => ({}),
          run: async () => ({}),
          status: () => ({}),
          cancel: () => ({}),
        },
        adapters: {
          codex: () => ({
            warmupConversation: async () => {
              warmed += 1;
              return { ok: true, sessionId: "warm-provider-session", providerSessionId: "warm-provider-session", resumeKey: "warm-provider-session", workdir: "/tmp/warm" };
            },
            sendMessage: async (ctx) => ({
              output: `session=${ctx.providerSessionId}`,
              command: "fake codex",
              connectionMode: "Codex ACP session",
              providerSessionId: ctx.providerSessionId,
              resumeKey: ctx.resumeKey,
            }),
          }),
        },
      });

      const created = await runtime.createConversation({ workspaceRoot, agent: { provider: "codex" }, title: "Warm" });
      const warm = await runtime.warmupConversation({ workspaceRoot, agent: { provider: "codex" }, conversationId: created.conversation.id });
      assert.equal(warm.ok, true);
      assert.equal(warm.providerSessionId, "warm-provider-session");
      assert.equal(warmed, 1);

      const started = await runtime.startMessage({ workspaceRoot, agent: { provider: "codex" }, conversationId: created.conversation.id, prompt: "hello" });
      const final = await waitForConversationFacadeRun(runtime, workspaceRoot, started.runId);
      assert.equal(final.output, "session=warm-provider-session");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("runs side questions in the same conversation without interrupting the main run", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "codex", provider: "codex", status: "online" }),
          start: async () => ({}),
          run: async () => ({}),
          status: () => ({}),
          cancel: () => ({}),
        },
        adapters: {
          codex: () => ({
            sendMessage: async (ctx) => {
              if (ctx.prompt === "main") await new Promise((resolve) => setTimeout(resolve, 80));
              return { output: `reply:${ctx.prompt}`, command: "fake", connectionMode: "Codex ACP session", providerSessionId: ctx.providerSessionId ?? "shared-session", resumeKey: ctx.resumeKey ?? "shared-session" };
            },
          }),
        },
      });
      const conversation = await runtime.createConversation({ workspaceRoot, agent: { provider: "codex" }, title: "Side" });
      const main = await runtime.startMessage({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id, prompt: "main" });
      const side = await runtime.sideQuestion({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id, prompt: "btw" });
      assert.equal(side.ok, true);
      assert.equal(side.run.output, "reply:btw");
      assert.notEqual(side.run.runId, main.runId);
      const mainFinal = await waitForRun(runtime, main.runId);
      assert.equal(mainFinal.output, "reply:main");
      assert.equal(side.run.conversationId, conversation.conversation.id);
      assert.equal(side.run.providerSessionId, mainFinal.providerSessionId);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("persists streaming conversation events outside the transient run object", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex" }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "assistant_chunk", text: "streamed" });
              return { output: "streamed final", command: "codex-acp", connectionMode: "Codex ACP session", providerSessionId: "provider-session-1" };
            },
          }),
        },
      });
      const conversation = await runtime.createConversation({ workspaceRoot, agent: { provider: "codex" }, title: "Durable" });
      const started = await runtime.startMessage({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id, prompt: "hello" });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      const persisted = await readConversationEvents(workspaceRoot, "codex", "codex", conversation.conversation.id);
      assert.equal(persisted.messages.some((message) => message.type === "text" && message.text === "streamed"), true);
      assert.equal(persisted.messages.some((message) => message.type === "finish" && message.text === "streamed final"), true);
      const recovered = await runtime.getConversationStatus({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id });
      assert.equal(recovered.conversationMessages.some((message) => message.type === "finish" && message.text === "streamed final"), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });
});

async function waitForConversationFacadeRun(runtime, workspaceRoot, id) {
  for (let i = 0; i < 40; i += 1) {
    const current = runtime.getRun({ runId: id, workspaceRoot });
    if (current.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`run did not finish: ${id}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("personal agent metadata", () => {
  it("maps detected local agents to metadata without inventing unsupported capabilities", () => {
    const metadata = personalAgentMetadataFromAgent({
      id: "openclaw",
      name: "OpenClaw",
      provider: "openclaw",
      executablePath: "/usr/local/bin/openclaw",
      customArgs: ["agent", "--local"],
      env: [{ name: "OPENCLAW_ENV", value: "1", description: "test env" }],
      nativeSkillsDirs: ["/tmp/openclaw/skills"],
      behaviorPolicy: { permissionMode: "read-only-auto", yoloModeId: "ask", autoApproveReadonly: true },
      managedAcpTool: { binPath: "/tmp/bridges/openclaw-acp", packageName: "openclaw-acp", version: "1.2.3", root: "/tmp/bridges" },
      modelOptions: [{ id: "stable", label: "Stable" }],
      status: "online",
      version: "openclaw 2026.5.5",
      error: null,
      connectionMode: "OpenClaw local agent JSON session",
      capability: {
        installed: true,
        authenticated: "unknown",
        minVersionOk: true,
        supportsStreaming: true,
        supportsResume: true,
        supportsModelOverride: true,
        supportsPermissionAutoApprove: true,
        supportsApproval: false,
        supportsAcp: false,
        targetKind: "agent",
        smokePrompt: "OPENCLAW_OK",
        warning: "approval unsupported",
      },
    });

    assert.equal(metadata.id, "openclaw");
    assert.equal(metadata.backend, "openclaw");
    assert.equal(metadata.agent_type, "local-harness");
    assert.equal(metadata.available, true);
    assert.equal(metadata.agent_source_info.bridge_binary, "/tmp/bridges/openclaw-acp");
    assert.equal(metadata.agent_source_info.hub_package_id, "openclaw-acp");
    assert.deepEqual(metadata.env, [{ name: "OPENCLAW_ENV", value: "1", description: "test env" }]);
    assert.deepEqual(metadata.native_skills_dirs, ["/tmp/openclaw/skills"]);
    assert.deepEqual(metadata.behavior_policy, { permission_mode: "read-only-auto", yolo_mode_id: "ask", auto_approve_readonly: true, supports_side_question: false });
    assert.equal(metadata.handshake.agent_capabilities.loadSession, true);
    assert.equal(metadata.handshake.agent_capabilities._meta.supportsApproval, false);
    assert.equal(metadata.handshake.available_models[0].id, "stable");
    assert.deepEqual(metadata.handshake.available_commands, []);
  });

  it("returns metadata next to legacy agent list from the runtime facade", async () => {
    const runtime = createPersonalAgentRuntime({
      legacy: {
        listAgents: async () => ({
          agents: [{
            id: "hermes",
            name: "Hermes",
            provider: "hermes",
            executablePath: "/usr/local/bin/hermes",
            model: null,
            customArgs: [],
            modelOptions: [],
            defaultModel: null,
            connectionMode: "Hermes ACP JSON-RPC session",
            status: "online",
            version: "hermes 1.0.0",
            error: null,
            capability: {
              installed: true,
              authenticated: "unknown",
              minVersionOk: true,
              supportsStreaming: true,
              supportsResume: false,
              supportsModelOverride: true,
              supportsPermissionAutoApprove: true,
              supportsApproval: true,
              supportsAcp: true,
              targetKind: "model",
              smokePrompt: "HERMES_OK",
              warning: "resume disabled",
            },
            lastCheckedAt: 1,
          }],
        }),
        normalizeAgent: async (input) => input,
        detectAgent: async () => ({ status: "offline" }),
        start: async () => ({}),
        run: async () => ({}),
        status: () => ({}),
        cancel: () => ({}),
      },
    });

    const listed = await runtime.listAgents({ workspaceRoot: "/tmp/workspace" });
    assert.equal(listed.agents.length, 1);
    assert.equal(listed.metadata.length, 1);
    assert.equal(listed.metadata[0].agent_type, "acp");
    assert.equal(listed.metadata[0].handshake.agent_capabilities.sessionCapabilities.resume, null);
  });

  it("maps agent status onto the 5-state model", () => {
    assert.equal(normalizeAgentStatus({ status: "online" }), "online");
    assert.equal(normalizeAgentStatus({ status: "needs_auth" }), "needs_auth");
    assert.equal(normalizeAgentStatus({ status: "offline", errorInfo: { code: "missing_binary" } }), "missing");
    assert.equal(normalizeAgentStatus({ status: "offline", errorInfo: { code: "auth_required" } }), "needs_auth");
    assert.equal(normalizeAgentStatus({ status: "error", error: "command not found" }), "missing");
    assert.equal(normalizeAgentStatus({ status: "error", error: "login required" }), "needs_auth");
    assert.equal(normalizeAgentStatus({ status: "error" }), "offline");
    assert.equal(normalizeAgentStatus({ status: "offline" }), "offline");
    assert.equal(normalizeAgentStatus({ status: "" }), "unknown");
    assert.equal(normalizeAgentStatus({ capability: { installed: false } }), "missing");
    assert.equal(normalizeAgentStatus({ status: "offline", capability: { installed: true, authenticated: false } }), "needs_auth");
  });

  it("only marks a 5-state online agent as available", () => {
    const agents = [
      { id: "codex", name: "Codex", provider: "codex", executablePath: "codex", status: "online", enabled: true },
      { id: "claude", name: "Claude", provider: "claude", executablePath: "claude", status: "needs_auth", enabled: true, error: "login required" },
      { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", status: "missing", enabled: true },
    ];
    const management = personalAgentMetadataList(agents);
    assert.equal(management[0].status, "online");
    assert.equal(management[0].available, true);
    assert.equal(management[1].status, "needs_auth");
    assert.equal(management[1].available, false);
    assert.equal(management[2].status, "missing");
    assert.equal(management[2].available, false);
  });

  it("persists ACP session/new metadata into agent handshake", () => {
    const metadata = personalAgentMetadataFromAgent({
      id: "codex",
      name: "Codex",
      provider: "codex",
      executablePath: "codex",
      status: "online",
      capability: { supportsAcp: true, supportsModelOverride: true },
      sessionMetadata: {
        availableModels: [{ id: "gpt-5.5", name: "GPT 5.5" }],
        currentModelId: "gpt-5.5",
        configOptions: [{ id: "mode", label: "Mode" }],
        modes: [{ id: "agent", label: "Agent" }],
        availableCommands: [{ name: "/help" }],
      },
    });
    assert.deepEqual(metadata.handshake.available_models, [{ id: "gpt-5.5", label: "GPT 5.5" }]);
    assert.deepEqual(metadata.handshake.config_options, [{ id: "mode", label: "Mode" }]);
    assert.deepEqual(metadata.handshake.available_modes, [{ id: "agent", label: "Agent" }]);
    assert.deepEqual(metadata.handshake.available_commands, [{ name: "/help" }]);
    assert.equal(metadata.handshake.session_metadata.currentModelId, "gpt-5.5");
  });

  it("separates management metadata from picker-safe available metadata", () => {
    const agents = [
      { id: "codex", name: "Codex", provider: "codex", executablePath: "codex", status: "online", enabled: true },
      { id: "claude", name: "Claude", provider: "claude", executablePath: "claude", status: "offline", enabled: true, error: "not logged in" },
      { id: "hermes", name: "Hermes", provider: "hermes", executablePath: "hermes", status: "online", enabled: false },
    ];

    const management = personalAgentMetadataList(agents);
    const picker = personalAgentAvailableMetadataList(agents);

    assert.deepEqual(management.map((agent) => agent.id), ["codex", "claude", "hermes"]);
    assert.deepEqual(picker.map((agent) => agent.id), ["codex"]);
    assert.equal(management[1].available, false);
    assert.equal(management[2].enabled, false);
    assert.equal(management[2].available, false);
  });

  it("returns only enabled online metadata from picker-safe ACP list", async () => {
    const runtime = createPersonalAgentRuntime({
      legacy: {
        listAgents: async () => ({
          agents: [
            { id: "codex", name: "Codex", provider: "codex", executablePath: "codex", status: "online", enabled: true },
            { id: "claude", name: "Claude", provider: "claude", executablePath: "claude", status: "offline", enabled: true },
          ],
        }),
        normalizeAgent: async (input) => input,
        detectAgent: async () => ({ status: "offline" }),
        start: async () => ({}),
        run: async () => ({}),
        status: () => ({}),
        cancel: () => ({}),
      },
    });

    const management = await runtime.listAgentMetadata({ workspaceRoot: "/tmp/workspace" });
    const picker = await runtime.listAcpAgents({ workspaceRoot: "/tmp/workspace" });

    assert.deepEqual(management.agents.map((agent) => agent.id), ["codex", "claude"]);
    assert.deepEqual(picker.agents.map((agent) => agent.id), ["codex"]);
  });

  it("reports config/model capability only when real options are exposed", async () => {
    const runtime = createPersonalAgentRuntime({
      legacy: {
        listAgents: async () => ({
          agents: [
            {
              id: "codex",
              name: "Codex",
              provider: "codex",
              executablePath: "codex",
              status: "online",
              modelOptions: [{ id: "gpt-5.5[medium]", label: "GPT 5.5" }],
              capability: { supportsAcp: true, supportsModelOverride: true },
            },
            {
              id: "custom",
              name: "Custom",
              provider: "custom",
              executablePath: "custom",
              status: "online",
              modelOptions: [{ id: "fake", label: "Fake" }],
              capability: { supportsAcp: false, supportsModelOverride: false },
            },
          ],
        }),
        normalizeAgent: async (input) => input,
        detectAgent: async () => ({ status: "offline" }),
        start: async () => ({}),
        run: async () => ({}),
        status: () => ({}),
        cancel: () => ({}),
      },
    });

    const codex = await runtime.acpConfigOptions({ workspaceRoot: "/tmp/workspace", agent: { id: "codex", provider: "codex" } });
    const custom = await runtime.acpConfigOptions({ workspaceRoot: "/tmp/workspace", agent: { id: "custom", provider: "custom" } });

    assert.equal(codex.capabilities.supportsModelOverride, true);
    assert.equal(codex.availableModels[0].id, "gpt-5.5[medium]");
    assert.equal(codex.unsupportedReason, null);
    assert.equal(custom.capabilities.supportsModelOverride, false);
    assert.deepEqual(custom.availableModels, []);
    assert.equal(custom.unsupportedReason, "provider_does_not_expose_config_options");
  });

  it("does not mark provider-native old connection modes as ACP metadata", () => {
    const oldModes = [
      ["codex", "Codex app-server session"],
      ["claude", "Claude Code stream-json session"],
      ["openclaw", "OpenClaw local agent JSON session"],
      ["opencode", "OpenCode SDK session"],
    ];
    for (const [provider, connectionMode] of oldModes) {
      const metadata = personalAgentMetadataFromAgent({
        id: provider,
        name: provider,
        provider,
        executablePath: provider,
        status: "online",
        connectionMode,
        capability: {
          installed: true,
          authenticated: "unknown",
          minVersionOk: true,
          supportsStreaming: true,
          supportsResume: true,
          supportsModelOverride: true,
          supportsPermissionAutoApprove: true,
          supportsApproval: true,
          supportsAcp: false,
          targetKind: "model",
        },
      });
      assert.notEqual(metadata.agent_type, "acp", `${provider} must not be marked ACP while using ${connectionMode}`);
    }
  });
});

describe("personal agent ACP JSON-RPC client", () => {
  it("resolves managed ACP bridge locations outside project repositories", () => {
    assert.equal(MANAGED_ACP_TOOLS.codex.packageName, "@agentclientprotocol/codex-acp");
    assert.equal(MANAGED_ACP_TOOLS.claude.packageName, "@agentclientprotocol/claude-agent-acp");
    assert.match(managedAcpToolRoot("codex"), /managed-resources\/acp\/codex-acp\/1\.0\.1/);
    assert.match(managedAcpBinPath("claude"), /managed-resources\/acp\/claude-agent-acp\/0\.52\.0\/.*\/node_modules\/\.bin\/claude-agent-acp/);
  });

  it("validates managed ACP tool version, reporting not_installed for missing tools", async () => {
    const unknown = await validateManagedAcpTool("nonexistent");
    assert.equal(unknown.reason, "unknown_provider");
    assert.equal(unknown.match, false);
    // Real providers that aren't actually installed should report not_installed.
    const codex = await validateManagedAcpTool("codex");
    if (!codex.installed) {
      assert.equal(codex.reason, "not_installed");
      assert.equal(codex.match, false);
    } else {
      assert.equal(codex.installed, true);
      assert.equal(codex.match, true);
      assert.equal(codex.installedVersion, codex.expected);
    }
  });

  it("runs initialize, session/new, and streaming session/prompt against a fake ACP CLI", async () => {
    const events = [];
    const chunks = [];
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const { child, client } = spawnAcpClient({
      command: process.execPath,
      args: [fixture],
      appendEvent: (event) => events.push(event),
      onNotification: (params) => {
        const { type, data } = normalizeAcpUpdate(params.update ?? params);
        if (type === "agent_message_chunk") chunks.push(textFromAcpContent(data));
      },
    });
    try {
      const initialized = await client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "studio-test", version: "0.0.0" },
        clientCapabilities: {},
      });
      assert.equal(initialized.agentInfo.name, "fake-acp-cli");

      const created = await client.request("session/new", { cwd: process.cwd(), mcpServers: [] });
      const sessionId = extractAcpSessionId(created);
      assert.match(sessionId, /^fake-session-/);

      const prompted = await client.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "hello-acp" }],
      });
      assert.equal(prompted.stopReason, "end_turn");
      assert.equal(chunks.join(""), "Fake response to: hello-acp");
      assert.equal(events.some((event) => /^pid /.test(event.text ?? "")), true);
    } finally {
      client.dispose();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  });

  it("reports ACP initialize failures without marking the provider complete", async () => {
    const result = await probeAcpCommand({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      timeoutMs: 500,
    });
    assert.equal(result.ok, false);
    assert.equal(result.step, "fail_cli");
    assert.equal(result.status, "missing");
    assert.match(result.error, /ACP process exited: 1|initialize timed out/);
  });

  it("two-step probe returns online when session/new succeeds", async () => {
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const result = await probeAcpCommand({ command: process.execPath, args: [fixture], timeoutMs: 4_000 });
    assert.equal(result.ok, true);
    assert.equal(result.step, "online");
    assert.equal(result.status, "online");
    assert.equal(result.initialized.agentInfo.name, "fake-acp-cli");
    assert.match(String(result.sessionResult.sessionId), /^fake-session-/);
  });

  it("two-step probe returns needs_auth when session/new reports authentication", async () => {
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const result = await probeAcpCommand({ command: process.execPath, args: [fixture, "--auth-required"], timeoutMs: 4_000 });
    assert.equal(result.ok, false);
    assert.equal(result.step, "needs_auth");
    assert.equal(result.status, "needs_auth");
    assert.match(result.error, /Authentication required/i);
  });

  it("handles ACP permission requests and continues the prompt stream", async () => {
    const decisions = [];
    const chunks = [];
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const { child, client } = spawnAcpClient({
      command: process.execPath,
      args: [fixture],
      appendEvent: () => undefined,
      onNotification: (params) => {
        const { type, data } = normalizeAcpUpdate(params.update ?? params);
        if (type === "agent_message_chunk") chunks.push(textFromAcpContent(data));
      },
      onRequest: async (message, rpcClient) => {
        assert.equal(message.method, "session/request_permission");
        decisions.push(message.params?.command ?? message.params?.toolName ?? "");
        rpcClient.respond(message.id, { optionId: "approve" });
      },
    });
    try {
      await client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "studio-test", version: "0.0.0" },
        clientCapabilities: {},
      });
      const created = await client.request("session/new", { cwd: process.cwd(), mcpServers: [] });
      const sessionId = extractAcpSessionId(created);
      await client.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "approval please" }],
      });
      assert.deepEqual(decisions, ["touch /tmp/fake-acp"]);
      assert.equal(chunks.join(""), "Fake response to: approval please");
    } finally {
      client.dispose();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  });
});

describe("personal agent normalized conversation message stream", () => {
  it("maps ACP run events into conversation messages", () => {
    const messages = runEventsToConversationMessages([
      { type: "status", text: "codex ACP flow started", at: 1 },
      { type: "assistant_chunk", text: "Hello", at: 2 },
      { type: "tool", text: "acp_tool_call> ls", at: 3, toolCall: { id: "tool-1", name: "Bash", status: "running", description: "ls", input: "ls" } },
      { type: "approval_request", text: "需要运行 ls", at: 4, approval: { id: "a1" } },
      { type: "status", text: "acp_available_commands> []", at: 5 },
      { type: "status", text: "acp_context_usage> {\"used\":1}", at: 6 },
      { type: "assistant", text: "Hello world", at: 7 },
    ]);

    assert.deepEqual(messages.map((message) => message.type), ["agent_status", "text", "tool", "permission", "available_commands", "context_usage", "finish"]);
    assert.equal(messages[1].role, "assistant");
    assert.equal(messages[2].status, "running");
    assert.equal(messages[3].approval.id, "a1");
    assert.equal(messages[6].text, "Hello world");
  });

  it("classifies tool failure and user-visible error categories", () => {
    const messages = runEventsToConversationMessages([
      { type: "tool", text: "tool_call_update> failed exit_code: 1", at: 1, toolCall: { id: "tool-1", name: "Bash", status: "failed", description: "exit 1" } },
      { type: "error", text: "User refused permission to run tool", at: 2 },
      { type: "error", text: "fetch failed timeout", at: 3 },
    ]);

    assert.equal(messages[0].status, "failed");
    assert.equal(messages[1].category, "permission");
    assert.equal(messages[2].category, "network");
  });

  it("keeps empty run events from producing blank conversation messages", () => {
    const messages = runEventsToConversationMessages([
      { type: "assistant_chunk", text: "", at: 1 },
      { type: "assistant", text: "", at: 2 },
      { type: "log", text: "", at: 3 },
    ]);

    assert.deepEqual(messages, []);
  });

  it("preserves boundary status and tool completion semantics", () => {
    const messages = runEventsToConversationMessages([
      { type: "log", text: "assistant_chunk> partial", at: 1 },
      { type: "tool", text: "acp_tool_call_update> completed successfully", at: 2, toolCall: { id: "tool-1", name: "Bash", status: "completed" } },
      { type: "status", text: "acp_usage_update> {\"used\":1000}", at: 3 },
      { type: "assistant", text: "", at: 4 },
    ]);

    assert.deepEqual(messages.map((message) => message.type), ["text", "tool", "context_usage", "finish"]);
    assert.equal(messages[1].status, "completed");
    assert.equal(messages[3].text, "partial");
  });

  it("merges tool start and completion updates into one visible tool item", () => {
    const messages = runEventsToConversationMessages([
      {
        type: "tool",
        text: "tool_start> commandExecution: ls",
        at: 1,
        toolCall: { id: "cmd-1", name: "commandExecution", status: "running", description: "ls", input: "ls" },
      },
      {
        type: "tool",
        text: "tool_end> commandExecution: file.txt",
        at: 2,
        toolCall: { id: "cmd-1", name: "commandExecution", status: "completed", description: "ls", output: "file.txt" },
      },
    ]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "tool");
    assert.equal(messages[0].status, "completed");
    assert.equal(messages[0].text, "commandExecution ls");
    assert.equal(messages[0].toolCall.input, "ls");
    assert.equal(messages[0].toolCall.output, "file.txt");
  });

  it("extracts visible tool names from ACP tool call text fallbacks", () => {
    const messages = runEventsToConversationMessages([
      {
        type: "tool",
        text: 'acp_tool_call> {"tool_call_id":"t1","title":"Bash","kind":"execute","status":"in_progress","raw_input":{"command":"pwd"}}',
        at: 1,
      },
    ]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, "Bash pwd");
    assert.equal(messages[0].toolCall.name, "Bash");
    assert.equal(messages[0].toolCall.description, "pwd");
  });

  it("omits unstructured tool text from the visible conversation timeline", () => {
    const messages = runEventsToConversationMessages([
      { type: "tool", text: "tool_update> running", at: 1 },
      { type: "tool", text: "acp_tool_call> plain text without id", at: 2 },
      { type: "assistant", text: "done", at: 3 },
    ]);

    assert.deepEqual(messages.map((message) => message.type), ["finish"]);
  });

  it("truncates long tool details while preserving the visible tool summary", () => {
    const longOutput = "x".repeat(2600);
    const messages = runEventsToConversationMessages([
      { type: "tool", text: "tool_end> commandExecution", at: 1, toolCall: { id: "tool-1", name: "commandExecution", status: "completed", description: "printf", output: longOutput } },
    ]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, "commandExecution printf");
    assert.equal(messages[0].toolCall.output.length < longOutput.length, true);
    assert.equal(messages[0].toolCall.outputTruncated, true);
  });

  it("categorizes provider and auth errors without changing message ordering", () => {
    const messages = runEventsToConversationMessages([
      { type: "error", text: "login required for provider", at: 1 },
      { type: "error", text: "unexpected provider failure", at: 2 },
    ]);

    assert.deepEqual(messages.map((message) => message.id), ["msg-1", "msg-2"]);
    assert.equal(messages[0].category, "auth");
    assert.equal(messages[1].category, "provider");
  });

  it("maps rich ACP updates into dedicated conversation message types", () => {
    const messages = runEventsToConversationMessages([
      { type: "plan", at: 1, plan: { entries: [{ id: "p1", title: "Inspect", status: "completed", priority: "high" }] } },
      { type: "thinking", at: 2, text: "Reasoning", status: "thinking", msgId: "m1" },
      { type: "acp_tool_call", at: 3, msgId: "m1", update: { tool_call_id: "t1", title: "Read", kind: "read", status: "in_progress", raw_input: { path: "README.md" } } },
      { type: "acp_tool_call", at: 4, msgId: "m1", update: { tool_call_id: "t2", title: "Edit", kind: "edit", status: "completed", content: [{ type: "text", text: "patched" }] } },
      { type: "tips", at: 5, text: "Provider timeout", category: "error", ownership: "provider", resolution: { target: "provider", kind: "retry", message: "Retry later" } },
    ]);

    assert.deepEqual(messages.map((message) => message.type), ["plan", "thinking", "tool_group", "tips"]);
    assert.equal(messages[0].entries[0].status, "completed");
    assert.equal(messages[1].status, "thinking");
    assert.equal(messages[2].toolCalls.length, 2);
    assert.equal(messages[2].toolCalls[0].update.kind, "read");
    assert.equal(messages[3].ownership, "provider");
    assert.equal(messages[3].resolution.kind, "retry");
  });

  it("maps ACP context usage updates into structured conversation messages", () => {
    const messages = runEventsToConversationMessages([
      { type: "status", text: 'acp_context_usage> {"used":10,"total":100}', at: 1 },
    ]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "context_usage");
    assert.deepEqual(messages[0].contextUsage, { used: 10, total: 100, label: null });
  });
});

describe("personal agent process registry", () => {
  it("normalizes empty process registration without creating records", () => {
    clearAgentProcesses();
    assert.equal(registerAgentProcess({ runId: "   " }), null);
    assert.deepEqual(listAgentProcesses(), []);
  });

  it("preserves provider and command fields through boundary updates", () => {
    clearAgentProcesses();
    const command = `fake-acp ${"x".repeat(1000)}`;
    const registered = registerAgentProcess({ runId: " run-1 ", pid: 1234, provider: " codex ", conversationId: " conv-1 ", command, startedAt: 10 });
    assert.equal(registered.runId, "run-1");
    assert.equal(registered.provider, "codex");
    assert.equal(registered.backend, "codex");
    assert.equal(registered.command, command);
    const updated = updateAgentProcess("run-1", { pid: Number.NaN, command: "" });
    assert.equal(updated.pid, 1234);
    assert.equal(updated.command, command);
    assert.equal(updated.conversationId, "conv-1");
  });

  it("filters process records by normalized provider and conversation", () => {
    clearAgentProcesses();
    registerAgentProcess({ runId: "a", provider: "codex", conversationId: "one" });
    registerAgentProcess({ runId: "b", provider: "claude", conversationId: "two" });
    assert.deepEqual(listAgentProcesses({ provider: "codex" }).map((item) => item.runId), ["a"]);
    assert.deepEqual(listAgentProcesses({ conversationId: "two" }).map((item) => item.runId), ["b"]);
    clearAgentProcesses();
  });

  it("recovers persisted active process records as stale after runtime restart", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      clearAgentProcesses({ persist: false });
      registerAgentProcess({ runId: "run-stale", provider: "codex", conversationId: "conv-stale", pid: 4567, command: "codex-acp", startedAt: 20 });
      await flushAgentProcessRegistry();
      clearAgentProcesses({ persist: false });
      const recovered = await recoverAgentProcesses();
      assert.equal(recovered.processes.length, 1);
      assert.equal(recovered.processes[0].runId, "run-stale");
      assert.equal(recovered.processes[0].status, "stale");
      assert.equal(recovered.processes[0].staleReason, "runtime_restarted");
      clearAgentProcesses();
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("serializes concurrent process registry writes into valid JSON", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      clearAgentProcesses({ persist: false });
      for (let index = 0; index < 30; index += 1) {
        registerAgentProcess({ runId: `run-${index}`, provider: "codex", conversationId: "conv-json", pid: 1000 + index, command: `codex-${index}`, startedAt: 20 + index });
        if (index % 3 === 0) updateAgentProcess(`run-${index}`, { status: "running" });
      }
      await flushAgentProcessRegistry();
      const raw = await readFile(processRegistryFile(), "utf8");
      const parsed = JSON.parse(raw);
      assert.equal(parsed.version, 1);
      assert.equal(parsed.processes.length, 30);
      clearAgentProcesses();
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("records crashes and implements exponential backoff restart policy", () => {
    clearAgentProcesses();
    clearAgentCrashHistory(undefined);
    const runId = "crash-test-run";
    registerAgentProcess({ runId, provider: "codex", conversationId: "crash-conv", pid: 1111, command: "codex-acp", startedAt: Date.now() });

    const r1 = recordAgentCrash(runId);
    assert.equal(r1.shouldRestart, true);
    assert.equal(r1.attempt, 1);
    assert.equal(r1.backoffMs, 1000);
    assert.equal(getAgentProcess(runId)?.status, "restarting");
    assert.equal(getAgentProcess(runId)?.staleReason, "crash_restart_1");

    const r2 = recordAgentCrash(runId);
    assert.equal(r2.shouldRestart, true);
    assert.equal(r2.backoffMs, 2000);

    const r3 = recordAgentCrash(runId);
    assert.equal(r3.shouldRestart, true);
    assert.equal(r3.backoffMs, 4000);

    const r4 = recordAgentCrash(runId);
    assert.equal(r4.shouldRestart, false);
    assert.equal(r4.attempt, 4);
    assert.equal(r4.backoffMs, 0);
    assert.equal(getAgentProcess(runId)?.status, "error");
    assert.equal(getAgentProcess(runId)?.staleReason, "crash_restart_exhausted");

    const r5 = recordAgentCrash("other-run");
    assert.equal(r5.shouldRestart, true);
    assert.equal(r5.attempt, 1);

    clearAgentProcesses();
    clearAgentCrashHistory(undefined);
  });

  it("computes exponential backoff for crash restarts", () => {
    assert.equal(crashRestartBackoffMs(1), 1000);
    assert.equal(crashRestartBackoffMs(2), 2000);
    assert.equal(crashRestartBackoffMs(3), 4000);
  });
});

describe("personal agent context injection", () => {
  it("replaces the managed block without deleting user-authored content", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const workdir = path.join(workspaceRoot, "workdir");
      await mkdir(workdir, { recursive: true });
      const agentsPath = path.join(workdir, "AGENTS.md");
      await writeFile(agentsPath, "# User Notes\n\nKeep this line.\n", "utf8");

      await injectPersonalAgentContext({ workdir, provider: "opencode", workspaceRoot });
      await injectPersonalAgentContext({ workdir, provider: "opencode", workspaceRoot: `${workspaceRoot}/updated` });

      const raw = await readFile(agentsPath, "utf8");
      assert.match(raw, /# User Notes/);
      assert.match(raw, /Keep this line\./);
      assert.match(raw, /Workspace root: .*\/updated/);
      assert.equal((raw.match(/BEGIN ONMYAGENT-PERSONAL-ASSISTANT/g) ?? []).length, 1);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("injects additional accessible roots for every provider context", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const workdir = path.join(workspaceRoot, "workdir-extra");
      await mkdir(workdir, { recursive: true });
      const filePath = await injectPersonalAgentContext({
        workdir,
        provider: "opencode",
        workspaceRoot,
        accessibleWorkspaceRoots: [path.join(workspaceRoot, "docs"), workspaceRoot, path.join(workspaceRoot, "docs")],
      });
      const raw = await readFile(filePath, "utf8");
      assert.match(raw, /Additional accessible roots:/);
      assert.match(raw, /docs/);
      assert.equal((raw.match(/docs/g) ?? []).length, 1);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("appends codex plan-first behavior block to AGENTS.md for codex only", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const codexDir = path.join(workspaceRoot, "codex-workdir");
      const opencodeDir = path.join(workspaceRoot, "opencode-workdir");
      await mkdir(codexDir, { recursive: true });
      await mkdir(opencodeDir, { recursive: true });
      const codexPath = await injectPersonalAgentContext({ workdir: codexDir, provider: "codex", workspaceRoot });
      const opencodePath = await injectPersonalAgentContext({ workdir: opencodeDir, provider: "opencode", workspaceRoot });
      const codexText = await readFile(codexPath, "utf8");
      const opencodeText = await readFile(opencodePath, "utf8");
      assert.match(codexText, /Plan-first behavior/);
      assert.match(codexText, /update_plan/);
      assert.equal(/Plan-first behavior/.test(opencodeText), false);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("uses CLAUDE.md for Claude Code", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const workdir = path.join(workspaceRoot, "claude-workdir");
      await mkdir(workdir, { recursive: true });
      const filePath = await injectPersonalAgentContext({ workdir, provider: "claude", workspaceRoot });
      assert.equal(path.basename(filePath), "CLAUDE.md");
      assert.match(await readFile(filePath, "utf8"), /Provider: claude/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });
});

describe("personal agent runtime facade", () => {
  it("keeps stale native-session detection in the native-session boundary", () => {
    assert.equal(isStaleNativeSessionError("claude", new Error("No conversation found with session ID: stale")), true);
    assert.equal(isStaleNativeSessionError("codex", new Error("No conversation found with session ID: stale")), false);
    assert.equal(isStaleNativeSessionError("claude", new Error("different failure")), false);
    assert.equal(
      staleNativeSessionResetMessage("claude"),
      "claude native session was missing; starting a fresh provider session for this Studio conversation.",
    );
  });

  it("routes OpenCode through the adapter and persists a completed run log", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const calls = [];
      const legacy = {
        normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
        detectAgent: async () => ({
          id: "opencode",
          name: "OpenCode",
          provider: "opencode",
          executablePath: "opencode",
          model: "ark-coding-openai/ark-code-latest",
          customArgs: [],
          status: "online",
        }),
        listAgents: async () => ({ agents: [] }),
        start: async () => ({ status: "legacy-start" }),
        run: async () => ({ status: "legacy-run" }),
        status: () => ({ status: "missing" }),
        cancel: async () => ({ ok: false }),
      };
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy,
        adapters: {
          opencode: ({ appendEvent, opencodeBaseUrl, onmyagentServerToken }) => ({
            sendMessage: async (ctx) => {
              calls.push({ ctx, opencodeBaseUrl, onmyagentServerToken });
              appendEvent({ type: "log", text: "fake adapter invoked" });
              return { output: `收到：${ctx.prompt}`, command: "fake-opencode-session" };
            },
            cancel: async () => undefined,
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "你好", agent: { provider: "opencode" } });
      assert.match(started.status, /^(running|completed)$/);

      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.ok, true);
      assert.equal(completed.output, "收到：你好");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].opencodeBaseUrl, "http://127.0.0.1:9999/opencode");
      assert.equal(calls[0].onmyagentServerToken, "client-token");
      assert.match(await waitForFileText(completed.logPath), /fake adapter invoked/);
      assert.equal(completed.logPath.includes(`${path.sep}.opencode${path.sep}`), false);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("passes the selected Studio conversation resume key to the adapter", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const first = await createConversation(workspaceRoot, "codex", "codex", {
        title: "A",
        providerSessionId: "thread-a",
      });
      const second = await createConversation(workspaceRoot, "codex", "codex", {
        title: "B",
        providerSessionId: "thread-b",
      });
      const seen = [];
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: () => ({
            sendMessage: async (ctx) => {
              seen.push({ conversationId: ctx.conversationId, resumeKey: ctx.resumeKey });
              return {
                output: `reply-${ctx.resumeKey}`,
                command: "fake-codex",
                providerSessionId: `${ctx.resumeKey}-next`,
                resumeKey: `${ctx.resumeKey}-next`,
              };
            },
            cancel: async () => undefined,
          }),
        },
      });

      const startedA = await runtime.startMessage({ workspaceRoot, prompt: "A", conversationId: first.id, agent: { provider: "codex", id: "codex" } });
      const completedA = await waitForRun(runtime, startedA.runId);
      const startedB = await runtime.startMessage({ workspaceRoot, prompt: "B", conversationId: second.id, agent: { provider: "codex", id: "codex" } });
      const completedB = await waitForRun(runtime, startedB.runId);

      assert.equal(completedA.conversationId, first.id);
      assert.equal(completedB.conversationId, second.id);
      assert.deepEqual(seen, [
        { conversationId: first.id, resumeKey: "thread-a" },
        { conversationId: second.id, resumeKey: "thread-b" },
      ]);
      const listed = await listConversations(workspaceRoot, "codex", "codex");
      assert.equal(listed.conversations.find((item) => item.id === first.id)?.providerSessionId, "thread-a-next");
      assert.equal(listed.conversations.find((item) => item.id === second.id)?.providerSessionId, "thread-b-next");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("clears local conversation pointers when closing a provider session", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const conversation = await createConversation(workspaceRoot, "codex", "codex", {
        title: "Closable",
        providerSessionId: "provider-session-close",
        resumeKey: "provider-session-close",
      });
      const closed = [];
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: () => ({
            closeSession: async (ctx) => {
              closed.push(ctx.sessionId);
              return { ok: true, sessionId: ctx.sessionId };
            },
          }),
        },
      });

      const result = await runtime.closeProviderSession({ workspaceRoot, conversationId: conversation.id, sessionId: "provider-session-close", agent: { provider: "codex", id: "codex" } });
      const updated = await getConversation(workspaceRoot, "codex", "codex", conversation.id);

      assert.deepEqual(closed, ["provider-session-close"]);
      assert.equal(result.ok, true);
      assert.deepEqual(result.closedConversationIds, [conversation.id]);
      assert.equal(updated.providerSessionId, null);
      assert.equal(updated.resumeKey, null);
      assert.equal(updated.lastStatus, "closed");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("lists, loads, and forks provider sessions through the runtime facade", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const calls = [];
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: () => ({
            listSessions: async () => ({ sessions: [{ id: "provider-session-a", sessionId: "provider-session-a", title: "A" }] }),
            loadSession: async (ctx) => {
              calls.push(["load", ctx.sessionId]);
              return {
                sessionId: ctx.sessionId,
                providerSessionId: ctx.sessionId,
                conversationMessages: [{ id: "loaded-1", type: "text", role: "assistant", text: "loaded", createdAt: 1 }],
                raw: { sessionId: ctx.sessionId },
              };
            },
            forkSession: async (ctx) => {
              calls.push(["fork", ctx.sessionId]);
              return { sessionId: `${ctx.sessionId}-fork`, providerSessionId: `${ctx.sessionId}-fork`, raw: { sessionId: `${ctx.sessionId}-fork` } };
            },
            closeSession: async (ctx) => {
              calls.push(["close", ctx.sessionId]);
              return { ok: true, sessionId: ctx.sessionId, raw: { closed: true } };
            },
          }),
        },
      });

      const listed = await runtime.listProviderSessions({ workspaceRoot, agent: { provider: "codex", id: "codex" } });
      const loaded = await runtime.loadProviderSession({ workspaceRoot, sessionId: "provider-session-a", agent: { provider: "codex", id: "codex" } });
      const forked = await runtime.forkProviderSession({ workspaceRoot, sessionId: "provider-session-a", agent: { provider: "codex", id: "codex" } });
      const closed = await runtime.closeProviderSession({ workspaceRoot, sessionId: "provider-session-a", conversationId: loaded.conversation.id, agent: { provider: "codex", id: "codex" } });
      const loadedEvents = await readConversationEvents(workspaceRoot, "codex", "codex", loaded.conversation.id);
      const closedConversation = await getConversation(workspaceRoot, "codex", "codex", loaded.conversation.id);

      assert.equal(listed.sessions[0].sessionId, "provider-session-a");
      assert.equal(loaded.conversation.providerSessionId, "provider-session-a");
      assert.equal(loadedEvents.messages[0].text, "loaded");
      assert.equal(forked.conversation.providerSessionId, "provider-session-a-fork");
      assert.equal(closed.ok, true);
      assert.deepEqual(closed.closedConversationIds, [loaded.conversation.id]);
      assert.equal(closedConversation.providerSessionId, null);
      assert.equal(closedConversation.resumeKey, null);
      assert.deepEqual(calls, [["load", "provider-session-a"], ["fork", "provider-session-a"], ["close", "provider-session-a"]]);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("sets ACP config options through the runtime facade", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const calls = [];
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: () => ({
            setConfigOption: async (ctx) => {
              calls.push({ sessionId: ctx.sessionId, optionId: ctx.optionId, value: ctx.value });
              return {
                ok: true,
                sessionId: ctx.sessionId,
                optionId: ctx.optionId,
                value: ctx.value,
                confirmation: "Mode updated",
                configOptions: [{ id: "mode", value: ctx.value }],
              };
            },
          }),
        },
      });

      const result = await runtime.setConfigOption({ workspaceRoot, sessionId: "provider-session-a", optionId: "mode", value: "plan", agent: { provider: "codex", id: "codex" } });

      assert.equal(result.ok, true);
      assert.equal(result.confirmation, "Mode updated");
      assert.deepEqual(result.configOptions, [{ id: "mode", value: "plan" }]);
      assert.deepEqual(calls, [{ sessionId: "provider-session-a", optionId: "mode", value: "plan" }]);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("persists custom agent CRUD and overrides through the runtime facade", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async (input) => ({ id: input.id ?? "custom", name: input.name ?? "Custom", provider: input.provider ?? "custom", executablePath: input.executablePath ?? "custom", customArgs: input.customArgs ?? [] }),
          detectAgent: async (agent) => ({ ...agent, status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
      });

      const created = await runtime.createCustomAgent({ workspaceRoot, agent: { id: "custom-reviewer", name: "Reviewer", command: "reviewer", args: ["--json"], env: { TOKEN: "redacted" } } });
      const listed = await runtime.listAgents({ workspaceRoot });
      const updated = await runtime.updateCustomAgent({ workspaceRoot, id: "custom-reviewer", agent: { name: "Reviewer 2", command: "reviewer", args: ["--stream"] } });
      const overrides = await runtime.setAgentOverrides({ workspaceRoot, id: "custom-reviewer", overrides: { command: "reviewer", env: { TOKEN: "redacted" } } });
      const readOverrides = await runtime.getAgentOverrides({ workspaceRoot, id: "custom-reviewer" });
      const deleted = await runtime.deleteCustomAgent({ workspaceRoot, id: "custom-reviewer" });
      const listedAfterDelete = await runtime.listAgents({ workspaceRoot });

      assert.equal(created.agent.id, "custom-reviewer");
      assert.equal(listed.agents.some((agent) => agent.id === "custom-reviewer"), true);
      assert.equal(updated.agent.name, "Reviewer 2");
      assert.deepEqual(overrides.overrides, { command: "reviewer", env: { TOKEN: "redacted" } });
      assert.deepEqual(readOverrides.overrides, overrides.overrides);
      assert.equal(deleted.deleted, true);
      assert.equal(listedAfterDelete.agents.some((agent) => agent.id === "custom-reviewer"), false);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("emits structured tips with ownership and resolution when a provider send fails", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          opencode: () => ({
            sendMessage: async () => {
              throw new Error("provider 500 timeout");
            },
            cancel: async () => undefined,
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "fail", agent: { provider: "opencode", id: "opencode" } });
      const failed = await waitForRun(runtime, started.runId);
      const tip = failed.conversationMessages.find((message) => message.type === "tips");

      assert.equal(failed.status, "failed");
      assert.equal(failed.errorInfo.code, "timeout");
      assert.equal(tip?.ownership, "unknown");
      assert.equal(tip?.resolution?.target, "details");
      assert.equal(tip?.resolution?.kind, "retry");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("retries Claude with a fresh provider session when the stored native session is missing", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const conversation = await createConversation(workspaceRoot, "claude", "claude", {
        title: "Feishu Claude",
        providerSessionId: "missing-claude-session",
      });
      const seen = [];
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "claude", name: "Claude", provider: "claude", executablePath: "claude", customArgs: [] }),
          detectAgent: async () => ({ id: "claude", name: "Claude", provider: "claude", executablePath: "claude", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          claude: () => ({
            sendMessage: async (ctx) => {
              seen.push({ providerSessionId: ctx.providerSessionId, resumeKey: ctx.resumeKey });
              if (ctx.resumeKey) throw new Error(`Claude result error\nNo conversation found with session ID: ${ctx.resumeKey}`);
              return {
                output: "fresh claude reply",
                command: "fake-claude",
                providerSessionId: "fresh-claude-session",
                resumeKey: "fresh-claude-session",
              };
            },
            cancel: async () => undefined,
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "hello", conversationId: conversation.id, agent: { provider: "claude", id: "claude" } });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "fresh claude reply");
      assert.deepEqual(seen, [
        { providerSessionId: "missing-claude-session", resumeKey: "missing-claude-session" },
        { providerSessionId: null, resumeKey: null },
      ]);
      assert.match(completed.events.map((event) => event.text).join("\n"), /native session was missing/);
      const listed = await listConversations(workspaceRoot, "claude", "claude");
      assert.equal(listed.conversations.find((item) => item.id === conversation.id)?.providerSessionId, "fresh-claude-session");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("resets a provider session without detecting the agent again", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      await writeSession(workspaceRoot, "codex", "codex", { sessionId: "old-thread" });
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => {
            throw new Error("reset should not require live detection");
          },
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {},
      });

      const result = await runtime.resetConversation({ workspaceRoot, agent: { provider: "codex", id: "codex" } });

      assert.equal(result.ok, true);
      assert.deepEqual(await readSession(workspaceRoot, "codex", "codex"), {});
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("does not reset a provider session while that agent has an active run", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let resolveSend = (_value) => undefined;
      const holdPromise = new Promise((resolve) => {
        resolveSend = resolve;
      });
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "log", text: "started" });
              await holdPromise;
              return { output: "done", command: "fake-codex" };
            },
            cancel: async () => undefined,
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "hold", agent: { provider: "codex", id: "codex" } });
      const result = await runtime.resetConversation({ workspaceRoot, agent: { provider: "codex", id: "codex" } });
      assert.equal(result.ok, false);
      assert.equal(result.error, "agent has an active run");

      resolveSend();
      await waitForRun(runtime, started.runId);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("keeps adapter chunks separate from the final assistant event", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", status: "online", executablePath: "codex", customArgs: [] }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "chunk", text: "partial" });
              appendEvent({ type: "log", text: "adapter done" });
              return {
                output: "final answer",
                command: "fake-codex-app-server",
                providerSessionId: "provider-session-1",
                resumeKey: "resume-1",
                metadata: { resumeSupported: true },
              };
            },
            cancel: async () => undefined,
          }),
        },
      });

      const completed = await runtime.runMessage({ workspaceRoot, prompt: "你好", agent: { provider: "codex" } });
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "final answer");
      assert.equal(completed.providerSessionId, "provider-session-1");
      assert.equal(completed.resumeKey, "resume-1");
      assert.deepEqual(completed.metadata, { resumeSupported: true });
      assert.match(completed.debugSummary, /providerSessionId=provider-session-1/);
      assert.equal(completed.events.filter((event) => event.type === "assistant_chunk").length, 1);
      const finalEvents = completed.events.filter((event) => event.type === "finish");
      assert.equal(finalEvents.length, 1);
      assert.equal(finalEvents[0]?.text, "final answer");
      assert.equal(completed.events.filter((event) => event.type === "assistant").length, 0);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("preserves explicit null resumeKey from adapters", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "hermes", name: "Hermes", provider: "hermes", executablePath: "hermes", customArgs: [] }),
          detectAgent: async () => ({ id: "hermes", name: "Hermes", provider: "hermes", status: "online", executablePath: "hermes", customArgs: [] }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          hermes: () => ({
            sendMessage: async () => ({
              output: "done",
              command: "fake-hermes-acp",
              providerSessionId: "provider-session",
              resumeKey: null,
            }),
            cancel: async () => undefined,
          }),
        },
      });

      const completed = await runtime.runMessage({ workspaceRoot, prompt: "你好", agent: { provider: "hermes" } });
      assert.equal(completed.providerSessionId, "provider-session");
      assert.equal(completed.resumeKey, null);
      assert.match(completed.debugSummary, /resumeKey=<none>/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("uses the active run cancel handler instead of a fresh adapter instance", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let cancelled = false;
      let resolveSend;
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "claude", name: "Claude", provider: "claude", executablePath: "claude", customArgs: [] }),
          detectAgent: async () => ({ id: "claude", name: "Claude", provider: "claude", status: "online", executablePath: "claude", customArgs: [] }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false, error: "legacy should not be used" }),
        },
        adapters: {
          claude: ({ registerCancel }) => ({
            sendMessage: async () => {
              registerCancel(async () => {
                cancelled = true;
                resolveSend?.();
              });
              await new Promise((resolve) => {
                resolveSend = resolve;
              });
              return { output: "should not override cancelled", command: "fake-claude-stream-json" };
            },
            cancel: async () => {
              throw new Error("fresh adapter cancel should not be used");
            },
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "wait", agent: { provider: "claude" } });
      assert.equal(started.status, "running");
      const result = await runtime.cancelRun(started.runId);
      assert.equal(result.ok, true);
      assert.equal(cancelled, true);
      assert.equal(runtime.getRun(started.runId).status, "cancelled");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("restores stale running logs as failed instead of fake running", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runId = "stale-running-run";
      const logPath = path.join(workspaceRoot, ".opencode", "personal-assistant", "runs", `${runId}.jsonl`);
      await mkdir(path.dirname(logPath), { recursive: true });
      await writeFile(logPath, [
        JSON.stringify({
          type: "run_meta",
          at: Date.now() - 60_000,
          runId,
          agentId: "codex",
          agentProvider: "codex",
          connectionMode: "Codex app-server session",
          status: "running",
          startedAt: Date.now() - 60_000,
          finishedAt: null,
        }),
        JSON.stringify({ type: "status", text: "codex harness flow started", at: Date.now() - 60_000 }),
      ].join("\n") + "\n", "utf8");
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", provider: "codex" }),
          detectAgent: async () => ({ id: "codex", provider: "codex", status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
      });

      const restored = runtime.getRun({ runId, workspaceRoot });
      assert.equal(restored.status, "failed");
      assert.equal(restored.agentId, "codex");
      assert.equal(restored.agentProvider, "codex");
      assert.equal(restored.connectionMode, "Codex app-server session");
      assert.equal(restored.errorInfo?.code, "timeout");
      assert.match(restored.error ?? "", /运行状态已丢失/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("routes Codex through the managed ACP bridge by default", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
          detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", status: "online", executablePath: "codex", customArgs: [] }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
      });

      const completed = await runtime.runMessage({ workspaceRoot, prompt: "你好", agent: { provider: "codex" } });
      assert.equal(completed.status, "completed");
      assert.equal(completed.connectionMode, "Codex ACP session");
      assert.match(completed.command, /codex-acp/);
      assert.match(completed.output, /你好|您好|可以|帮/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("routes Claude Code through the managed ACP bridge by default", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "claude", name: "Claude Code", provider: "claude", executablePath: "claude", customArgs: [] }),
          detectAgent: async () => ({ id: "claude", name: "Claude Code", provider: "claude", status: "online", executablePath: "claude", customArgs: [] }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
      });

      const completed = await runtime.runMessage({ workspaceRoot, prompt: "你好", agent: { provider: "claude" } });
      assert.equal(completed.status, "completed");
      assert.equal(completed.connectionMode, "Claude Code ACP session");
      assert.match(completed.command, /claude-agent-acp/);
      assert.match(completed.output, /你好|您好|可以|帮/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("tracks active ACP subprocesses by run and conversation", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      /** @type {(() => void) | null} */
      let release = null;
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const runtime = createPersonalAgentRuntime({
        legacy: {
          normalizeAgent: async () => ({ id: "hermes", name: "Hermes", provider: "hermes", executablePath: "hermes", customArgs: [] }),
          detectAgent: async () => ({ id: "hermes", name: "Hermes", provider: "hermes", status: "online", executablePath: "hermes", customArgs: [] }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: true }),
        },
        adapters: {
          hermes: ({ appendEvent }) => ({
            sendMessage: async (ctx) => {
              appendEvent({ type: "log", text: "pid 43210" });
              appendEvent({ type: "assistant_chunk", text: "pending" });
              await gate;
              return {
                output: `hermes:${ctx.prompt}`,
                command: "fake-hermes-acp",
                connectionMode: "Hermes ACP session",
                providerSessionId: "provider-session-1",
                resumeKey: "provider-session-1",
                pid: 43210,
                metadata: { agent_type: "acp" },
              };
            },
            cancel: async () => undefined,
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "hello", agent: { provider: "hermes" } });
      assert.equal(started.status, "running");
      assert.equal(runtime.listProcesses().processes.length, 1);
      assert.equal(runtime.listProcesses().processes[0].pid, 43210);
      assert.equal(runtime.listProcesses().processes[0].agentType, "acp");
      assert.equal(typeof release, "function");
      if (!release) throw new Error("test gate release was not initialized");
      release();
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.pid, 43210);
      assert.equal(getAgentProcess(started.runId), null);
      assert.deepEqual(runtime.listProcesses().processes, []);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("keeps approval requests pending until the user resolves them", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let receivedDecision = null;
      const legacy = {
        normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
        detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
        listAgents: async () => ({ agents: [] }),
        start: async () => ({ status: "legacy-start" }),
        run: async () => ({ status: "legacy-run" }),
        status: () => ({ status: "missing" }),
        cancel: async () => ({ ok: false }),
      };
      const runtime = createPersonalAgentRuntime({
        legacy,
        adapters: {
          codex: ({ requestApproval, appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "log", text: "fake codex started" });
              const result = await requestApproval({
                id: "approval-1",
                method: "item/commandExecution/requestApproval",
                kind: "command",
                title: "Codex 请求执行命令",
                summary: "Codex 请求执行命令：curl https://example.com",
                command: "curl https://example.com",
                readonly: false,
              });
              receivedDecision = result.decision;
              return { output: `decision=${result.decision}`, command: "fake-codex-session" };
            },
          }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "联网", agent: { provider: "codex" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(waiting.status, "running");
      assert.equal(waiting.approvalMode, "ask");
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.equal(waiting.pendingApprovals[0].command, "curl https://example.com");

      assert.deepEqual(await runtime.resolveApproval({ runId: started.runId, approvalId: "approval-1", decision: "accept" }), { ok: true });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(receivedDecision, "accept");
      assert.equal(completed.pendingApprovals.length, 0);
      assert.match(completed.output, /decision=accept/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("persists always-allow approval decisions across runtime restarts", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const decisions = [];
      const legacy = {
        normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
        detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
        listAgents: async () => ({ agents: [] }),
        start: async () => ({ status: "legacy-start" }),
        run: async () => ({ status: "legacy-run" }),
        status: () => ({ status: "missing" }),
        cancel: async () => ({ ok: false }),
      };
      const makeRuntime = () => createPersonalAgentRuntime({
        legacy,
        adapters: {
          codex: ({ requestApproval }) => ({
            sendMessage: async () => {
              const result = await requestApproval({
                id: `approval-${decisions.length + 1}`,
                method: "session/request_permission",
                kind: "command",
                title: "Run command",
                summary: "Run harmless command",
                command: "touch /tmp/onmyagent-approval-store-smoke",
                readonly: false,
              });
              decisions.push(result);
              return { output: `decision=${result.decision}`, command: "fake-codex-session" };
            },
          }),
        },
      });

      const firstRuntime = makeRuntime();
      const first = await firstRuntime.startMessage({ workspaceRoot, prompt: "needs approval", agent: { provider: "codex" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(firstRuntime, { runId: first.runId, workspaceRoot });
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.deepEqual(await firstRuntime.resolveApproval({ runId: first.runId, approvalId: waiting.pendingApprovals[0].id, decision: "acceptForSession", alwaysAllow: true }), { ok: true });
      const firstCompleted = await waitForRun(firstRuntime, first.runId);
      assert.equal(firstCompleted.status, "completed");
      assert.equal(decisions[0].decision, "acceptForSession");

      const secondRuntime = makeRuntime();
      const second = await secondRuntime.startMessage({ workspaceRoot, prompt: "same approval", agent: { provider: "codex" }, approvalMode: "ask" });
      const secondCompleted = await waitForRun(secondRuntime, second.runId);
      assert.equal(secondCompleted.status, "completed");
      assert.equal(secondCompleted.pendingApprovals.length, 0);
      assert.equal(decisions[1].decision, "acceptForSession");
      assert.equal(decisions[1].stored, true);
      assert.equal(secondCompleted.events.some((event) => event.type === "approval_request"), false);
      assert.equal(secondCompleted.events.some((event) => /stored/.test(String(event.text ?? ""))), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("recovers and resolves pending approvals through conversation confirmations", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      /** @type {{ decision?: string } | null} */
      let resolver = null;
      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "codex", provider: "codex", status: "online" }),
          start: async () => ({}),
          run: async () => ({}),
          status: () => ({}),
          cancel: () => ({}),
        },
        adapters: {
          codex: () => ({
            sendMessage: async (ctx) => {
              const approval = await ctx.requestApproval({
                id: "confirm-1",
                method: "session/request_permission",
                kind: "command",
                title: "Run command",
                summary: "Run pwd",
                command: "pwd",
              });
              resolver = approval;
              return { output: `decision:${approval.decision}`, command: "fake", connectionMode: "Codex ACP session" };
            },
          }),
        },
      });
      const conversation = await runtime.createConversation({ workspaceRoot, agent: { provider: "codex" }, title: "Approval" });
      const started = await runtime.startMessage({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id, prompt: "needs approval" });
      const pending = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(pending.pendingApprovals.length, 1);

      const recovered = await runtime.listConversationConfirmations({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id });
      assert.equal(recovered.confirmations[0].id, "confirm-1");
      const persisted = await readConversationEvents(workspaceRoot, "codex", "codex", conversation.conversation.id);
      assert.equal(persisted.messages.some((message) => message.type === "permission" && message.approval?.id === "confirm-1"), true);
      const confirmed = await runtime.confirmConversationConfirmation({ workspaceRoot, agent: { provider: "codex" }, conversationId: conversation.conversation.id, approvalId: "confirm-1", decision: "accept" });
      assert.equal(confirmed.ok, true);
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.output, "decision:accept");
      if (!resolver) throw new Error("test approval resolver was not initialized");
      assert.equal(resolver.decision, "accept");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("routes OpenCode SDK permissions through runtime approval", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const replies = [];
      let messagesCalls = 0;
      const client = {
        session: {
          get: async () => ({ data: { id: "opencode-session" } }),
          create: async () => ({ data: { id: "opencode-session" } }),
          abort: async () => ({ data: {} }),
          messages: async () => {
            messagesCalls += 1;
            if (messagesCalls < 2) return { data: [] };
            return {
              data: [{ info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "text", text: "approved-output" }] }],
            };
          },
          promptAsync: async () => ({ data: {} }),
        },
        permission: {
          list: async () => replies.length
            ? { data: [] }
            : {
                data: [{
                  id: "perm-1",
                  sessionID: "opencode-session",
                  permission: "bash",
                  patterns: ["*"],
                  metadata: { command: "pwd" },
                }],
              },
          reply: async (input) => {
            replies.push(input);
            return { data: {} };
          },
          respond: async (input) => {
            replies.push(input);
            return { data: {} };
          },
        },
      };
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", model: "", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false }),
        },
        adapters: {
          opencode: (options) => createOpenCodeAdapter({ ...options, createClient: () => client }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "pwd", agent: { provider: "opencode" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(waiting.status, "running");
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.equal(waiting.pendingApprovals[0].command, "pwd");

      assert.deepEqual(await runtime.resolveApproval({ runId: started.runId, approvalId: waiting.pendingApprovals[0].id, decision: "accept" }), { ok: true });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "approved-output");
      assert.equal(replies.length, 1);
      assert.equal(replies[0].permissionID, "perm-1");
      assert.equal(replies[0].response, "once");
      assert.equal(replies[0].sessionID, "opencode-session");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("blocks interactive sudo prompts before dispatching OpenCode SDK work", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let clientCreated = false;
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", model: "", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false }),
        },
        adapters: {
          opencode: (options) => createOpenCodeAdapter({
            ...options,
            createClient: () => {
              clientCreated = true;
              throw new Error("OpenCode client should not be created for interactive sudo");
            },
          }),
        },
      });

      const started = await runtime.startMessage({
        workspaceRoot,
        prompt: "请执行 sudo ls /Users/example/Desktop",
        agent: { provider: "opencode" },
        approvalMode: "ask",
      });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(clientCreated, false);
      assert.match(completed.output, /不能在当前 OpenCode 聊天窗口里执行 `sudo ls \/Users\/example\/Desktop`/);
      assert.match(completed.output, /没有可输入 macOS sudo 密码的 TTY/);
      assert.match(completed.output, /`ls \/Users\/example\/Desktop`/);
      assert.equal(completed.metadata.blockedReason, "interactive_sudo");
      assert.equal(completed.connectionMode, "OpenCode SDK session (sudo preflight)");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("does not ask again when OpenCode reissues the same accepted permission with a new id", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const replies = [];
      let listCalls = 0;
      let messagesCalls = 0;
      const client = {
        session: {
          get: async () => ({ data: { id: "opencode-session" } }),
          create: async () => ({ data: { id: "opencode-session" } }),
          abort: async () => ({ data: {} }),
          messages: async () => {
            messagesCalls += 1;
            if (messagesCalls < 4) return { data: [] };
            return {
              data: [{ info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "text", text: "duplicate-permission-output" }] }],
            };
          },
          promptAsync: async () => ({ data: {} }),
        },
        permission: {
          list: async () => {
            listCalls += 1;
            if (listCalls === 1) {
              return { data: [{ id: "perm-1", sessionID: "opencode-session", permission: "bash", metadata: { command: "pwd" } }] };
            }
            if (listCalls === 2) {
              return { data: [{ id: "perm-2", sessionID: "opencode-session", permission: "bash", metadata: { command: "pwd" } }] };
            }
            return { data: [] };
          },
          respond: async (input) => {
            replies.push(input);
            return { data: {} };
          },
        },
      };
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", model: "", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false }),
        },
        adapters: {
          opencode: (options) => createOpenCodeAdapter({ ...options, createClient: () => client }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "pwd", agent: { provider: "opencode" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.deepEqual(await runtime.resolveApproval({ runId: started.runId, approvalId: waiting.pendingApprovals[0].id, decision: "accept" }), { ok: true });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "duplicate-permission-output");
      assert.equal(replies.length, 2);
      assert.deepEqual(replies.map((reply) => reply.permissionID), ["perm-1", "perm-2"]);
      assert.equal(completed.events.filter((event) => event.type === "approval_request").length, 1);
      assert.equal(completed.events.some((event) => /approval_auto_accept_duplicate/.test(String(event.text ?? ""))), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("polls OpenCode SDK permissions while session.prompt is still pending", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const replies = [];
      let messagesCalls = 0;
      let resolvePrompt;
      const promptGate = new Promise((resolve) => {
        resolvePrompt = resolve;
      });
      const listCalls = [];
      const client = {
        session: {
          get: async () => ({ data: { id: "opencode-session" } }),
          create: async () => ({ data: { id: "opencode-session" } }),
          abort: async () => ({ data: {} }),
          messages: async () => {
            messagesCalls += 1;
            if (!replies.length || messagesCalls < 2) return { data: [] };
            return {
              data: [{ info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "text", text: "prompt-approved-output" }] }],
            };
          },
          prompt: async () => promptGate,
          promptAsync: async () => {
            throw new Error("promptAsync should not be used when session.prompt returns output");
          },
        },
        permission: {
          list: async (input) => {
            listCalls.push(input ?? null);
            return replies.length
              ? { data: [] }
              : {
                  data: [{
                    id: "perm-1",
                    sessionID: "opencode-session",
                    permission: "external_directory",
                    pattern: `${workspaceRoot}/Desktop/*`,
                  }],
                };
          },
          reply: async (input) => {
            replies.push(input);
            resolvePrompt({ data: { parts: [] } });
            return { data: {} };
          },
        },
      };
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", model: "", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false }),
        },
        adapters: {
          opencode: (options) => createOpenCodeAdapter({ ...options, createClient: () => client }),
        },
      });

      const extraRoot = path.join(workspaceRoot, "shared-reference");
      const started = await runtime.startMessage({ workspaceRoot, accessibleWorkspaceRoots: [extraRoot], prompt: "找桌面文件", agent: { provider: "opencode" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(waiting.status, "running");
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.equal(waiting.pendingApprovals[0].kind, "permissions");
      assert.match(waiting.pendingApprovals[0].summary, /Desktop/);

      assert.deepEqual(await runtime.resolveApproval({ runId: started.runId, approvalId: waiting.pendingApprovals[0].id, decision: "accept" }), { ok: true });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "prompt-approved-output");
      assert.equal(replies.length, 1);
      assert.equal(replies[0].requestID, "perm-1");
      assert.equal(replies[0].reply, "once");
      assert.equal(listCalls.some((input) => input && input.directory === workspaceRoot), true);
      assert.equal(listCalls.some((input) => input && input.directory === extraRoot), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("does not fail OpenCode runs when a duplicate permission was already cleared upstream", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const replies = [];
      let messagesCalls = 0;
      let resolvePrompt;
      const promptGate = new Promise((resolve) => {
        resolvePrompt = resolve;
      });
      const client = {
        session: {
          get: async () => ({ data: { id: "opencode-session" } }),
          create: async () => ({ data: { id: "opencode-session" } }),
          abort: async () => ({ data: {} }),
          messages: async () => {
            messagesCalls += 1;
            if (messagesCalls < 2) return { data: [] };
            return {
              data: [{ info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "text", text: "stale-permission-ignored" }] }],
            };
          },
          prompt: async () => promptGate,
          promptAsync: async () => {
            throw new Error("promptAsync should not be used");
          },
        },
        permission: {
          list: async () => replies.length
            ? { data: [] }
            : {
                data: [{
                  id: "perm-stale",
                  sessionID: "opencode-session",
                  permission: "external_directory",
                  metadata: { filepath: "/Users/example/Desktop" },
                }],
              },
          reply: async (input) => {
            replies.push(input);
            resolvePrompt({ data: { parts: [] } });
            return { error: { message: "Permission request not found: perm-stale" } };
          },
        },
      };
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", model: "", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false }),
        },
        adapters: {
          opencode: (options) => createOpenCodeAdapter({ ...options, createClient: () => client }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "找桌面文件", agent: { provider: "opencode" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.deepEqual(await runtime.resolveApproval({ runId: started.runId, approvalId: waiting.pendingApprovals[0].id, decision: "acceptForSession" }), { ok: true });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "stale-permission-ignored");
      assert.equal(replies.length, 1);
      assert.equal(completed.events.some((event) => /permission stale/.test(String(event.text ?? ""))), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("polls OpenCode SDK permissions while promptAsync is still pending", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const replies = [];
      let messagesCalls = 0;
      let resolvePrompt;
      const promptGate = new Promise((resolve) => {
        resolvePrompt = resolve;
      });
      const client = {
        session: {
          get: async () => ({ data: { id: "opencode-session" } }),
          create: async () => ({ data: { id: "opencode-session" } }),
          abort: async () => ({ data: {} }),
          messages: async () => {
            messagesCalls += 1;
            if (!replies.length || messagesCalls < 2) return { data: [] };
            return {
              data: [{ info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "text", text: "pending-prompt-approved" }] }],
            };
          },
          promptAsync: async () => promptGate,
        },
        permission: {
          list: async () => replies.length
            ? { data: [] }
            : {
                data: [{
                  id: "perm-1",
                  sessionID: "opencode-session",
                  permission: "bash",
                  metadata: { command: "curl https://example.com" },
                }],
              },
          reply: async (input) => {
            replies.push(input);
            resolvePrompt({ data: {} });
            return { data: {} };
          },
        },
      };
      const runtime = createPersonalAgentRuntime({
        engineInfo: () => ({ baseUrl: "http://127.0.0.1:9999/opencode" }),
        onmyagentServerInfo: () => ({ clientToken: "client-token" }),
        legacy: {
          normalizeAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", customArgs: [] }),
          detectAgent: async () => ({ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode", model: "", customArgs: [], status: "online" }),
          listAgents: async () => ({ agents: [] }),
          start: async () => ({ status: "legacy-start" }),
          run: async () => ({ status: "legacy-run" }),
          status: () => ({ status: "missing" }),
          cancel: async () => ({ ok: false }),
        },
        adapters: {
          opencode: (options) => createOpenCodeAdapter({ ...options, createClient: () => client }),
        },
      });

      const started = await runtime.startMessage({ workspaceRoot, prompt: "curl", agent: { provider: "opencode" }, approvalMode: "ask" });
      const waiting = await waitForPendingApproval(runtime, { runId: started.runId, workspaceRoot });
      assert.equal(waiting.status, "running");
      assert.equal(waiting.pendingApprovals.length, 1);
      assert.equal(waiting.pendingApprovals[0].command, "curl https://example.com");

      assert.deepEqual(await runtime.resolveApproval({ runId: started.runId, approvalId: waiting.pendingApprovals[0].id, decision: "accept" }), { ok: true });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, "pending-prompt-approved");
      assert.equal(replies.length, 1);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("routes Hermes, Claude Code, and OpenClaw through migrated adapters", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      for (const provider of ["hermes", "claude", "openclaw"]) {
        const runtime = createPersonalAgentRuntime({
          legacy: {
            normalizeAgent: async () => ({ id: provider, name: provider, provider, executablePath: provider, customArgs: [] }),
            detectAgent: async () => ({ id: provider, name: provider, provider, status: "online", executablePath: provider, customArgs: [] }),
            listAgents: async () => ({ agents: [] }),
            start: async () => ({ status: "legacy-start" }),
            run: async () => ({ status: "legacy-run" }),
            status: () => ({ status: "missing" }),
            cancel: async () => ({ ok: true }),
          },
          adapters: {
            [provider]: () => ({
              sendMessage: async (ctx) => ({
                output: `${provider}:${ctx.prompt}`,
                command: `${provider}-adapter`,
                connectionMode: `${provider}-mode`,
              }),
              cancel: async () => undefined,
            }),
          },
        });
        const completed = await runtime.runMessage({ workspaceRoot, prompt: "你好", agent: { provider } });
        assert.equal(completed.status, "completed");
        assert.equal(completed.output, `${provider}:你好`);
        assert.equal(completed.connectionMode, `${provider}-mode`);
      }
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("delegates unknown providers to legacy", async () => {
    const runtime = createPersonalAgentRuntime({
      legacy: {
        normalizeAgent: async () => ({ id: "custom", provider: "custom" }),
        detectAgent: async () => ({ id: "custom", provider: "custom", status: "online" }),
        listAgents: async () => ({ agents: [] }),
        start: async () => ({ status: "legacy-start" }),
        run: async () => ({ status: "legacy-run" }),
        status: () => ({ status: "missing" }),
        cancel: async () => ({ ok: true }),
      },
    });

    assert.deepEqual(await runtime.startMessage({ workspaceRoot: "/tmp/work", prompt: "hi", agent: { provider: "custom" } }), { status: "legacy-start" });
  });
});

describe("OpenClaw adapter parsing", () => {
  it("extracts text from pretty final JSON output", () => {
    const raw = `log before\n{\n  "payloads": [{ "text": "你好，已完成" }],\n  "meta": { "durationMs": 10, "agentMeta": { "sessionId": "ses-1", "model": "qwen" } }\n}`;
    const parsed = openclawTest.parseOutput(raw, () => undefined);
    assert.equal(parsed.output, "你好，已完成");
    assert.equal(parsed.sessionId, "ses-1");
  });

  it("records NDJSON text events as chunks", () => {
    const events = [];
    const raw = [
      JSON.stringify({ sessionId: "ses-2", type: "text", text: "第一段" }),
      JSON.stringify({ type: "text", text: "第二段" }),
    ].join("\n");
    const parsed = openclawTest.parseOutput(raw, (event) => events.push(event));
    assert.equal(parsed.output, "第一段\n第二段");
    assert.equal(parsed.sessionId, "ses-2");
    assert.deepEqual(events, [
      { type: "assistant_chunk", text: "第一段" },
      { type: "assistant_chunk", text: "第二段" },
    ]);
  });

  it("omits OpenClaw agent override when model is empty", () => {
    const args = openclawTest.buildArgs(
      { model: "", prompt: "hi", agent: { customArgs: [] } },
      "session-1",
    );
    assert.equal(args.includes("--agent"), false);
  });

  it("passes selected model as OpenClaw agent id", () => {
    const args = openclawTest.buildArgs(
      { model: "agent-reviewer", prompt: "hi", agent: { customArgs: [] } },
      "session-1",
    );
    assert.deepEqual(args.slice(0, 9), ["agent", "--local", "--json", "--session-id", "session-1", "--timeout", "600", "--agent", "agent-reviewer"]);
    assert.equal(args.at(-2), "--message");
    assert.equal(args.at(-1), "hi");
  });
});

describe("Hermes ACP adapter parsing", () => {
  it("extracts nested ACP session ids returned by resume/new", () => {
    assert.equal(hermesTest.extractSessionId({ sessionId: "direct" }), "direct");
    assert.equal(hermesTest.extractSessionId({ session: { id: "nested-id" } }), "nested-id");
    assert.equal(hermesTest.extractSessionId({ data: { session: { session_id: "snake" } } }), "snake");
  });

  it("rejects legacy Hermes CLI session ids for ACP resume", () => {
    assert.equal(hermesTest.isAcpSessionId("34b82e3c-3f33-4913-acea-6df293784df8"), true);
    assert.equal(hermesTest.isAcpSessionId("20260612_112037_77638f"), false);
  });

  it("normalizes slash model ids to Hermes ACP provider:model ids", () => {
    assert.equal(hermesTest.normalizeHermesModelId("ark-coding-plan/kimi-k2.5"), "ark-coding-plan:kimi-k2.5");
    assert.equal(hermesTest.normalizeHermesModelId("ark-coding-plan:kimi-k2.5"), "ark-coding-plan:kimi-k2.5");
  });

  it("maps UI approval decisions to Hermes ACP permission options", () => {
    const params = {
      options: [
        { optionId: "reject", label: "Reject" },
        { optionId: "approve", label: "Approve once" },
        { optionId: "approve_for_session", label: "Approve for session" },
      ],
    };
    assert.equal(hermesTest.hermesPermissionOptionForDecision(params, "accept"), "approve");
    assert.equal(hermesTest.hermesPermissionOptionForDecision(params, "acceptForSession"), "approve_for_session");
    assert.equal(hermesTest.hermesPermissionOptionForDecision(params, "decline"), "reject");
  });

  it("does not classify Hermes shell permission as read-only", () => {
    assert.equal(hermesTest.isReadOnlyHermesPermission({ toolName: "Read" }), true);
    assert.equal(hermesTest.isReadOnlyHermesPermission({ toolName: "Bash", input: { command: "pwd" } }), false);
    assert.equal(hermesTest.hermesPermissionKind({ toolName: "Bash" }), "command");
  });

  it("extracts nested Hermes tool update output for fallback completion", () => {
    const update = {
      content: [
        { content: { type: "text", text: "terminal result" }, type: "content" },
        { content: { type: "text", text: "exit_code: 0" }, type: "content" },
      ],
    };
    assert.equal(hermesTest.textFromUnknown(update), "terminal result\nexit_code: 0");
  });

  it("does not implicitly resume stored Hermes ACP sessions", () => {
    assert.equal(acpGenericTest.shouldResumeProviderSession("hermes", {}, { sessionId: "stale" }), false);
    assert.equal(acpGenericTest.shouldResumeProviderSession("hermes", { providerSessionId: "explicit" }, { sessionId: "stale" }), false);
    assert.equal(acpGenericTest.normalizeExplicitSessionId("hermes", "20260610_170717_e717ba"), "");
    assert.equal(acpGenericTest.normalizeExplicitSessionId("hermes", "23385178-4bfb-46bf-8316-bdd9a2fddb90"), "23385178-4bfb-46bf-8316-bdd9a2fddb90");
  });
});

describe("Claude Code adapter approvals", () => {
  it("only enables bypassPermissions for unattended auto mode", () => {
    const ctx = { model: "sonnet", agent: { customArgs: [] } };
    assert.equal(claudeTest.buildArgs(ctx, "", "ask").includes("bypassPermissions"), false);
    assert.equal(claudeTest.buildArgs(ctx, "", "read-only-auto").includes("bypassPermissions"), false);
    assert.equal(claudeTest.buildArgs(ctx, "", "auto").includes("bypassPermissions"), true);
    assert.equal(claudeTest.buildArgs(ctx, "", "ask", true).includes("bypassPermissions"), true);
  });

  it("adds the workspace root to Claude Code allowed directories", () => {
    const args = claudeTest.buildArgs({ workspaceRoot: "/tmp/workspace", model: "", agent: { customArgs: [] } }, "", "ask");
    assert.equal(args.includes("--add-dir"), true);
    assert.equal(args[args.indexOf("--add-dir") + 1], "/tmp/workspace");
  });

  it("adds extra accessible roots to Claude Code allowed directories", () => {
    const args = claudeTest.buildArgs({ workspaceRoot: "/tmp/workspace", accessibleWorkspaceRoots: ["/tmp/docs", "/tmp/workspace", "/tmp/docs"], model: "", agent: { customArgs: [] } }, "", "ask");
    const addDirs = args.flatMap((arg, index) => arg === "--add-dir" ? [args[index + 1]] : []);
    assert.deepEqual(addDirs, ["/tmp/workspace", "/tmp/docs"]);
  });

  it("preflights Claude Code risky non-interactive runs before using bypassPermissions", () => {
    assert.equal(claudeTest.shouldPreflightClaudeRun("auto", "请执行 pwd"), false);
    assert.equal(claudeTest.shouldPreflightClaudeRun("ask", "你好"), false);
    assert.equal(claudeTest.shouldPreflightClaudeRun("ask", "请执行 pwd"), true);
    assert.equal(claudeTest.shouldPreflightClaudeRun("read-only-auto", "你好"), false);
    assert.equal(claudeTest.shouldPreflightClaudeRun("read-only-auto", "请通过 shell 执行 pwd"), true);
  });

  it("does not classify Claude shell control requests as read-only", () => {
    assert.equal(claudeTest.isReadOnlyClaudeControlRequest({ tool_name: "Read" }), true);
    assert.equal(claudeTest.isReadOnlyClaudeControlRequest({ tool_name: "Bash", input: { command: "pwd" } }), false);
    assert.equal(claudeTest.claudeControlRequestKind({ tool_name: "Bash" }), "command");
    assert.deepEqual(claudeTest.claudeControlResponseForDecision("decline"), { behavior: "deny" });
    assert.deepEqual(claudeTest.claudeControlResponseForDecision("accept"), { behavior: "allow" });
  });
});

describe("OpenCode SDK adapter approvals", () => {
  it("does not classify OpenCode bash permission as read-only", () => {
    assert.equal(opencodeTest.isReadOnlyOpenCodePermission({ permission: "read" }), true);
    assert.equal(opencodeTest.isReadOnlyOpenCodePermission({ permission: "bash", metadata: { command: "pwd" } }), false);
    assert.equal(opencodeTest.opencodePermissionKind({ permission: "bash" }), "command");
    assert.equal(opencodeTest.opencodePermissionCommand({ permission: "bash", metadata: { command: "pwd" } }), "pwd");
    assert.equal(opencodeTest.openCodeReplyForDecision("accept"), "once");
    assert.equal(opencodeTest.openCodeReplyForDecision("acceptForSession"), "always");
    assert.equal(opencodeTest.openCodeReplyForDecision("decline"), "reject");
  });
});

describe("Codex app-server adapter approvals", () => {
  it("includes extra accessible roots in Codex developer instructions", () => {
    const text = codexTest.buildDeveloperInstructions("/tmp/workspace", ["/tmp/docs", "/tmp/workspace"]);
    assert.match(text, /当前工作区根目录：\/tmp\/workspace/);
    assert.match(text, /额外可访问目录：/);
    assert.match(text, /\/tmp\/docs/);
    assert.doesNotMatch(text, /- \/tmp\/workspace/);
  });

  it("maps Studio approval modes to explicit Codex approval and sandbox policy", () => {
    assert.deepEqual(codexTest.codexRunPolicyForApprovalMode("ask"), {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      threadSandbox: "read-only",
      turnSandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    assert.deepEqual(codexTest.codexRunPolicyForApprovalMode("read-only-auto"), {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      threadSandbox: "read-only",
      turnSandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    assert.deepEqual(codexTest.codexRunPolicyForApprovalMode("auto"), {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      threadSandbox: "danger-full-access",
      turnSandboxPolicy: { type: "dangerFullAccess" },
    });
  });

  it("auto-accepts Codex command and file approvals for unattended local runs", () => {
    assert.deepEqual(
      codexTest.codexApprovalResponseForRequest("item/commandExecution/requestApproval", { command: "curl https://example.com" }),
      { decision: "acceptForSession" },
    );
    assert.deepEqual(
      codexTest.codexApprovalResponseForRequest("item/fileChange/requestApproval", { itemId: "patch-1" }),
      { decision: "acceptForSession" },
    );
    assert.deepEqual(
      codexTest.codexApprovalResponseForRequest("item/permissions/requestApproval", { permissions: { network: { enabled: true } } }),
      { scope: "session", permissions: { network: { enabled: true } } },
    );
  });
});

describe("personal agent runtime timeout & artifacts", () => {
  function makeFakeLegacy(provider) {
    return {
      normalizeAgent: async (agent = {}) => ({ id: provider, name: provider, provider, executablePath: provider, customArgs: [], ...agent }),
      detectAgent: async (agent = {}) => ({ id: provider, name: provider, provider, status: "online", executablePath: provider, customArgs: [], ...agent }),
      listAgents: async () => ({ agents: [{ id: provider, name: provider, provider, status: "online", executablePath: provider, customArgs: [] }] }),
      start: async () => ({ status: "legacy-start" }),
      run: async () => ({ status: "legacy-run" }),
      status: () => ({ status: "missing" }),
      cancel: async () => ({ ok: true }),
    };
  }

  it("marks long-running runs as failed/timeout when wall-clock cancel reason is timeout", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let cancelCalled = false;
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("opencode"),
        adapters: {
          opencode: ({ registerCancel }) => {
            let resolveSend;
            registerCancel(() => {
              cancelCalled = true;
              resolveSend?.({ output: "(cancelled)", command: "fake-opencode" });
            });
            return {
              sendMessage: () => new Promise((resolve) => {
                resolveSend = resolve;
              }),
              cancel: async () => undefined,
            };
          },
        },
      });

      const started = await runtime.startMessage({
        workspaceRoot,
        prompt: "long",
        agent: { provider: "opencode" },
        timeoutMs: 60_000,
      });
      assert.equal(started.status, "running");
      const result = await runtime.cancelRun(started.runId, { reason: "timeout" });
      assert.equal(result.ok, true);
      const final = runtime.getRun({ runId: started.runId, workspaceRoot });
      assert.equal(final.status, "failed");
      assert.equal(final.errorInfo?.code, "timeout");
      assert.match(final.error ?? "", /超时|timeout/i);
      assert.equal(cancelCalled, true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("differentiates user cancellation from timeout cancellation", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("opencode"),
        adapters: {
          opencode: ({ registerCancel }) => {
            let resolveSend;
            registerCancel(() => resolveSend?.({ output: "(cancelled)", command: "fake-opencode" }));
            return {
              sendMessage: () => new Promise((resolve) => { resolveSend = resolve; }),
              cancel: async () => undefined,
            };
          },
        },
      });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "long", agent: { provider: "opencode" } });
      const result = await runtime.cancelRun(started.runId);
      assert.equal(result.ok, true);
      const final = runtime.getRun({ runId: started.runId, workspaceRoot });
      assert.equal(final.status, "cancelled");
      assert.equal(final.errorInfo?.code, "cancelled");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("captures structured artifacts from adapter events and final assistant text", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("opencode"),
        adapters: {
          opencode: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({
                type: "artifact",
                text: "wrote reports/x.md",
                artifact: { path: "reports/x.md", source: "adapter" },
              });
              return {
                output: "已生成产物文件：reports/y.md\n附带 reports/y.md 备份。",
                command: "fake-opencode",
              };
            },
            cancel: async () => undefined,
          }),
        },
      });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "go", agent: { provider: "opencode" } });
      const completed = await waitForRun(runtime, started.runId);
      assert.equal(completed.status, "completed");
      assert(Array.isArray(completed.artifacts));
      const names = completed.artifacts.map((entry) => entry.relPath).sort();
      assert.deepEqual(names, ["reports/x.md", "reports/y.md"]);
      const adapterEntry = completed.artifacts.find((entry) => entry.relPath === "reports/x.md");
      assert.equal(adapterEntry?.source, "adapter");
      const assistantEntry = completed.artifacts.find((entry) => entry.relPath === "reports/y.md");
      assert.equal(assistantEntry?.source, "assistant");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("does not mark ACP tool failure plus interrupted output as completed", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("codex"),
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "assistant_chunk", text: "我先检查。" });
              appendEvent({ type: "tool", text: "acp_tool_call_update> {\"status\":\"failed\",\"rawOutput\":{\"exit_code\":null}}" });
              throw new Error("codex ACP conversation interrupted. tool_call_update failed");
            },
            cancel: async () => undefined,
          }),
        },
      });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "research", agent: { provider: "codex" } });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "failed");
      assert.equal(final.ok, false);
      assert.match(final.error ?? "", /interrupted|tool_call_update/i);
      assert.equal(final.errorInfo.code, "acp_bridge_interrupted");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("preserves assistant output when an ACP tool fails after visible text", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("codex"),
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "assistant_chunk", text: "已经完成主要检查。" });
              appendEvent({ type: "tool", text: "acp_tool_call_update> {\"status\":\"failed\",\"rawOutput\":{\"formatted_output\":\"jq failed\",\"exit_code\":5},\"_meta\":{\"terminal_exit\":{\"exit_code\":5}}}" });
              appendEvent({ type: "status", text: "codex ACP reported a failed tool after assistant output; preserving the assistant response." });
              return { output: "已经完成主要检查。", command: "fake-codex-acp" };
            },
            cancel: async () => undefined,
          }),
        },
      });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "inspect", agent: { provider: "codex" } });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "completed", final.error ?? "remote run should complete");
      assert.equal(final.ok, true);
      assert.equal(final.errorInfo, null);
      assert.match(final.output, /已经完成主要检查/);
      assert(final.events.some((event) => event.type === "tool" && /failed/.test(event.text)));
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("splits reasoning content out of agent_message_chunk", () => {
    const roleReasoning = acpGenericTest.extractReasoningFromMessageChunk({ role: "reasoning" });
    assert.equal(roleReasoning.thought, "");
    assert.equal(roleReasoning.reasoningRole, true);
    const inline = acpGenericTest.extractReasoningFromMessageChunk({
      content: [
        { type: "thought", text: "step 1 " },
        { type: "text", text: "hello" },
      ],
    });
    assert.equal(inline.thought, "step 1 ");
    assert.deepEqual(inline.messageData.content, [{ type: "text", text: "hello" }]);
    const passthrough = acpGenericTest.extractReasoningFromMessageChunk({ content: [{ type: "text", text: "plain" }] });
    assert.equal(passthrough.thought, "");
    assert.equal(passthrough.messageData.content[0].text, "plain");
  });

  it("thinking tracker merges chunks by msgId and emits done boundary", async () => {
    const events = [];
    const tracker = acpGenericTest.createThinkingTracker((event) => events.push(event));
    tracker.push({ text: "step a ", data: {}, msgId: "m1", status: "thinking" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    tracker.push({ text: "step b", data: {}, msgId: "m1", status: "thinking" });
    tracker.finishOnAssistant();
    // Two chunk events plus one done boundary.
    assert.equal(events.length, 3);
    assert.equal(events[0].type, "thinking");
    assert.equal(events[0].msgId, "m1");
    assert.equal(events[0].text, "step a ");
    assert.equal(events[1].text, "step b");
    assert.ok(events[1].durationMs >= events[0].durationMs);
    assert.equal(events[2].status, "done");
    assert.equal(events[2].msgId, "m1");
    assert.ok(events[2].durationMs >= events[1].durationMs);
    // Subsequent finishOnAssistant should be a no-op.
    tracker.finishOnAssistant();
    assert.equal(events.length, 3);
  });

  it("thinking tracker finishes on non-thinking boundary events", async () => {
    const events = [];
    const tracker = acpGenericTest.createThinkingTracker((event) => events.push(event));
    tracker.push({ text: "reason ", data: {}, msgId: "m1", status: "thinking" });
    assert.equal(tracker.hasActive(), true);
    tracker.finishOnBoundary("tool_call");
    assert.equal(tracker.hasActive(), false);
    const done = events.at(-1);
    assert.equal(done.status, "done");
    assert.equal(done.data.reason, "tool_call");
    // Second finishOnBoundary is a no-op.
    tracker.finishOnBoundary("tool_call");
    assert.equal(events.length, 2);
  });

  it("deriveThoughtHint splits subject/description", () => {
    assert.deepEqual(acpGenericTest.deriveThoughtHint("Analyzing repo"), { subject: "Analyzing repo", description: "" });
    assert.deepEqual(acpGenericTest.deriveThoughtHint("Step one\nlook up files"), { subject: "Step one", description: "look up files" });
    assert.equal(acpGenericTest.deriveThoughtHint(""), null);
    assert.equal(acpGenericTest.deriveThoughtHint("   "), null);
    const long = "x".repeat(120);
    const hint = acpGenericTest.deriveThoughtHint(long);
    assert.equal(hint.subject.length, 80);
    assert.equal(hint.description.length, 40);
  });

  it("normalizes Codex ACP model ids to modelId effort syntax", () => {
    assert.equal(acpGenericTest.normalizeModelId("codex", "gpt-5.5"), "gpt-5.5[medium]");
    assert.equal(acpGenericTest.normalizeModelId("codex", "gpt-5.5[low]"), "gpt-5.5[low]");
    assert.equal(acpGenericTest.normalizeModelId("hermes", "ark/model"), "ark:model");
    assert.equal(acpGenericTest.codexModeForApprovalMode("ask"), "agent");
    assert.equal(acpGenericTest.codexModeForApprovalMode("auto"), "agent-full-access");
    assert.equal(acpGenericTest.codexModeForApprovalMode("read-only-auto"), "read-only");
    assert.equal(acpGenericTest.supportsSessionSetModel("codex"), true);
    assert.equal(acpGenericTest.supportsSessionSetModel("hermes"), true);
    assert.equal(acpGenericTest.supportsSessionSetModel("claude"), false);
  });

  it("normalizes Codex thought stream + inline reasoning + plan into merged UI messages", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
      const events = [];
      const adapter = acpGenericTest.createGenericAcpAdapterForTest({ appendEvent: (event) => events.push(event), registerCancel: () => undefined });
      const result = await adapter.sendMessage({
        workspaceRoot,
        prompt: "plan-and-think",
        approvalMode: "ask",
        agent: {
          id: "codex",
          name: "Codex CLI",
          provider: "codex",
          executablePath: process.execPath,
          customArgs: [fixture, "--emit-thought-stream", "--emit-reasoning-inline", "--emit-plan-update"],
          managedAcpTool: { id: "codex-cli-test" },
        },
      });
      assert.match(result.output, /Fake response to: plan-and-think/);
      // Assistant text must not carry the inline "inline-thought" reasoning fragment.
      assert.equal(result.output.includes("inline-thought"), false);

      const thinkingEvents = events.filter((event) => event.type === "thinking");
      // 2 thought chunks (step-a, step-b) + inline reasoning (inline-thought) + done boundary(ies).
      assert.ok(thinkingEvents.length >= 3, `expected >=3 thinking events, got ${thinkingEvents.length}`);
      assert.ok(thinkingEvents.some((event) => event.text.trim() === "step-a"));
      assert.ok(thinkingEvents.some((event) => event.text === "step-b"));
      assert.ok(thinkingEvents.some((event) => event.text.trim() === "inline-thought"));
      assert.ok(thinkingEvents.some((event) => event.status === "done"));
      // All thinking chunk events carry durationMs (>= 0) and startedAt.
      for (const event of thinkingEvents) {
        assert.equal(typeof event.durationMs, "number");
        assert.equal(typeof event.startedAt, "number");
      }

      const planEvents = events.filter((event) => event.type === "plan");
      assert.equal(planEvents.length, 1);

      const messages = runEventsToConversationMessages(events);
      const thinkingMessages = messages.filter((m) => m.type === "thinking");
      // Renderer/backend converter must merge chunks by msgId. Two distinct
      // msgIds (thought-1 for the streamed thought pair, m-inline for the
      // inline reasoning) means at most 2 cards, plus optionally one for the
      // unnamed done-boundary if it lands separately.
      const uniqueMsgIds = new Set(thinkingMessages.map((m) => m.msgId || "__none__"));
      assert.ok(uniqueMsgIds.size <= 3, `expected <=3 unique msgId groups, got ${uniqueMsgIds.size}`);
      const merged = thinkingMessages.find((m) => m.msgId === "thought-1");
      assert.ok(merged, "expected merged thinking message for msgId=thought-1");

      assert.match(merged.text, /step-astep-b|step-a step-b/);
      assert.equal(merged.status, "done");
      assert.equal(typeof merged.durationMs, "number");

      const planMessages = messages.filter((m) => m.type === "plan");
      assert.equal(planMessages.length, 1);
      assert.equal(planMessages[0].entries.length, 2);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("does not call session/set_model for Claude ACP providers", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
      const events = [];
      const adapter = acpGenericTest.createGenericAcpAdapterForTest({ appendEvent: (event) => events.push(event), registerCancel: () => undefined });
      const result = await adapter.sendMessage({
        workspaceRoot,
        prompt: "hello-acp",
        model: "claude-sonnet-test",
        approvalMode: "ask",
        agent: { id: "claude", name: "Claude Code", provider: "claude", executablePath: process.execPath, customArgs: [fixture, "--no-set-model"], managedAcpTool: { id: "claude-agent-acp-test" } },
      });

      assert.equal(result.output, "Fake response to: hello-acp");
      assert.match(result.command, /model=claude-sonnet-test/);
      assert.equal(events.some((event) => event.type === "error" && /set_model failed/i.test(event.text)), false);
      assert.equal(events.some((event) => event.type === "status" && /set_model skipped/i.test(event.text)), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("preserves Claude ACP assistant output when a later tool update reports user refusal", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
      const events = [];
      const adapter = acpGenericTest.createGenericAcpAdapterForTest({ appendEvent: (event) => events.push(event), registerCancel: () => undefined });
      const result = await adapter.sendMessage({
        workspaceRoot,
        prompt: "hello-after-refusal",
        model: "claude-sonnet-test",
        approvalMode: "ask",
        agent: { id: "claude", name: "Claude Code", provider: "claude", executablePath: process.execPath, customArgs: [fixture, "--no-set-model", "--fail-tool-after-assistant"], managedAcpTool: { id: "claude-agent-acp-test" } },
      });

      assert.equal(result.output, "Fake response to: hello-after-refusal");
      assert.equal(events.some((event) => event.type === "tool" && /User refused permission to run tool/.test(String(event.text ?? ""))), true);
      assert.equal(events.some((event) => event.type === "status" && /preserving the assistant response/.test(String(event.text ?? ""))), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("marks Codex ACP runs with non-clean stop reasons as incomplete warning (not failure)", () => {
    assert.equal(acpGenericTest.acpPromptStopReason({ stopReason: "max_tokens" }), "max_tokens");
    const result = acpGenericTest.assertAcpPromptCompleted("codex", { stopReason: "max_tokens" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "acp_incomplete_output");
    assert.match(result.message, /stopReason=max_tokens/);
  });

  it("does not guess truncation from Markdown shape when the ACP stop reason is clean", () => {
    // A clean stopReason means
    // complete, even if the assistant text ends on a bold heading.
    const result = acpGenericTest.assertAcpPromptCompleted("codex", { stopReason: "end_turn" });
    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "end_turn");
  });

  it("reports non-clean stop reasons as incomplete regardless of text shape", () => {
    const complete = acpGenericTest.assertAcpPromptCompleted("codex", { stopReason: "max_tokens" });
    assert.equal(complete.ok, false);
    assert.equal(complete.code, "acp_incomplete_output");
    assert.equal(complete.stopReason, "max_tokens");
  });

  it("does not auto-continue a truncated Codex ACP turn; shows it as-is with a warning", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
      const events = [];
      const adapter = acpGenericTest.createGenericAcpAdapterForTest({ appendEvent: (event) => events.push(event), registerCancel: () => undefined });
      const result = await adapter.sendMessage({
        workspaceRoot,
        prompt: "research-ai-hotspots",
        model: "gpt-test[medium]",
        approvalMode: "ask",
        agent: { id: "codex", name: "Codex", provider: "codex", executablePath: process.execPath, customArgs: [fixture, "--truncated-reply", "--max-tokens-stop"], managedAcpTool: { id: "codex-acp-test" } },
      });

      // The single truncated turn is preserved verbatim — no continuation prompt.
      assert.equal(result.output, "**3. AI 对就业影响成为主流议题**");
      assert.equal(result.truncated, true);
      assert.equal(result.stopReason, "max_tokens");
      assert.equal(result.metadata.truncated, true);
      // Exactly one turn (two chunks from the fake CLI), no continuation turn.
      assert.equal(events.filter((event) => event.type === "assistant_chunk").length, 2);
      assert.equal(events.some((event) => event.type === "status" && /requesting continuation/.test(String(event.text ?? ""))), false);
      assert.equal(events.some((event) => event.type === "status" && /did not finish cleanly/.test(String(event.text ?? ""))), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("does not implicitly resume stored Codex ACP sessions and quarantines interrupted failures", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      assert.equal(acpGenericTest.shouldResumeProviderSession("codex", {}, { sessionId: "stored" }), false);
      assert.equal(acpGenericTest.shouldResumeProviderSession("codex", { resumeKey: "chosen" }, { sessionId: "stored" }), true);
      assert.equal(acpGenericTest.shouldResumeProviderSession("codex", { resumeKey: "chosen" }, { sessionId: "stored", health: "unhealthy" }), false);
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("codex"),
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({ type: "assistant_chunk", text: "partial" });
              /** @type {Error & { code?: string }} */
              const error = new Error("codex ACP conversation interrupted. tool_call_update failed");
              error.code = "acp_bridge_interrupted";
              throw error;
            },
            cancel: async () => undefined,
          }),
        },
      });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "research", agent: { provider: "codex" } });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "failed");
      assert.equal(final.errorInfo.code, "acp_bridge_interrupted_after_retry");
      assert.match(final.debugSummary ?? "", /errorCode=acp_bridge_interrupted_after_retry/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("retries Codex ACP bridge interruptions once with a clean session", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      let calls = 0;
      const seenSessionIds = [];
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("codex"),
        adapters: {
          codex: () => ({
            sendMessage: async (ctx) => {
              calls += 1;
              seenSessionIds.push(ctx.providerSessionId ?? ctx.resumeKey ?? null);
              if (calls === 1) {
                /** @type {Error & { code?: string }} */
                const error = new Error("codex ACP conversation interrupted. tool_call_update failed");
                error.code = "acp_bridge_interrupted";
                throw error;
              }
              return {
                output: "recovered",
                command: "fake-codex-acp",
                connectionMode: "Codex ACP session",
                providerSessionId: "fresh-session",
                resumeKey: "fresh-session",
              };
            },
            cancel: async () => undefined,
          }),
        },
      });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "research", agent: { provider: "codex" } });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "completed");
      assert.equal(final.output, "recovered");
      assert.equal(calls, 2);
      assert.deepEqual(seenSessionIds, [null, null]);
      assert.equal(final.events.some((event) => /retrying once with a clean session/.test(String(event.text ?? ""))), true);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("classifies Codex ACP model, mode, interruption, and sandbox failures", () => {
    const runtime = createPersonalAgentRuntime({ legacy: makeFakeLegacy("codex") });
    assert.equal(runtime.classifyErrorForTest(new Error("session/set_model failed: Expected: modelId[effort].")).code, "codex_acp_model_format");
    assert.equal(runtime.classifyErrorForTest(new Error("codex ACP set_mode failed: modeId invalid")).code, "codex_acp_mode_failed");
    assert.equal(runtime.classifyErrorForTest(new Error("acp_bridge_interrupted_after_retry")).code, "acp_bridge_interrupted_after_retry");
    assert.equal(runtime.classifyErrorForTest(new Error("curl: (6) Could not resolve host: example.com")).code, "sandbox_or_network_refusal");
  });

  it("classifies send failures with ownership and resolution diagnostics", () => {
    const runtime = createPersonalAgentRuntime({ legacy: makeFakeLegacy("opencode") });
    const missing = runtime.classifyErrorForTest(new Error("spawn opencode ENOENT command not found"));
    assert.equal(missing.code, "missing_binary");
    assert.equal(runtime.buildErrorTipForTest(missing).ownership, "agent");
    const auth = runtime.classifyErrorForTest(new Error("401 unauthorized api key login required"));
    assert.equal(auth.code, "auth_required");
    assert.equal(runtime.buildErrorTipForTest(auth).resolution.kind, "authenticate");
    const provider = runtime.classifyErrorForTest(new Error("provider returned 502 Bad Gateway"));
    assert.equal(provider.code, "provider_failed");
    assert.equal(runtime.buildErrorTipForTest(provider).ownership, "provider");
    const timeout = runtime.classifyErrorForTest(new Error("request timed out after 30000ms"));
    assert.equal(timeout.code, "timeout");
    assert.equal(runtime.buildErrorTipForTest(timeout).resolution.kind, "retry");
  });

  it("runs remote ACP agents over WebSocket", async () => {
    const workspaceRoot = await tempWorkspace();
    const server = await withTinyWebSocketServer((message) => {
      if (message.method === "initialize") return { capabilities: { remote: true } };
      if (message.method === "session/new") return { sessionId: "remote-session" };
      if (message.method === "session/prompt") return { sessionId: "remote-session", output: "remote:" + message.params.prompt };
      return {};
    });
    try {
      const runtime = createPersonalAgentRuntime({ legacy: makeFakeLegacy("remote") });
      const started = await runtime.startMessage({ workspaceRoot, prompt: "ping", agent: { provider: "remote", remote: { url: server.url } } });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "completed");
      assert.equal(final.output, "remote:ping");
      assert.equal(final.connectionMode, "Remote ACP WebSocket session");
    } finally {
      await server.close();
      await cleanup(workspaceRoot);
    }
  });

  it("checks provider health and managed agent health by id", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("opencode"),
        adapters: { opencode: () => ({ sendMessage: async () => ({ output: "ok", command: "opencode acp", connectionMode: "OpenCode ACP session" }) }) },
      });
      const direct = await runtime.checkProviderHealth({ workspaceRoot, agent: { provider: "opencode" } });
      assert.equal(direct.healthy, true);
      const managed = await runtime.checkManagedAgentHealthById({ workspaceRoot, id: "opencode" });
      assert.equal(managed.healthy, true);
      const missing = await runtime.checkManagedAgentHealthById({ workspaceRoot, id: "missing" });
      assert.equal(missing.healthy, false);
      assert.equal(missing.status, "missing");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("injects all ACP E2E stream update kinds", () => {
    const events = [];
    const injector = new AcpE2EStreamInjector({ appendEvent: (event) => appendContractEvent(events, event) });
    injector.emitAll();
    const messages = runEventsToConversationMessages(events);
    const types = new Set(messages.map((message) => message.type));
    assert.equal(types.has("plan"), true);
    assert.equal(types.has("thinking"), true);
    assert.equal(types.has("tool_group"), true);
    assert.equal(types.has("tips"), true);
    assert.equal(types.has("context_usage"), true);
    assert.equal(types.has("available_commands"), true);
  });

  it("bounds large ACP terminal deltas before persisting run events", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: makeFakeLegacy("codex"),
        adapters: {
          codex: ({ appendEvent }) => ({
            sendMessage: async () => {
              appendEvent({
                type: "acp_tool_call",
                text: "x".repeat(12_000),
                update: {
                  tool_call_id: "tool-large-output",
                  status: "in_progress",
                  title: "Bash",
                  _meta: { terminal_output_delta: { data: "y".repeat(12_000), terminal_id: "tool-large-output" } },
                },
              });
              return { output: "done", command: "codex acp", connectionMode: "Codex ACP session" };
            },
          }),
        },
      });
      const final = await runtime.runMessage({ workspaceRoot, prompt: "large terminal output", agent: { provider: "codex", id: "codex" } });
      const event = final.events.find((item) => item.type === "acp_tool_call");
      assert.ok(event);
      assert.equal(Object.prototype.hasOwnProperty.call(event, "data"), false);
      assert.equal(event.truncated, true);
      assert.ok(event.text.length < 4_100);
      assert.equal(event.update._meta.terminal_output_delta.truncated, true);
      assert.ok(event.update._meta.terminal_output_delta.data.length < 4_100);
    } finally {
      await cleanup(workspaceRoot);
    }
  });
});

async function waitForRun(runtime, runId) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = runtime.getRun(runId);
    if (snapshot.status !== "running") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function waitForPendingApproval(runtime, input) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const snapshot = runtime.getRun(input);
    if (snapshot.pendingApprovals?.length) return snapshot;
    if (snapshot.status !== "running") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return runtime.getRun(input);
}

async function waitForFileText(filePath) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return await readFile(filePath, "utf8");
}
