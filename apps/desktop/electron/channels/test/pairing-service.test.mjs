/**
 * ChannelPairingService unit tests
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelPairingService, PAIRING_CODE_LENGTH, PAIRING_EXPIRY_MS } from "../ChannelPairingService.mjs";

// Create temp directory
const tmpDir = path.join(os.tmpdir(), `channel-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

// Test 1: Initialization
console.log("Test 1: Initialization");
const pairingService = new ChannelPairingService({ userDataDir: tmpDir });
await pairingService.initialize();
console.log("✓ Pairing service initialized");

// Test 2: Generate pairing request
console.log("Test 2: Generate pairing request");
const result = await pairingService.requestPairing({
  platformType: "wechat",
  platformUserId: "test-user-123",
  displayName: "Test User",
});
assert.ok(result.pairingRequest);
assert.equal(result.pairingRequest.platformType, "wechat");
assert.equal(result.pairingRequest.platformUserId, "test-user-123");
assert.equal(result.pairingRequest.status, "pending");
assert.equal(result.pairingRequest.code.length, PAIRING_CODE_LENGTH);
console.log("✓ Pairing request generated correctly");

// Test 3: Get pending requests
console.log("Test 3: Get pending requests");
const pending = pairingService.getPendingRequests();
assert.equal(pending.length, 1);
assert.equal(pending[0].code, result.pairingRequest.code);
console.log("✓ Pending requests retrieved correctly");

// Test 4: Approve pairing
console.log("Test 4: Approve pairing");
const approveResult = await pairingService.approvePairing(result.pairingRequest.code);
assert.ok(approveResult.user);
assert.equal(approveResult.user.platformType, "wechat");
assert.equal(approveResult.user.platformUserId, "test-user-123");
console.log("✓ Pairing approved correctly");

// Test 5: Check authorization
console.log("Test 5: Check authorization");
const isAuthorized = pairingService.isUserAuthorized("wechat", "test-user-123");
assert.ok(isAuthorized);
const notAuthorized = pairingService.isUserAuthorized("wechat", "unknown-user");
assert.ok(!notAuthorized);
console.log("✓ Authorization checks work");

// Test 6: Get authorized users
console.log("Test 6: Get authorized users");
const authorizedUsers = pairingService.getAuthorizedUsers();
assert.equal(authorizedUsers.length, 1);
assert.equal(authorizedUsers[0].platformUserId, "test-user-123");
console.log("✓ Authorized users retrieved correctly");

// Test 7: Revoke authorization
console.log("Test 7: Revoke authorization");
await pairingService.revokeAuthorization("wechat", "test-user-123");
const isStillAuthorized = pairingService.isUserAuthorized("wechat", "test-user-123");
assert.ok(!isStillAuthorized);
console.log("✓ Authorization revoked correctly");

// Test 8: Deny pairing
console.log("Test 8: Deny pairing");
const denyRequest = await pairingService.requestPairing({
  platformType: "feishu",
  platformUserId: "deny-user-456",
});
const pendingBeforeDeny = pairingService.getPendingRequests().length;
await pairingService.denyPairing(denyRequest.pairingRequest.code);
const pendingAfterDeny = pairingService.getPendingRequests().length;
assert.equal(pendingAfterDeny, pendingBeforeDeny - 1);
console.log("✓ Pairing denied correctly");

// Test 9: Reuse pending request for the same user
console.log("Test 9: Reuse pending request for the same user");
const firstRequest = await pairingService.requestPairing({
  platformType: "wechat",
  platformUserId: "duplicate-user",
});
const secondRequest = await pairingService.requestPairing({
  platformType: "wechat",
  platformUserId: "duplicate-user",
});
assert.equal(secondRequest.alreadyPending, true);
assert.equal(secondRequest.pairingRequest.code, firstRequest.pairingRequest.code);
console.log("✓ Pending pairing request is reused correctly");

// Cleanup
await pairingService.dispose();
await fs.rm(tmpDir, { recursive: true, force: true });

console.log("\n✅ All ChannelPairingService tests passed!");
