import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  DIRECT_RUNTIME,
  ORCHESTRATOR_RUNTIME,
  isShippedEngineRuntime,
  resolveShippedEngineRuntime,
  assertOnMyAgentServerReady,
  buildConnectUrls,
  createEngineState,
  createOnMyAgentServerState,
  snapshotEngineState,
  snapshotOnMyAgentServerState,
} from "./runtime-engine-state.mjs";

test("shipped engineStart cannot assign onmyagent-orchestrator", () => {
  assert.equal(resolveShippedEngineRuntime(), DIRECT_RUNTIME);
  assert.equal(resolveShippedEngineRuntime(DIRECT_RUNTIME), DIRECT_RUNTIME);
  assert.equal(resolveShippedEngineRuntime(ORCHESTRATOR_RUNTIME), DIRECT_RUNTIME);
  assert.equal(resolveShippedEngineRuntime("onmyagent-orchestrator"), DIRECT_RUNTIME);
  assert.equal(isShippedEngineRuntime(DIRECT_RUNTIME), true);
  assert.equal(isShippedEngineRuntime(ORCHESTRATOR_RUNTIME), false);

  const runtimeSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "runtime.mjs"),
    "utf8",
  );
  const start = runtimeSource.indexOf("async function engineStart");
  const end = runtimeSource.indexOf("async function engineStop");
  assert.ok(start >= 0 && end > start, "engineStart slice missing");
  const slice = runtimeSource.slice(start, end);
  assert.match(slice, /resolveShippedEngineRuntime\(/);
  assert.doesNotMatch(slice, /ORCHESTRATOR_RUNTIME/);
  assert.doesNotMatch(slice, /runtime\s*=\s*options\.runtime/);
});

test("createEngineState defaults to direct runtime", () => {
  const state = createEngineState();
  assert.equal(state.runtime, DIRECT_RUNTIME);
  assert.equal(state.childExited, true);
  const snap = snapshotEngineState(state);
  assert.equal(snap.running, false);
  assert.equal(snap.runtime, DIRECT_RUNTIME);
});

test("snapshotOnMyAgentServerState honors inProcess and tokens", () => {
  const state = createOnMyAgentServerState();
  state.inProcess = true;
  state.baseUrl = "http://127.0.0.1:48000";
  state.ownerToken = "tok";
  const snap = snapshotOnMyAgentServerState(state);
  assert.equal(snap.running, true);
  assert.equal(assertOnMyAgentServerReady(snap), snap);
});

test("assertOnMyAgentServerReady rejects incomplete snapshots", () => {
  assert.throws(
    () => assertOnMyAgentServerReady({ running: false }),
    /did not stay running/,
  );
  assert.throws(
    () =>
      assertOnMyAgentServerReady({
        running: true,
        baseUrl: "http://x",
      }),
    /access token/,
  );
});

test("buildConnectUrls returns url fields", () => {
  const urls = buildConnectUrls(1234);
  assert.ok("connectUrl" in urls);
  assert.ok("mdnsUrl" in urls);
  assert.ok("lanUrl" in urls);
});
