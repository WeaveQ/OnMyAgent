import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TaskOrchestratorArtifactContentResult,
  TaskOrchestratorDesktopEvent,
  TaskOrchestratorEvent,
  TaskOrchestratorHandoffArtifact,
  TaskOrchestratorTaskListResult,
  TaskOrchestratorTurnHistoryItem,
} from "@onmyagent/types";

import { coalesceTaskCenterQueryInvalidations, flattenTaskCenterTurnHistoryPages, isTaskCenterRevisionConflict, loadTaskCenterArtifactContent, loadTaskCenterTaskList, taskCenterArtifactsQueryKey, taskCenterCanLoadSnapshot, taskCenterDesktopEventInvalidations, taskCenterDesktopEventScope, taskCenterEventTouchesList, taskCenterListQueryKey, taskCenterOperationsDiagnosticsPollInterval, taskCenterOperationsDiagnosticsQueryKey, taskCenterTurnHistoryNextCursor, taskCenterTurnHistoryQueryKey } from "./task-center-query";

const list = {
  issues: [],
  tasks: [{
    id: "task-1",
    revision: 1,
    idea: "Task idea",
    workspaceRoot: "/workspace",
    definitionStatus: "ready",
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    latestRunId: "run-1",
    latestRunStatus: "running",
    currentActor: "primary",
    currentTurn: 1,
    pauseReason: null,
    resumeEligible: false,
    updatedAt: 1,
  }],
} satisfies TaskOrchestratorTaskListResult;

const lifecycleEvent = {
  schemaVersion: 2,
  id: "event-1",
  sequence: 1,
  taskId: "task-1",
  taskRunId: "run-1",
  attemptId: "attempt-1",
  turnId: "turn-1",
  type: "primary-succeeded",
  message: "Primary attempt succeeded.",
  at: 2,
} satisfies TaskOrchestratorEvent;

