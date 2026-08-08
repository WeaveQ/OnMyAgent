import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BaiduDriveConnectionStatus } from "@onmyagent/types/baidu-drive-connector";

import {
  canDisconnectBaiduDrive,
  getBaiduDrivePrimaryAction,
  getBaiduDriveStatusTone,
  isBaiduDriveBusy,
} from "./baidu-drive-plugin-state";

function status(
  partial: Partial<BaiduDriveConnectionStatus>,
): BaiduDriveConnectionStatus {
  return {
    phase: "disconnected",
    mcpConfigured: false,
    authorized: false,
    serverNames: ["baidu-netdisk"],
    message: null,
    errorCode: null,
    errorMessage: null,
    lastCheckedAt: 1,
    ...partial,
  };
}

describe("baidu-drive-plugin-state", () => {
  it("maps phase to status tone", () => {
    assert.equal(getBaiduDriveStatusTone(status({ phase: "connected" })), "success");
    assert.equal(getBaiduDriveStatusTone(status({ phase: "error" })), "danger");
    assert.equal(getBaiduDriveStatusTone(status({ phase: "disconnected" })), "neutral");
  });

  it("primary action is connect/retry when not authorized", () => {
    assert.equal(getBaiduDrivePrimaryAction(status({ phase: "disconnected" })), "connect");
    assert.equal(getBaiduDrivePrimaryAction(status({ phase: "error" })), "retry");
    assert.equal(
      getBaiduDrivePrimaryAction(status({ phase: "connected", authorized: true })),
      null,
    );
  });

  it("busy when authorizing or missing status", () => {
    assert.equal(isBaiduDriveBusy(null), true);
    assert.equal(isBaiduDriveBusy(status({ phase: "authorizing" })), true);
    assert.equal(isBaiduDriveBusy(status({ phase: "disconnected" })), false);
  });

  it("can disconnect when authorized or mcp present", () => {
    assert.equal(canDisconnectBaiduDrive(status({ authorized: true })), true);
    assert.equal(canDisconnectBaiduDrive(status({ mcpConfigured: true })), true);
    assert.equal(canDisconnectBaiduDrive(status({})), false);
  });
});
