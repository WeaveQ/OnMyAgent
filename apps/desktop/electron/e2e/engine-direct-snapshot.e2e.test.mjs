/**
 * Shipped desktop engine snapshot e2e (no live model, no Electron window).
 *
 * engineStart is in-process `direct`; a freshly constructed runtime manager
 * must report idle / not running before any start, and must not advertise
 * orchestrator as the engine host.
 */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";

import { DIRECT_RUNTIME } from "../runtime-engine-state.mjs";
import { createRuntimeManager } from "../runtime.mjs";
import { createDesktopE2eSandbox } from "./sandbox.mjs";

const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

describe("desktop engine direct snapshot e2e", () => {
  test("createRuntimeManager reports idle direct engine before start", async () => {
    const sandbox = await createDesktopE2eSandbox({
      prefix: "oma-desktop-engine-snapshot-e2e-",
    });
    roots.push(sandbox.root);

    const manager = createRuntimeManager({
      app: {
        getPath(name) {
          if (name === "userData") return sandbox.userData;
          if (name === "home") return sandbox.realHome;
          if (name === "exe") return process.execPath;
          return path.join(sandbox.root, name);
        },
      },
      desktopRoot: path.join(sandbox.root, "desktop"),
      listLocalWorkspacePaths: async () => [sandbox.workspace],
      homeDir: sandbox.realHome,
    });

    try {
      const info = await manager.engineInfo();
      assert.equal(info.running, false);
      assert.equal(info.runtime, DIRECT_RUNTIME);
      assert.equal(info.lifecycleState, "idle");
      assert.equal(info.pid, null);

      const status = await manager.runtimeStatus();
      assert.equal(status.lifecycleState, "idle");
      assert.equal(status.engine.running, false);
      assert.equal(status.engine.runtime, DIRECT_RUNTIME);
      assert.equal(status.onmyagentServer.running, false);

      const orchestrator = await manager.orchestratorStatus();
      assert.equal(orchestrator.running, false);
      assert.equal(orchestrator.daemon, null);
      assert.equal(orchestrator.opencode, null);
    } finally {
      await manager.dispose();
    }
  });
});
