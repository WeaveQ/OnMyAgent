import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  clearAgentProcesses,
  cleanupRegisteredAgentProcesses,
  configureProcessRegistry,
  flushAgentProcessRegistry,
  processRegistryFile,
  processRegistryNamespace,
  recoverAgentProcesses,
  registerAgentProcess,
} from "./process-registry.mjs";

const roots = [];

afterEach(async () => {
  configureProcessRegistry({ filePath: null, namespace: "personal-agent-runtime" });
  clearAgentProcesses({ persist: false });
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Personal process registry namespace isolation", () => {
  it("does not recover or clean a registry owned by another namespace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "personal-process-registry-namespace-"));
    roots.push(root);
    const filePath = path.join(root, "personal-process-registry.json");

    configureProcessRegistry({ filePath, namespace: "electron-personal" });
    assert.equal(processRegistryFile(), filePath);
    assert.equal(processRegistryNamespace(), "electron-personal");
    registerAgentProcess({ runId: "electron-run", pid: 999_991, pgid: 999_991, provider: "codex", status: "running" });
    await flushAgentProcessRegistry();
    const owned = await readFile(filePath, "utf8");
    assert.match(owned, /"namespace":\s*"electron-personal"/);

    configureProcessRegistry({ filePath, namespace: "task-center-supervisor" });
    assert.deepEqual(await recoverAgentProcesses({ markStale: true }), { processes: [] });
    assert.deepEqual(await cleanupRegisteredAgentProcesses({ graceMs: 1 }), { killed: [] });
    assert.equal(await readFile(filePath, "utf8"), owned);

    configureProcessRegistry({ filePath, namespace: "electron-personal" });
    const recovered = await recoverAgentProcesses({ markStale: false });
    assert.equal(recovered.processes.length, 1);
    assert.equal(recovered.processes[0].runId, "electron-run");
  });

  it("keeps two configured files and namespaces independent across reconfiguration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "personal-process-registry-files-"));
    roots.push(root);
    const electronFile = path.join(root, "electron.json");
    const supervisorFile = path.join(root, "supervisor.json");

    configureProcessRegistry({ filePath: electronFile, namespace: "electron" });
    registerAgentProcess({ runId: "electron-run", pid: 999_992, provider: "codex" });
    await flushAgentProcessRegistry();

    configureProcessRegistry({ filePath: supervisorFile, namespace: "supervisor" });
    assert.deepEqual(await recoverAgentProcesses({ markStale: false }), { processes: [] });
    registerAgentProcess({ runId: "supervisor-run", pid: 999_993, provider: "codex" });
    await flushAgentProcessRegistry();

    configureProcessRegistry({ filePath: electronFile, namespace: "electron" });
    const electron = await recoverAgentProcesses({ markStale: false });
    assert.deepEqual(electron.processes.map((record) => record.runId), ["electron-run"]);

    configureProcessRegistry({ filePath: supervisorFile, namespace: "supervisor" });
    const supervisor = await recoverAgentProcesses({ markStale: false });
    assert.deepEqual(supervisor.processes.map((record) => record.runId), ["supervisor-run"]);
  });
});
