import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserUseBroker } from "./browser-use-broker.mjs";

function createPanel() {
  let counter = 0;
  const tabs = new Map();
  return {
    /**
     * @param {string} url
     * @param {{ ownerId: string }} options
     */
    createBrowserTab(url, options) {
      counter += 1;
      const { ownerId } = options;
      const tab = { tabId: `tab_${counter}`, ownerId, url, title: url };
      tabs.set(tab.tabId, tab);
      return tab;
    },
    /** @param {{ ownerId?: string }} [options] */
    listBrowserTabs(options = {}) {
      const { ownerId } = options;
      return [...tabs.values()].filter((tab) => !ownerId || tab.ownerId === ownerId);
    },
    selectBrowserTab(tabId) {
      return tabs.get(tabId) ?? null;
    },
    closeBrowserTab(tabId) {
      if (!tabs.has(tabId)) return null;
      tabs.delete(tabId);
      return tabId;
    },
    closeBrowserTabsByOwner(ownerId) {
      const ids = [...tabs.values()]
        .filter((tab) => tab.ownerId === ownerId)
        .map((tab) => tab.tabId);
      for (const id of ids) tabs.delete(id);
      return ids;
    },
  };
}

async function request(environment, path, init = {}) {
  return fetch(`${environment.ONMYAGENT_BROWSER_BROKER_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${environment.ONMYAGENT_BROWSER_BROKER_TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

test("binds owner-scoped tokens to isolated embedded browser tabs", async () => {
  const broker = createBrowserUseBroker({
    panel: createPanel(),
    cdpPort: 9832,
    runtimeStatus: () => ({
      ready: true,
      browserUseVersion: "0.13.4",
      browserHarnessVersion: "0.1.5",
    }),
  });
  await broker.start();
  try {
    const ownerA = broker.environmentForOwner("conversation:a");
    const ownerB = broker.environmentForOwner("conversation:b");
    assert.notEqual(
      ownerA.ONMYAGENT_BROWSER_BROKER_TOKEN,
      ownerB.ONMYAGENT_BROWSER_BROKER_TOKEN,
    );
    assert.equal(ownerA.BU_CDP_URL, "http://127.0.0.1:9832");
    assert.notEqual(ownerA.BU_NAME, ownerB.BU_NAME);

    const unauthorized = await fetch(
      `${ownerA.ONMYAGENT_BROWSER_BROKER_URL}/v1/tabs`,
    );
    assert.equal(unauthorized.status, 401);

    const created = await request(ownerA, "/v1/tabs", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/a" }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();

    const ownerATabs = await (await request(ownerA, "/v1/tabs")).json();
    const ownerBTabs = await (await request(ownerB, "/v1/tabs")).json();
    assert.deepEqual(ownerATabs.tabs.map((tab) => tab.tabId), [createdBody.tabId]);
    assert.deepEqual(ownerBTabs.tabs, []);

    const forbiddenClose = await request(
      ownerB,
      `/v1/tabs/${createdBody.tabId}`,
      { method: "DELETE" },
    );
    assert.equal(forbiddenClose.status, 404);
    assert.equal((await request(ownerA, "/v1/tabs")).status, 200);
  } finally {
    await broker.stop();
  }
});

test("returns redacted runtime health without connection credentials", async () => {
  const broker = createBrowserUseBroker({
    panel: createPanel(),
    cdpPort: 9832,
    runtimeStatus: () => ({
      ready: true,
      browserUseVersion: "0.13.4",
      browserHarnessVersion: "0.1.5",
    }),
  });
  await broker.start();
  try {
    const environment = broker.environmentForOwner("conversation:health");
    const response = await request(environment, "/v1/health");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      ready: true,
      target: "embedded",
      browserUseVersion: "0.13.4",
      browserHarnessVersion: "0.1.5",
    });
    assert.doesNotMatch(JSON.stringify(body), /9832|token|cdp/i);
  } finally {
    await broker.stop();
  }
});
