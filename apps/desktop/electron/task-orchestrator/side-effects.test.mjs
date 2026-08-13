import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { taskOrchestratorSideEffectSchema } from "../../../../packages/types/src/task-orchestrator.ts";

import {
  classifySideEffect,
  createSideEffectController,
  unsafeUnknownSideEffects,
  untrustedObservedSideEffects,
} from "./side-effects.mjs";

function harness() {
  let timestamp = 100;
  let sequence = 0;
  const attempt = {
    id: "primary-1",
    turnId: null,
    leaseId: "lease-1",
  };
  const run = {
    id: "run-1",
    status: "running",
    updatedAt: timestamp,
    primaryAttempts: [attempt],
    workerAttempts: [],
    sideEffects: [],
  };
  const writes = [];
  const controller = createSideEffectController({
    store: {
      requireRun: async () => run,
      writeRun: async (value) => {
        writes.push(structuredClone(value));
        return value;
      },
    },
    serialized: async (operation) => operation(),
    now: () => ++timestamp,
    createId: (prefix) => `${prefix}-${++sequence}`,
  });
  return { attempt, controller, run, writes };
}

function writeOperation(toolCallId = "tool-write-1") {
  return {
    toolCallId,
    operation: "Write proof.txt",
    kind: "execute",
    input: { command: "printf proof > proof.txt" },
  };
}

function terminalSnapshot(toolCallId = "tool-write-1", status = "completed") {
  return {
    status: status === "completed" ? "completed" : "failed",
    events: [{
      type: "tool",
      at: 150,
      toolCall: {
        id: toolCallId,
        name: "Bash",
        kind: "execute",
        status,
        input: "printf proof > proof.txt",
        output: status === "completed" ? "done" : "",
      },
    }],
  };
}

