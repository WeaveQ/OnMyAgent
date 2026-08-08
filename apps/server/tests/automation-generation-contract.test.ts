import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError } from "../src/core/errors.js";
import {
  cancelAutomationRun,
  isBenignAutomationAbortError,
} from "../src/services/automation-cancel.js";
import {
  bindAutomationRunSession,
  claimManualAutomation,
  createAutomation,
  listAutomations,
  recordAutomationRun,
} from "../src/services/automations.js";

describe("automation generation / stop contract", () => {
  test("stale lease cannot finalize after a newer generation is claimed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oma-auto-gen-stale-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Stale lease",
      prompt: "work",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const first = await claimManualAutomation(workspace, task.id);
    const oldLease = first.running.leaseId;

    // Simulate reclaim / replace: clear then claim again with a new lease.
    await recordAutomationRun(
      workspace,
      task.id,
      {
        status: "skipped",
        source: "manual",
        ranAt: Date.now(),
        error: "Cancelled by user",
      },
      oldLease,
    );
    const second = await claimManualAutomation(workspace, task.id);
    expect(second.running.leaseId).not.toBe(oldLease);

    const afterStale = await recordAutomationRun(
      workspace,
      task.id,
      {
        status: "success",
        source: "scheduled",
        ranAt: Date.now() + 1,
        sessionId: "ses_old",
      },
      oldLease,
    );
    expect(afterStale?.running?.leaseId).toBe(second.running.leaseId);
    expect(afterStale?.lastRun?.sessionId).not.toBe("ses_old");

    const listed = await listAutomations(workspace);
    expect(listed[0]?.running?.leaseId).toBe(second.running.leaseId);
  });

  test("missing lease cannot clear an active run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oma-auto-gen-nolease-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Needs lease",
      prompt: "work",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const claimed = await claimManualAutomation(workspace, task.id);
    const after = await recordAutomationRun(workspace, task.id, {
      status: "success",
      source: "manual",
      ranAt: Date.now(),
      sessionId: "ses_no_lease",
    });
    expect(after?.running?.leaseId).toBe(claimed.running.leaseId);
    expect(after?.lastRun?.sessionId).not.toBe("ses_no_lease");
  });

  test("late success after cancel is ignored", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oma-auto-gen-late-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Late write",
      prompt: "work",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const claimed = await claimManualAutomation(workspace, task.id);
    const leaseId = claimed.running.leaseId;

    await cancelAutomationRun(workspace, task.id, {
      abortSession: async () => {},
    });
    const listedAfterCancel = await listAutomations(workspace);
    expect(listedAfterCancel[0]?.running).toBeNull();
    expect(listedAfterCancel[0]?.lastRun?.error).toBe("Cancelled by user");

    const afterLate = await recordAutomationRun(
      workspace,
      task.id,
      {
        status: "success",
        source: "manual",
        ranAt: Date.now() + 5,
        sessionId: "ses_late",
      },
      leaseId,
    );
    expect(afterLate?.running).toBeNull();
    expect(afterLate?.lastRun?.error).toBe("Cancelled by user");
    expect(afterLate?.lastRun?.sessionId).not.toBe("ses_late");
  });

  test("cancel aborts session before clearing lease", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oma-auto-gen-abort-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Abort first",
      prompt: "work",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const claimed = await claimManualAutomation(workspace, task.id);
    // Bind session fields onto the lease the way the runner does.
    await bindAutomationRunSession(
      workspace,
      task.id,
      claimed.running.leaseId,
      "ses_abort",
      "group",
      join(workspace, "out"),
    );

    const aborted: string[] = [];
    await cancelAutomationRun(workspace, task.id, {
      abortSession: async (running) => {
        aborted.push(running.sessionId ?? "");
      },
    });
    expect(aborted).toEqual(["ses_abort"]);
    const listed = await listAutomations(workspace);
    expect(listed[0]?.running).toBeNull();
    expect(listed[0]?.lastRun?.error).toBe("Cancelled by user");
  });

  test("cancel keeps lease when abort fails so stop can be retried", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oma-auto-gen-stopfail-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Stop fail",
      prompt: "work",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const claimed = await claimManualAutomation(workspace, task.id);
    await bindAutomationRunSession(
      workspace,
      task.id,
      claimed.running.leaseId,
      "ses_fail",
      "group",
      join(workspace, "out"),
    );

    let error: unknown;
    try {
      await cancelAutomationRun(workspace, task.id, {
        abortSession: async () => {
          throw new Error("connection refused");
        },
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("automation_stop_failed");

    const listed = await listAutomations(workspace);
    expect(listed[0]?.running?.leaseId).toBe(claimed.running.leaseId);
    expect(listed[0]?.running?.sessionId).toBe("ses_fail");
  });

  test("cancel with wrong leaseId is rejected", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oma-auto-gen-mismatch-"));
    const task = await createAutomation(workspace, {
      scene: "office",
      title: "Mismatch",
      prompt: "work",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    await claimManualAutomation(workspace, task.id);

    let error: unknown;
    try {
      await cancelAutomationRun(workspace, task.id, {
        leaseId: "not-the-active-lease",
        abortSession: async () => {},
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("automation_lease_mismatch");
    const listed = await listAutomations(workspace);
    expect(listed[0]?.running).not.toBeNull();
  });

  test("benign abort errors allow lease clear", () => {
    expect(
      isBenignAutomationAbortError(
        new ApiError(502, "opencode_request_failed", "OpenCode request failed: not found", {
          status: 404,
        }),
      ),
    ).toBe(true);
    expect(
      isBenignAutomationAbortError(new Error("session already stopped")),
    ).toBe(true);
    expect(isBenignAutomationAbortError(new Error("connection refused"))).toBe(
      false,
    );
    // Bare "aborted" must not mask real failures.
    expect(isBenignAutomationAbortError(new Error("request aborted by proxy"))).toBe(
      false,
    );
  });
});
