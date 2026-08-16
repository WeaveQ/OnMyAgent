import assert from "node:assert/strict";
import { test } from "node:test";

import { desktopCommandDomain } from "../src/desktop-ipc-commands.mjs";
import {
  taskOrchestratorTurnHistoryAttemptSchema,
  taskOrchestratorTurnHistoryListInputSchema,
} from "../src/task-orchestrator.ts";

test("Turn History requires an explicit task and historical run identity", () => {
  assert.deepEqual(taskOrchestratorTurnHistoryListInputSchema.parse({
    taskId: "task-1",
    taskRunId: "run-older",
    cursor: null,
    limit: 20,
  }), {
    taskId: "task-1",
    taskRunId: "run-older",
    cursor: null,
    limit: 20,
  });
  assert.equal(taskOrchestratorTurnHistoryListInputSchema.safeParse({ taskId: "task-1" }).success, false);
});

test("Turn History attempt contract rejects execution prompts", () => {
  const result = taskOrchestratorTurnHistoryAttemptSchema.safeParse({
    id: "attempt-1",
    kind: "primary",
    profileId: "primary-profile",
    parentAttemptId: null,
    turnId: "turn-1",
    depth: 0,
    status: "succeeded",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    providerDiagnostics: null,
    providerUsage: null,
    prompt: "must not be exposed",
    outputArtifactIds: [],
    timeoutMs: 60_000,
    startedAt: 1,
    updatedAt: 2,
    finishedAt: 2,
    error: null,
  });
  assert.equal(result.success, false);
});

test("Turn History command belongs to the Task Orchestrator desktop domain", () => {
  assert.equal(desktopCommandDomain("taskOrchestratorTurnHistoryList"), "taskOrchestrator");
});

test("knowledge / company / computerUse commands left the system group", () => {
  assert.equal(desktopCommandDomain("knowledgeEnsureVault"), "knowledge");
  assert.equal(desktopCommandDomain("companySettingsRead"), "company");
  assert.equal(desktopCommandDomain("captureComputerUseAppshot"), "computerUse");
  assert.equal(desktopCommandDomain("checkSystemPermissions"), "system");
});
