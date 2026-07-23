import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserSafetyPolicy } from "./browser-safety-policy.mjs";

test("safety policy blocks unsafe navigation schemes and embedded credentials", async () => {
  const policy = createBrowserSafetyPolicy({ requestApproval: async () => true });

  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://user:secret@example.com"]) {
    await assert.rejects(policy.authorize({ kind: "navigate", url }), /navigation blocked/i);
  }
});

test("safety policy requires approval for consequential actions from every engine", async () => {
  const approvals = [];
  const policy = createBrowserSafetyPolicy({
    requestApproval: async (request) => { approvals.push(request); return true; },
  });

  for (const engine of ["locator", "dom-cua", "coordinate-cua"]) {
    await policy.authorize({
      kind: "click",
      engine,
      pageUrl: "https://shop.example/checkout",
      label: "Place order",
    });
  }

  // Same click label is granted once per browser session after the first Allow.
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].risk, "destructive");

  await policy.authorize({
    kind: "click",
    engine: "locator",
    label: "发送",
  });
  assert.equal(approvals.length, 2);
  assert.match(String(approvals[1].action.label), /发送/);
});

test("denied approval prevents the action", async () => {
  const policy = createBrowserSafetyPolicy({ requestApproval: async () => false });

  await assert.rejects(
    policy.authorize({ kind: "click", engine: "locator", label: "Delete account" }),
    /approval denied/i,
  );
});

test("uploads and downloads require explicit grants", async () => {
  const policy = createBrowserSafetyPolicy({ requestApproval: async () => true });

  await policy.authorize({ kind: "upload", path: "/tmp/report.pdf" });
  await policy.authorize({ kind: "download", url: "https://example.com/report.pdf" });
  assert.equal(policy.hasGrant("upload", "/tmp/report.pdf"), true);
  assert.equal(policy.hasGrant("download", "https://example.com/report.pdf"), true);
});
