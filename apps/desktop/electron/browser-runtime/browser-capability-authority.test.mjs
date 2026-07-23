import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserCapabilityAuthority } from "./browser-capability-authority.mjs";

test("capability tokens bind session, backend, peer process, and OS identity", () => {
  const authority = createBrowserCapabilityAuthority({
    secret: Buffer.alloc(32, 7),
    now: () => 1_000,
  });
  const token = authority.issue({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    backend: "in-app",
    peerPid: 44,
    peerIdentity: "uid:501",
  });

  assert.equal(authority.verify(token, {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    backend: "in-app",
    peerPid: 44,
    peerIdentity: "uid:501",
  }).sessionId, "session-1");
  assert.throws(() => authority.verify(token, {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    backend: "in-app",
    peerPid: 45,
    peerIdentity: "uid:501",
  }), /scope mismatch/i);
});

test("capability tokens expire", () => {
  let now = 1_000;
  const authority = createBrowserCapabilityAuthority({
    secret: Buffer.alloc(32, 9),
    now: () => now,
    ttlMs: 500,
  });
  const scope = {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    backend: "chrome",
    peerPid: 50,
    peerIdentity: "sid:user",
  };
  const token = authority.issue(scope);
  now = 1_501;

  assert.throws(() => authority.verify(token, scope), /expired/i);
});

test("capability tokens reject signature tampering", () => {
  const authority = createBrowserCapabilityAuthority({ secret: Buffer.alloc(32, 3) });
  const scope = {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    backend: "chrome",
    peerPid: 50,
    peerIdentity: "sid:user",
  };
  const token = authority.issue(scope);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

  assert.throws(() => authority.verify(tampered, scope), /signature/i);
});
