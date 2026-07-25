import test from "node:test";
import assert from "node:assert/strict";

import {
  DIRECT_RUNTIME,
  assertOnMyAgentServerReady,
  buildConnectUrls,
  createEngineState,
  createOnMyAgentServerState,
  snapshotEngineState,
  snapshotOnMyAgentServerState,
} from "./runtime-engine-state.mjs";

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
