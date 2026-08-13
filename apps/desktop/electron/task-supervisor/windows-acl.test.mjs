import assert from "node:assert/strict";
import test from "node:test";

import { hardenWindowsSupervisorAcl } from "./server.mjs";

test("Windows Supervisor ACL removes inherited access and grants only the current SID", async () => {
  const calls = [];
  const result = await hardenWindowsSupervisorAcl(["C:\\runtime", "C:\\runtime\\supervisor.secret"], {
    platform: "win32",
    async execFileFn(file, args) {
      calls.push({ file, args });
      if (file === "whoami") return { stdout: '"DESKTOP\\alice","S-1-5-21-100-200-300-1001"\r\n' };
      return { stdout: "processed" };
    },
  });
  assert.equal(result.applied, true);
  assert.equal(result.sid, "S-1-5-21-100-200-300-1001");
  assert.deepEqual(calls.slice(1).map((call) => call.file), ["icacls", "icacls"]);
  assert.deepEqual(calls[1].args.slice(1), ["/inheritance:r", "/grant:r", "*S-1-5-21-100-200-300-1001:(OI)(CI)F"]);
  assert.deepEqual(calls[2].args.slice(1), ["/inheritance:r", "/grant:r", "*S-1-5-21-100-200-300-1001:F"]);
});

test("non-Windows ACL hardening is a no-op", async () => {
  let called = false;
  assert.deepEqual(await hardenWindowsSupervisorAcl("/tmp/runtime", {
    platform: "darwin",
    execFileFn: async () => { called = true; },
  }), { applied: false, platform: "darwin" });
  assert.equal(called, false);
});

test("Windows ACL hardening fails closed when SID resolution is unavailable", async () => {
  await assert.rejects(
    hardenWindowsSupervisorAcl("C:\\runtime", {
      platform: "win32",
      execFileFn: async () => ({ stdout: "unexpected output" }),
    }),
    { code: "SUPERVISOR_ACL_IDENTITY_FAILED" },
  );
});
