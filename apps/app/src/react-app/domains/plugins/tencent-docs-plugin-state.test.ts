import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TencentDocsConnectionStatus } from "@onmyagent/types/tencent-docs-connector";

import {
  canDisconnectTencentDocs,
  getTencentDocsPrimaryAction,
  getTencentDocsStatusTone,
  isTencentDocsBusy,
} from "./tencent-docs-plugin-state";

function status(
  patch: Partial<TencentDocsConnectionStatus>,
): TencentDocsConnectionStatus {
  return {
    phase: "disconnected",
    mcpConfigured: false,
    skillInstalled: false,
    authorized: false,
    serverNames: ["tencent-docs"],
    message: null,
    errorCode: null,
    errorMessage: null,
    lastCheckedAt: 1,
    ...patch,
  };
}

describe("tencent-docs-plugin-state", () => {
  it("marks busy/authorizing as busy", () => {
    assert.equal(isTencentDocsBusy(status({ phase: "busy" })), true);
    assert.equal(isTencentDocsBusy(status({ phase: "authorizing" })), true);
    assert.equal(isTencentDocsBusy(status({ phase: "connected" })), false);
  });

  it("maps status tones", () => {
    assert.equal(getTencentDocsStatusTone(status({ phase: "connected" })), "success");
    assert.equal(getTencentDocsStatusTone(status({ phase: "error" })), "danger");
    assert.equal(getTencentDocsStatusTone(status({ phase: "disconnected" })), "neutral");
  });

  it("primary action is connect or retry", () => {
    assert.equal(getTencentDocsPrimaryAction(status({ phase: "disconnected" })), "connect");
    assert.equal(getTencentDocsPrimaryAction(status({ phase: "error" })), "retry");
    assert.equal(getTencentDocsPrimaryAction(status({ phase: "connected", authorized: true })), null);
  });

  it("disconnect when any managed surface is present", () => {
    assert.equal(canDisconnectTencentDocs(status({ phase: "disconnected" })), false);
    assert.equal(canDisconnectTencentDocs(status({ phase: "connected" })), true);
    assert.equal(canDisconnectTencentDocs(status({ skillInstalled: true })), true);
  });
});
