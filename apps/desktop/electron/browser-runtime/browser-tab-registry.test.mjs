import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserTabRegistry } from "./browser-tab-registry.mjs";

test("tab registry isolates agent tabs by session", () => {
  const registry = createBrowserTabRegistry();
  registry.register({ tabId: "tab-a", owner: "agent", sessionId: "session-a", temporary: true });
  registry.register({ tabId: "tab-b", owner: "agent", sessionId: "session-b", temporary: true });

  assert.deepEqual(registry.listForSession("session-a").map((tab) => tab.tabId), ["tab-a"]);
  assert.throws(() => registry.assertControllable("tab-b", "session-a"), /not owned/i);
});

test("claim changes a user tab into a session-scoped claimed tab", () => {
  const registry = createBrowserTabRegistry();
  registry.register({ tabId: "tab-user", owner: "user", sessionId: null, temporary: false });

  const claimed = registry.claim("tab-user", "session-a");

  assert.equal(claimed.owner, "claimed");
  assert.equal(claimed.sessionId, "session-a");
  assert.equal(registry.assertControllable("tab-user", "session-a").tabId, "tab-user");
});

test("turn cleanup closes temporary agent tabs but preserves user and deliverable tabs", () => {
  const registry = createBrowserTabRegistry();
  registry.register({ tabId: "temporary", owner: "agent", sessionId: "session-a", temporary: true });
  registry.register({ tabId: "deliverable", owner: "agent", sessionId: "session-a", temporary: true, deliverable: true });
  registry.register({ tabId: "user", owner: "user", sessionId: null, temporary: false });

  assert.deepEqual(registry.turnEnded("session-a"), ["temporary"]);
  assert.deepEqual(registry.list().map((tab) => tab.tabId).sort(), ["deliverable", "user"]);
});

test("explicit finalize closes only tabs selected from the current session", () => {
  const registry = createBrowserTabRegistry();
  registry.register({ tabId: "one", owner: "agent", sessionId: "session-a", temporary: false });
  registry.register({ tabId: "two", owner: "agent", sessionId: "session-b", temporary: false });

  assert.deepEqual(registry.finalize("session-a", ["one"]), ["one"]);
  assert.throws(() => registry.finalize("session-a", ["two"]), /not owned/i);
});

test("session deletion closes every agent and claimed tab owned by that session", () => {
  const registry = createBrowserTabRegistry();
  registry.register({ tabId: "temporary", owner: "agent", sessionId: "session-a", temporary: true });
  registry.register({ tabId: "deliverable", owner: "agent", sessionId: "session-a", deliverable: true });
  registry.register({ tabId: "user", owner: "user" });
  registry.claim("user", "session-a");
  registry.register({ tabId: "other", owner: "agent", sessionId: "session-b" });

  assert.deepEqual(
    registry.sessionDeleted("session-a").sort(),
    ["deliverable", "temporary", "user"],
  );
  assert.deepEqual(registry.list().map((tab) => tab.tabId), ["other"]);
});
