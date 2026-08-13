import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskSupervisorStructuredLog } from "./structured-log.mjs";

test("Supervisor structured log persists bounded redacted crash diagnostics", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supervisor-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = createTaskSupervisorStructuredLog({ userDataDir: root, now: () => 123 });
  await log.recordCrash(Object.assign(new Error("authorization: Bearer top-secret"), { code: "CRASH" }), {
    token: "api_key=very-secret",
  });
  await log.flush();
  const crash = await log.lastCrash();
  const serialized = JSON.stringify(crash);
  assert.equal(crash.at, 123);
  assert.equal(serialized.includes("top-secret"), false);
  assert.equal(serialized.includes("very-secret"), false);
  const line = await readFile(log.paths.logPath, "utf8");
  assert.equal(line.includes("top-secret"), false);
  assert.equal(line.includes("very-secret"), false);
  assert.match(line, /supervisor-crash/);
});
