import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createOrphanReconcile } from "./orphan-reconcile.mjs";
import {
  configurePersonalAgentRuntimeState,
  personalAgentRootAt,
  personalRunWorkspacesRoot,
  resolveInteractivePersonalRuntimeStateRoot,
  resolveTaskSupervisorPersonalAssistantRoot,
} from "./runtime-state.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function runningLog(runId) {
  return `${JSON.stringify({
    type: "run_meta",
    runId,
    status: "running",
    startedAt: 1,
  })}\n`;
}

async function writeRunningLog(dir, runId) {
  const filePath = path.join(dir, "runs", `${runId}.jsonl`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, runningLog(runId), "utf8");
  return filePath;
}

describe("orphan reconcile persist tree", () => {
  it("scans isolated personalAssistantRoot, not the interactive personal-assistant tree", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "orphan-reconcile-isolate-"));
    roots.push(userDataDir);
    const workspace = path.join(userDataDir, "ws");
    const interactivePersist = personalAgentRootAt(
      resolveInteractivePersonalRuntimeStateRoot(userDataDir),
      workspace,
    );
    const isolatedAssistant = resolveTaskSupervisorPersonalAssistantRoot(userDataDir);

    configurePersonalAgentRuntimeState({
      userDataDir,
      personalAssistantRoot: isolatedAssistant,
    });
    try {
      const scanned = personalRunWorkspacesRoot();
      assert.equal(scanned, path.join(isolatedAssistant, "workspaces"));
      assert.match(scanned, /[/\\]task-center-supervisor[/\\]personal-assistant[/\\]workspaces$/);
      assert.ok(!scanned.startsWith(`${interactivePersist}${path.sep}`));
      assert.ok(!interactivePersist.startsWith(`${scanned}${path.sep}`));

      const mainLog = await writeRunningLog(interactivePersist, "main-run");
      const isolatedPersist = path.join(scanned, path.basename(interactivePersist));
      const supervisorLog = await writeRunningLog(isolatedPersist, "sup-run");

      const { reconcileOrphanRuns } = createOrphanReconcile({
        runs: new Map(),
        reconcileCutoffMs: Date.now(),
        userDataDir,
        processTermination: {
          isAlive: () => false,
          terminate: async () => ({ terminated: true }),
        },
      });
      await reconcileOrphanRuns();

      const mainContent = await readFile(mainLog, "utf8");
      const supervisorContent = await readFile(supervisorLog, "utf8");
      assert.match(mainContent, /"status":"running"/);
      assert.doesNotMatch(mainContent, /"status":"failed"/);
      assert.match(supervisorContent, /"status":"failed"/);
    } finally {
      configurePersonalAgentRuntimeState({ userDataDir });
    }
  });
});
