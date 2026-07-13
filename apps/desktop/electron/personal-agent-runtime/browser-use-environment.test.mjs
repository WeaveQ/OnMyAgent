import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBrowserUseEnvironmentManager } from "./browser-use-environment.mjs";

test("creates stable isolated Browser Use workspaces for conversations", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "onmyagent-browser-env-"));
  const runtimeRoot = path.join(root, "runtimes");
  const resourceRoot = path.join(root, "resources", "browser-use");
  const userDataDir = path.join(root, "user-data");
  const launcherDir = path.join(runtimeRoot, "aarch64-apple-darwin", "bin");
  mkdirSync(launcherDir, { recursive: true });
  mkdirSync(resourceRoot, { recursive: true });
  writeFileSync(path.join(launcherDir, "browser-use"), "launcher");
  writeFileSync(path.join(resourceRoot, "agent_helpers.py"), "HELPER = True\n");

  const owners = [];
  const manager = createBrowserUseEnvironmentManager({
    runtimeRoot,
    resourceRoot,
    userDataDir,
    platform: "darwin",
    arch: "arm64",
    environmentForOwner(ownerId) {
      owners.push(ownerId);
      return {
        BU_NAME: ownerId,
        ONMYAGENT_BROWSER_BROKER_TOKEN: `token-${ownerId}`,
      };
    },
  });

  const first = await manager.environmentForRun({
    workspaceRoot: "/workspace/a",
    conversationId: "conversation-1",
    runId: "run-1",
  });
  const same = await manager.environmentForRun({
    workspaceRoot: "/workspace/a",
    conversationId: "conversation-1",
    runId: "run-2",
  });
  const other = await manager.environmentForRun({
    workspaceRoot: "/workspace/a",
    conversationId: "conversation-2",
    runId: "run-3",
  });

  assert.equal(first.ownerId, same.ownerId);
  assert.notEqual(first.ownerId, other.ownerId);
  assert.deepEqual(first.pathEntries, [launcherDir]);
  assert.equal(first.environment.BH_AGENT_WORKSPACE, first.workspaceRoot);
  assert.equal(first.environment.BH_HOME, path.join(first.workspaceRoot, "home"));
  assert.equal(first.environment.BH_TMP_DIR, path.join(first.workspaceRoot, "tmp"));
  assert.equal(
    first.environment.BH_RUNTIME_DIR,
    path.join("/tmp", "onmyagent-browser-use", first.ownerId.slice("conversation:".length)),
  );
  assert.ok(first.environment.BH_RUNTIME_DIR.length < 80);
  assert.equal(first.environment.BH_DOMAIN_SKILLS, "0");
  assert.equal(
    readFileSync(path.join(first.workspaceRoot, "agent_helpers.py"), "utf8"),
    "HELPER = True\n",
  );
  assert.equal(owners[0], owners[1]);
});
