import assert from "node:assert/strict";
import test from "node:test";

import { probeAcpCommand } from "./acp-probe.mjs";

test("process exit without spawn ENOENT is fail_acp / offline (binary exists)", async () => {
  const result = await probeAcpCommand({
    command: process.execPath,
    args: ["-e", "process.exit(1)"],
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "fail_acp");
  assert.equal(result.status, "offline");
  assert.match(result.error, /ACP process exited: 1|initialize timed out/);
});

test("auth-required stderr plus process exit is needs_auth, not missing", async () => {
  const result = await probeAcpCommand({
    command: process.execPath,
    args: [
      "-e",
      "console.error(\"Authentication required. Please run 'agent login' first\"); process.exit(1);",
    ],
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "needs_auth");
  assert.equal(result.status, "needs_auth");
  assert.match(result.error, /Authentication required/i);
});
