import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { OfficeCliStatus } from "@onmyagent/types/officecli";

import {
  getOfficeCliPrimaryAction,
  getOfficeCliStatusTone,
  isOfficeCliBusy,
} from "./officecli-plugin-state";

function status(overrides: Partial<OfficeCliStatus>): OfficeCliStatus {
  return {
    pluginId: "officecli",
    state: "not_installed",
    supported: true,
    platform: "darwin-arm64",
    installedVersion: null,
    latestVersion: null,
    previousVersion: null,
    usable: false,
    lastCheckedAt: null,
    ...overrides,
  };
}

describe("OfficeCLI plugin state", () => {
  test("maps install and update actions to the marketplace card", () => {
    assert.equal(getOfficeCliPrimaryAction(status({})), "install");
    assert.equal(
      getOfficeCliPrimaryAction(
        status({
          state: "update_available",
          installedVersion: "1.0.102",
          latestVersion: "1.0.103",
          usable: true,
        }),
      ),
      "update",
    );
  });

  test("allows retry after a failed check without hiding an installed tool", () => {
    assert.equal(
      getOfficeCliPrimaryAction(
        status({
          state: "error",
          installedVersion: "1.0.102",
          usable: true,
          errorCode: "network_error",
        }),
      ),
      "retry",
    );
    assert.equal(
      getOfficeCliPrimaryAction(status({ state: "error" })),
      "retry",
    );
  });

  test("does not expose an action for unsupported or in-flight states", () => {
    assert.equal(
      getOfficeCliPrimaryAction(status({ supported: false, state: "unsupported" })),
      null,
    );
    assert.equal(
      getOfficeCliPrimaryAction(status({ state: "installing" })),
      null,
    );
    assert.equal(isOfficeCliBusy(status({ state: "checking" })), true);
    assert.equal(isOfficeCliBusy(status({ state: "installed", usable: true })), false);
  });

  test("uses a danger tone only for unsupported and failed states", () => {
    assert.equal(getOfficeCliStatusTone(status({ state: "unsupported" })), "danger");
    assert.equal(getOfficeCliStatusTone(status({ state: "error" })), "danger");
    assert.equal(
      getOfficeCliStatusTone(
        status({ state: "update_available", installedVersion: "1.0.102", usable: true }),
      ),
      "warning",
    );
    assert.equal(getOfficeCliStatusTone(status({ state: "installed", usable: true })), "success");
  });
});
