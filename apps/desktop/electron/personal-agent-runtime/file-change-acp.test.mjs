// HR2-A-02 regression: runtime must convert ACP `acp_tool_call` updates whose
// kind is `edit` and whose rawInput/locations point at an existing absolute
// path into an entry on `run.fileChanges`. Free-text mentions must not create
// artifacts (HR2-A-01) even when the tool call succeeds.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPersonalAgentRuntime } from "./index.mjs";

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "oma-hr2a-"));
}

async function waitForRun(runtime, runId) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snap = runtime.getRun(runId);
    if (snap.status !== "running") return snap;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not finish`);
}

describe("HR2-A-02 acp_tool_call file change ingestion", () => {
  it("records an edit-kind tool_call whose rawInput.file_path exists on disk", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const target = path.join(workspaceRoot, "hr2a-scratch.txt");
      await writeFile(target, "hello", "utf8");

      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "claude", name: "Claude", provider: "claude", executablePath: "claude", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "claude", provider: "claude", status: "online" }),
          start: async () => ({}),
          run: async () => ({}),
          status: () => ({}),
          cancel: () => ({}),
        },
        adapters: {
          claude: ({ appendEvent }) => ({
            sendMessage: async () => {
              // Assistant mentions two other filenames in prose; these must
              // NOT surface as artifacts because HR2-A-01 removed text mining.
              appendEvent({ type: "assistant_chunk", text: "I will write hr2a-scratch.txt (see notes.md and README.md)." });
              // Real ACP tool_call_update carrying the structured payload
              // Claude/Codex-ACP send when the Write/apply_patch tool runs.
              appendEvent({
                type: "acp_tool_call",
                text: "Write",
                update: {
                  toolCallId: "tc-1",
                  sessionUpdate: "tool_call_update",
                  status: "completed",
                  kind: "edit",
                  title: `Write ${target}`,
                  rawInput: { file_path: target, content: "hello" },
                  content: [{ type: "diff", path: target, diff: "+hello\n" }],
                  locations: [{ path: target }],
                  _meta: { claudeCode: { toolName: "Write" } },
                },
              });
              return { output: "done", command: "fake claude", connectionMode: "Claude Code ACP session" };
            },
          }),
        },
      });

      const created = await runtime.createConversation({ workspaceRoot, agent: { provider: "claude" }, title: "hr2-a-02" });
      const started = await runtime.startMessage({
        workspaceRoot,
        agent: { provider: "claude" },
        conversationId: created.conversation.id,
        prompt: "write the file",
      });
      const final = await waitForRun(runtime, started.runId);

      assert.equal(final.status, "completed");
      // HR2-A-01: no text-mined artifacts even when prose mentions filenames.
      assert.deepEqual(final.artifacts ?? [], []);
      // HR2-A-02: one file change with parsed file name and absolute path.
      assert.equal(final.fileChanges?.length ?? 0, 1, "expected one file change");
      const [change] = final.fileChanges;
      assert.equal(change.fileName, "hr2a-scratch.txt");
      assert.equal(change.filePath, target);
      assert.equal(change.tool, "write");
      assert.equal(change.toolCallId, "tc-1");
      assert.ok(typeof change.id === "string" && change.id.length > 0);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("ignores non-edit kinds and non-existent paths", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "claude", name: "Claude", provider: "claude", executablePath: "claude", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "claude", provider: "claude", status: "online" }),
          start: async () => ({}), run: async () => ({}), status: () => ({}), cancel: () => ({}),
        },
        adapters: {
          claude: ({ appendEvent }) => ({
            sendMessage: async () => {
              // execute-kind tool_call (shell command) must not surface as file change.
              appendEvent({
                type: "acp_tool_call", text: "Bash",
                update: {
                  toolCallId: "tc-2", status: "completed", kind: "execute",
                  title: "Bash ls", rawInput: { command: "ls" }, locations: [],
                },
              });
              // edit-kind but path does not exist on disk.
              appendEvent({
                type: "acp_tool_call", text: "Write",
                update: {
                  toolCallId: "tc-3", status: "completed", kind: "edit",
                  title: "Write /tmp/does-not-exist-hr2a.txt",
                  rawInput: { file_path: "/tmp/does-not-exist-hr2a.txt", content: "x" },
                  locations: [{ path: "/tmp/does-not-exist-hr2a.txt" }],
                  _meta: { claudeCode: { toolName: "Write" } },
                },
              });
              return { output: "done", command: "fake claude", connectionMode: "Claude Code ACP session" };
            },
          }),
        },
      });

      const created = await runtime.createConversation({ workspaceRoot, agent: { provider: "claude" }, title: "hr2-a-02-neg" });
      const started = await runtime.startMessage({
        workspaceRoot, agent: { provider: "claude" }, conversationId: created.conversation.id, prompt: "run",
      });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "completed");
      assert.deepEqual(final.fileChanges ?? [], []);
      assert.deepEqual(final.artifacts ?? [], []);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("aggregates Claude Code split updates: pending -> path -> toolResponse -> completed", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const os = (await import("node:os")).default;
    const pathMod = (await import("node:path")).default;
    const workspaceRoot = await mkdtemp(pathMod.join(os.tmpdir(), "oma-hr2a-split-"));
    try {
      const target = pathMod.join(workspaceRoot, "hr2a-split.txt");
      await writeFile(target, "hello", "utf8");

      const runtime = createPersonalAgentRuntime({
        legacy: {
          listAgents: async () => ({ agents: [] }),
          normalizeAgent: async (input) => ({ id: "claude", name: "Claude", provider: "claude", executablePath: "claude", ...input }),
          detectAgent: async (agent) => ({ ...agent, id: "claude", provider: "claude", status: "online" }),
          start: async () => ({}), run: async () => ({}), status: () => ({}), cancel: () => ({}),
        },
        adapters: {
          claude: ({ appendEvent }) => ({
            sendMessage: async () => {
              const toolCallId = "tc-split-1";
              // Update 1: pending, no path, no toolName yet.
              appendEvent({
                type: "acp_tool_call", text: "Write",
                update: { toolCallId, status: "pending", kind: "edit", title: "Write", rawInput: {}, locations: [], content: [], _meta: { claudeCode: { toolName: "Write" } } },
              });
              // Update 2: path arrives, still no status field.
              appendEvent({
                type: "acp_tool_call", text: "Write",
                update: {
                  toolCallId, kind: "edit", title: `Write ${target}`,
                  rawInput: { file_path: target, content: "hello" },
                  locations: [{ path: target }],
                  content: [{ type: "diff", path: target, diff: "+hello\n" }],
                  _meta: { claudeCode: { toolName: "Write" } },
                },
              });
              // Update 3: toolResponse embedded in _meta, still no status.
              appendEvent({
                type: "acp_tool_call", text: "Write",
                update: {
                  toolCallId,
                  _meta: { claudeCode: { toolName: "Write", toolResponse: { type: "create", filePath: target, content: "hello", structuredPatch: [] } } },
                },
              });
              // Update 4: status=completed, no path info.
              appendEvent({
                type: "acp_tool_call", text: "Write",
                update: { toolCallId, status: "completed", _meta: { claudeCode: { toolName: "Write" } } },
              });
              return { output: "done", command: "fake claude", connectionMode: "Claude Code ACP session" };
            },
          }),
        },
      });

      const created = await runtime.createConversation({ workspaceRoot, agent: { provider: "claude" }, title: "hr2-a-02-split" });
      const started = await runtime.startMessage({
        workspaceRoot, agent: { provider: "claude" }, conversationId: created.conversation.id, prompt: "write",
      });
      const final = await waitForRun(runtime, started.runId);
      assert.equal(final.status, "completed");
      assert.equal(final.fileChanges?.length ?? 0, 1);
      const [ch] = final.fileChanges;
      assert.equal(ch.filePath, target);
      assert.equal(ch.fileName, "hr2a-split.txt");
      assert.equal(ch.tool, "write");
      assert.equal(ch.toolCallId, "tc-split-1");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
