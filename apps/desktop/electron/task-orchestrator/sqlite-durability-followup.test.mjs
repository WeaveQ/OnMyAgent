import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";

import {
  TASK_CENTER_SQLITE_SCHEMA_VERSION,
  createTaskCenterSchema,
} from "./sqlite-schema.mjs";
import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorSqliteStore } from "./sqlite-store.mjs";
import { createRuntime, taskInput } from "./v2-test-helpers.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-center-durability-followup-"));
  roots.push(root);
  return root;
}

describe("Task Center schema guards and outbox replay", () => {
  it("fails closed for corrupt/newer metadata without overwriting it", async () => {
    const root = await temporaryRoot();
    const dbPath = path.join(root, "metadata.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    db.prepare("INSERT INTO metadata(key, value, updated_at) VALUES('schema_version', '6.0', 1)").run();
    assert.throws(() => createTaskCenterSchema(db), { code: "TASK_CENTER_SCHEMA_VERSION_CORRUPT" });
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, "6.0");
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get(), undefined);
    db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(String(TASK_CENTER_SQLITE_SCHEMA_VERSION + 1));
    assert.throws(() => createTaskCenterSchema(db), { code: "TASK_CENTER_SCHEMA_VERSION_NEWER" });
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, String(TASK_CENTER_SQLITE_SCHEMA_VERSION + 1));
    db.close();
  });

  it("records each migration transactionally and retries an injected step", async () => {
    const root = await temporaryRoot();
    const db = new DatabaseSync(path.join(root, "migration.sqlite"));
    assert.throws(() => createTaskCenterSchema(db, { failMigrationStep: 3, now: 10 }), {
      code: "TASK_CENTER_SCHEMA_MIGRATION_FAILED",
    });
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, "2");
    assert.deepEqual(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => Number(row.version)), [1, 2]);
    createTaskCenterSchema(db, { now: 11 });
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, String(TASK_CENTER_SQLITE_SCHEMA_VERSION));
    assert.deepEqual(
      db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => Number(row.version)),
      Array.from({ length: TASK_CENTER_SQLITE_SCHEMA_VERSION }, (_, index) => index + 1),
    );
    db.close();
  });

  it("single-flights concurrent replay and releases failed delivery back to pending", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, supervisorEpoch: "epoch-followup" });
    await store.initialize();
    await store._serializedTransaction((db) => db.prepare(
      "INSERT INTO tasks(id, revision, workspace_root, definition_status, created_at, updated_at, payload_json) VALUES('task-followup', 1, '/tmp', 'ready', 1, 1, '{}')",
    ).run());
    await store.appendEvent({
      schemaVersion: 2,
      id: "event-followup",
      sequence: 1,
      taskId: "task-followup",
      taskRunId: null,
      attemptId: null,
      type: "alignment-started",
      message: "durable",
      at: 1,
    });
    let release;
    let notifications = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    const slowNotify = async () => {
      notifications += 1;
      await gate;
    };
    const first = store.replayOutbox({ notify: slowNotify });
    const second = store.replayOutbox({ notify: slowNotify });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(notifications, 1);
    release();
    assert.deepEqual(await first, { claimed: 1, delivered: 1, pending: 0 });
    assert.deepEqual(await second, { claimed: 1, delivered: 1, pending: 0 });
    await store.appendEvent({
      schemaVersion: 2,
      id: "event-followup-failure",
      sequence: 2,
      taskId: "task-followup",
      taskRunId: null,
      attemptId: null,
      type: "alignment-message",
      message: "retry",
      at: 2,
    });
    assert.deepEqual(await store.replayOutbox({ notify: () => { throw new Error("temporary recipient failure"); } }), { claimed: 1, delivered: 0, pending: 1 });
    assert.deepEqual(await store.replayOutbox({ notify: () => undefined }), { claimed: 1, delivered: 1, pending: 0 });
    await store.close();
  });

  it("keeps a real orchestrator event pending when the only listener rejects, then replays it once", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root, supervisorEpoch: "epoch-orchestrator" });
    const orchestrator = createTaskOrchestrator({
      userDataDir: root,
      store,
      personalAgentRuntime: createRuntime(),
      pollMs: 1,
    });
    try {
      await orchestrator.createTask({
        ...taskInput(root, { idea: "no connected event recipient" }),
        independentChecker: { mode: "primary-only", profile: null, maxRounds: 1 },
      });
      assert.ok((await store.listOutbox({ statuses: ["pending"] })).some((entry) => entry.event.type === "alignment-started"));
      const rejected = orchestrator.subscribe(() => false);
      await orchestrator.createTask({
        ...taskInput(root, { idea: "reject event recipient" }),
        independentChecker: { mode: "primary-only", profile: null, maxRounds: 1 },
      });
      rejected();
      const pending = await store.listOutbox({ statuses: ["pending"] });
      assert.ok(pending.some((entry) => entry.event.type === "alignment-started"));
      const observed = [];
      const unsubscribe = orchestrator.subscribe((event) => { observed.push(event.id); });
      try {
        const replay = await orchestrator.replayOutbox();
        assert.ok(replay.delivered >= 1);
      } finally {
        unsubscribe();
      }
      assert.ok(observed.length >= 1);
      assert.equal((await store.listOutbox({ statuses: ["pending", "processing"] })).length, 0);
    } finally {
      await orchestrator.close().catch(() => undefined);
    }
  });
});
