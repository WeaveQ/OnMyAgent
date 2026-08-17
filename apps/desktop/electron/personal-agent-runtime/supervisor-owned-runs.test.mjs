import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  readSupervisorOwnedRunIds,
  resolveTaskSupervisorRegistryFile,
  shouldFinalizeOrphanRunLog,
  supervisorOwnedRunIdsFromRegistry,
  TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE,
} from "./supervisor-owned-runs.mjs";
import { managedAcpToolRoot } from "./managed-acp-tools.mjs";
import {
  configurePersonalAgentRuntimeState,
  personalAgentRoot,
  personalAgentRootAt,
  personalAgentRuntimeStateRoot,
  personalAssistantRoot,
  resetPersonalAgentRuntimeState,
  resolveInteractivePersonalRuntimeStateRoot,
  resolveTaskSupervisorPersonalAssistantRoot,
  resolveTaskSupervisorPersonalRuntimeStateRoot,
} from "./runtime-state.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("supervisor-owned run skip", () => {
  it("reads run ids only from the Task Supervisor registry namespace", () => {
    assert.deepEqual(
      [...supervisorOwnedRunIdsFromRegistry({
        namespace: "task-supervisor",
        processes: [{ runId: "sup-1" }, { runId: "sup-2" }],
      })].sort(),
      ["sup-1", "sup-2"],
    );
    assert.deepEqual(
      [...supervisorOwnedRunIdsFromRegistry({
        namespace: "electron-personal",
        processes: [{ runId: "personal-1" }],
      })],
      [],
    );
  });

  it("does not finalize a Supervisor-owned run that is absent from main memory", () => {
    const supervisorOwnedRunIds = new Set(["task-run"]);
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "task-run",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds,
      }),
      false,
    );
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "personal-run",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds,
      }),
      true,
    );
  });

  it("still skips in-memory and post-cutoff personal runs", () => {
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "live",
        inMemory: true,
        startedAt: 1,
        reconcileCutoffMs: 100,
      }),
      false,
    );
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "fresh",
        inMemory: false,
        startedAt: 200,
        reconcileCutoffMs: 100,
      }),
      false,
    );
  });

  it("loads live Supervisor run ids from the shipped registry path", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "supervisor-owned-runs-"));
    roots.push(userDataDir);
    const filePath = resolveTaskSupervisorRegistryFile(userDataDir);
    assert.equal(
      filePath,
      path.join(userDataDir, TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE),
    );
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        namespace: "task-supervisor",
        processes: [{ runId: "sup-live", status: "running" }],
      }, null, 2)}\n`,
      "utf8",
    );
    const ids = await readSupervisorOwnedRunIds(userDataDir);
    assert.equal(ids.registryReadable, true);
    assert.deepEqual([...ids.runIds], ["sup-live"]);
    const missingUserData = await readSupervisorOwnedRunIds("");
    assert.equal(missingUserData.registryReadable, true);
    assert.deepEqual([...missingUserData.runIds], []);
  });

  it("treats a missing Supervisor registry as empty-owned-ids", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "supervisor-owned-runs-missing-"));
    roots.push(userDataDir);
    const missing = await readSupervisorOwnedRunIds(userDataDir);
    assert.equal(missing.registryReadable, true);
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "personal-orphan",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds: missing.runIds,
        supervisorRegistryReadable: missing.registryReadable,
      }),
      true,
    );
  });

  it("does not finalize when the Supervisor registry JSON is corrupt", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "supervisor-owned-runs-invalid-"));
    roots.push(userDataDir);
    const filePath = resolveTaskSupervisorRegistryFile(userDataDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not-json", "utf8");
    const invalid = await readSupervisorOwnedRunIds(userDataDir);
    assert.equal(invalid.registryReadable, false);
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "maybe-supervisor",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds: invalid.runIds,
        supervisorRegistryReadable: invalid.registryReadable,
      }),
      false,
    );
  });

  it("still finalizes a personal orphan when the Supervisor registry is readable and empty", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "supervisor-owned-runs-empty-"));
    roots.push(userDataDir);
    const filePath = resolveTaskSupervisorRegistryFile(userDataDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({ version: 1, namespace: "task-supervisor", processes: [] })}\n`,
      "utf8",
    );
    const empty = await readSupervisorOwnedRunIds(userDataDir);
    assert.equal(empty.registryReadable, true);
    assert.equal(
      shouldFinalizeOrphanRunLog({
        runId: "personal-orphan",
        inMemory: false,
        startedAt: 1,
        reconcileCutoffMs: 100,
        supervisorOwnedRunIds: empty.runIds,
        supervisorRegistryReadable: empty.registryReadable,
      }),
      true,
    );
  });

  it("Supervisor persist root is under task-center-supervisor, not the main personal-assistant tree", () => {
    const userDataDir = path.join("/onmyagent-user-data", "app");
    const mainRoot = resolveInteractivePersonalRuntimeStateRoot(userDataDir);
    const supervisorRoot = resolveTaskSupervisorPersonalRuntimeStateRoot(userDataDir);
    const workspace = "/Users/demo/project";
    const mainPersist = personalAgentRootAt(mainRoot, workspace);
    const supervisorPersist = path.join(
      resolveTaskSupervisorPersonalAssistantRoot(userDataDir),
      "workspaces",
      path.basename(mainPersist),
    );

    assert.match(supervisorRoot, /task-center-supervisor$/);
    assert.notEqual(supervisorRoot, mainRoot);
    assert.match(mainPersist, /[/\\]personal-assistant[/\\]workspaces[/\\]/);
    assert.match(resolveTaskSupervisorPersonalAssistantRoot(userDataDir), /[/\\]task-center-supervisor[/\\]personal-assistant$/);
    assert.notEqual(supervisorPersist, mainPersist);
    assert.ok(!supervisorPersist.startsWith(`${mainPersist}${path.sep}`));
    assert.ok(!mainPersist.startsWith(`${supervisorPersist}${path.sep}`));
  });

  it("resetPersonalAgentRuntimeState clears persist and runtimeStateRoot overrides", () => {
    const userDataDir = path.join("/onmyagent-user-data", "reset-globals");
    configurePersonalAgentRuntimeState({
      userDataDir,
      personalAssistantRoot: resolveTaskSupervisorPersonalAssistantRoot(userDataDir),
    });
    try {
      assert.match(personalAgentRuntimeStateRoot(), /[/\\]runtime-state$/);
      assert.match(personalAssistantRoot(), /[/\\]task-center-supervisor[/\\]personal-assistant$/);
      resetPersonalAgentRuntimeState();
      assert.doesNotMatch(personalAgentRuntimeStateRoot(), /onmyagent-user-data/);
      assert.doesNotMatch(personalAssistantRoot(), /task-center-supervisor/);
    } finally {
      resetPersonalAgentRuntimeState();
    }
  });

  it("keeps managed ACP on interactive runtime-state when Supervisor persist is isolated", () => {
    const userDataDir = path.join("/onmyagent-user-data", "shared-acp");
    const workspace = "/Users/demo/project";
    configurePersonalAgentRuntimeState({
      userDataDir,
      personalAssistantRoot: resolveTaskSupervisorPersonalAssistantRoot(userDataDir),
    });
    try {
      const persist = personalAgentRoot(workspace);
      const acp = managedAcpToolRoot("codex");
      assert.match(persist, /[/\\]task-center-supervisor[/\\]personal-assistant[/\\]/);
      assert.match(personalAssistantRoot(), /[/\\]task-center-supervisor[/\\]personal-assistant$/);
      assert.match(acp, /[/\\]runtime-state[/\\]managed-resources[/\\]acp[/\\]/);
      assert.doesNotMatch(acp, /task-center-supervisor/);
    } finally {
      resetPersonalAgentRuntimeState();
    }
  });

  it("main-process reconcile and Task Supervisor share the same registry relative path", async () => {
    const [reconcileSource, supervisorSource, mainSource] = await Promise.all([
      readFile(new URL("./orphan-reconcile.mjs", import.meta.url), "utf8"),
      readFile(new URL("../task-supervisor/service.mjs", import.meta.url), "utf8"),
      readFile(new URL("../personal-runtime-services.mjs", import.meta.url), "utf8"),
    ]);
    assert.match(reconcileSource, /readSupervisorOwnedRunIds\(/);
    assert.match(reconcileSource, /shouldFinalizeOrphanRunLog\(/);
    assert.match(reconcileSource, /supervisorRegistryReadable/);
    assert.match(reconcileSource, /personalRunWorkspacesRoot\(/);
    assert.doesNotMatch(reconcileSource, /personalAgentRuntimeStateRoot\(\)/);
    assert.match(supervisorSource, /export function createTaskSupervisorPersonalRuntime/);
    assert.match(supervisorSource, /personalAssistantRoot:\s*resolveTaskSupervisorPersonalAssistantRoot\(/);
    assert.doesNotMatch(supervisorSource, /runtimeStateRoot:\s*resolveTaskSupervisorPersonalRuntimeStateRoot\(/);
    assert.match(supervisorSource, /resolveTaskSupervisorPersonalRuntimeStateRoot\(/);
    assert.doesNotMatch(mainSource, /resolveTaskSupervisorPersonalAssistantRoot/);
    assert.match(mainSource, /createPersonalAgentRuntime\(\{/);
    assert.equal(
      TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE,
      path.join("runtime-state", "task-center-supervisor", "personal-agent-process-registry.json"),
    );
  });
});
