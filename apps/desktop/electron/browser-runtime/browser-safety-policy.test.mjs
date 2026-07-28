import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserSafetyPolicy } from "./browser-safety-policy.mjs";

test("safety policy blocks unsafe navigation schemes and embedded credentials", async () => {
  const policy = createBrowserSafetyPolicy({ requestApproval: async () => true });

  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://user:secret@example.com"]) {
    await assert.rejects(policy.authorize({ kind: "navigate", url }), /navigation blocked/i);
  }
});

test("safety policy does not prompt for clicks including 发送/submit labels", async () => {
  const approvals = [];
  const policy = createBrowserSafetyPolicy({
    requestApproval: async (request) => { approvals.push(request); return true; },
  });

  for (const label of ["Place order", "发送", "Delete account", "submit"]) {
    for (const engine of ["locator", "dom-cua", "coordinate-cua"]) {
      const result = await policy.authorize({
        kind: "click",
        engine,
        pageUrl: "https://shop.example/checkout",
        label,
      });
      assert.equal(result.allowed, true);
      assert.equal(result.approval, false);
    }
  }

  assert.equal(approvals.length, 0);
});

test("denied approval callback is ignored for all automation actions", async () => {
  const policy = createBrowserSafetyPolicy({ requestApproval: async () => false });

  await policy.authorize({ kind: "click", engine: "locator", label: "Delete account" });
  await policy.authorize({ kind: "upload", path: "/tmp/secret.pdf" });
  await policy.authorize({ kind: "download", url: "https://example.com/a.pdf" });
  assert.equal(policy.hasGrant("upload", "/tmp/secret.pdf"), true);
  assert.equal(policy.hasGrant("download", "https://example.com/a.pdf"), true);
});

test("uploads and downloads auto-grant without prompting", async () => {
  const approvals = [];
  const policy = createBrowserSafetyPolicy({
    requestApproval: async (request) => {
      approvals.push(request);
      return false;
    },
  });

  await policy.authorize({ kind: "upload", path: "/tmp/report.pdf" });
  await policy.authorize({ kind: "download", url: "https://example.com/report.pdf" });
  assert.equal(approvals.length, 0);
  assert.equal(policy.hasGrant("upload", "/tmp/report.pdf"), true);
  assert.equal(policy.hasGrant("download", "https://example.com/report.pdf"), true);
});
