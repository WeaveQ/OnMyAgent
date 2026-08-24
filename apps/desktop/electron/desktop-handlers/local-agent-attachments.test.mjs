import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES } from "@onmyagent/types/desktop-ipc";
import {
  createLocalAgentsDomainHandlers,
  LOCAL_AGENT_ATTACHMENT_MAX_AGE_MS,
  LOCAL_AGENT_ATTACHMENT_MAX_FILES,
} from "./local-agents.mjs";

test("Local Agent attachment bridge bounds payloads and prunes retained files", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "onmyagent-attachment-test-"));
  try {
    const handlers = createLocalAgentsDomainHandlers({
      app: { getPath: () => userData },
    });
    const save = (input) => handlers.localAgentComposerSaveAttachment(null, [input]);
    const payload = Buffer.from("bounded attachment");
    const saved = await save({
      workspaceRoot: "/workspace",
      name: "note.txt",
      size: payload.length,
      dataUrl: `data:text/plain;base64,${payload.toString("base64")}`,
    });
    assert.equal(await readFile(saved.path, "utf8"), "bounded attachment");
    const empty = await save({
      workspaceRoot: "/workspace",
      name: "empty.txt",
      size: 0,
      dataUrl: "data:text/plain;base64,",
    });
    assert.equal((await readFile(empty.path)).length, 0);

    await assert.rejects(
      save({
        workspaceRoot: "/workspace",
        name: "too-large.bin",
        size: LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES + 1,
        dataUrl: "data:application/octet-stream;base64,YQ==",
      }),
      /attachment exceeds/,
    );
    await assert.rejects(
      save({
        workspaceRoot: "/workspace",
        name: "mismatch.bin",
        size: 2,
        dataUrl: "data:application/octet-stream;base64,YQ==",
      }),
      /size does not match/,
    );

    const attachmentDir = path.dirname(saved.path);
    for (let index = 0; index < LOCAL_AGENT_ATTACHMENT_MAX_FILES; index += 1) {
      await writeFile(path.join(attachmentDir, `retained-${index}.txt`), "x", "utf8");
    }
    const stalePath = path.join(attachmentDir, "stale.txt");
    await writeFile(stalePath, "old", "utf8");
    const staleAt = new Date(Date.now() - LOCAL_AGENT_ATTACHMENT_MAX_AGE_MS - 1_000);
    await utimes(stalePath, staleAt, staleAt);
    await save({
      workspaceRoot: "/workspace",
      name: "latest.txt",
      size: 1,
      dataUrl: "data:text/plain;base64,eA==",
    });
    assert.ok((await readdir(attachmentDir)).length <= LOCAL_AGENT_ATTACHMENT_MAX_FILES);
    await assert.rejects(access(stalePath));
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("Local Agent mention picker excludes hidden files except .env.example", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-mention-test-"));
  try {
    await Promise.all([
      writeFile(path.join(workspaceRoot, ".env"), "SECRET=hidden", "utf8"),
      writeFile(path.join(workspaceRoot, ".secret"), "hidden", "utf8"),
      writeFile(path.join(workspaceRoot, ".env.example"), "SAFE=example", "utf8"),
      writeFile(path.join(workspaceRoot, "visible.txt"), "visible", "utf8"),
      mkdir(path.join(workspaceRoot, ".hidden")),
    ]);
    await writeFile(path.join(workspaceRoot, ".hidden", "nested.txt"), "hidden", "utf8");
    const handlers = createLocalAgentsDomainHandlers({ app: { getPath: () => os.tmpdir() } });

    const result = await handlers.localAgentComposerListFiles(null, [{ workspaceRoot }]);
    const paths = result.files.map((entry) => entry.relativePath);

    assert.ok(paths.includes(".env.example"));
    assert.ok(paths.includes("visible.txt"));
    assert.ok(!paths.includes(".env"));
    assert.ok(!paths.includes(".secret"));
    assert.ok(!paths.some((entry) => entry.startsWith(".hidden")));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Personal compatibility IPC commands share one start/cancel/approval owner", async () => {
  const calls = [];
  const relays = [];
  const runtime = {
    startMessage: async (input) => {
      calls.push(["start", input]);
      return { runId: `run-${calls.length}`, conversationId: "conversation-1" };
    },
    runMessage: async (input) => {
      calls.push(["run", input]);
      return { runId: "run-wait", conversationId: "conversation-1" };
    },
    cancelRun: async (runId) => {
      calls.push(["cancel", runId]);
      return { ok: true };
    },
    resolveApproval: async (input) => {
      calls.push(["approval", input]);
      return { ok: true };
    },
    acpSendMessage: async () => assert.fail("ACP alias bypassed canonical service"),
    acpCancel: async () => assert.fail("ACP cancel bypassed canonical service"),
    acpResolveApproval: async () => assert.fail("ACP approval bypassed canonical service"),
  };
  const handlers = createLocalAgentsDomainHandlers({
    personalAgentRuntime: runtime,
    channelInfrastructureApi: {
      relayStudioMessage: async (conversationId, prompt) => relays.push([conversationId, prompt]),
    },
    app: { getPath: () => os.tmpdir() },
  });
  const invoke = (name, input) => handlers[name](null, [input]);

  await invoke("personalLocalAgentAcpSend", { prompt: "from acp" });
  await invoke("personalLocalAgentStart", { prompt: "from legacy" });
  await invoke("personalLocalAgentRun", { prompt: "wait" });
  await invoke("personalLocalAgentAcpCancel", { runId: "run-1" });
  await invoke("personalLocalAgentCancel", "run-2");
  await invoke("personalLocalAgentAcpResolveApproval", { approvalId: "approval-1" });
  await invoke("personalLocalAgentResolveApproval", { approvalId: "approval-2" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.map(([kind]) => kind), [
    "start",
    "start",
    "run",
    "cancel",
    "cancel",
    "approval",
    "approval",
  ]);
  assert.deepEqual(relays, [
    ["conversation-1", "from acp"],
    ["conversation-1", "from legacy"],
    ["conversation-1", "wait"],
  ]);
});