describe("Task Center side-effect intent provenance", () => {
  it("does not treat durable Task MCP controls or a bounded read-only find as external side effects", async () => {
    assert.equal(classifySideEffect({
      operation: "mcp.onmyagent-task-control.get_task_state",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "mcp.onmyagent-task-control.spawn_agent",
      kind: "execute",
      input: '{"server":"onmyagent-task-control"}',
    }), "read-only");
    const safeFind = {
      operation: "find /workspace /reference -maxdepth 2 \\( -name AGENTS.md -o -name CLAUDE.md \\) -print 2>/dev/null",
      kind: "execute",
      input: "",
    };
    assert.equal(classifySideEffect(safeFind), "read-only");
    assert.equal(classifySideEffect({ ...safeFind, operation: "find /workspace -delete" }), "non-idempotent");
    assert.equal(classifySideEffect({ ...safeFind, operation: "find /workspace -exec sh -c 'touch changed' \\;" }), "non-idempotent");
    assert.equal(classifySideEffect({ ...safeFind, operation: "find /workspace -print > inventory.txt" }), "non-idempotent");

    const actualReadScript = [
      "sed -n '1,320p' /workspace/AGENTS.md",
      "sed -n '1,220p' /workspace/.loop/ACTIVE.md",
      "if [ -f /workspace/docs/PROGRESS.md ]; then sed -n '1,100p' /workspace/docs/PROGRESS.md; fi",
    ].join("\n");
    assert.equal(classifySideEffect({
      operation: actualReadScript.slice(0, 240),
      kind: "execute",
      input: JSON.stringify({ command: actualReadScript, cwd: "/workspace" }),
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: `/bin/zsh -lc "${actualReadScript}"`.slice(0, 240),
      kind: "execute",
      input: JSON.stringify({ command: `/bin/zsh -lc "${actualReadScript}"`, cwd: "/workspace" }),
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "/bin/zsh -lc \"sed -n '1,20p' AGENTS.md; rg -n \\\"task|run\\\" README.md | head -80\"",
      kind: "execute",
      input: "",
    }), "read-only");
    const realQuotedCronInspection = `/bin/zsh -lc "rg -n '"'^class CronJob|''^class CronService|def add_job|def _save|def _load|def _execute|def _run|_running_tasks|persistent_session|auto_paused|record_failure|_arm_timer|compute_next_run'"' src/kiro_crew/cron.py | head -260; nl -ba src/kiro_crew/cron.py | sed -n '80,260p'; nl -ba src/kiro_crew/cron.py | sed -n '430,720p'; nl -ba src/kiro_crew/cron.py | sed -n '900,1210p'"`;
    assert.equal(classifySideEffect({
      operation: realQuotedCronInspection.slice(0, 240),
      kind: "execute",
      input: JSON.stringify({ command: realQuotedCronInspection, cwd: "/Users/huangchunan/KiroCrew" }),
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "Search for 'writeAutomationStore|rename|abort|cancel|delete' in automations.ts",
      kind: "search",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "printf '%s\\n' '### files'; rg --files /workspace | rg '(task|queue)' | head -260",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "echo '--- branch ---'; git -C /Users/huangchunan/KiroCrew branch -a 2>&1 | head -30",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "cd /workspace && (git rev-parse --git-dir 2>&1); (git branch -a 2>&1 | head -20); (git log --oneline -5 2>&1)",
      kind: "execute",
      input: "",
    }), "read-only");
    const realReadOnlyInventory = "for p in /reference /workspace; do echo $p; find $p -maxdepth 2 -type f | sed \"s#^$p/##\" | sort | head -120; done";
    assert.equal(classifySideEffect({
      operation: realReadOnlyInventory,
      kind: "execute",
      input: JSON.stringify({ command: realReadOnlyInventory, cwd: "/workspace" }),
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "for repo in /reference /workspace; do echo REPO $repo; git -C $repo rev-parse --show-toplevel; git -C $repo status --short --branch; find $repo -maxdepth 2 -name AGENTS.md -print; done",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "echo ROOTS; ls -d /reference /workspace 2>&1; echo ---; ls /workspace 2>&1 | head -40",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({ operation: "cat /tmp/write", kind: "execute", input: "" }), "read-only");
    assert.equal(classifySideEffect({ operation: "xxd /workspace/proof.txt", kind: "execute", input: "" }), "read-only");
    assert.equal(classifySideEffect({
      operation: "cmp /workspace/proof.txt <(printf 'expected\\n') && echo exact",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({
      operation: "\"nl -ba /Users/huangchunan/KiroCrew/src/kiro_crew/cron.py | sed -n '201,370p;519,760p;760,1040p' && nl -ba /Users/huangchunan/KiroCrew/src/kiro_crew/heartbeat.py | sed -n '1,340p'\"",
      kind: "execute",
      input: "",
    }), "read-only");
    assert.equal(classifySideEffect({ operation: "rm /tmp/read", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "sed -i '' 's/a/b/' file", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "sed -n '1p;w changed.txt' file", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "sed 's/a/b/w changed.txt' file", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "git branch -D old-branch", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "git branch -m renamed", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "(git status); (rm changed.txt)", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "git status && rm -rf build", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "echo $(touch changed)", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "/bin/zsh -lc \"git status; touch changed\"", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "rg pattern | tee inventory.txt", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "xxd input.bin output.hex", kind: "execute", input: "" }), "non-idempotent");
    assert.equal(classifySideEffect({ operation: "cmp safe.txt <(touch changed.txt)", kind: "execute", input: "" }), "non-idempotent");
    const checkerReadOnlyVerification = [
      "actual_sha=\"$(shasum -a 256 proof.txt | cut -d ' ' -f 1)\"",
      "entry_count=\"$(find . -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')\"",
      "test \"$actual_sha\" = expected",
      "test \"$entry_count\" = 1",
    ].join("; ");
    assert.equal(classifySideEffect({
      operation: checkerReadOnlyVerification.slice(0, 240),
      kind: "execute",
      input: JSON.stringify({ command: checkerReadOnlyVerification, cwd: "/workspace" }),
    }), "read-only");
    const realCheckerInspection = "find . -mindepth 1 -maxdepth 1 -print && stat -f 'type=%HT mode=%Sp size=%z' ./proof.txt && if test -L ./proof.txt; then echo symlink=yes; else echo symlink=no; fi && hexdump -C ./proof.txt && shasum -a 256 ./proof.txt";
    assert.equal(classifySideEffect({
      operation: realCheckerInspection.slice(0, 240),
      kind: "execute",
      input: JSON.stringify({ command: realCheckerInspection, cwd: "/workspace" }),
    }), "read-only");
    const realWorkerInspection = "cd /workspace && expected='ONMYAGENT_TASK_CENTER_POST_FIX_LIVE_OK'; bytes=$(wc -c < proof.txt | tr -d ' '); printf 'BYTE_COUNT=%s\\n' \"$bytes\"; test \"$bytes\" -eq 39; head -c 38 proof.txt | grep -qx \"$expected\"; tail -c 1 proof.txt | hexdump -C";
    assert.equal(classifySideEffect({
      operation: realWorkerInspection.slice(0, 240),
      kind: "execute",
      input: JSON.stringify({ command: realWorkerInspection, cwd: "/workspace" }),
    }), "read-only");
    assert.equal(classifySideEffect({ operation: "echo $(touch changed)", kind: "execute", input: "" }), "non-idempotent");

    const { attempt, controller, run } = harness();
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, {
      status: "completed",
      events: [{
        type: "tool",
        at: 150,
        toolCall: {
          id: "tool-find",
          name: safeFind.operation,
          kind: "execute",
          status: "completed",
          input: "",
          output: "AGENTS.md",
        },
      }],
    });
    assert.equal(run.sideEffects[0]?.idempotency, "read-only");
    assert.deepEqual(untrustedObservedSideEffects(run, [attempt.id]), []);

    const historicalRun = {
      sideEffects: [{
        id: "legacy-task-control",
        attemptId: attempt.id,
        toolCallId: "legacy-control-call",
        operation: "mcp.onmyagent-task-control.get_task_state",
        kind: "",
        input: "",
        idempotency: "non-idempotent",
        intentSource: "pre-execute",
        receiptStatus: "unknown",
      }, {
        id: "legacy-real-write",
        attemptId: attempt.id,
        toolCallId: "legacy-write-call",
        operation: "shell command: printf changed > proof.txt",
        kind: "execute",
        input: "",
        idempotency: "non-idempotent",
        intentSource: "pre-execute",
        receiptStatus: "unknown",
      }, {
        id: "legacy-safe-find",
        attemptId: attempt.id,
        toolCallId: "legacy-find-call",
        operation: safeFind.operation,
        kind: "",
        input: "",
        idempotency: "non-idempotent",
        intentSource: "observed-terminal",
        receiptStatus: "completed",
      }],
    };
    assert.deepEqual(unsafeUnknownSideEffects(historicalRun).map((effect) => effect.id), ["legacy-real-write"]);
    assert.deepEqual(untrustedObservedSideEffects(historicalRun).map((effect) => effect.id), []);
  });

  it("ignores only the synthetic Task MCP startup diagnostic", async () => {
    const { attempt, controller, run } = harness();
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, {
      status: "running",
      events: [{
        type: "acp_tool_call",
        at: 125,
        update: {
          toolCallId: "mcp_startup.onmyagent-task-control",
          title: "mcp__onmyagent-task-control__startup",
          kind: "other",
          status: "failed",
          rawInput: null,
        },
      }],
    });
    assert.deepEqual(run.sideEffects, []);

    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, {
      status: "running",
      events: [{
        type: "acp_tool_call",
        at: 125,
        update: {
          toolCallId: "task-mcp-list-agents",
          title: "mcp.onmyagent-task-control.list_agents",
          kind: "execute",
          status: "in_progress",
          rawInput: { server: "onmyagent-task-control", tool: "list_agents", arguments: {} },
        },
      }, {
        type: "acp_tool_call",
        at: 126,
        update: {
          toolCallId: "task-mcp-list-agents",
          status: "in_progress",
        },
      }],
    });
    assert.deepEqual(run.sideEffects, []);

    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, {
      status: "running",
      events: [{
        type: "acp_tool_call",
        at: 126,
        update: {
          toolCallId: "mcp_startup.untrusted-server",
          title: "mcp__untrusted-server__startup",
          kind: "other",
          status: "failed",
          rawInput: null,
        },
      }],
    });
    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].toolCallId, "mcp_startup.untrusted-server");
    assert.equal(run.sideEffects[0].intentSource, "observed-terminal");
  });

  it("records blocking capability only through the pre-execute hook", async () => {
    const { attempt, controller, run, writes } = harness();
    const recorded = await controller.recordIntent("task-1", run.id, attempt.id, attempt.leaseId, writeOperation());

    assert.equal(recorded.recorded, true);
    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].intentSource, "pre-execute");
    assert.equal(run.sideEffects[0].receiptStatus, "unknown");
    assert.equal(writes.length, 1);

    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, terminalSnapshot());
    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].intentSource, "pre-execute");
    assert.equal(run.sideEffects[0].receiptStatus, "completed");
  });

  it("allows a pending ACP tool announcement to reach the blocking intent hook", async () => {
    const { attempt, controller, run } = harness();
    const pending = terminalSnapshot("tool-write-pending", "running");
    pending.status = "running";
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, pending);
    assert.deepEqual(run.sideEffects, []);

    await controller.recordIntent("task-1", run.id, attempt.id, attempt.leaseId, writeOperation("tool-write-pending"));
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, terminalSnapshot("tool-write-pending"));
    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].intentSource, "pre-execute");
    assert.equal(run.sideEffects[0].receiptStatus, "completed");
  });

  it("records the terminal receipt after the durable intent when a pending card arrived first", async () => {
    const { attempt, controller, run } = harness();
    const pending = terminalSnapshot("tool-write-order", "running");
    pending.status = "running";
    pending.events[0].at = 100;
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, pending);
    await controller.recordIntent("task-1", run.id, attempt.id, attempt.leaseId, writeOperation("tool-write-order"));
    const terminal = terminalSnapshot("tool-write-order");
    terminal.events[0].at = 150;
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, terminal);
    assert.equal(run.sideEffects[0].intentAt < run.sideEffects[0].receiptAt, true);
  });

  it("labels a terminal tool with no durable intent as observed-terminal", async () => {
    const { attempt, controller, run } = harness();
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, terminalSnapshot());

    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].intentSource, "observed-terminal");
    assert.equal(run.sideEffects[0].receiptStatus, "completed");
  });

  it("records a policy-declined tool as not-started without claiming an executed side effect", async () => {
    const { attempt, controller, run } = harness();
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, {
      status: "completed",
      events: [{
        type: "task_permission_decision",
        at: 149,
        toolCallId: "tool-denied",
        decision: "decline",
      }, {
        type: "tool",
        at: 150,
        toolCall: {
          id: "tool-denied",
          name: "Bash",
          kind: "execute",
          status: "failed",
          input: "printf proof > /tmp/denied",
          output: "User refused permission to run tool",
        },
      }],
    });
    assert.deepEqual(run.sideEffects.map((effect) => ({
      intentSource: effect.intentSource,
      receiptStatus: effect.receiptStatus,
      idempotency: effect.idempotency,
    })), [{ intentSource: "observed-terminal", receiptStatus: "not-started", idempotency: "non-idempotent" }]);
    assert.deepEqual(untrustedObservedSideEffects(run, [attempt.id]), []);
  });

  it("fails closed when a provider claims completion after the same tool was declined", async () => {
    const { attempt, controller, run } = harness();
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, {
      status: "completed",
      events: [{ type: "task_permission_decision", at: 149, toolCallId: "tool-bypass", decision: "decline" }, {
        type: "tool",
        at: 150,
        toolCall: { id: "tool-bypass", name: "Bash", kind: "execute", status: "completed", input: "touch changed", output: "done" },
      }],
    });
    assert.equal(run.sideEffects[0].receiptStatus, "completed");
    assert.equal(untrustedObservedSideEffects(run, [attempt.id]).length, 1);
  });

  it("fails closed for retry when terminal evidence has no pre-execute intent", async () => {
    const { attempt, controller, run } = harness();
    await controller.synchronize("task-1", run.id, attempt.id, attempt.leaseId, terminalSnapshot("tool-write-unknown", "running"));

    assert.equal(run.sideEffects[0].intentSource, "observed-terminal");
    assert.equal(run.sideEffects[0].receiptStatus, "unknown");
    assert.deepEqual(unsafeUnknownSideEffects(run, [attempt.id]).map((effect) => effect.id), [run.sideEffects[0].id]);
    await assert.rejects(
      controller.recordIntent("task-1", run.id, attempt.id, attempt.leaseId, writeOperation("tool-write-unknown")),
      /without a durable pre-execute intent/,
    );
    assert.equal(run.sideEffects[0].intentSource, "observed-terminal");
  });

  it("parses legacy records conservatively without claiming pre-execute provenance", () => {
    const legacy = taskOrchestratorSideEffectSchema.parse({
      id: "effect-legacy",
      attemptId: "primary-1",
      turnId: null,
      toolCallId: "tool-legacy",
      operation: "Write proof.txt",
      idempotency: "non-idempotent",
      intentHash: "a".repeat(64),
      intentAt: 100,
      receiptStatus: "unknown",
      receiptAt: null,
      resultHash: null,
    });

    assert.equal(legacy.intentSource, "observed-terminal");
    assert.equal(taskOrchestratorSideEffectSchema.parse({ ...legacy, intentSource: "pre-execute" }).intentSource, "pre-execute");
  });
});
