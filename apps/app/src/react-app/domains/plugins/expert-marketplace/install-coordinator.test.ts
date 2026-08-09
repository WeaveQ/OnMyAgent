import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExpertPackageInstallInput } from "@onmyagent/types/desktop-ipc";

import { createExpertPackageInstallCoordinator } from "./install-coordinator";

const expert: ExpertPackageInstallInput = {
  source: "builtin",
  marketplace: "experts",
  packageName: "order-entry-clerk",
};

describe("expert package install coordinator", () => {
  test("shares concurrent installations", async () => {
    let calls = 0;
    let complete: (() => void) | undefined;
    const coordinator = createExpertPackageInstallCoordinator(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
    });

    const first = coordinator.ensure(expert);
    const second = coordinator.ensure(expert);
    await Promise.resolve();
    assert.equal(calls, 1);

    complete?.();
    await Promise.all([first, second]);
  });

  test("does not reinstall a successfully installed package", async () => {
    let calls = 0;
    const coordinator = createExpertPackageInstallCoordinator(async () => {
      calls += 1;
    });

    await coordinator.ensure(expert);
    await coordinator.ensure(expert);

    assert.equal(calls, 1);
  });

  test("allows a retry after an installation failure", async () => {
    let calls = 0;
    const coordinator = createExpertPackageInstallCoordinator(async () => {
      calls += 1;
      if (calls === 1) throw new Error("install failed");
    });

    await assert.rejects(coordinator.ensure(expert), /install failed/);
    await coordinator.ensure(expert);

    assert.equal(calls, 2);
  });
});
