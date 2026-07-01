/**
 * ChannelEventBus unit tests
 */

import { strict as assert } from "node:assert";
import ChannelEventBus, { CHANNEL_EVENTS, channelEventBus } from "../ChannelEventBus.mjs";

// Test 1: Event publish and subscribe
console.log("Test 1: Event publish and subscribe");
/** @type {{ name?: string, payload?: unknown } | null} */
let receivedEvent = null;
const unsubscribe = channelEventBus.subscribe(CHANNEL_EVENTS.PAIRING_REQUESTED, (event) => {
  receivedEvent = event;
});

channelEventBus.publish(CHANNEL_EVENTS.PAIRING_REQUESTED, { code: "123456" });
assert.ok(receivedEvent);
assert.equal(receivedEvent?.name, CHANNEL_EVENTS.PAIRING_REQUESTED);
assert.deepEqual(receivedEvent?.payload, { code: "123456" });
console.log("✓ Event publish and subscribe works");

// Test 2: Unsubscribe
console.log("Test 2: Unsubscribe");
receivedEvent = null;
unsubscribe();
channelEventBus.publish(CHANNEL_EVENTS.PAIRING_REQUESTED, { code: "789012" });
assert.equal(receivedEvent, null);
console.log("✓ Unsubscribe works");

// Test 3: Wildcard subscription
console.log("Test 3: Wildcard subscription");
let wildcardEvents = [];
const wildcardUnsub = channelEventBus.subscribe("*", (event) => {
  wildcardEvents.push(event);
});

channelEventBus.publish(CHANNEL_EVENTS.PAIRING_APPROVED, { user: "test" });
channelEventBus.publish(CHANNEL_EVENTS.PAIRING_DENIED, {});

assert.equal(wildcardEvents.length, 2);
wildcardUnsub();
console.log("✓ Wildcard subscription works");

// Test 4: Event history
console.log("Test 4: Event history");
const history = channelEventBus.getHistory(10);
assert.ok(Array.isArray(history));
assert.ok(history.length >= 3); // At least the 3 events we published
console.log("✓ Event history works");

// Test 5: Filtered event history
console.log("Test 5: Filtered event history");
const pairingRequests = channelEventBus.getHistory(10, CHANNEL_EVENTS.PAIRING_REQUESTED);
assert.equal(pairingRequests.length, 2);
console.log("✓ Filtered event history works");

// Test 6: Clear history
console.log("Test 6: Clear history");
channelEventBus.clearHistory();
const emptyHistory = channelEventBus.getHistory();
assert.equal(emptyHistory.length, 0);
console.log("✓ Clear history works");

console.log("\n✅ All ChannelEventBus tests passed!");
