import assert from "node:assert/strict";
import test from "node:test";

import { createChromeBackend } from "./chrome-backend.mjs";

function createChromeFixture() {
  const attached = [];
  const detached = [];
  const commands = [];
  const stored = {};
  return {
    attached,
    detached,
    commands,
    api: {
      tabs: {
        async query() { return [{ id: 1, title: "One", url: "https://example.com" }]; },
      },
      history: {
        async search() { return [{ id: "history-1", url: "https://example.com" }]; },
      },
      debugger: {
        async attach(target) { attached.push(target.tabId); },
        async detach(target) { detached.push(target.tabId); },
        async sendCommand(target, method, params) {
          commands.push({ tabId: target.tabId, method, params });
          return { ok: true };
        },
      },
      storage: {
        session: {
          async get() { return { claimedTabs: stored.claimedTabs ?? [] }; },
          async set(value) { Object.assign(stored, value); },
        },
      },
    },
  };
}

test("Chrome backend controls a tab only after the session claims it", async () => {
  const fixture = createChromeFixture();
  const backend = createChromeBackend({ chrome: fixture.api });

  await assert.rejects(
    backend.executeCdp("session-a", 1, "DOM.getDocument", {}),
    /not claimed/i,
  );
  await backend.claimTab("session-a", 1);
  await backend.executeCdp("session-a", 1, "DOM.getDocument", {});

  assert.deepEqual(fixture.attached, [1]);
  assert.equal(fixture.commands[0].method, "DOM.getDocument");
});

test("Chrome backend isolates claimed tabs between sessions", async () => {
  const fixture = createChromeFixture();
  const backend = createChromeBackend({ chrome: fixture.api });
  await backend.claimTab("session-a", 1);

  await assert.rejects(backend.executeCdp("session-b", 1, "DOM.getDocument", {}), /not claimed/i);
  await assert.rejects(backend.claimTab("session-b", 1), /another session/i);
});

test("Chrome backend finalization detaches debugger and forgets the claim", async () => {
  const fixture = createChromeFixture();
  const backend = createChromeBackend({ chrome: fixture.api });
  await backend.claimTab("session-a", 1);

  assert.deepEqual(await backend.finalizeTabs("session-a", [1]), [1]);
  assert.deepEqual(fixture.detached, [1]);
  await assert.rejects(backend.executeCdp("session-a", 1, "DOM.getDocument", {}), /not claimed/i);
});

test("Chrome backend restores claims after an MV3 service worker restart", async () => {
  const fixture = createChromeFixture();
  const first = createChromeBackend({ chrome: fixture.api });
  await first.claimTab("session-a", 1);

  const restored = createChromeBackend({ chrome: fixture.api });
  await restored.restore();
  await restored.executeCdp("session-a", 1, "DOM.getDocument", {});

  assert.deepEqual(fixture.attached, [1, 1]);
});

test("Chrome backend exposes open tabs and browser history without profile-file access", async () => {
  const fixture = createChromeFixture();
  const backend = createChromeBackend({ chrome: fixture.api });

  assert.equal((await backend.listUserTabs()).length, 1);
  assert.equal((await backend.history({ text: "example" })).length, 1);
});
