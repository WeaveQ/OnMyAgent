import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPersonalAgentHeartbeatScheduler } from "./heartbeat-scheduler.mjs";
import {
  claimDueHeartbeatJobs,
  createHeartbeatJob,
  heartbeatFile,
  HEARTBEAT_MIN_INTERVAL_MINUTES,
  listHeartbeatJobs,
  normalizeIntervalMinutes,
  recordHeartbeatRun,
  updateHeartbeatJob,
} from "./heartbeat-store.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-heartbeat-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state") });
  return workspaceRoot;
}

async function cleanup(workspaceRoot) {
  await rm(workspaceRoot, { recursive: true, force: true });
}

function agent() {
  return { id: "codex", name: "Codex", provider: "codex" };
}

describe("personal local agent heartbeat store", () => {
  it("stores jobs under runtime-state and clamps interval minutes", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const job = await createHeartbeatJob(workspaceRoot, {
        title: "Check",
        prompt: "ping",
        agent: agent(),
        conversationId: "conv-1",
        schedule: { mode: "interval", intervalMinutes: 1 },
      }, 1_000);

      assert.equal(job.schedule.intervalMinutes, HEARTBEAT_MIN_INTERVAL_MINUTES);
      assert.equal(normalizeIntervalMinutes(2), HEARTBEAT_MIN_INTERVAL_MINUTES);
      assert.equal(job.conversationId, "conv-1");
      assert.equal(heartbeatFile(workspaceRoot).includes(`${path.sep}.opencode${path.sep}`), false);
      assert.equal(heartbeatFile(workspaceRoot).startsWith(path.join(workspaceRoot, "user-data", "runtime-state")), true);
      assert.match(await readFile(heartbeatFile(workspaceRoot), "utf8"), /"heartbeats"|"jobs"/);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("claims due enabled jobs once and prevents overlapping leases", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const job = await createHeartbeatJob(workspaceRoot, {
        title: "Due",
        prompt: "ping",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      }, 1_000);
      const due = await claimDueHeartbeatJobs(workspaceRoot, 10 * 60_000);
      assert.equal(due.length, 1);
      assert.equal(due[0].id, job.id);

      const second = await claimDueHeartbeatJobs(workspaceRoot, 10 * 60_000 + 1_000);
      assert.equal(second.length, 0);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("records heartbeat run history and schedules the next interval", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const job = await createHeartbeatJob(workspaceRoot, {
        title: "Record",
        prompt: "ping",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      }, 1_000);
      const updated = await recordHeartbeatRun(workspaceRoot, job.id, {
        runId: "run-1",
        status: "completed",
        startedAt: 2_000,
        finishedAt: 3_000,
        output: "ok",
      }, 3_000);

      assert.equal(updated.lastRun.runId, "run-1");
      assert.equal(updated.lastRun.status, "completed");
      assert.equal(updated.nextRunAt, 3_000 + 5 * 60_000);
      assert.equal((await listHeartbeatJobs(workspaceRoot))[0].runs.length, 1);
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("normalizes run history entries without blank ids", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const job = await createHeartbeatJob(workspaceRoot, {
        title: "Record",
        prompt: "ping",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      }, 1_000);
      const updated = await recordHeartbeatRun(workspaceRoot, job.id, {
        status: "failed",
        error: "boom",
        startedAt: 2_000,
        finishedAt: 3_000,
      }, 3_000);

      assert.match(updated.lastRun.id, /^heartbeat-run-/);
      assert.equal(updated.lastRun.runId, null);
      assert.equal(updated.lastRun.status, "failed");
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("preserves the due time when only session context changes", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const job = await createHeartbeatJob(workspaceRoot, {
        title: "Context",
        prompt: "ping",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      }, 1_000);
      const rescheduled = await updateHeartbeatJob(workspaceRoot, job.id, { nextRunAt: 9_000 }, 2_000);
      const updated = await updateHeartbeatJob(workspaceRoot, job.id, { sessionContext: "user: later check Studio" }, 8_000);

      assert.equal(rescheduled.nextRunAt, 9_000);
      assert.equal(updated.nextRunAt, 9_000);
      assert.equal(updated.sessionContext, "user: later check Studio");
    } finally {
      await cleanup(workspaceRoot);
    }
  });
});

describe("personal local agent heartbeat scheduler", () => {
  it("runNow invokes runtime with selected conversation and records completion", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const calls = [];
      const runtime = {
        startMessage: async (input) => {
          calls.push(input);
          return {
            ok: true,
            runId: "run-now-1",
            agentId: input.agent.id,
            status: "completed",
            startedAt: 10,
            finishedAt: 20,
            pid: null,
            command: "fake",
            output: "HEARTBEAT_OK",
            error: null,
            events: [],
            logPath: null,
          };
        },
        getRun: async () => null,
      };
      const scheduler = createPersonalAgentHeartbeatScheduler({ personalAgentRuntime: runtime, pollMs: 60_000, runPollMs: 1 });
      const created = await scheduler.create({
        workspaceRoot,
        title: "Run now",
        prompt: "ping",
        sessionContext: "user: 一会你要去看看 studio，现在不要做",
        conversationId: "conv-selected",
        approvalMode: "read-only-auto",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      });

      const result = await scheduler.runNow({ workspaceRoot, jobId: created.job.id });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].workspaceRoot, workspaceRoot);
      assert.match(calls[0].prompt, /<bound_session_context>/);
      assert.match(calls[0].prompt, /execute the latest pending user intent/);
      assert.match(calls[0].prompt, /deferred wording such as later, soon, 一会, 之后, or 到点 is now due/);
      assert.match(calls[0].prompt, /bound session context wins/);
      assert.match(calls[0].prompt, /Do not replace a concrete pending session request with a generic workspace check/);
      assert.match(calls[0].prompt, /一会你要去看看 studio/);
      assert.match(calls[0].prompt, /<scheduled_task_instruction>\nping/);
      assert.equal(calls[0].conversationId, "conv-selected");
      assert.equal(calls[0].approvalMode, "read-only-auto");
      assert.equal(result.job.lastRun.runId, "run-now-1");
      assert.equal(result.job.lastRun.status, "completed");
      await scheduler.close();
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("discovers persisted workspace jobs on scheduler startup", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const calls = [];
      const job = await createHeartbeatJob(workspaceRoot, {
        title: "Recovered",
        prompt: "ping recovered",
        conversationId: "conv-recovered",
        approvalMode: "read-only-auto",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      }, 1_000);
      await updateHeartbeatJob(workspaceRoot, job.id, { nextRunAt: 1_000 }, 2_000);

      const runtime = {
        startMessage: async (input) => {
          calls.push(input);
          return {
            ok: true,
            runId: "recovered-run-1",
            agentId: input.agent.id,
            status: "completed",
            startedAt: Date.now(),
            finishedAt: Date.now(),
            pid: null,
            command: "fake",
            output: "HEARTBEAT_OK",
            error: null,
            events: [],
            logPath: null,
          };
        },
        getRun: async () => null,
      };
      const scheduler = createPersonalAgentHeartbeatScheduler({
        personalAgentRuntime: runtime,
        listWorkspaceRoots: async () => [workspaceRoot],
        pollMs: 60_000,
        runPollMs: 1,
      });

      await scheduler.tick();
      for (let attempt = 0; calls.length === 0 && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const [current] = await listHeartbeatJobs(workspaceRoot);
        if (current?.lastRun) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const jobs = await listHeartbeatJobs(workspaceRoot);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].conversationId, "conv-recovered");
      assert.equal(jobs[0].lastRun.runId, "recovered-run-1");
      await scheduler.close();
    } finally {
      await cleanup(workspaceRoot);
    }
  });

  it("records a failed run when runtime returns a non-terminal result without run id", async () => {
    const workspaceRoot = await tempWorkspace();
    try {
      const runtime = {
        startMessage: async () => ({ status: "running" }),
        getRun: async () => ({ status: "running" }),
      };
      const scheduler = createPersonalAgentHeartbeatScheduler({ personalAgentRuntime: runtime, pollMs: 60_000, runPollMs: 1 });
      const created = await scheduler.create({
        workspaceRoot,
        title: "Missing run id",
        prompt: "ping",
        agent: agent(),
        schedule: { mode: "interval", intervalMinutes: 5 },
      });

      const result = await scheduler.runNow({ workspaceRoot, jobId: created.job.id });

      assert.equal(result.ok, true);
      assert.equal(result.job.lastRun.status, "failed");
      assert.equal(result.job.lastRun.runId, null);
      assert.equal(result.job.lastRun.error, "scheduled task runtime did not return a run id");
      await scheduler.close();
    } finally {
      await cleanup(workspaceRoot);
    }
  });
});
