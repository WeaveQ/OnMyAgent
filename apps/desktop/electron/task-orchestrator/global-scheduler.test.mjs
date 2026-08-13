import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AdmissionCancelledError,
  SchedulerClosedError,
  createGlobalAdmissionScheduler,
} from "./global-scheduler.mjs";

function request(runId, attemptId, kind = "primary", priority = 0) {
  return { runId, attemptId, kind, priority };
}

describe("global Task Center admission scheduler", () => {
  it("enforces the global active-attempt cap and reports peak/per-run metrics", async () => {
    const scheduler = createGlobalAdmissionScheduler({ maxActiveAttempts: 2, reservedWorkerSlots: 0 });
    const first = scheduler.enqueue(request("run-a", "attempt-a1"));
    const second = scheduler.enqueue(request("run-b", "attempt-b1"));
    const queued = scheduler.enqueue(request("run-a", "attempt-a2"));

    assert.equal(scheduler.snapshot().active, 2);
    assert.equal(scheduler.snapshot().queued, 1);
    assert.equal(scheduler.snapshot().peak, 2);
    assert.deepEqual(scheduler.snapshot().perRun, {
      "run-a": { active: 1, queued: 1, total: 2 },
      "run-b": { active: 1, queued: 0, total: 1 },
    });

    const firstLease = await first;
    const secondLease = await second;
    assert.equal(firstLease.release(), true);
    const queuedLease = await queued;
    assert.equal(scheduler.snapshot().active, 2);
    assert.equal(scheduler.snapshot().peak, 2);
    assert.equal(secondLease.release(), true);
    assert.equal(queuedLease.release(), true);
    assert.equal(scheduler.snapshot().active, 0);
    assert.equal(scheduler.snapshot().queued, 0);
    assert.equal(scheduler.snapshot().perRun["run-a"], undefined);
  });

  it("rotates fairly across runs instead of draining one run first", async () => {
    const order = [];
    const scheduler = createGlobalAdmissionScheduler({
      maxActiveAttempts: 1,
      onAdmit: ({ attemptId, lease }) => {
        order.push(attemptId);
        queueMicrotask(() => lease.release());
      },
    });
    const tickets = [
      scheduler.enqueue(request("run-a", "a1")),
      scheduler.enqueue(request("run-a", "a2")),
      scheduler.enqueue(request("run-a", "a3")),
      scheduler.enqueue(request("run-b", "b1")),
      scheduler.enqueue(request("run-b", "b2")),
    ];

    await Promise.all(tickets);
    assert.deepEqual(order, ["a1", "a2", "b1", "a3", "b2"]);
    assert.equal(scheduler.snapshot().active, 0);
    assert.equal(scheduler.snapshot().queued, 0);
  });

  it("keeps one worker slot reserved while allowing workers to use the full cap", async () => {
    const order = [];
    const scheduler = createGlobalAdmissionScheduler({
      maxActiveAttempts: 4,
      onAdmit: ({ attemptId }) => order.push(attemptId),
    });
    const primaryTickets = [
      scheduler.enqueue(request("run-a", "primary-1", "primary")),
      scheduler.enqueue(request("run-a", "primary-2", "primary")),
      scheduler.enqueue(request("run-b", "primary-3", "resume")),
      scheduler.enqueue(request("run-b", "primary-4", "primary")),
    ];
    const primaryLeases = await Promise.all(primaryTickets.slice(0, 3));
    assert.equal(scheduler.snapshot().active, 3);
    assert.equal(scheduler.snapshot().activeNonWorkers, 3);
    assert.equal(scheduler.snapshot().activeWorkers, 0);
    assert.equal(scheduler.snapshot().reservedWorkerSlots, 1);
    assert.equal(primaryTickets[3].status, "queued");

    const workerTicket = scheduler.enqueue(request("run-c", "worker-1", "worker-follow-up"));
    const workerLease = await workerTicket;
    assert.deepEqual(order, ["primary-1", "primary-2", "primary-3", "worker-1"]);
    assert.equal(scheduler.snapshot().active, 4);
    assert.equal(scheduler.snapshot().activeWorkers, 1);
    assert.equal(scheduler.snapshot().activeNonWorkers, 3);
    assert.equal(primaryTickets[3].status, "queued");

    assert.equal(primaryLeases[0].release(), true);
    const fourthPrimaryLease = await primaryTickets[3];
    assert.equal(scheduler.snapshot().activeNonWorkers, 3);
    assert.equal(fourthPrimaryLease.release(), true);
    assert.equal(primaryLeases[1].release(), true);
    assert.equal(primaryLeases[2].release(), true);
    assert.equal(workerLease.release(), true);
    assert.equal(scheduler.snapshot().active, 0);
  });

  it("prioritizes primary/resume work while bounding worker follow-up starvation", async () => {
    const order = [];
    const scheduler = createGlobalAdmissionScheduler({
      maxActiveAttempts: 1,
      maxPriorityBurst: 2,
      onAdmit: ({ attemptId, lease }) => {
        order.push(attemptId);
        queueMicrotask(() => lease.release());
      },
    });
    const tickets = [
      scheduler.enqueue(request("run-a", "primary-0", "primary")),
      scheduler.enqueue(request("run-b", "worker-0", "worker-follow-up")),
      scheduler.enqueue(request("run-c", "primary-1", "resume")),
      scheduler.enqueue(request("run-d", "primary-2", "primary")),
      scheduler.enqueue(request("run-e", "primary-3", "primary")),
    ];

    await Promise.all(tickets);
    assert.deepEqual(order, ["primary-0", "primary-1", "primary-2", "worker-0", "primary-3"]);
    assert.ok(order.indexOf("worker-0") <= 3, "worker follow-up must be admitted after a bounded high-priority burst");
  });

  it("cancels queued work and makes release idempotent", async () => {
    const scheduler = createGlobalAdmissionScheduler({ maxActiveAttempts: 1 });
    const activeTicket = scheduler.enqueue(request("run-a", "active"));
    const queuedTicket = scheduler.enqueue(request("run-a", "queued"));
    const activeLease = await activeTicket;

    assert.equal(queuedTicket.cancel("user cancelled"), true);
    assert.equal(queuedTicket.cancel("duplicate cancellation"), false);
    await assert.rejects(queuedTicket, (error) => {
      assert.ok(error instanceof AdmissionCancelledError);
      assert.equal(error.code, "SCHEDULER_CANCELLED");
      assert.match(error.message, /user cancelled/);
      return true;
    });
    assert.equal(scheduler.snapshot().queued, 0);
    assert.equal(scheduler.snapshot().active, 1);
    assert.equal(activeLease.release(), true);
    assert.equal(activeLease.release(), false);
    assert.equal(scheduler.release(activeLease), false);
    assert.equal(scheduler.snapshot().active, 0);
  });

  it("rejects queued requests on close and keeps active leases releasable", async () => {
    const scheduler = createGlobalAdmissionScheduler({ maxActiveAttempts: 1 });
    const activeTicket = scheduler.enqueue(request("run-a", "active"));
    const queuedTicket = scheduler.enqueue(request("run-b", "queued"));
    const activeLease = await activeTicket;

    const closed = scheduler.close({ reason: "application quit" });
    assert.equal(closed.closed, true);
    assert.equal(closed.active, 1);
    assert.equal(closed.queued, 0);
    await assert.rejects(queuedTicket, (error) => {
      assert.ok(error instanceof SchedulerClosedError);
      assert.equal(error.code, "SCHEDULER_CLOSED");
      assert.match(error.message, /application quit/);
      return true;
    });
    await assert.rejects(scheduler.enqueue(request("run-c", "after-close")), (error) => {
      assert.ok(error instanceof SchedulerClosedError);
      return true;
    });
    assert.equal(activeLease.release(), true);
    assert.equal(scheduler.close().closed, true);
    assert.equal(scheduler.snapshot().active, 0);
  });

  it("uses deterministic clock hooks for enqueue and admission timestamps", async () => {
    let clock = 100;
    const changes = [];
    const scheduler = createGlobalAdmissionScheduler({
      maxActiveAttempts: 1,
      now: () => clock,
      onChange: (event) => changes.push(event.type),
    });
    const ticket = scheduler.enqueue(request("run-a", "attempt-a"));
    const lease = await ticket;
    assert.equal(lease.admittedAt, 100);
    clock = 250;
    assert.equal(lease.release(), true);
    assert.deepEqual(changes, ["enqueue", "admit", "release"]);
    assert.equal(scheduler.snapshot().active, 0);
  });

  it("bulk-restores the complete durable backlog before dispatch and is idempotent", async () => {
    const order = [];
    const scheduler = createGlobalAdmissionScheduler({
      maxActiveAttempts: 1,
      reservedWorkerSlots: 0,
      onAdmit: ({ attemptId }) => order.push(attemptId),
    });
    const entries = [
      { ...request("run-worker", "worker-first", "worker", 0), sequence: 1, enqueuedAt: 10 },
      { ...request("run-primary", "primary-later", "primary", 100), sequence: 2, enqueuedAt: 10 },
    ];
    const tickets = scheduler.restore(entries);
    assert.deepEqual(order, ["primary-later"]);
    assert.equal(scheduler.restore(entries).length, 0, "repeated startup reconciliation must not duplicate tickets");
    const primaryLease = await tickets[1];
    primaryLease.release();
    const workerLease = await tickets[0];
    assert.deepEqual(order, ["primary-later", "worker-first"]);
    workerLease.release();
  });
});
