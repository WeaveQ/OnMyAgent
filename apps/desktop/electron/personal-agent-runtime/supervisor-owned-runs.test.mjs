import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  readSupervisorOwnedRunIds,
  resolveTaskSupervisorRegistryFile,
  shouldFinalizeOrphanRunLog,
  supervisorOwnedRunIdsFromRegistry,
  TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE,
} from "./supervisor-owned-runs.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("supervisor-owned run skip", () => {
  it("reads run ids only from the Task Supervisor registry namespace", () => {
    assert.deepEqual(
      [...supervisorOwnedRunIdsFromRegistry({
        namespace: "task-supervisor",
        processes: [{ runId: "sup-1" }, { runId: "sup-2" }],
      })].sort(),
      ["sup-1", "sup-2"],
    );
    assert.deepEqual(
      [...supervisorOwnedRunIdsFromRegistry({
        namespace: "electron-personal",
        processes: [{ runId: "personal-1" }],
      })],
      [],
    );
  });

  it("does not finalize a Supervisor-owned run that is absent from main memory", () => {
    const supervisorOwnedRunIds = new Set(["task-run"]);
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "task-run",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds,
      }),
      false,
    );
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "personal-run",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds,
      }),
      true,
    );
  });

  it("still skips in-memory and post-cutoff personal runs", () => {
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "live",
        inMemory: true,
        startedAt: 1,
        reconcileCutoffMs: 100,
      }),
      false,
    );
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "fresh",
        inMemory: false,
        startedAt: 200,
        reconcileCutoffMs: 100,
      }),
      false,
    );
  });

  it("loads live Supervisor run ids from the shipped registry path", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "supervisor-owned-runs-"));
    roots.push(userDataDir);
    const filePath = resolveTaskSupervisorRegistryFile(userDataDir);
    assert.equal(
      filePath,
      path.join(userDataDir, TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE),
    );
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        namespace: "task-supervisor",
        processes: [{ runId: "sup-live", status: "running" }],
      }, null, 2)}\n`,
      "utf8",
    );
    const ids = await readSupervisorOwnedRunIds(userDataDir);
    assert.deepEqual([...ids], ["sup-live"]);
    assert.deepEqual([...(await readSupervisorOwnedRunIds(""))], []);
  });

  it("main-process reconcile and Task Supervisor share the same registry relative path", async () => {
    const [runtimeSource, supervisorSource] = await Promise.all([
      readFile(new URL("./index.mjs", import.meta.url), "utf8"),
      readFile(new URL("../task-supervisor/service.mjs", import.meta.url), "utf8"),
    ]);
    assert.match(runtimeSource, /readSupervisorOwnedRunIds\(/);
    assert.match(runtimeSource, /shouldFinalizeOrphanRunLog\(/);
    assert.match(
      supervisorSource,
      /runtime-state["'].*task-center-supervisor["'].*personal-agent-process-registry\.json/,
    );
    assert.equal(
      TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE,
      path.join("runtime-state", "task-center-supervisor", "personal-agent-process-registry.json"),
    );
  });
});
