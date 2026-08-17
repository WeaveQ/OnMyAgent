/**
 * Task Supervisor vs interactive Personal persist e2e (no live model, no Electron window).
 *
 * Constructs the shipped Supervisor service and desktop Personal services against
 * an isolated userData sandbox, then asserts conversations / run logs / orphan
 * reconcile stay on disjoint trees while managed ACP stays on interactive
 * runtime-state.
 */
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";

import { conversationFile, createConversation } from "../personal-agent-runtime/conversation-store.mjs";
import { managedAcpToolRoot } from "../personal-agent-runtime/managed-acp-tools.mjs";
import { createOrphanReconcile } from "../personal-agent-runtime/orphan-reconcile.mjs";
import {
  configureProcessRegistry,
  processRegistryFile,
} from "../personal-agent-runtime/process-registry.mjs";
import {
  configurePersonalAgentRuntimeState,
  resolveInteractivePersonalRuntimeStateRoot,
  resolveTaskSupervisorPersonalAssistantRoot,
} from "../personal-agent-runtime/runtime-state.mjs";
import { ensureRunLogPath } from "../personal-agent-runtime/workdir.mjs";
import { createDesktopPersonalRuntimeServices } from "../personal-runtime-services.mjs";
import { createTaskSupervisorService } from "../task-supervisor/service.mjs";
import { createDesktopE2eSandbox } from "./sandbox.mjs";

const roots = [];

after(async () => {
  configurePersonalAgentRuntimeState({ userDataDir: "" });
  configureProcessRegistry({ filePath: null, namespace: "personal-agent-runtime" });
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

function interactiveAssistantRoot(userDataDir) {
  return path.join(resolveInteractivePersonalRuntimeStateRoot(userDataDir), "personal-assistant");
}

async function writeRunningLog(workspaceRoot, runId) {
  const filePath = await ensureRunLogPath(workspaceRoot, runId);
  await writeFile(
    filePath,
    `${JSON.stringify({
      type: "run_meta",
      runId,
      status: "running",
      startedAt: 1,
    })}\n`,
    "utf8",
  );
  return filePath;
}

function createOrphanHarness(userDataDir) {
  return createOrphanReconcile({
    runs: new Map(),
    reconcileCutoffMs: Date.now(),
    userDataDir,
    processTermination: {
      isAlive: () => false,
      terminate: async () => ({ terminated: true }),
    },
  });
}

describe("desktop task persist isolation e2e", () => {
  test("Supervisor and main desktop services persist to disjoint trees", async () => {
    const sandbox = await createDesktopE2eSandbox({
      prefix: "oma-desktop-task-persist-e2e-",
    });
    roots.push(sandbox.root);
    const { userData: userDataDir, workspace } = sandbox;
    const isolatedAssistant = resolveTaskSupervisorPersonalAssistantRoot(userDataDir);
    const interactiveAssistant = interactiveAssistantRoot(userDataDir);

    const supervisor = await createTaskSupervisorService({
      userDataDir,
      maintenanceEnabled: false,
      deferStartupReconcileMs: 60_000,
    });
    let supervisorConversationId = "";
    let supervisorLog = "";
    try {
      const supervisorConv = await createConversation(workspace, "codex", "codex", {
        title: "Task Supervisor e2e",
      });
      supervisorConversationId = supervisorConv.id;
      supervisorLog = await writeRunningLog(workspace, "sup-e2e-run");
      const supervisorConvFile = conversationFile(workspace, "codex", "codex");
      const acp = managedAcpToolRoot("codex");

      assert.ok(
        supervisorConvFile.startsWith(`${isolatedAssistant}${path.sep}`),
        `Supervisor conversation left isolated persist: ${supervisorConvFile}`,
      );
      assert.ok(
        supervisorLog.startsWith(`${isolatedAssistant}${path.sep}`),
        `Supervisor run log left isolated persist: ${supervisorLog}`,
      );
      assert.ok(
        !supervisorConvFile.startsWith(`${interactiveAssistant}${path.sep}`),
        `Supervisor conversation leaked into interactive persist: ${supervisorConvFile}`,
      );
      assert.match(acp, /[/\\]runtime-state[/\\]managed-resources[/\\]acp[/\\]/);
      assert.doesNotMatch(acp, /task-center-supervisor/);
      assert.match(
        processRegistryFile(),
        /[/\\]runtime-state[/\\]task-center-supervisor[/\\]personal-agent-process-registry\.json$/,
      );
      assert.match(supervisor.rootDirectory, /[/\\]runtime-state[/\\]task-center-supervisor$/);
    } finally {
      await supervisor.close("e2e-close");
    }

    configureProcessRegistry({ filePath: null, namespace: "personal-agent-runtime" });
    const services = createDesktopPersonalRuntimeServices({
      app: {
        getPath: (name) => (name === "userData" ? userDataDir : path.join(sandbox.root, name)),
      },
      runtimeManager: {
        runtimePathEntries: () => [],
        engineInfo: async () => ({ running: false, runtime: "direct" }),
        onmyagentServerInfo: async () => ({ running: false }),
      },
      readWorkspaceState: async () => ({ workspaces: [{ path: workspace }] }),
      deferStartupReconcileMs: 60_000,
    });
    try {
      const created = await services.personalAgentRuntime.createConversation({
        workspaceRoot: workspace,
        agent: { provider: "codex", id: "codex" },
        title: "Interactive e2e",
      });
      const mainLog = await writeRunningLog(workspace, "main-e2e-run");
      const mainConvFile = conversationFile(workspace, "codex", "codex");

      assert.ok(
        mainConvFile.startsWith(`${interactiveAssistant}${path.sep}`),
        `Main conversation left interactive persist: ${mainConvFile}`,
      );
      assert.ok(
        mainLog.startsWith(`${interactiveAssistant}${path.sep}`),
        `Main run log left interactive persist: ${mainLog}`,
      );
      assert.doesNotMatch(mainConvFile, /task-center-supervisor/);
      assert.doesNotMatch(mainLog, /task-center-supervisor/);

      const foundMain = await services.personalAgentRuntime.getConversationById({
        workspaceRoot: workspace,
        conversationId: created.conversation.id,
      });
      assert.equal(foundMain.conversation?.id, created.conversation.id);

      const foundSupervisor = await services.personalAgentRuntime.getConversationById({
        workspaceRoot: workspace,
        conversationId: supervisorConversationId,
      });
      assert.equal(foundSupervisor.conversation, null);

      await createOrphanHarness(userDataDir).reconcileOrphanRuns();
      const mainAfterMainReconcile = await readFile(mainLog, "utf8");
      const supervisorAfterMainReconcile = await readFile(supervisorLog, "utf8");
      assert.match(mainAfterMainReconcile, /"status":"failed"/);
      assert.match(supervisorAfterMainReconcile, /"status":"running"/);
      assert.doesNotMatch(supervisorAfterMainReconcile, /"status":"failed"/);

      configurePersonalAgentRuntimeState({
        userDataDir,
        personalAssistantRoot: isolatedAssistant,
      });
      await createOrphanHarness(userDataDir).reconcileOrphanRuns();
      const supervisorAfterIsolatedReconcile = await readFile(supervisorLog, "utf8");
      const mainAfterIsolatedReconcile = await readFile(mainLog, "utf8");
      assert.match(supervisorAfterIsolatedReconcile, /"status":"failed"/);
      assert.match(mainAfterIsolatedReconcile, /"status":"failed"/);
    } finally {
      await services.personalAgentRuntime.close();
      await services.personalAgentHeartbeatScheduler.close();
    }
  });
});
