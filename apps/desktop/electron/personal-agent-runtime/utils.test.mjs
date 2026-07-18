import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  forceKillProcessTree,
  resolveProcessTreeKillPlan,
  waitForExit,
  writeJsonFile,
} from "./utils.mjs";

test("writeJsonFile survives concurrent writers to same target (no ENOENT rename race)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "onmyagent-writejson-"));
  try {
    const target = path.join(dir, "session.json");
    const N = 20;
    const jobs = Array.from({ length: N }, (_, i) => writeJsonFile(target, { i, at: Date.now() }));
    const results = await Promise.allSettled(jobs);
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(rejected.length, 0, `expected no rejections, got ${rejected.length}: ${rejected.map((r) => r.reason?.message).join(", ")}`);
    const parsed = JSON.parse(await readFile(target, "utf8"));
    assert.ok(typeof parsed.i === "number" && parsed.i >= 0 && parsed.i < N, "final content should be one of the writes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveProcessTreeKillPlan uses taskkill /T /F on win32", () => {
  const plan = resolveProcessTreeKillPlan({ platform: "win32", pid: 4242, force: true });
  assert.equal(plan.kind, "taskkill");
  assert.equal(plan.command, "taskkill");
  assert.deepEqual(plan.args, ["/pid", "4242", "/T", "/F"]);
});

test("resolveProcessTreeKillPlan soft taskkill omits /F when force=false", () => {
  const plan = resolveProcessTreeKillPlan({ platform: "win32", pid: 99, force: false });
  assert.equal(plan.kind, "taskkill");
  assert.deepEqual(plan.args, ["/pid", "99", "/T"]);
  assert.ok(!plan.args.includes("/F"));
});

test("resolveProcessTreeKillPlan uses posix process-group signals off Windows", () => {
  for (const platform of ["darwin", "linux"]) {
    const plan = resolveProcessTreeKillPlan({ platform, pid: 1001, force: true });
    assert.equal(plan.kind, "posix-group");
    assert.deepEqual(plan.signals, ["SIGTERM", "SIGKILL"]);
  }
});

test("resolveProcessTreeKillPlan is noop without pid", () => {
  assert.equal(resolveProcessTreeKillPlan({ platform: "win32", pid: 0 }).kind, "noop");
  assert.equal(resolveProcessTreeKillPlan({ platform: "win32" }).kind, "noop");
});

test("forceKillProcessTree falls back to child.kill when no pid (mock platform)", () => {
  const signals = [];
  const child = {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      signals.push(signal);
    },
  };
  forceKillProcessTree(child, { platform: "win32" });
  assert.deepEqual(signals, ["SIGKILL"]);
});

test("forceKillProcessTree is a no-op when child already exited", () => {
  const signals = [];
  const child = {
    pid: 12,
    exitCode: 0,
    signalCode: null,
    kill(signal) {
      signals.push(signal);
    },
  };
  forceKillProcessTree(child, { platform: "darwin" });
  assert.deepEqual(signals, []);
});

test("waitForExit resolves immediately when child already closed", async () => {
  const child = { exitCode: 0, signalCode: null, once() {} };
  await waitForExit(child, 50);
});

test("waitForExit force-kills the tree after timeout", async () => {
  const signals = [];
  // Plain ChildProcess-shaped stub (not EventEmitter) so electron tsc accepts
  // pid/exitCode/signalCode/kill without TS2339 on EventEmitter.
  const child = {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      signals.push(signal);
    },
    once(_event, _handler) {
      // Timeout path is under test; never emit "close".
    },
  };
  const started = Date.now();
  await waitForExit(child, 30);
  assert.ok(Date.now() - started >= 25, "should wait at least the timeout");
  assert.deepEqual(signals, ["SIGKILL"]);
});
