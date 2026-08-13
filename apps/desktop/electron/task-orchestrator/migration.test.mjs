import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  taskOrchestratorContractSchema,
  taskOrchestratorRunSchema,
  taskOrchestratorTaskSchema,
} from "@onmyagent/types/task-orchestrator";

import { migrateLegacyJsonV2, parseJsonlWithTruncatedTail } from "./json-import.mjs";
import { createTaskOrchestratorSqliteStore } from "./sqlite-store.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix = "task-center-migration-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function profile(id, kind) {
  return {
    id,
    label: id,
    kind,
    runtime: "personal-local-agent",
    agentId: id,
    provider: kind === "primary" ? "codex" : "claude",
    model: `${id}-model`,
    modelLabel: `${id} model`,
    catalogSource: "personal-registry",
    catalogRevision: null,
    instructions: "",
    approvalMode: "ask",
    sessionStrategy: "fresh",
    timeoutMs: 10_000,
  };
}

function legacyRecords(root) {
  const contract = taskOrchestratorContractSchema.parse({
    outcome: "Import this task.",
    deliverables: ["An imported task"],
    acceptance: ["The imported task is readable"],
    scope: { included: ["Local state"], excluded: ["Cloud state"] },
    verification: ["Read the imported snapshot"],
  });
  const primary = profile("primary", "primary");
  const task = taskOrchestratorTaskSchema.parse({
    schemaVersion: 2,
    id: "task-imported",
    revision: 1,
    idea: "Import this task.",
    workspaceRoot: root,
    primary,
    allowedWorkers: [],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: { conversationId: null, personalRunId: null, messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
    latestRunId: "run-imported",
    createdAt: 10,
    updatedAt: 11,
  });
  const attempt = {
    id: "attempt-imported",
    kind: "primary",
    profileId: primary.id,
    parentAttemptId: null,
    depth: 0,
    status: "running",
    leaseId: "lease-old",
    personalRunId: "personal-old",
    conversationId: "conversation-old",
    prompt: "Continue the old run.",
    outputArtifactIds: ["artifact-good"],
    timeoutMs: 10_000,
    startedAt: 12,
    updatedAt: 13,
    finishedAt: null,
    error: null,
  };
  const run = taskOrchestratorRunSchema.parse({
    schemaVersion: 2,
    id: "run-imported",
    taskId: task.id,
    taskRevision: task.revision,
    definition: { idea: task.idea, workspaceRoot: root, primary, allowedWorkers: [], permissionMode: task.permissionMode, contractFinalization: task.contractFinalization, contract, template: task.template },
    status: "running",
    primaryAttemptId: attempt.id,
    currentAttemptId: attempt.id,
    primaryAttempts: [attempt],
    workerAttempts: [],
    createdAt: 12,
    startedAt: 12,
    updatedAt: 13,
    finishedAt: null,
    error: null,
  });
  return { task, run, attempt };
}

async function writeLegacySource(root) {
  const sourceRoot = path.join(root, "runtime-state", "task-center");
  const records = legacyRecords(root);
  const runRoot = path.join(sourceRoot, "tasks", records.task.id, "runs", records.run.id);
  await mkdir(path.join(runRoot, "artifacts", "artifact-good"), { recursive: true });
  await mkdir(path.join(runRoot, "artifacts", "artifact-missing"), { recursive: true });
  await mkdir(path.join(sourceRoot, "tasks", "legacy-v1"), { recursive: true });
  await writeFile(path.join(sourceRoot, "tasks", records.task.id, "task.json"), JSON.stringify(records.task, null, 2));
  await writeFile(path.join(runRoot, "run.json"), JSON.stringify(records.run, null, 2));
  const event = { schemaVersion: 2, id: "event-imported", sequence: 1, taskId: records.task.id, taskRunId: records.run.id, attemptId: records.attempt.id, type: "run-created", message: "Imported", at: 12 };
  await writeFile(path.join(runRoot, "events.jsonl"), `${JSON.stringify(event)}\n{"crash tail"`);
  await writeFile(path.join(runRoot, "artifacts", "artifact-good", "content.txt"), "immutable result");
  await writeFile(path.join(runRoot, "artifacts", "artifact-good", "metadata.json"), JSON.stringify({ schemaVersion: 2, id: "artifact-good", taskId: records.task.id, taskRunId: records.run.id, taskRevision: 1, attemptId: records.attempt.id, kind: "primary", summary: "Imported result", evidence: [], createdAt: 13 }));
  await writeFile(path.join(runRoot, "artifacts", "artifact-missing", "content.txt"), "partial");
  await writeFile(path.join(sourceRoot, "tasks", "legacy-v1", "task.json"), JSON.stringify({ schemaVersion: 1, title: "Old task" }));
  return { sourceRoot, records, originalTask: await readFile(path.join(sourceRoot, "tasks", records.task.id, "task.json"), "utf8") };
}

describe("Task Center v2 JSON migration", () => {
  it("stages an idempotent import, blocks active legacy attempts, and retains source/issues", async () => {
    const root = await temporaryRoot();
    const source = await writeLegacySource(root);
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, autoMigrate: false, legacyRootDirectory: source.sourceRoot });
    await store.initialize();
    const result = await migrateLegacyJsonV2({ store, sourceRoot: source.sourceRoot });
    assert.equal(result.status, "active");
    const importedRun = await store.readRun("task-imported", "run-imported");
    assert.equal(importedRun.status, "blocked");
    assert.equal(importedRun.primaryAttempts[0].status, "blocked");
    assert.equal(importedRun.primaryAttempts[0].leaseId, null);
    assert.equal((await store.readEvents("task-imported", "run-imported")).length, 1);
    assert.deepEqual((await store.readArtifacts("task-imported", "run-imported")).map((artifact) => artifact.id), ["artifact-good"]);
    assert.equal(await store.isLegacyTask("legacy-v1"), true);
    await assert.rejects(store.readTask("legacy-v1"), /legacy Task Center v1 state and is read-only/);
    const issues = await store.migrationIssues();
    assert.deepEqual(new Set(issues.map((entry) => entry.category)), new Set(["missing-artifact-marker", "legacy-v1"]));
    assert.equal(await readFile(path.join(source.sourceRoot, "tasks", "task-imported", "task.json"), "utf8"), source.originalTask);
    const repeated = await migrateLegacyJsonV2({ store, sourceRoot: source.sourceRoot });
    assert.equal(repeated.status, "already-active");
    await writeFile(path.join(source.sourceRoot, "tasks", "legacy-v1", "task.json"), JSON.stringify({ schemaVersion: 1, title: "Changed" }));
    await assert.rejects(migrateLegacyJsonV2({ store, sourceRoot: source.sourceRoot }), /hash drifted/);
    await store.close();
  });

  it("rolls back injected staging/quick-check failures and allows a clean retry", async () => {
    const root = await temporaryRoot();
    const source = await writeLegacySource(root);
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, autoMigrate: false, legacyRootDirectory: source.sourceRoot });
    await store.initialize();
    await assert.rejects(migrateLegacyJsonV2({ store, sourceRoot: source.sourceRoot, injectFailure: "after-task" }), /Injected migration failure/);
    assert.equal(await store.migrationMarker(), null);
    assert.deepEqual((await store.listTasks({})).tasks, []);
    await assert.rejects(migrateLegacyJsonV2({ store, sourceRoot: source.sourceRoot, forceQuickCheckFailure: true }), /quick_check failed/);
    assert.equal(await store.migrationMarker(), null);
    const result = await migrateLegacyJsonV2({ store, sourceRoot: source.sourceRoot });
    assert.equal(result.status, "active");
    await store.close();
  });

  it("uses deterministic truncated-tail semantics and fails closed on a corrupt database", async () => {
    assert.deepEqual(parseJsonlWithTruncatedTail('{"a":1}\n{"cut"'), [{ a: 1 }]);
    assert.throws(() => parseJsonlWithTruncatedTail('{"a":1}\nnope\n'), /line 2/);
    const root = await temporaryRoot("task-center-corrupt-");
    const dbPath = path.join(root, "runtime-state", "task-center-supervisor", "task-center.sqlite");
    await mkdir(path.dirname(dbPath), { recursive: true });
    await writeFile(dbPath, "not a sqlite database");
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, autoMigrate: false });
    await assert.rejects(store.initialize(), (error) => {
      assert.equal(error?.code, "TASK_CENTER_SQLITE_CORRUPT");
      assert.match(error?.message ?? "", /corruption was preserved.*fail-closed/i);
      assert.match(error?.cause?.message ?? "", /not a database|file is not a database|malformed/i);
      assert.match(error?.quarantine?.preservedPath ?? "", /task-center\.sqlite\.corrupt-/);
      return true;
    });
  });
});
