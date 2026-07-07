import { strict as assert } from "node:assert";

import {
  ChannelPluginRegistry,
  createLegacyServicePlugin,
  createStubPlugin,
  PLUGIN_TRANSPORT_STATE,
} from "../PluginRegistry.mjs";

console.log("Test 1: register / list / get");
const registry = new ChannelPluginRegistry();

const fakeService = {
  status: () => ({ status: "stopped", enabled: true, activeUsers: 3, hasToken: true }),
  start: async () => ({ ok: true }),
  stop: async () => ({ ok: true }),
};

registry.register(createLegacyServicePlugin({ id: "weixin", type: "weixin", name: "微信", service: fakeService }));
registry.register(createStubPlugin({ id: "telegram", type: "telegram", name: "Telegram" }));

assert.equal(registry.size(), 2);
assert.deepEqual(registry.ids().sort(), ["telegram", "weixin"]);
assert.ok(registry.get("weixin"));
console.log("✓ register/list/get");

console.log("Test 2: duplicate registration throws");
assert.throws(() => registry.register(createStubPlugin({ id: "telegram", type: "telegram", name: "Telegram" })));
console.log("✓ duplicate throws");

console.log("Test 3: getPluginStatuses shape");
const statuses = await registry.getPluginStatuses();
const weixin = statuses.find((s) => s.id === "weixin");
const telegram = statuses.find((s) => s.id === "telegram");
assert.ok(weixin && telegram);
assert.equal(weixin.type, "weixin");
assert.equal(weixin.activeUsers, 3);
assert.equal(weixin.hasToken, true);
assert.equal(telegram.status, "stopped");
assert.equal(telegram.enabled, false);
console.log("✓ status shape");

console.log("Test 4: stub plugin start reports pending_transport");
const telegramRecord = registry.get("telegram");
assert.equal(telegramRecord.transport, PLUGIN_TRANSPORT_STATE.STUB);
const startResult = await telegramRecord.instance.start();
assert.equal(startResult.ok, false);
const afterStart = telegramRecord.instance.status();
assert.equal(afterStart.status, "pending_transport");
console.log("✓ stub start");

console.log("Test 5: disposeAll clears map");
await registry.disposeAll();
assert.equal(registry.size(), 0);
console.log("✓ disposeAll");

console.log("All plugin registry tests passed");
