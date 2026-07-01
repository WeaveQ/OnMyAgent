/**
 * Channel Infrastructure Integration Tests
 * Tests the complete IPC API layer and integration between services
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Import channel infrastructure
import { createMessagingChannelServices } from "../../channel-runtime.mjs";

// Create temp directory for testing
const tmpDir = path.join(os.tmpdir(), `channel-integration-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

console.log("Test directory:", tmpDir);

// Create channel services
const services = createMessagingChannelServices({
  userDataDir: tmpDir,
  personalAgentRuntime: {}, // Mock runtime
});

// Initialize services
await services.initialize();

const api = services.channelInfrastructureApi;

console.log("\n=== Channel Infrastructure Integration Tests ===\n");

// Test 1: Pairing request flow
console.log("Test 1: Pairing request flow");

// First, simulate a pairing request creation (this would normally be triggered by IM message)
// Since we can't directly call the internal method, we test the API layer with existing requests
const pendingBefore = await api.getPendingPairingRequests();
console.log(`  Initial pending requests: ${pendingBefore.length}`);

// Test approve/deny with invalid code
const invalidApprove = await api.approvePairing("invalid");
assert.equal(invalidApprove.ok, false);
assert.ok(invalidApprove.error.includes("Invalid pairing code format"));
console.log("  ✓ Invalid pairing code rejected");

const invalidDeny = await api.denyPairing("invalid");
assert.equal(invalidDeny.ok, false);
console.log("  ✓ Invalid deny rejected");

// Test 2: Authorized users management
console.log("\nTest 2: Authorized users management");
const usersBefore = await api.getAuthorizedUsers();
console.log(`  Initial authorized users: ${usersBefore.length}`);

// Test isUserAuthorized with non-existent user
const notAuthorized = await api.isUserAuthorized("wechat", "non-existent-user");
assert.equal(notAuthorized, false);
console.log("  ✓ Non-existent user correctly not authorized");

// Test 3: Session store API
console.log("\nTest 3: Session store API");

// Create session
const createResult = await api.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "test-user-123",
  agentType: "claude-code",
  workspace: "/tmp/test-workspace",
  chatId: "chat-456",
});

assert.equal(createResult.ok, true);
assert.ok(createResult.session);
assert.equal(createResult.session.platformType, "wechat");
assert.equal(createResult.session.platformUserId, "test-user-123");
assert.equal(createResult.session.agentType, "claude-code");
console.log("  ✓ Session created successfully");

// Get session by ID
const getResult = await api.getSession(createResult.session.id);
assert.equal(getResult.ok, true);
assert.equal(getResult.session.id, createResult.session.id);
console.log("  ✓ Session retrieved by ID successfully");

// Get sessions by platform
const platformSessions = await api.getSessionsByPlatform("wechat");
assert.ok(platformSessions.length >= 1);
console.log("  ✓ Sessions retrieved by platform successfully");

// Get sessions by user
const userSessions = await api.getSessionsByUser("wechat", "test-user-123");
assert.ok(userSessions.length >= 1);
console.log("  ✓ Sessions retrieved by user successfully");

// Update session metadata
const updateResult = await api.updateSessionMetadata(createResult.session.id, {
  lastMessage: "Hello world",
  messagesCount: 5,
});
assert.equal(updateResult.ok, true);
console.log("  ✓ Session metadata updated successfully");

// Close session
const closeResult = await api.closeSession(createResult.session.id);
assert.equal(closeResult.ok, true);
console.log("  ✓ Session closed successfully");

// Test 4: Event bus API
console.log("\nTest 4: Event bus API");

const history = await api.getChannelEventHistory(10);
assert.ok(Array.isArray(history));
console.log(`  ✓ Retrieved ${history.length} events from history`);

const filteredHistory = await api.getChannelEventHistory(10, "test-event");
assert.ok(Array.isArray(filteredHistory));
console.log("  ✓ Filtered event history works");

// Test 5: Subscribe to events
console.log("\nTest 5: Event subscription");
/** @type {{ name?: string, payload?: unknown } | null} */
let receivedEvent = null;
const unsubscribe = api.subscribeToChannelEvents("test-event", (event) => {
  receivedEvent = event;
});

// Publish a test event directly
services.channelEventBus.publish("test-event", { data: "hello" });

// Wait a bit for the event to propagate
await new Promise((r) => setTimeout(r, 10));

// Note: The event handler receives the full event object, payload is inside payload
assert.ok(receivedEvent !== null);
assert.equal(receivedEvent?.name, "test-event");
assert.deepEqual(receivedEvent?.payload, { data: "hello" });
console.log("  ✓ Event received successfully");

unsubscribe();
console.log("  ✓ Unsubscribe works");

// Test 6: Empty session handling
console.log("\nTest 6: Empty session handling");

// Get non-existent session
const nonExistentSession = await api.getSession("non-existent-id");
assert.equal(nonExistentSession.ok, false);
assert.equal(nonExistentSession.error, "Session not found");
console.log("  ✓ Non-existent session returns proper error");

// Test 7: Error and boundary paths
console.log("\nTest 7: Error and boundary paths");

const malformedSession = await api.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "missing-agent-user",
});
assert.equal(malformedSession.ok, false);
assert.ok(malformedSession.error.includes("agentType"));
console.log("  ✓ Malformed session creation returns structured error");

const missingMetadata = await api.updateSessionMetadata("missing-session", { x: 1 });
assert.equal(missingMetadata.ok, false);
assert.ok(missingMetadata.error.includes("Session not found"));
console.log("  ✓ Missing session metadata update returns structured error");

const duplicateRequest = await services.pairingService.requestPairing({
  platformType: "wechat",
  platformUserId: "duplicate-pairing-user",
  displayName: "Duplicate Pairing User",
});
const duplicatePending = await services.pairingService.requestPairing({
  platformType: "wechat",
  platformUserId: "duplicate-pairing-user",
  displayName: "Changed Name",
});
assert.equal(duplicatePending.alreadyPending, true);
assert.equal(duplicatePending.pairingRequest.code, duplicateRequest.pairingRequest.code);
console.log("  ✓ Duplicate pending pairing reuses the original request");

const longWorkspace = `/tmp/${"workspace-".repeat(80)}`;
const boundarySession = await api.getOrCreateSession({
  platformType: "feishu",
  platformUserId: "boundary-user",
  agentType: "codex",
  workspace: longWorkspace,
});
assert.equal(boundarySession.ok, true);
assert.equal(boundarySession.session.workspace, longWorkspace);
console.log("  ✓ Long workspace boundary value is preserved");

// Cleanup
await services.dispose();
await fs.rm(tmpDir, { recursive: true, force: true });

console.log("\n✅ All Channel Infrastructure Integration Tests passed!");
