import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpertDeleteResult } from "@onmyagent/types/server";
import { normalizeExpertWritePackageName } from "./expert-package-name";
import {
  resolveExpertDeletePackageName,
  shouldUninstallExpertPackage,
} from "../../domains/session/pages/use-expert-session-delete";

describe("normalizeExpertWritePackageName", () => {
  it("coerces composite agentId to the short name when no packageName is given", () => {
    assert.equal(
      normalizeExpertWritePackageName({ agentId: "kol-ops:kol-ops" }),
      "kol-ops",
    );
  });

  it("keeps an explicit short packageName", () => {
    assert.equal(
      normalizeExpertWritePackageName({
        agentId: "kol-ops:kol-ops",
        packageName: "kol-ops",
      }),
      "kol-ops",
    );
  });

  it("coerces an explicit composite packageName equal to agentId", () => {
    assert.equal(
      normalizeExpertWritePackageName({
        agentId: "kol-ops:kol-ops",
        packageName: "kol-ops:kol-ops",
      }),
      "kol-ops",
    );
  });

  it("lets marketplacePackageName win over a composite agentId", () => {
    assert.equal(
      normalizeExpertWritePackageName({
        agentId: "kol-ops:kol-ops",
        packageName: "kol-ops:kol-ops",
        marketplacePackageName: "kol-ops",
      }),
      "kol-ops",
    );
  });

  it("uses the last colon segment when the composite is not a:a", () => {
    assert.equal(
      normalizeExpertWritePackageName({ agentId: "ns:pkg" }),
      "pkg",
    );
  });

  it("returns a non-composite agentId when no better name exists", () => {
    assert.equal(
      normalizeExpertWritePackageName({ agentId: "kol-ops" }),
      "kol-ops",
    );
  });
});

describe("resolveExpertDeletePackageName", () => {
  it("still recovers a short name from a composite delete payload", () => {
    assert.equal(
      resolveExpertDeletePackageName({
        agentId: "kol-ops:kol-ops",
        packageName: "kol-ops:kol-ops",
      }),
      "kol-ops",
    );
  });
});

describe("shouldUninstallExpertPackage", () => {
  it("does not uninstall after a completed result with zero deleted sessions", () => {
    assert.equal(shouldUninstallExpertPackage({ state: "completed", steps: [] }), false);
  });

  it("uninstalls after a completed result that deleted sessions", () => {
    assert.equal(
      shouldUninstallExpertPackage({
        state: "completed",
        steps: [{ sessionId: "ses_1" } as ExpertDeleteResult["steps"][number]],
      }),
      true,
    );
  });
});
