import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIVENESS_DEFAULTS,
  LIVENESS_VERDICT,
  classifyLiveness,
  evaluateLiveness,
} from "./liveness-oracle.mjs";

const NOW = 100_000;

function flatRunning(overrides = {}) {
  return {
    process: { pid: 42, state: "running" },
    child: { state: "none" },
    socket: { established: false, moving: false },
    activity: { lastProgressAt: 0, cpuDeltaMs: 0, ioDeltaBytes: 0 },
    ...overrides,
  };
}

describe("Task Center liveness oracle", () => {
  it("classifies a live child as WORKING and an exited child as DEAD only after grace", () => {
    const working = classifyLiveness(flatRunning({ child: { state: "running" } }), { now: NOW });
    assert.equal(working.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(working.reason, "child-running");
    assert.equal(working.terminationRecommended, false);

    const insideGrace = classifyLiveness(flatRunning({
      child: { state: "exited", exitedAt: NOW - 2_999 },
      activity: { lastProgressAt: NOW - 1, cpuDeltaMs: 0, ioDeltaBytes: 0 },
    }), { now: NOW, childExitGraceMs: 3_000 });
    assert.equal(insideGrace.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(insideGrace.reason, "child-exit-grace");
    assert.equal(insideGrace.terminationRecommended, false);

    const afterGrace = classifyLiveness(flatRunning({
      child: { state: "exited", exitedAt: NOW - 3_000 },
    }), { now: NOW, childExitGraceMs: 3_000 });
    assert.equal(afterGrace.verdict, LIVENESS_VERDICT.DEAD);
    assert.equal(afterGrace.reason, "child-exited");
    assert.equal(afterGrace.terminationRecommended, true);
  });

  it("treats a declared wait or approval as WORKING", () => {
    const declaredWait = classifyLiveness({
      declaredWait: { active: true, kind: "tool", until: NOW + 5_000 },
      activity: { lastProgressAt: 0 },
    }, { now: NOW });
    assert.equal(declaredWait.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(declaredWait.reason, "declared-wait-active");

    const approval = classifyLiveness({
      declaredWait: { active: true, kind: "approval" },
      activity: { lastProgressAt: 0 },
    }, { now: NOW });
    assert.equal(approval.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(approval.reason, "approval-wait-active");
  });

  it("classifies an unowned stdin wait as STUCK_INPUT but never overrides an approval", () => {
    const stuck = classifyLiveness(flatRunning({ stdin: { waiting: true } }), { now: NOW });
    assert.equal(stuck.verdict, LIVENESS_VERDICT.STUCK_INPUT);
    assert.equal(stuck.reason, "stdin-wait");
    assert.equal(stuck.terminationRecommended, true);

    const approval = classifyLiveness(flatRunning({
      stdin: { waiting: true },
      declaredWait: { active: true, kind: "approval" },
    }), { now: NOW });
    assert.equal(approval.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(approval.terminationRecommended, false);
  });

  it("uses socket movement as WORKING evidence and an idle established socket as UNKNOWN", () => {
    const moving = classifyLiveness(flatRunning({
      socket: { established: true, moving: true },
    }), { now: NOW });
    assert.equal(moving.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(moving.reason, "socket-movement");

    const waiting = classifyLiveness(flatRunning({
      socket: { established: true, moving: false },
    }), { now: NOW });
    assert.equal(waiting.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(waiting.reason, "socket-wait");
    assert.equal(waiting.terminationRecommended, false);
  });

  it("uses CPU or IO movement as WORKING evidence", () => {
    const cpu = classifyLiveness(flatRunning({
      activity: { lastProgressAt: 0, cpuDeltaMs: 1, ioDeltaBytes: 0 },
    }), { now: NOW });
    assert.equal(cpu.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(cpu.reason, "resource-movement");

    const io = classifyLiveness(flatRunning({
      activity: { lastProgressAt: 0, cpuDeltaMs: 0, ioDeltaBytes: 16 },
    }), { now: NOW });
    assert.equal(io.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(io.reason, "resource-movement");
  });

  it("uses active time since last progress without guessing from wall time alone", () => {
    const recent = classifyLiveness(flatRunning({
      activity: { lastProgressAt: NOW - 9_999, cpuDeltaMs: 0, ioDeltaBytes: 0 },
    }), { now: NOW, stallAfterMs: 10_000 });
    assert.equal(recent.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(recent.activeIdleMs, 9_999);

    const staleFlat = classifyLiveness(flatRunning({
      activity: { lastProgressAt: NOW - 10_000, cpuDeltaMs: 0, ioDeltaBytes: 0 },
    }), { now: NOW, stallAfterMs: 10_000 });
    assert.equal(staleFlat.verdict, LIVENESS_VERDICT.DEAD);
    assert.equal(staleFlat.reason, "stale-flat-process");
  });

  it("subtracts sleep and completed approval waits from the stall budget", () => {
    const excluded = classifyLiveness(flatRunning({
      activity: { lastProgressAt: 0, cpuDeltaMs: 0, ioDeltaBytes: 0 },
      exclusions: { sleepMs: 50_000, approvalMs: 45_001 },
    }), { now: NOW, stallAfterMs: 10_000 });
    assert.equal(excluded.verdict, LIVENESS_VERDICT.WORKING);
    assert.equal(excluded.activeIdleMs, 4_999);

    const wallTimeOnly = classifyLiveness(flatRunning(), { now: NOW, stallAfterMs: 10_000 });
    assert.equal(wallTimeOnly.verdict, LIVENESS_VERDICT.DEAD);
  });

  it("returns UNKNOWN for a missing PID or malformed evidence", () => {
    const missingPid = classifyLiveness({
      process: { state: "running" },
      child: { state: "running" },
      activity: { lastProgressAt: 0 },
    }, { now: NOW });
    assert.equal(missingPid.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(missingPid.reason, "missing-pid");
    assert.equal(missingPid.terminationRecommended, false);

    const garbage = classifyLiveness({
      process: { pid: "not-a-pid", state: "busy forever" },
      child: { state: 7, exitedAt: "never" },
      stdin: { waiting: "yes" },
    }, { now: NOW });
    assert.equal(garbage.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(garbage.reason, "invalid-evidence");
    assert.equal(garbage.terminationRecommended, false);

    const nonObject = classifyLiveness("garbage", { now: NOW });
    assert.equal(nonObject.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(nonObject.terminationRecommended, false);
  });

  it("combines injected probes without performing its own OS inspection", async () => {
    const calls = [];
    const verdict = await evaluateLiveness({ activity: { lastProgressAt: 0 } }, {
      now: () => NOW,
      probes: {
        process: ({ now }) => {
          calls.push(["process", now]);
          return { process: { pid: 777, state: "running" } };
        },
        child: ({ now }) => {
          calls.push(["child", now]);
          return { child: { state: "running" } };
        },
      },
    });
    assert.equal(verdict.verdict, LIVENESS_VERDICT.WORKING);
    assert.deepEqual(calls, [["process", NOW], ["child", NOW]]);
  });

  it("turns every probe error, timeout, or malformed result into non-actionable UNKNOWN", async () => {
    const workingInput = flatRunning({ child: { state: "running" } });
    const errored = await evaluateLiveness(workingInput, {
      now: NOW,
      probes: { process: () => { throw new Error("Bearer top-secret-token"); } },
    });
    assert.equal(errored.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(errored.reason, "probe-failure");
    assert.equal(errored.terminationRecommended, false);

    const timedOut = await evaluateLiveness(workingInput, {
      now: NOW,
      probes: { process: () => new Promise(() => undefined) },
      probeTimeoutMs: 5,
      setTimer: (callback) => {
        queueMicrotask(callback);
        return { unref() {} };
      },
      clearTimer: () => undefined,
    });
    assert.equal(timedOut.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(timedOut.evidence[0].code, "probe-timeout");
    assert.equal(timedOut.terminationRecommended, false);

    const malformed = await evaluateLiveness(workingInput, {
      now: NOW,
      probes: { process: () => "garbage" },
    });
    assert.equal(malformed.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.equal(malformed.evidence[0].code, "probe-invalid");
    assert.equal(malformed.terminationRecommended, false);
  });

  it("bounds diagnostics and never includes raw probe values or errors", async () => {
    const secret = "top-secret-credential";
    const fromProbe = await evaluateLiveness({}, {
      now: NOW,
      probes: {
        process: () => ({
          process: { pid: 1, state: "running", command: `/bin/tool --token=${secret}` },
          rawEnvironment: { API_KEY: secret },
        }),
        activity: () => ({
          activity: { lastProgressAt: NOW - 1, cpuDeltaMs: 0, ioDeltaBytes: 0, detail: secret },
        }),
      },
    });
    assert.equal(fromProbe.verdict, LIVENESS_VERDICT.WORKING);
    assert.doesNotMatch(JSON.stringify(fromProbe), new RegExp(secret));

    const bounded = classifyLiveness({
      process: { pid: secret, state: secret },
      child: { state: secret, exitedAt: secret },
      declaredWait: { active: secret, kind: secret, until: secret },
      stdin: { waiting: secret },
      socket: { established: secret, moving: secret },
      activity: { cpuDeltaMs: secret, ioDeltaBytes: secret, lastProgressAt: secret },
      exclusions: { sleepMs: secret, approvalMs: secret },
    }, { now: NOW });
    assert.equal(bounded.verdict, LIVENESS_VERDICT.UNKNOWN);
    assert.ok(bounded.evidence.length <= LIVENESS_DEFAULTS.maxEvidenceItems);
    assert.doesNotMatch(JSON.stringify(bounded), new RegExp(secret));
  });
});