describe("Task Center v2 event invalidation", () => {
  it("waits for the v2 list and never loads a stale legacy task id", () => {
    assert.equal(taskCenterCanLoadSnapshot("legacy-task", undefined), false);
    assert.equal(taskCenterCanLoadSnapshot("legacy-task", list), false);
    assert.equal(taskCenterCanLoadSnapshot("task-1", list), true);
  });

  it("refreshes snapshots and lists for nullable alignment events", () => {
    const alignmentEvent = { taskId: "task-1", taskRunId: null } satisfies Pick<TaskOrchestratorEvent, "taskId" | "taskRunId">;
    assert.equal(taskCenterEventTouchesList(alignmentEvent, undefined, "task-1"), true);
    assert.equal(taskCenterEventTouchesList(alignmentEvent, list, null), true);
  });

  it("matches a known run and ignores unrelated or malformed events", () => {
    const runEvent = { taskId: "other-task", taskRunId: "run-1" } satisfies Pick<TaskOrchestratorEvent, "taskId" | "taskRunId">;
    assert.equal(taskCenterEventTouchesList(runEvent, list, null), true);
    assert.equal(taskCenterEventTouchesList({ taskId: "other-task", taskRunId: "other-run" }, list, null), false);
    assert.equal(taskCenterEventTouchesList({ taskId: "", taskRunId: null }, list, null), false);
  });

  it("treats Supervisor reconnect as a full query resync instead of a malformed task event", () => {
    const event = {
      type: "task-supervisor-resync",
      sequence: 0,
      supervisorEpoch: "epoch-2",
      coveredScopes: ["task-list"],
      snapshot: list,
    } satisfies TaskOrchestratorDesktopEvent;
    assert.deepEqual(taskCenterDesktopEventScope(event), { resync: true, taskId: null });
    assert.deepEqual(taskCenterDesktopEventInvalidations({
      event,
      workspaceRoot: "/workspace",
      list,
      selectedTaskId: "task-1",
    }), [{ queryKey: ["task-center"] }]);
  });

  it("invalidates artifact pages for the task that emitted a durable lifecycle event", () => {
    const invalidations = taskCenterDesktopEventInvalidations({
      event: lifecycleEvent,
      workspaceRoot: "/workspace",
      list,
      selectedTaskId: "task-1",
    });
    assert.deepEqual(
      invalidations.find(({ queryKey }) => queryKey[1] === "artifacts"),
      { queryKey: taskCenterArtifactsQueryKey("task-1", "run-1").slice(0, 3) },
    );
    assert.ok(invalidations.some(({ queryKey, exact }) => (
      exact === true && JSON.stringify(queryKey) === JSON.stringify(taskCenterListQueryKey("/workspace"))
    )));
  });

  it("does not refresh the selected task when an unrelated task emits an event", () => {
    const invalidations = taskCenterDesktopEventInvalidations({
      event: { ...lifecycleEvent, id: "event-2", taskId: "task-2", taskRunId: "run-2" },
      workspaceRoot: "/workspace",
      list,
      selectedTaskId: "task-1",
    });
    assert.ok(invalidations.some(({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(["task-center", "artifacts", "task-2"])));
    assert.ok(!invalidations.some(({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(["task-center", "artifacts", "task-1"])));
    assert.ok(!invalidations.some(({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(taskCenterListQueryKey("/workspace"))));
  });

  it("coalesces burst invalidations and lets a Supervisor resync subsume scoped keys", () => {
    const scoped = taskCenterDesktopEventInvalidations({
      event: lifecycleEvent,
      workspaceRoot: "/workspace",
      list,
      selectedTaskId: "task-1",
    });
    assert.equal(coalesceTaskCenterQueryInvalidations([...scoped, ...scoped]).length, scoped.length);
    assert.deepEqual(coalesceTaskCenterQueryInvalidations([
      ...scoped,
      { queryKey: ["task-center"] },
      ...scoped,
    ]), [{ queryKey: ["task-center"] }]);
  });

  it("recognizes revision conflicts without treating arbitrary provider errors as stale revisions", () => {
    assert.equal(isTaskCenterRevisionConflict(new Error("Task revision conflict: expected 3, found 4")), true);
    assert.equal(isTaskCenterRevisionConflict("expected revision 7"), true);
    assert.equal(isTaskCenterRevisionConflict(new Error("provider unavailable")), false);
  });
});

describe("Task Center task-list contract compatibility", () => {
  it("uses every page exposed by a pagination-aware Supervisor", async () => {
    const requests: unknown[] = [];
    const result = await loadTaskCenterTaskList({
      workspaceRoot: "/workspace",
      loadPage: async (input) => {
        const request = input ?? {};
        requests.push(request);
        if (request.cursor === null) return { ...list, nextCursor: "page-2", hasMore: true };
        return { tasks: [{ ...list.tasks[0], id: "task-2" }], issues: ["second-page"], nextCursor: null, hasMore: false };
      },
    });
    assert.deepEqual(requests, [
      { workspaceRoot: "/workspace", cursor: null, limit: 200 },
      { workspaceRoot: "/workspace", cursor: "page-2", limit: 200 },
    ]);
    assert.deepEqual(result.tasks.map((task) => task.id), ["task-1", "task-2"]);
    assert.deepEqual(result.issues, ["second-page"]);
  });

  it("falls back once when a detached legacy Supervisor rejects cursor and limit", async () => {
    const requests: unknown[] = [];
    const result = await loadTaskCenterTaskList({
      workspaceRoot: "/workspace",
      loadPage: async (input) => {
        const request = input ?? {};
        requests.push(request);
        if ("cursor" in request || "limit" in request) {
          throw new Error('Error invoking remote method: [{"code":"unrecognized_keys","keys":["cursor","limit"]}]');
        }
        return list;
      },
    });
    assert.deepEqual(requests, [
      { workspaceRoot: "/workspace", cursor: null, limit: 200 },
      { workspaceRoot: "/workspace" },
    ]);
    assert.deepEqual(result, { ...list, nextCursor: null, hasMore: false });
  });

  it("does not hide unrelated task-list failures", async () => {
    await assert.rejects(
      loadTaskCenterTaskList({
        workspaceRoot: "/workspace",
        loadPage: async () => { throw new Error("Supervisor database unavailable"); },
      }),
      /database unavailable/,
    );
  });
});

describe("Task Center immutable turn history query", () => {
  it("keeps task/run deep-link identity in a cursor query key", () => {
    assert.deepEqual(taskCenterTurnHistoryQueryKey("task-1", "run-old"), ["task-center", "turn-history", "task-1", "run-old"]);
    assert.equal(taskCenterTurnHistoryNextCursor({ hasMore: true, nextCursor: "cursor-2" }), "cursor-2");
    assert.equal(taskCenterTurnHistoryNextCursor({ hasMore: true, nextCursor: null }), undefined);
    assert.equal(taskCenterTurnHistoryNextCursor({ hasMore: false, nextCursor: "cursor-ignored" }), undefined);
  });

  it("flattens immutable pages without falling back to compact snapshot turns", () => {
    const item = { turn: { id: "turn-1" } } as unknown as TaskOrchestratorTurnHistoryItem;
    const next = { turn: { id: "turn-2" } } as unknown as TaskOrchestratorTurnHistoryItem;
    assert.deepEqual(flattenTaskCenterTurnHistoryPages([{ items: [item] }, { items: [next] }]), [item, next]);
  });
});

describe("Task Center operations diagnostics query", () => {
  it("keeps task/run identity and polls only active runs", () => {
    assert.deepEqual(taskCenterOperationsDiagnosticsQueryKey("task-1", "run-1"), ["task-center", "operations-diagnostics", "task-1", "run-1"]);
    assert.equal(taskCenterOperationsDiagnosticsPollInterval("running"), 5_000);
    assert.equal(taskCenterOperationsDiagnosticsPollInterval("waiting-approval"), 5_000);
    assert.equal(taskCenterOperationsDiagnosticsPollInterval("succeeded"), false);
    assert.equal(taskCenterOperationsDiagnosticsPollInterval(null), false);
  });
});

const artifactMetadata: TaskOrchestratorArtifactContentResult["artifact"] = {
  schemaVersion: 2,
  id: "artifact-1",
  taskId: "task-1",
  taskRunId: "run-1",
  taskRevision: 1,
  attemptId: "attempt-1",
  turnId: null,
  kind: "primary",
  summary: "Large artifact",
  evidenceCount: 3,
  contentBytes: 10,
  contentSha256: "0".repeat(64),
  createdAt: 1,
};

const evidence = (label: string): TaskOrchestratorHandoffArtifact["evidence"][number] => ({
  kind: "test",
  provenance: "runtime-observed",
  label,
  value: label,
  status: "passed",
  exitCode: 0,
  path: null,
});

describe("Task Center bounded artifact loader", () => {
  it("reconstructs content and every evidence page from immutable cursors", async () => {
    const content = "你好🌙世界abc";
    const allEvidence = [evidence("one"), evidence("two"), evidence("three")];
    const requests: Array<{ offset: number; evidenceOffset: number }> = [];
    const artifact = await loadTaskCenterArtifactContent({
      taskId: "task-1",
      taskRunId: "run-1",
      artifactId: "artifact-1",
      loadChunk: async (input) => {
        const offset = input.offset ?? 0;
        const currentEvidenceOffset = input.evidenceOffset ?? 0;
        requests.push({ offset, evidenceOffset: currentEvidenceOffset });
        const contentChunk = content.slice(offset, offset + 4);
        const nextOffset = offset + contentChunk.length;
        const page = {
          artifact: artifactMetadata,
          offset,
          contentChunk,
          nextOffset: nextOffset < content.length ? nextOffset : null,
          complete: nextOffset >= content.length,
          totalChars: content.length,
          evidenceOffset: currentEvidenceOffset,
          evidence: allEvidence.slice(currentEvidenceOffset, currentEvidenceOffset + 2),
          nextEvidenceOffset: currentEvidenceOffset + allEvidence.slice(currentEvidenceOffset, currentEvidenceOffset + 2).length < allEvidence.length ? currentEvidenceOffset + allEvidence.slice(currentEvidenceOffset, currentEvidenceOffset + 2).length : null,
          evidenceComplete: currentEvidenceOffset + allEvidence.slice(currentEvidenceOffset, currentEvidenceOffset + 2).length >= allEvidence.length,
          totalEvidence: allEvidence.length,
        } satisfies TaskOrchestratorArtifactContentResult;
        return page;
      },
    });

    assert.equal(artifact.content, content);
    assert.deepEqual(artifact.evidence.map((item) => item.label), ["one", "two", "three"]);
    assert.deepEqual(requests, [
      { offset: 0, evidenceOffset: 0 },
      { offset: 4, evidenceOffset: 2 },
      { offset: 8, evidenceOffset: 3 },
    ]);
  });

  it("does not call ArtifactGet for a large legacy response", async () => {
    const content = "x".repeat(64_001);
    let fullCalls = 0;
    const artifact = await loadTaskCenterArtifactContent({
      taskId: "task-1",
      taskRunId: "run-1",
      artifactId: "artifact-1",
      loadChunk: async (input) => {
        const offset = input.offset ?? 0;
        const contentChunk = content.slice(offset, offset + 64_000);
        const nextOffset = offset + contentChunk.length;
        return {
          artifact: { ...artifactMetadata, evidenceCount: 0, contentBytes: content.length },
          offset,
          contentChunk,
          nextOffset: nextOffset < content.length ? nextOffset : null,
          complete: nextOffset >= content.length,
          totalChars: content.length,
        } as TaskOrchestratorArtifactContentResult;
      },
      loadFull: async () => {
        fullCalls += 1;
        throw new Error("ArtifactGet must not be used for large content");
      },
    });

    assert.equal(artifact.content, content);
    assert.deepEqual(artifact.evidence, []);
    assert.equal(fullCalls, 0);
  });
});
