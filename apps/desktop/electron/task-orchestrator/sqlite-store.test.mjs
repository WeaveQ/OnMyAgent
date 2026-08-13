import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";

import {
  TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET,
  taskOrchestratorContractSchema,
  taskOrchestratorRunSchema,
  taskOrchestratorTaskSchema,
} from "@onmyagent/types/task-orchestrator";

import { createTaskOrchestratorSqliteStore } from "./sqlite-store.mjs";
import {
  TASK_SUPERVISOR_MAX_FRAME_BYTES,
  encodeSupervisorFrame,
} from "../task-supervisor/protocol.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix = "task-center-sqlite-") {
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

function fixture(root, taskId = "task-sqlite") {
  const contract = taskOrchestratorContractSchema.parse({
    outcome: "Store the task durably.",
    deliverables: ["A persisted result"],
    acceptance: ["The result can be reloaded"],
    scope: { included: ["The local workspace"], excluded: ["Remote systems"] },
    verification: ["Run the focused store test"],
  });
  const task = taskOrchestratorTaskSchema.parse({
    schemaVersion: 2,
    id: taskId,
    revision: 1,
    idea: "Persist a task.",
    workspaceRoot: root,
    primary: profile("primary", "primary"),
    allowedWorkers: [profile("worker", "worker")],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: { conversationId: null, personalRunId: null, messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
    latestRunId: "run-sqlite",
    createdAt: 1,
    updatedAt: 2,
  });
  const attempt = {
    id: "attempt-primary",
    kind: "primary",
    profileId: task.primary.id,
    parentAttemptId: null,
    depth: 0,
    status: "succeeded",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    prompt: "Run the task.",
    outputArtifactIds: ["artifact-1"],
    timeoutMs: 10_000,
    startedAt: 3,
    updatedAt: 5,
    finishedAt: 5,
    error: null,
  };
  const run = taskOrchestratorRunSchema.parse({
    schemaVersion: 2,
    id: "run-sqlite",
    taskId,
    taskRevision: task.revision,
    definition: {
      idea: task.idea,
      workspaceRoot: task.workspaceRoot,
      primary: task.primary,
      allowedWorkers: task.allowedWorkers,
      permissionMode: task.permissionMode,
      contractFinalization: task.contractFinalization,
      contract: task.contract,
      template: task.template,
    },
    status: "succeeded",
    primaryAttemptId: attempt.id,
    currentAttemptId: attempt.id,
    primaryAttempts: [attempt],
    workerAttempts: [],
    createdAt: 3,
    startedAt: 3,
    updatedAt: 5,
    finishedAt: 5,
    error: null,
  });
  return { task, run, attempt };
}

function runVariant(source, index) {
  const attempt = {
    ...source.primaryAttempts[0],
    id: `attempt-history-${index}`,
    outputArtifactIds: [],
    startedAt: index,
    updatedAt: index,
    finishedAt: index,
  };
  return taskOrchestratorRunSchema.parse({
    ...source,
    id: `run-history-${index}`,
    primaryAttemptId: attempt.id,
    currentAttemptId: attempt.id,
    primaryAttempts: [attempt],
    createdAt: index,
    startedAt: index,
    updatedAt: index,
    finishedAt: index,
  });
}

describe("Task Center SQLite authoritative store", () => {
  it("creates the supervisor DB with required pragmas and preserves snapshot-shaped CRUD", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    await store.initialize();
    const { task, run, attempt } = fixture(root);
    await store.writeTask(task);
    await store.writeRun(run);
    await store.appendEvent({ schemaVersion: 2, id: "event-1", sequence: 1, taskId: task.id, taskRunId: run.id, attemptId: attempt.id, type: "run-created", message: "created", at: 3 });
    await store.writeArtifact({ schemaVersion: 2, id: "artifact-1", taskId: task.id, taskRunId: run.id, taskRevision: 1, attemptId: attempt.id, kind: "primary", summary: "Result", content: "done", evidence: [], createdAt: 5 });
    await store.writeGate({ schemaVersion: 2, id: "gate-1", kind: "manual-review", status: "pending", taskId: task.id, taskRunId: run.id, taskRevision: 1, attemptId: attempt.id, personalApprovalId: null, title: "Review", summary: "Review result", risk: "careful", operation: { method: null, kind: null, command: null, cwd: null, params: [], diff: null, readOnly: true }, requestedAt: 4, decisionRequestedAt: null, resolvedAt: null, decision: null });
    const snapshot = await store.snapshot(task.id);
    assert.equal(snapshot.task.id, task.id);
    assert.equal(snapshot.run?.id, run.id);
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.artifacts[0].content, "done");
    assert.equal(snapshot.gates[0].id, "gate-1");
    const health = await store.health();
    assert.deepEqual(health.quickCheck, ["ok"]);
    assert.equal(health.pragmas.journalMode, "wal");
    assert.equal(health.pragmas.synchronous, 2);
    assert.equal(health.pragmas.walAutoCheckpointPages, 1_000);
    assert.equal(health.pragmas.foreignKeys, true);
    assert.equal(health.pragmas.busyTimeoutMs, 5_000);
    assert.equal(health.pragmas.trustedSchema, false);
    assert.match(store.dbPath, /runtime-state[\\/]task-center-supervisor[\\/]task-center\.sqlite$/);
    await store.close();
  });

  it("uses a bounded diagnostics aggregate and cached health without process payload reads", async () => {
    const root = await temporaryRoot("task-center-diagnostics-");
    let clock = 100;
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, now: () => clock });
    await store.initialize();
    const { task, run } = fixture(root, "task-diagnostics");
    await store.writeTask(task);
    await store.writeRun(run);
    await store.upsertProcess({ id: "diag-primary", runId: run.id, attemptId: "attempt-primary", pid: 4_321, status: "running", updatedAt: 90, payload: { secret: "must-not-project" } });
    await store.upsertProcess({ id: "diag-checker", runId: run.id, attemptId: null, pid: 4_322, status: "running", updatedAt: 91, payload: { attemptKind: "checker", secret: "checker-secret" } });
    await store.upsertProcess({ id: "diag-exited", runId: run.id, pid: 4_323, status: "exited", updatedAt: 92, payload: { output: "terminal" } });
    const aggregate = await store.diagnosticsAggregate({ runId: run.id, pidLimit: 2 });
    assert.deepEqual(aggregate.processes, {
      count: 3,
      active: 2,
      states: { running: 2, exited: 1 },
      pids: [4_323, 4_322],
    });
    assert.equal(JSON.stringify(aggregate).includes("checker-secret"), false);
    const first = await store.diagnosticsHealth();
    assert.equal(first.observed, true);
    assert.equal(first.stale, false);
    assert.equal(first.healthy, true);
    assert.equal(first.observedAt, 100);
    clock = 5_099;
    const cached = await store.diagnosticsHealth();
    assert.equal(cached.observedAt, 100);
    clock = 5_101;
    const refreshed = await store.diagnosticsHealth();
    assert.equal(refreshed.observedAt, 5_101);
    await store.close();
  });

  it("allocates unique event sequences for concurrent appends and survives restart", async () => {
    const root = await temporaryRoot();
    const first = createTaskOrchestratorSqliteStore({ userDataDir: root });
    await first.initialize();
    const { task } = fixture(root, "task-events");
    await first.writeTask(task);
    const events = await Promise.all(Array.from({ length: 32 }, (_, index) => first.appendEvent({ schemaVersion: 2, id: `event-${index}`, sequence: 1, taskId: task.id, taskRunId: null, attemptId: null, type: "alignment-started", message: String(index), at: index + 1 })));
    assert.deepEqual(events.map((event) => event.sequence).sort((left, right) => left - right), Array.from({ length: 32 }, (_, index) => index + 1));
    assert.equal((await first.readEvents(task.id, null)).length, 32);
    await first.close();
    const restarted = createTaskOrchestratorSqliteStore({ userDataDir: root });
    await restarted.initialize();
    assert.equal(await restarted.nextEventSequence(task.id, null), 33);
    await restarted.appendEvent({ schemaVersion: 2, id: "event-restart", sequence: 1, taskId: task.id, taskRunId: null, attemptId: null, type: "alignment-message", message: "after restart", at: 40 });
    assert.equal((await restarted.readEvents(task.id, null)).at(-1).sequence, 33);
    await restarted.close();
  });

  it("keeps artifact rows immutable and hides an uncommitted marker", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    await store.initialize();
    const { task, run, attempt } = fixture(root, "task-artifacts");
    await store.writeTask(task);
    await store.writeRun(run);
    await store.writeArtifact({ schemaVersion: 2, id: "artifact-immutable", taskId: task.id, taskRunId: run.id, taskRevision: 1, attemptId: attempt.id, kind: "primary", summary: "Result", content: "first", evidence: [], createdAt: 5 });
    run.updatedAt += 1;
    run.primaryAttempts[0].updatedAt += 1;
    await store.writeRun(run);
    assert.equal((await store.readArtifacts(task.id, run.id))[0]?.content, "first");
    assert.equal(await store.latestArtifactCreatedAt(task.id, run.id), 5);
    await assert.rejects(store.writeArtifact({ schemaVersion: 2, id: "artifact-immutable", taskId: task.id, taskRunId: run.id, taskRevision: 1, attemptId: attempt.id, kind: "primary", summary: "Changed", content: "second", evidence: [], createdAt: 6 }), /immutable/);
    const db = new DatabaseSync(store.dbPath);
    db.prepare("INSERT INTO artifacts(id, task_id, run_id, attempt_id, content, content_sha256, metadata_json, committed, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?)").run("artifact-incomplete", task.id, run.id, attempt.id, "partial", "", JSON.stringify({ schemaVersion: 2, id: "artifact-incomplete", taskId: task.id, taskRunId: run.id, taskRevision: 1, attemptId: attempt.id, kind: "primary", summary: "partial", evidence: [], createdAt: 6 }), 6);
    db.close();
    assert.deepEqual((await store.readArtifacts(task.id, run.id)).map((artifact) => artifact.id), ["artifact-immutable"]);
    await store.close();
  });

  it("projects active leases and side effects and fences RPC replay across Supervisor epochs", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, now: () => 50 });
    await store.initialize();
    const { task, run } = fixture(root, "task-fencing");
    const attempt = run.primaryAttempts[0];
    attempt.status = "running";
    attempt.leaseId = "lease-active";
    attempt.finishedAt = null;
    attempt.outputArtifactIds = [];
    run.status = "running";
    run.finishedAt = null;
    run.sideEffects = [{
      id: "effect-1",
      attemptId: attempt.id,
      turnId: null,
      toolCallId: "tool-1",
      operation: "write file",
      idempotency: "non-idempotent",
      intentHash: "a".repeat(64),
      intentAt: 4,
      receiptStatus: "unknown",
      receiptAt: null,
      resultHash: null,
    }];
    await store.writeTask(task);
    await store.writeRun(run);
    const db = new DatabaseSync(store.dbPath);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leases WHERE run_id = ?").get(run.id).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM side_effects WHERE run_id = ?").get(run.id).count, 1);
    db.close();

    const request = { idempotencyKey: "desktop-request-1", requestDigest: "b".repeat(64), ownerEpoch: "epoch-one" };
    assert.deepEqual(await store.claimRpcRequest(request), { state: "claimed" });
    await store.completeRpcRequest({ ...request, result: { taskId: task.id } });
    assert.deepEqual(await store.claimRpcRequest({ ...request, ownerEpoch: "epoch-two" }), { state: "completed", result: { taskId: task.id } });

    const interrupted = { idempotencyKey: "desktop-request-2", requestDigest: "c".repeat(64), ownerEpoch: "epoch-one" };
    assert.deepEqual(await store.claimRpcRequest(interrupted), { state: "claimed" });
    assert.deepEqual(await store.claimRpcRequest({ ...interrupted, ownerEpoch: "epoch-two" }), { state: "unknown" });
    await store.close();
  });

  it("paginates immutable run and event history with stable cursors", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    const { task, run } = fixture(root, "task-history");
    task.latestRunId = "run-history-5";
    await store.writeTask(task);
    for (let index = 1; index <= 5; index += 1) await store.writeRun(runVariant(run, index));

    const firstRuns = await store.listRuns({ taskId: task.id, limit: 2 });
    assert.deepEqual(firstRuns.runs.map((item) => item.id), ["run-history-5", "run-history-4"]);
    assert.equal(firstRuns.hasMore, true);
    const secondRuns = await store.listRuns({ taskId: task.id, cursor: firstRuns.nextCursor, limit: 2 });
    assert.deepEqual(secondRuns.runs.map((item) => item.id), ["run-history-3", "run-history-2"]);
    const movedRun = runVariant(run, 5);
    movedRun.createdAt = 99;
    await assert.rejects(store.writeRun(movedRun), /history cursor are immutable/);

    for (let index = 1; index <= 5; index += 1) {
      await store.appendEvent({
        schemaVersion: 2,
        id: `event-history-${index}`,
        sequence: 1,
        taskId: task.id,
        taskRunId: null,
        attemptId: null,
        type: "alignment-message",
        message: `event ${index}`,
        at: index,
      });
    }
    const firstEvents = await store.listEvents({ taskId: task.id, cursor: 0, limit: 2 });
    assert.deepEqual(firstEvents.events.map((event) => event.sequence), [1, 2]);
    assert.equal(firstEvents.nextCursor, 2);
    await store.appendEvent({ schemaVersion: 2, id: "event-history-6", sequence: 1, taskId: task.id, taskRunId: null, attemptId: null, type: "alignment-message", message: "event 6", at: 6 });
    const secondEvents = await store.listEvents({ taskId: task.id, cursor: firstEvents.nextCursor, limit: 4 });
    assert.deepEqual(secondEvents.events.map((event) => event.sequence), [3, 4, 5, 6]);
    assert.equal(secondEvents.nextCursor, 6);
    assert.equal(new Set([...firstEvents.events, ...secondEvents.events].map((event) => event.id)).size, 6);
    await store.close();
  });

  it("paginates projected task summaries without historical run N+1 reads", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    for (let index = 0; index < 205; index += 1) {
      const { task } = fixture(root, `task-page-${String(index).padStart(3, "0")}`);
      await store.writeTask({ ...task, latestRunId: null, updatedAt: 1_000 + index });
    }
    const seen = [];
    let cursor = null;
    do {
      const page = await store.listTasks({ cursor, limit: 37 });
      seen.push(...page.tasks.map((task) => task.id));
      cursor = page.hasMore ? page.nextCursor : null;
      assert.ok(page.tasks.length <= 37);
    } while (cursor);
    assert.equal(seen.length, 205);
    assert.equal(new Set(seen).size, 205);
    assert.equal(seen[0], "task-page-204");
    assert.equal(seen.at(-1), "task-page-000");
    await store.close();
  });

  it("lists artifact metadata without content and reads verified immutable content on demand", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    const { task, run, attempt } = fixture(root, "task-artifact-history");
    await store.writeTask(task);
    await store.writeRun(run);
    const unicodeContent = "界".repeat(500_000);
    for (let index = 1; index <= 3; index += 1) {
      const content = index === 2 ? unicodeContent : `full artifact ${index}`;
      await store.writeArtifact({
        schemaVersion: 2,
        id: `artifact-history-${index}`,
        taskId: task.id,
        taskRunId: run.id,
        taskRevision: 1,
        attemptId: attempt.id,
        kind: "evidence",
        summary: `Artifact ${index}`,
        content,
        evidence: index === 2 ? Array.from({ length: 5 }, (_, evidenceIndex) => ({
          kind: "test", provenance: "runtime-observed", label: `Unicode evidence ${evidenceIndex + 1}`,
          value: "证".repeat(24_000), status: "passed", exitCode: 0, path: null,
        })) : [],
        createdAt: index,
      });
    }
    const first = await store.listArtifacts({ taskId: task.id, taskRunId: run.id, limit: 2 });
    assert.deepEqual(first.artifacts.map((artifact) => artifact.id), ["artifact-history-3", "artifact-history-2"]);
    assert.equal("content" in first.artifacts[0], false);
    assert.equal(first.artifacts[0].contentBytes, Buffer.byteLength("full artifact 3"));
    assert.match(first.artifacts[0].contentSha256, /^[a-f0-9]{64}$/);
    const second = await store.listArtifacts({ taskId: task.id, taskRunId: run.id, cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(second.artifacts.map((artifact) => artifact.id), ["artifact-history-1"]);
    await assert.rejects(
      store.getArtifact({ taskId: task.id, taskRunId: run.id, artifactId: "artifact-history-2" }),
      (error) => error?.code === "TASK_ARTIFACT_REQUIRES_CHUNKS",
    );
    let offset = 0;
    let evidenceOffset = 0;
    let totalEvidence = null;
    let reconstructed = "";
    const reconstructedEvidence = [];
    do {
      const chunk = await store.getArtifactContent({
        taskId: task.id, taskRunId: run.id, artifactId: "artifact-history-2",
        offset: offset ?? unicodeContent.length, limitChars: 64_000,
        evidenceOffset: evidenceOffset ?? totalEvidence ?? 0, evidenceLimit: 2,
      });
      reconstructed += chunk.contentChunk;
      reconstructedEvidence.push(...chunk.evidence);
      totalEvidence = chunk.totalEvidence;
      const artifactFrame = encodeSupervisorFrame({ type: "response", id: `artifact-${offset}`, ok: true, result: chunk });
      assert.ok(Buffer.byteLength(artifactFrame, "utf8") <= TASK_SUPERVISOR_MAX_FRAME_BYTES);
      offset = chunk.nextOffset;
      evidenceOffset = chunk.nextEvidenceOffset;
    } while (offset !== null || evidenceOffset !== null);
    assert.equal(reconstructed, unicodeContent);
    assert.equal(reconstructedEvidence.length, 5);
    assert.deepEqual(reconstructedEvidence.map((item) => item.label), Array.from({ length: 5 }, (_, index) => `Unicode evidence ${index + 1}`));
    assert.equal((await store.getArtifact({ taskId: task.id, taskRunId: run.id, artifactId: "artifact-history-1" })).content, "full artifact 1");
    await store.close();
  });

  it("archives immutable task history, exports a complete paginated digest, and restores explicitly", async () => {
    const root = await temporaryRoot();
    let clock = 20;
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, now: () => clock });
    const { task, run, attempt } = fixture(root, "task-archive");
    await store.writeTask(task);
    await store.writeRun(run);
    await store.appendEvent({
      schemaVersion: 2, id: "event-before-archive", sequence: 1, taskId: task.id,
      taskRunId: run.id, attemptId: attempt.id, type: "run-succeeded", message: "done", at: 5,
    });
    await store.writeArtifact({
      schemaVersion: 2, id: "artifact-archive", taskId: task.id, taskRunId: run.id,
      taskRevision: 1, attemptId: attempt.id, kind: "primary", summary: "Exported",
      content: "immutable export content", evidence: [], createdAt: 5,
    });
    await store.writeGate({
      schemaVersion: 2, id: "gate-archive", kind: "manual-review", status: "approved",
      taskId: task.id, taskRunId: run.id, taskRevision: 1, attemptId: attempt.id,
      personalApprovalId: null, title: "Approved", summary: "complete", risk: "careful",
      operation: { method: null, kind: null, command: null, cwd: null, params: [], diff: null, readOnly: true },
      requestedAt: 3, decisionRequestedAt: 4, resolvedAt: 5, decision: "approve",
    });

    const archived = await store.archiveTask({ taskId: task.id, expectedRevision: 1 });
    assert.equal(archived.definitionStatus, "archived");
    assert.equal(archived.revision, 2);
    assert.deepEqual((await store.readEvents(task.id, null)).map((event) => event.type), ["task-archived"]);
    await assert.rejects(store.writeTask({ ...archived, idea: "mutated", revision: 3 }), /Archived task history is immutable/);
    await assert.rejects(store.writeRun({ ...run, updatedAt: 21 }), /Archived task history is immutable/);
    await assert.rejects(store.appendEvent({
      schemaVersion: 2, id: "event-after-archive", sequence: 1, taskId: task.id,
      taskRunId: run.id, attemptId: attempt.id, type: "primary-progress", message: "late", at: 21,
    }), /Archived task history is immutable/);

    const pages = [];
    let cursor = 0;
    do {
      const page = await store.exportTaskManifest({ taskId: task.id, cursor, limit: 2 });
      pages.push(page);
      const frame = encodeSupervisorFrame({ type: "response", id: `export-${cursor}`, ok: true, result: page });
      assert.ok(Buffer.byteLength(frame, "utf8") <= TASK_SUPERVISOR_MAX_FRAME_BYTES);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.ok(pages.length > 1);
    assert.equal(new Set(pages.map((page) => page.manifestSha256)).size, 1);
    assert.deepEqual(pages[0].counts, { tasks: 1, runs: 1, events: 2, artifacts: 1, gates: 1 });
    assert.equal(pages[0].totalEntries, 6);
    const entries = pages.flatMap((page) => page.entries);
    assert.deepEqual(entries.map((entry) => entry.index), [0, 1, 2, 3, 4, 5]);
    const independentDigest = createHash("sha256");
    independentDigest.update(`1\n${task.id}\n${archived.revision}\n${JSON.stringify(pages[0].counts)}\n`);
    for (const entry of entries) independentDigest.update(`${JSON.stringify(entry)}\n`);
    assert.equal(pages[0].manifestSha256, independentDigest.digest("hex"));
    const artifactEntry = entries.find((entry) => entry.kind === "artifact");
    assert.equal(artifactEntry.contentBytes, Buffer.byteLength("immutable export content"));
    assert.match(artifactEntry.contentSha256, /^[a-f0-9]{64}$/);

    await assert.rejects(store.purgeTask({
      taskId: task.id, expectedRevision: 2, confirmation: `PURGE ${task.id}`, manifestSha256: "0".repeat(64),
    }), /manifest digest does not match/);
    assert.equal((await store.readTask(task.id))?.definitionStatus, "archived");

    clock = 21;
    const restored = await store.restoreTask({ taskId: task.id, expectedRevision: 2 });
    assert.equal(restored.definitionStatus, "ready");
    assert.equal(restored.revision, 3);
    assert.deepEqual((await store.readEvents(task.id, null)).map((event) => event.type), ["task-archived", "task-restored"]);
    await assert.rejects(store.exportTaskManifest({ taskId: task.id }), /must be archived/);

    const archivedAgain = await store.archiveTask({ taskId: task.id, expectedRevision: 3 });
    const purgeManifest = await store.exportTaskManifest({ taskId: task.id, cursor: 0, limit: 2 });
    await assert.rejects(store.purgeTask({
      taskId: task.id, expectedRevision: archivedAgain.revision, confirmation: "PURGE wrong-task", manifestSha256: purgeManifest.manifestSha256,
    }), /confirmation must exactly equal/);
    const purged = await store.purgeTask({
      taskId: task.id,
      expectedRevision: archivedAgain.revision,
      confirmation: `PURGE ${task.id}`,
      manifestSha256: purgeManifest.manifestSha256,
    });
    assert.equal(purged.ok, true);
    assert.equal(purged.taskId, task.id);
    assert.equal(await store.readTask(task.id), null);
    const purgeAudit = store._database().prepare("SELECT * FROM purge_audit WHERE id=?").get(purged.auditId);
    assert.equal(purgeAudit.task_id, task.id);
    assert.equal(purgeAudit.manifest_sha256, purgeManifest.manifestSha256);

    const activeAlignment = fixture(root, "task-active-alignment").task;
    activeAlignment.latestRunId = null;
    activeAlignment.alignment.status = "running";
    activeAlignment.alignment.startedAt = 21;
    await store.writeTask(activeAlignment);
    await assert.rejects(
      store.archiveTask({ taskId: activeAlignment.id, expectedRevision: activeAlignment.revision }),
      /while alignment is active/,
    );
    await store.close();
  });

  it("keeps the default snapshot below the Supervisor frame budget and reports truncation", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    const { task, run, attempt } = fixture(root, "task-bounded-snapshot");
    task.alignment.messages = Array.from({ length: 50 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 ? "primary" : "human",
      text: `${index}:${"界".repeat(7_000)}`,
      at: index,
    }));
    await store.writeTask(task);
    await store.writeRun(run);
    for (let index = 1; index <= 8; index += 1) {
      await store.writeArtifact({
        schemaVersion: 2,
        id: `artifact-large-${index}`,
        taskId: task.id,
        taskRunId: run.id,
        taskRevision: 1,
        attemptId: attempt.id,
        kind: "primary",
        summary: `Large ${index}`,
        content: "x".repeat(300_000),
        evidence: [],
        createdAt: index,
      });
    }
    for (let index = 1; index <= 125; index += 1) {
      await store.appendEvent({ schemaVersion: 2, id: `event-large-${index}`, sequence: 1, taskId: task.id, taskRunId: run.id, attemptId: attempt.id, type: "primary-progress", message: "界".repeat(4_000), at: index });
    }
    const snapshot = await store.snapshot(task.id, run.id);
    const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
    assert.ok(bytes <= TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET, `${bytes} exceeds snapshot budget`);
    assert.equal(snapshot.truncation.serializedBytes, bytes);
    assert.equal(snapshot.truncation.byteBudget, TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET);
    assert.equal(snapshot.truncation.truncated, true);
    assert.equal(snapshot.truncation.compactedTask, true);
    assert.equal(snapshot.truncation.omitted.events, 25);
    assert.equal(snapshot.truncation.omitted.artifacts, 2);
    assert.ok(snapshot.truncation.omitted.artifactContentBytes > 2_000_000);
    assert.ok(snapshot.truncation.artifactContentTruncatedIds.length > 0);
    const frame = encodeSupervisorFrame({
      type: "response",
      id: "bounded-snapshot",
      ok: true,
      supervisorEpoch: "epoch",
      startToken: "start",
      result: snapshot,
    });
    assert.ok(Buffer.byteLength(frame, "utf8") <= TASK_SUPERVISOR_MAX_FRAME_BYTES);
    const eventPage = await store.listEvents({ taskId: task.id, taskRunId: run.id, cursor: 0, limit: 200 });
    assert.equal(eventPage.hasMore, true);
    assert.ok(eventPage.events.length < 125);
    assert.equal(eventPage.nextCursor, eventPage.events.at(-1).sequence);
    const eventFrame = encodeSupervisorFrame({ type: "response", id: "bounded-events", ok: true, result: eventPage });
    assert.ok(Buffer.byteLength(eventFrame, "utf8") <= TASK_SUPERVISOR_MAX_FRAME_BYTES);
    await store.close();
  });

  it("bounds only operational retention and reports checkpoint/vacuum health metrics", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, now: () => 10_000 });
    const { task, run, attempt } = fixture(root, "task-maintenance");
    await store.writeTask(task);
    await store.writeRun(run);
    await store.writeArtifact({
      schemaVersion: 2, id: "artifact-maintenance", taskId: task.id, taskRunId: run.id,
      taskRevision: 1, attemptId: attempt.id, kind: "evidence", summary: "keep",
      content: "immutable", evidence: [], createdAt: 5,
    });
    const db = new DatabaseSync(store.dbPath);
    for (const [index, timestamp] of [1, 9_997, 9_998, 9_999].entries()) {
      db.prepare(
        "INSERT INTO rpc_requests(idempotency_key, request_digest, owner_epoch, status, started_at, finished_at) VALUES(?, ?, ?, 'completed', ?, ?)",
      ).run(`rpc-terminal-${index}`, String(index + 1).padStart(64, "a"), "epoch", timestamp, timestamp);
      db.prepare("INSERT INTO outbox(id, stream_key, status, created_at, payload_json) VALUES(?, ?, 'delivered', ?, '{}')")
        .run(`outbox-terminal-${index}`, "task:maintenance", timestamp);
      db.prepare("INSERT INTO processes(id, status, updated_at, payload_json) VALUES(?, 'exited', ?, '{}')")
        .run(`process-terminal-${index}`, timestamp);
    }
    db.prepare(
      "INSERT INTO rpc_requests(idempotency_key, request_digest, owner_epoch, status, started_at) VALUES('rpc-active', ?, 'epoch', 'processing', 1)",
    ).run("f".repeat(64));
    db.prepare("INSERT INTO outbox(id, stream_key, status, created_at, payload_json) VALUES('outbox-active', 'task:maintenance', 'pending', 1, '{}')").run();
    db.prepare("INSERT INTO processes(id, status, updated_at, payload_json) VALUES('process-active', 'running', 1, '{}')").run();
    db.close();

    const result = await store.runMaintenance({
      retentionMs: 100,
      maxTerminalRowsPerTable: 1,
      incrementalVacuumPages: 8,
    });
    assert.deepEqual(result.protectedRows, { tasks: 1, runs: 1, artifacts: 1 });
    assert.deepEqual(result.deleted, { rpcRequests: 3, outbox: 3, processTombstones: 3 });
    assert.equal(result.after.rpcRequests, 2);
    assert.equal(result.after.outbox, 2);
    assert.equal(result.after.processes, 2);
    assert.equal(result.storage.incrementalVacuumPages, 8);
    assert.equal(typeof result.storage.checkpoint.checkpointedFrames, "number");
    const health = await store.health();
    assert.equal(health.storage.autoVacuum, "incremental");
    assert.ok(health.storage.databaseFileBytes > 0);
    assert.ok(health.storage.walBytes >= 0);
    assert.equal(
      health.storage.totalFileBytes,
      health.storage.databaseFileBytes + health.storage.walBytes + health.storage.shmBytes,
    );
    assert.equal(health.lastMaintenance.ranAt, 10_000);
    assert.deepEqual(health.lastMaintenance.protectedRows, { tasks: 1, runs: 1, artifacts: 1 });
    assert.equal((await store.requireTask(task.id)).id, task.id);
    assert.equal((await store.requireRun(task.id, run.id)).id, run.id);
    assert.equal((await store.getArtifact({ taskId: task.id, taskRunId: run.id, artifactId: "artifact-maintenance" })).content, "immutable");
    await store.close();
  });

  it("quarantines a corrupt database and keeps future startup fail-closed", async () => {
    const root = await temporaryRoot();
    const databaseDirectory = path.join(root, "runtime-state", "task-center-supervisor");
    const databasePath = path.join(databaseDirectory, "task-center.sqlite");
    await mkdir(databaseDirectory, { recursive: true });
    const corruptBytes = Buffer.from("this is not a sqlite database", "utf8");
    await writeFile(databasePath, corruptBytes);
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, now: () => 12_345 });
    await assert.rejects(store.initialize(), /corruption was preserved.*fail-closed/i);
    const files = await readdir(databaseDirectory);
    const preservedName = files.find((name) => name.startsWith("task-center.sqlite.corrupt-"));
    assert.ok(preservedName, `missing preserved database in ${files.join(", ")}`);
    assert.deepEqual(await readFile(path.join(databaseDirectory, preservedName)), corruptBytes);
    assert.ok(files.includes("task-center.sqlite.corruption.json"));
    const marker = JSON.parse(await readFile(path.join(databaseDirectory, "task-center.sqlite.corruption.json"), "utf8"));
    assert.equal(marker.preservedPath, path.join(databaseDirectory, preservedName));

    const restarted = createTaskOrchestratorSqliteStore({ userDataDir: root });
    await assert.rejects(restarted.initialize(), /quarantined after corruption.*manual recovery/i);
    assert.equal((await readdir(databaseDirectory)).includes("task-center.sqlite"), false);
    await restarted.close();
  });
});
