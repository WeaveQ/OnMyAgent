#!/usr/bin/env bun

/**
 * Real, destructive Expert lifecycle smoke.
 *
 * Every mutable root is a child of one mkdtemp directory.  The script uses
 * the production server directory/origin/delete services and the production
 * desktop package/materialization/delete handlers.  A loopback OpenCode HTTP
 * fixture supplies the one process boundary needed by the server delete
 * service; child Bun processes exercise restart/replay rather than relying on
 * module state in the parent process.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
  applyExpertSessionIsolation,
  resolveExpertSessionRuntimeRoot,
} from "../../apps/server/src/services/expert-session-runtime.ts";
import {
  deleteExpertSessions,
} from "../../apps/server/src/services/expert-delete-saga.ts";
import {
  buildExpertDirectory,
  clearExpertDirectoryCache,
  healExpertDirectory,
} from "../../apps/server/src/services/expert-directory.ts";
import {
  scanWorkspaceExpertSessionMarkers,
} from "../../apps/server/src/services/workspace-session-marker-inventory.ts";
import {
  deleteWorkspaceSession,
} from "../../apps/server/src/services/workspace-sessions.ts";
import {
  deleteSessionOrigin,
  listSessionOrigins,
  upsertSessionOrigin,
} from "../../apps/server/src/services/session-origins.ts";
import {
  getExpertLifecycleEventsSnapshot,
  resetExpertLifecycleEventsForTest,
} from "../../apps/server/src/services/expert-lifecycle-events.ts";
import {
  createExpertMarketplace,
} from "../../apps/desktop/electron/expert-marketplace.mjs";
import {
  materializeExpertPackageSkillsStateAndRefresh,
} from "../../apps/desktop/electron/expert-package-skills.mjs";
import {
  createSkillsDomainHandlers,
} from "../../apps/desktop/electron/desktop-handlers/skills.mjs";
import {
  resolveLocalSkillsRoot,
} from "../../apps/desktop/electron/config-profile-paths.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../..");
const EVIDENCE_PATH = path.join(
  REPO_ROOT,
  ".loop/evidence/expert-module-refactor/real-smoke.json",
);
const CUSTOM_PACKAGE = "fixture-custom-expert";
const BUILTIN_PACKAGE = "fixture-builtin-expert";
const CUSTOM_AGENT = "fixture-custom-agent";
const CUSTOM_SESSION = "fixture-custom-session";
const BUILTIN_AGENT = "fixture-builtin-agent";
const BUILTIN_SESSION = "fixture-builtin-session";
const FOREIGN_AGENT = "fixture-foreign-agent";
const FOREIGN_SESSION = "fixture-foreign-session";
const SHARED_SKILL = "fixture-shared-skill";
const PRIVATE_SKILL = "fixture-private-skill";
const FOREIGN_SKILL = "fixture-foreign-skill";

function die(message) {
  throw new Error(`[real-smoke] ${message}`);
}

function inside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertInside(root, candidate, label) {
  assert.equal(
    inside(root, candidate),
    true,
    `${label} escaped disposable fixture: ${candidate}`,
  );
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativeFixturePath(fixtureRoot, target) {
  const relative = path.relative(fixtureRoot, target);
  return relative || ".";
}

function workspaceHash(workspace) {
  return createHash("sha256")
    .update(`${workspace.id}\0${path.resolve(workspace.path)}`)
    .digest("hex")
    .slice(0, 16);
}

function makeConfig(workspace, configRoot) {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "fixture-token",
    hostToken: "fixture-host-token",
    configPath: path.join(configRoot, "server.json"),
    approval: { mode: "auto", timeoutMs: 500 },
    corsOrigins: [],
    workspaces: [workspace],
    authorizedRoots: [workspace.path],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

function createDesktopHandlers({
  fixture,
  marketplace,
  rmImpl = rm,
}) {
  const skillsRoot = resolveLocalSkillsRoot(fixture.fakeHome);
  let refreshCount = 0;
  const handlers = createSkillsDomainHandlers({
    mkdir,
    cp,
    readFile,
    writeFile,
    rename,
    rm: rmImpl,
    path,
    existsSync,
    pathExists,
    onmyagentUserSkillsRoot: () => skillsRoot,
    onmyagentMarketplaceRoot: marketplace.onmyagentMarketplaceRoot,
    validateExpertMarketplaceName: marketplace.validateExpertMarketplaceName,
    validateExpertPackageName: marketplace.validateExpertPackageName,
    listExpertPackages: marketplace.listExpertPackages,
    listExpertRegistryRecords: marketplace.listExpertRegistryRecords,
    myExpertPackageFiles: marketplace.myExpertPackageFiles,
    refreshRuntimeSkillLinks: async () => {
      refreshCount += 1;
    },
    expertDeleteJournalPath: fixture.desktopJournal,
    userAgentRegistryPath: () => fixture.registryPath,
    validateSkillName: (value) => String(value),
    execResult: (ok, stdout = "", stderr = "") => ({ ok, stdout, stderr }),
  });
  return {
    handlers,
    skillsRoot,
    get refreshCount() {
      return refreshCount;
    },
  };
}

async function startOpenCodeFixture() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      pathname: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      hasDirectoryHeader: Boolean(request.headers["x-opencode-directory"]),
    });
    // The production deleteWorkspaceSession service treats 204 as a valid
    // empty delete response. No external process or network is contacted.
    response.statusCode = 204;
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") die("OpenCode fixture did not bind a loopback port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function runChild(mode, manifestPath) {
  const child = spawn(process.execPath, [SCRIPT_PATH, mode, manifestPath], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT: "",
      ONMYAGENT_DATA_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(exitCode, 0, `${mode} child failed (${exitCode}): ${stderr || stdout}`);
  const line = stdout.split(/\r?\n/).find((value) => value.startsWith("REAL_SMOKE_CHILD_RESULT "));
  assert.ok(line, `${mode} child did not return a result: ${stdout}`);
  const result = JSON.parse(line.slice("REAL_SMOKE_CHILD_RESULT ".length));
  return { exitCode, result, stdout, stderr };
}

async function serverReplay(manifestPath) {
  const manifest = await readJson(manifestPath);
  const result = await deleteExpertSessions(
    makeConfig(manifest.workspace, manifest.configRoot),
    manifest.workspace,
    manifest.serverRequest,
    {
      runtimeRoot: manifest.runtimeRoot,
      journalPath: manifest.serverJournal,
    },
  );
  assert.equal(result.state, "completed");
  assert.equal(typeof result.steps[0]?.sessionId, "string");
  assert.equal(JSON.stringify(result).includes(manifest.fixtureRoot), false);
  console.log(`REAL_SMOKE_CHILD_RESULT ${JSON.stringify(result)}`);
}

async function desktopReplay(manifestPath) {
  const manifest = await readJson(manifestPath);
  const marketplace = createExpertMarketplace({
    getRealHomeDir: () => manifest.fakeHome,
  });
  const fixture = {
    fakeHome: manifest.fakeHome,
    desktopJournal: manifest.desktopJournal,
    registryPath: manifest.registryPath,
  };
  const { handlers } = createDesktopHandlers({ fixture, marketplace });
  const result = await handlers.deleteExpertPackage({}, [manifest.desktopRequest]);
  assert.equal(result.state, "completed");
  assert.equal(JSON.stringify(result).includes(manifest.fixtureRoot), false);
  console.log(`REAL_SMOKE_CHILD_RESULT ${JSON.stringify(result)}`);
}

async function main() {
  // macOS exposes /var and /tmp through /private symlinks. Canonicalize the
  // disposable root once so production realpath checks and this safety audit
  // compare the same path representation.
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "onmyagent-expert-real-smoke-")),
  );
  const realOnMyAgentRoot = path.join(homedir(), ".onmyagent");
  const repoRuntimeRoots = [
    path.join(REPO_ROOT, ".onmyagent"),
    path.join(REPO_ROOT, "runtime"),
    path.join(REPO_ROOT, ".loop", "runtime"),
  ];
  const fixture = {
    fixtureRoot,
    workspaceRoot: path.join(fixtureRoot, "workspace"),
    runtimeRoot: path.join(fixtureRoot, "runtime"),
    userDataRoot: path.join(fixtureRoot, "user-data"),
    configRoot: path.join(fixtureRoot, "config"),
    fakeHome: path.join(fixtureRoot, "home"),
  };
  const customPaths = [];
  let openCodeFixture;
  let evidence;
  try {
    const canonicalTmpRoot = await realpath(tmpdir());
    assert.ok(fixtureRoot.startsWith(canonicalTmpRoot + path.sep));
    for (const [label, target] of Object.entries(fixture)) {
      if (label === "fixtureRoot") continue;
      assertInside(fixtureRoot, target, label);
      customPaths.push(target);
    }
    for (const target of [realOnMyAgentRoot, ...repoRuntimeRoots]) {
      assert.equal(inside(fixtureRoot, target), false);
    }

    await mkdir(fixture.workspaceRoot, { recursive: true });
    await mkdir(fixture.runtimeRoot, { recursive: true });
    await mkdir(fixture.userDataRoot, { recursive: true });
    await mkdir(fixture.configRoot, { recursive: true });
    await mkdir(path.join(fixture.fakeHome, ".onmyagent", "profiles", "local", "config"), { recursive: true });
    await writeJson(
      path.join(fixture.fakeHome, ".onmyagent", "profiles", "local", "config", "manifest.json"),
      { version: 1, migration: { status: "complete" } },
    );
    await writeJson(path.join(fixture.configRoot, "server.json"), { fixture: true, root: "<mktemp>" });

    const workspace = {
      id: "fixture-expert-workspace",
      name: "Disposable Expert workspace",
      path: fixture.workspaceRoot,
      preset: "default",
      workspaceType: "local",
    };

    const emptyWorkspace = {
      ...workspace,
      id: "fixture-empty-workspace",
      name: "Disposable empty workspace",
      path: path.join(fixtureRoot, "workspace-empty"),
    };
    await mkdir(emptyWorkspace.path, { recursive: true });
    clearExpertDirectoryCache();
    const emptyDirectory = await buildExpertDirectory(emptyWorkspace, {
      runtimeRoot: fixture.runtimeRoot,
      readSessions: async () => [],
    });
    assert.equal(emptyDirectory.complete, true);
    assert.deepEqual(emptyDirectory.records, []);
    assert.deepEqual((await listSessionOrigins(emptyWorkspace)).items, []);

    const legacyWorkspace = {
      ...workspace,
      id: "fixture-legacy-workspace",
      name: "Disposable legacy workspace",
      path: path.join(fixtureRoot, "workspace-legacy"),
    };
    await mkdir(legacyWorkspace.path, { recursive: true });
    const legacySessionId = "fixture-real-legacy-session";
    const legacyDirectory = path.join(
      fixture.runtimeRoot,
      workspaceHash(legacyWorkspace),
      "fixture-legacy-agent",
      "timestamp-key-not-a-session-id",
    );
    assertInside(fixtureRoot, legacyDirectory, "legacy runtime");
    customPaths.push(legacyDirectory);
    await writeJson(path.join(legacyDirectory, "onmyagent-session.json"), {
      kind: "expert-session",
      isolationVersion: 2,
      workspaceId: legacyWorkspace.id,
      agent: "fixture-legacy-agent",
      sessionKey: "timestamp-key-not-a-session-id",
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    });
    const legacyLookup = async () => [{
      id: legacySessionId,
      directory: await realpath(legacyDirectory),
    }];
    clearExpertDirectoryCache();
    const legacyDryRun = await healExpertDirectory(legacyWorkspace, {}, {
      runtimeRoot: fixture.runtimeRoot,
      readSessions: legacyLookup,
    });
    assert.deepEqual(legacyDryRun.actions.map((action) => action.kind), [
      "upgrade_marker",
      "write_origin",
    ]);
    assert.equal((await listSessionOrigins(legacyWorkspace)).items.length, 0);
    const legacyApplied = await healExpertDirectory(legacyWorkspace, {
      apply: true,
      expectedRevision: 0,
    }, {
      runtimeRoot: fixture.runtimeRoot,
      readSessions: legacyLookup,
    });
    assert.deepEqual(legacyApplied.actions.map((action) => action.kind), [
      "upgrade_marker",
      "write_origin",
    ]);
    const persistedLegacyMarker = await readJson(path.join(legacyDirectory, "onmyagent-session.json"));
    assert.equal(persistedLegacyMarker.isolationVersion, 3);
    assert.equal(persistedLegacyMarker.sessionId, legacySessionId);
    assert.equal(persistedLegacyMarker.agentId, "fixture-legacy-agent");
    assert.equal(persistedLegacyMarker.packageName, "fixture-legacy-agent");
    const legacyOrigins = await listSessionOrigins(legacyWorkspace);
    assert.deepEqual(legacyOrigins.items.map((item) => item.sessionId), [legacySessionId]);
    const legacyReplay = await healExpertDirectory(legacyWorkspace, {
      apply: true,
      expectedRevision: legacyApplied.revision,
    }, {
      runtimeRoot: fixture.runtimeRoot,
      readSessions: legacyLookup,
    });
    assert.deepEqual(legacyReplay.actions, []);

    openCodeFixture = await startOpenCodeFixture();
    workspace.baseUrl = openCodeFixture.baseUrl;
    const config = makeConfig(workspace, fixture.configRoot);
    const marketplace = createExpertMarketplace({
      getRealHomeDir: () => fixture.fakeHome,
    });
    const desktopFixture = {
      ...fixture,
      desktopJournal: path.join(fixture.userDataRoot, "desktop-expert-delete.json"),
      serverJournal: path.join(fixture.userDataRoot, "server-expert-delete.json"),
      registryPath: path.join(fixture.userDataRoot, "agents", "registry.json"),
    };
    for (const target of [
      desktopFixture.desktopJournal,
      desktopFixture.serverJournal,
      desktopFixture.registryPath,
      resolveLocalSkillsRoot(fixture.fakeHome),
      marketplace.onmyagentMarketplaceRoot("experts"),
      marketplace.onmyagentMarketplaceRoot("my-experts"),
    ]) {
      assertInside(fixtureRoot, target, "resolved target");
      customPaths.push(target);
    }

    const desktop = createDesktopHandlers({ fixture: desktopFixture, marketplace });
    await desktop.handlers.writeMyExpertPackage({}, [{
      packageName: CUSTOM_PACKAGE,
      name: "Disposable custom Expert",
      description: "A fixture-only custom Expert",
      quote: "fixture",
      skills: [SHARED_SKILL, PRIVATE_SKILL],
    }]);
    const customPackageDir = path.join(marketplace.onmyagentMarketplaceRoot("my-experts"), CUSTOM_PACKAGE);
    const builtinPackageDir = path.join(marketplace.onmyagentMarketplaceRoot("experts"), BUILTIN_PACKAGE);
    const foreignPackageDir = path.join(marketplace.onmyagentMarketplaceRoot("my-experts"), "fixture-foreign-package");
    await mkdir(path.join(customPackageDir, "skills", SHARED_SKILL), { recursive: true });
    await mkdir(path.join(customPackageDir, "skills", PRIVATE_SKILL), { recursive: true });
    await writeFile(path.join(customPackageDir, "skills", SHARED_SKILL, "SKILL.md"), "# Shared fixture skill\n", "utf8");
    await writeFile(path.join(customPackageDir, "skills", PRIVATE_SKILL, "SKILL.md"), "# Private fixture skill\n", "utf8");
    await mkdir(path.join(builtinPackageDir, ".expert-plugin", "..", "skills", SHARED_SKILL), { recursive: true });
    await writeJson(path.join(builtinPackageDir, ".expert-plugin", "plugin.json"), {
      name: BUILTIN_PACKAGE,
      skills: [`./skills/${SHARED_SKILL}`],
    });
    await writeFile(path.join(builtinPackageDir, "skills", SHARED_SKILL, "SKILL.md"), "# Shared fixture skill\n", "utf8");
    await mkdir(path.join(foreignPackageDir, ".expert-plugin"), { recursive: true });
    await writeJson(path.join(foreignPackageDir, ".expert-plugin", "plugin.json"), { name: "fixture-foreign-package", skills: [] });
    const skillsRoot = desktop.skillsRoot;
    await mkdir(path.join(skillsRoot, FOREIGN_SKILL), { recursive: true });
    await writeFile(path.join(skillsRoot, FOREIGN_SKILL, "SKILL.md"), "# Foreign user skill\n", "utf8");
    const customSkillState = await materializeExpertPackageSkillsStateAndRefresh({
      packageDir: customPackageDir,
      skillsRoot,
      refreshSkillLinks: async () => undefined,
    });
    const builtinSkillState = await materializeExpertPackageSkillsStateAndRefresh({
      packageDir: builtinPackageDir,
      skillsRoot,
      refreshSkillLinks: async () => undefined,
    });
    assert.deepEqual(customSkillState.missing, []);
    assert.deepEqual(builtinSkillState.missing, []);
    assert.deepEqual(customSkillState.installed.sort(), [PRIVATE_SKILL, SHARED_SKILL].sort());
    assert.deepEqual(builtinSkillState.installed, [SHARED_SKILL]);
    assert.equal(await pathExists(path.join(skillsRoot, FOREIGN_SKILL, "SKILL.md")), true);
    assert.deepEqual(await readJson(path.join(skillsRoot, SHARED_SKILL, ".onmyagent-expert-owners.json")), {
      owners: [BUILTIN_PACKAGE, CUSTOM_PACKAGE].sort(),
    });

    await writeJson(desktopFixture.registryPath, {
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      agents: [
        { id: CUSTOM_AGENT, name: "Disposable custom", packageName: CUSTOM_PACKAGE },
        { id: BUILTIN_AGENT, name: "Disposable built-in", packageName: BUILTIN_PACKAGE, builtin: true },
        { id: FOREIGN_AGENT, name: "Foreign fixture", packageName: "fixture-foreign-package" },
      ],
    });

    const runtimeDirectories = {
      custom: path.join(fixture.runtimeRoot, workspaceHash(workspace), CUSTOM_AGENT, CUSTOM_SESSION),
      builtin: path.join(fixture.runtimeRoot, workspaceHash(workspace), BUILTIN_AGENT, BUILTIN_SESSION),
      foreign: path.join(fixture.runtimeRoot, workspaceHash(workspace), FOREIGN_AGENT, FOREIGN_SESSION),
    };
    for (const [label, directory] of Object.entries(runtimeDirectories)) {
      assertInside(fixtureRoot, directory, `${label} runtime`);
      customPaths.push(directory);
    }
    const runtimeSpecs = [
      { key: "custom", directory: runtimeDirectories.custom, agentId: CUSTOM_AGENT, packageName: CUSTOM_PACKAGE, sessionId: CUSTOM_SESSION, skills: [SHARED_SKILL, PRIVATE_SKILL] },
      { key: "builtin", directory: runtimeDirectories.builtin, agentId: BUILTIN_AGENT, packageName: BUILTIN_PACKAGE, sessionId: BUILTIN_SESSION, skills: [SHARED_SKILL] },
      { key: "foreign", directory: runtimeDirectories.foreign, agentId: FOREIGN_AGENT, packageName: "fixture-foreign-package", sessionId: FOREIGN_SESSION, skills: [] },
    ];
    for (const spec of runtimeSpecs) {
      await applyExpertSessionIsolation({
        directory: spec.directory,
        workspaceId: workspace.id,
        agentId: spec.agentId,
        packageName: spec.packageName,
        sessionId: spec.sessionId,
        agentSegment: spec.agentId,
        sessionKey: spec.sessionId,
        declaredSkills: spec.skills,
        skillsSourceRoot: skillsRoot,
      });
    }

    let origins = await listSessionOrigins(workspace);
    for (const spec of runtimeSpecs) {
      await upsertSessionOrigin(workspace, spec.sessionId, {
        kind: "expert",
        agentId: spec.agentId,
        packageName: spec.packageName,
        directory: spec.directory,
        ...(origins.revision > 0 ? { expectedRevision: origins.revision } : {}),
      });
      origins = await listSessionOrigins(workspace);
    }
    assert.equal(origins.items.length, 3);
    assert.equal(origins.state, "ok");

    const sessions = runtimeSpecs.map((spec) => ({ id: spec.sessionId, directory: spec.directory }));
    const inventory = await scanWorkspaceExpertSessionMarkers({
      workspace,
      runtimeRoot: fixture.runtimeRoot,
    });
    assert.equal(inventory.complete, true);
    assert.equal(inventory.entries.length, 3);
    for (const entry of inventory.entries) assertInside(fixtureRoot, entry.directory, "inventory directory");
    clearExpertDirectoryCache();
    const beforeDirectory = await buildExpertDirectory(workspace, {
      runtimeRoot: fixture.runtimeRoot,
      readSessions: async () => sessions,
    });
    assert.equal(beforeDirectory.complete, true);
    assert.equal(beforeDirectory.records.length, 3);
    assert.deepEqual(
      beforeDirectory.records.map((record) => `${record.agentId}:${record.packageName}`).sort(),
      [`${BUILTIN_AGENT}:${BUILTIN_PACKAGE}`, `${CUSTOM_AGENT}:${CUSTOM_PACKAGE}`, `${FOREIGN_AGENT}:fixture-foreign-package`].sort(),
    );

    const serverRequest = {
      operationId: "fixture-server-delete-operation",
      agentId: CUSTOM_AGENT,
      packageName: CUSTOM_PACKAGE,
      marketplace: "my-experts",
      expectedRevision: origins.revision,
      sessionIds: [CUSTOM_SESSION],
    };
    const serverManifest = path.join(fixture.userDataRoot, "real-smoke-manifest.json");
    const manifest = {
      fixtureRoot,
      workspace,
      configRoot: fixture.configRoot,
      runtimeRoot: fixture.runtimeRoot,
      fakeHome: fixture.fakeHome,
      serverJournal: desktopFixture.serverJournal,
      desktopJournal: desktopFixture.desktopJournal,
      registryPath: desktopFixture.registryPath,
      packageName: CUSTOM_PACKAGE,
      agentId: CUSTOM_AGENT,
      serverRequest,
      desktopRequest: {
        operationId: "fixture-desktop-delete-operation",
        agentId: CUSTOM_AGENT,
        packageName: CUSTOM_PACKAGE,
        marketplace: "my-experts",
      },
    };
    assertInside(fixtureRoot, serverManifest, "restart manifest");
    await writeJson(serverManifest, manifest);

    let crash = true;
    await assert.rejects(
      deleteExpertSessions(config, workspace, serverRequest, {
        runtimeRoot: fixture.runtimeRoot,
        journalPath: desktopFixture.serverJournal,
        beforeTombstone: async () => {
          if (crash) {
            crash = false;
            throw new Error("fixture crash before tombstone");
          }
        },
      }),
      /fixture crash before tombstone/,
    );
    assert.equal(await pathExists(runtimeDirectories.custom), false);
    const originsAfterCrash = await listSessionOrigins(workspace);
    assert.equal(originsAfterCrash.items.some((item) => item.sessionId === CUSTOM_SESSION), true);
    const journalAfterCrash = await readJson(desktopFixture.serverJournal);
    // A process-level crash happens before the saga can compute its returned
    // partial state. Durable per-step checkpoints are the recovery truth.
    assert.equal(journalAfterCrash[0].state, "failed");
    assert.equal(journalAfterCrash[0].steps[0].tombstone, "pending");

    const serverReplay = await runChild("--server-replay", serverManifest);
    const serverReplayAgain = await runChild("--server-replay", serverManifest);
    assert.deepEqual(serverReplayAgain.result, serverReplay.result);
    assert.equal(serverReplay.result.state, "completed");
    assert.equal(serverReplay.result.steps[0].tombstone, "completed");
    const originsAfterServer = await listSessionOrigins(workspace);
    assert.equal(originsAfterServer.items.some((item) => item.sessionId === CUSTOM_SESSION), false);
    assert.equal(originsAfterServer.tombstones.some((item) => item.sessionId === CUSTOM_SESSION), true);
    assert.equal(await pathExists(runtimeDirectories.builtin), true);
    assert.equal(await pathExists(runtimeDirectories.foreign), true);
    clearExpertDirectoryCache();
    const afterServerDirectory = await buildExpertDirectory(workspace, {
      runtimeRoot: fixture.runtimeRoot,
      readSessions: async () => sessions.filter((session) => session.id !== CUSTOM_SESSION),
    });
    assert.equal(afterServerDirectory.complete, true);
    assert.equal(afterServerDirectory.records.length, 2);

    let failPackageDelete = true;
    const failingRm = async (target, options) => {
      if (failPackageDelete && path.resolve(target) === path.resolve(customPackageDir)) {
        failPackageDelete = false;
        throw new Error("fixture package delete failure");
      }
      return rm(target, options);
    };
    const desktopPartialHandlers = createDesktopHandlers({
      fixture: desktopFixture,
      marketplace,
      rmImpl: failingRm,
    }).handlers;
    const desktopRequest = manifest.desktopRequest;
    const desktopPartial = await desktopPartialHandlers.deleteExpertPackage({}, [desktopRequest]);
    assert.equal(desktopPartial.state, "partial");
    assert.equal(desktopPartial.steps.find((step) => step.target === "my-experts").state, "failed");
    assert.equal(desktopPartial.steps.find((step) => step.target === "registry").state, "pending");
    assert.equal(await pathExists(customPackageDir), true);
    assert.equal((await readJson(desktopFixture.registryPath)).agents.some((agent) => agent.id === CUSTOM_AGENT), true);
    assert.equal(await pathExists(path.join(skillsRoot, PRIVATE_SKILL)), false);
    assert.equal(await pathExists(builtinPackageDir), true);
    assert.equal(await pathExists(foreignPackageDir), true);
    assert.equal(await pathExists(path.join(skillsRoot, FOREIGN_SKILL)), true);

    const desktopReplay = await runChild("--desktop-replay", serverManifest);
    const desktopReplayAgain = await runChild("--desktop-replay", serverManifest);
    assert.deepEqual(desktopReplayAgain.result, desktopReplay.result);
    assert.equal(desktopReplay.result.state, "completed");
    assert.equal(await pathExists(customPackageDir), false);
    assert.equal(await pathExists(builtinPackageDir), true);
    assert.equal(await pathExists(foreignPackageDir), true);
    const registryAfter = await readJson(desktopFixture.registryPath);
    assert.equal(registryAfter.agents.some((agent) => agent.id === CUSTOM_AGENT), false);
    assert.equal(registryAfter.agents.some((agent) => agent.id === BUILTIN_AGENT), true);
    assert.equal(registryAfter.agents.some((agent) => agent.id === FOREIGN_AGENT), true);
    assert.equal(await pathExists(path.join(skillsRoot, FOREIGN_SKILL)), true);
    assert.equal(await pathExists(path.join(skillsRoot, PRIVATE_SKILL)), false);
    assert.equal(await pathExists(path.join(skillsRoot, SHARED_SKILL)), true);

    const serverEvents = getExpertLifecycleEventsSnapshot().events;
    const serverResults = [serverReplay.result, serverReplayAgain.result];
    const redactedPayload = JSON.stringify({ serverResults, desktopPartial, desktopReplay: desktopReplay.result, serverEvents });
    assert.equal(redactedPayload.includes(fixtureRoot), false);
    assert.equal(redactedPayload.includes(runtimeDirectories.custom), false);
    assert.equal(JSON.stringify(await readJson(desktopFixture.serverJournal)).includes(fixtureRoot), false);
    assert.equal(JSON.stringify(await readJson(desktopFixture.desktopJournal)).includes(fixtureRoot), false);
    assert.equal(serverEvents.some((event) => event.sessionHash?.startsWith("sha256:")), true);
    assert.equal(serverEvents.some((event) => JSON.stringify(event).includes(runtimeDirectories.custom)), false);

    const tombstone = originsAfterServer.tombstones.find((item) => item.sessionId === CUSTOM_SESSION);
    evidence = {
      status: "PASS",
      scope: "mktemp-only",
      fixtureRoot: "<mktemp>",
      fixtureRootBasename: path.basename(fixtureRoot),
      resolvedRoots: Object.fromEntries(Object.entries({
        workspace: fixture.workspaceRoot,
        runtime: fixture.runtimeRoot,
        userData: fixture.userDataRoot,
        config: fixture.configRoot,
        fakeHome: fixture.fakeHome,
        skills: skillsRoot,
      }).map(([key, target]) => [key, relativeFixturePath(fixtureRoot, target)])),
      before: {
        originItems: 3,
        markerEntries: 3,
        directoryRecords: 3,
        customRuntime: relativeFixturePath(fixtureRoot, runtimeDirectories.custom),
        builtinRuntime: relativeFixturePath(fixtureRoot, runtimeDirectories.builtin),
        foreignRuntime: relativeFixturePath(fixtureRoot, runtimeDirectories.foreign),
      },
      rolloutScenarios: {
        resetEmpty: {
          complete: emptyDirectory.complete,
          directoryRecords: emptyDirectory.records.length,
          originItems: 0,
        },
        multipleExperts: {
          directoryRecords: beforeDirectory.records.length,
          originItems: origins.items.length,
          markerEntries: inventory.entries.length,
        },
        deleteThenRestart: {
          replayExitCodes: [serverReplay.exitCode, serverReplayAgain.exitCode],
          resultState: serverReplay.result.state,
          remainingRecords: afterServerDirectory.records.length,
        },
        legacyHeal: {
          dryRunActions: legacyDryRun.actions.map((action) => action.kind),
          applyActions: legacyApplied.actions.map((action) => action.kind),
          replayActions: legacyReplay.actions.length,
          markerVersion: persistedLegacyMarker.isolationVersion,
          originSessionId: legacyOrigins.items[0]?.sessionId,
        },
      },
      serverDelete: {
        crashPoint: "before-tombstone",
        replayExitCodes: [serverReplay.exitCode, serverReplayAgain.exitCode],
        resultState: serverReplay.result.state,
        tombstoneSessionId: tombstone?.sessionId,
        tombstoneRevision: tombstone?.revision,
        afterDirectoryRecords: afterServerDirectory.records.length,
        customRuntimeExists: await pathExists(runtimeDirectories.custom),
        builtinRuntimeExists: await pathExists(runtimeDirectories.builtin),
        foreignRuntimeExists: await pathExists(runtimeDirectories.foreign),
      },
      desktopDelete: {
        crashPoint: "package-delete-step",
        partialState: desktopPartial.state,
        replayExitCodes: [desktopReplay.exitCode, desktopReplayAgain.exitCode],
        resultState: desktopReplay.result.state,
        customPackageExists: await pathExists(customPackageDir),
        builtinPackageExists: await pathExists(builtinPackageDir),
        foreignPackageExists: await pathExists(foreignPackageDir),
        customRegistryExists: registryAfter.agents.some((agent) => agent.id === CUSTOM_AGENT),
        builtinRegistryPreserved: registryAfter.agents.some((agent) => agent.id === BUILTIN_AGENT),
        foreignRegistryPreserved: registryAfter.agents.some((agent) => agent.id === FOREIGN_AGENT),
        privateSkillExists: await pathExists(path.join(skillsRoot, PRIVATE_SKILL)),
        sharedSkillExists: await pathExists(path.join(skillsRoot, SHARED_SKILL)),
        foreignSkillExists: await pathExists(path.join(skillsRoot, FOREIGN_SKILL)),
      },
      redaction: {
        serverResultPaths: false,
        desktopResultPaths: false,
        lifecycleRawPaths: false,
        journalRawPaths: false,
      },
      process: {
        openCodeDeleteRequests: openCodeFixture.requests.filter((request) => request.method === "DELETE").length,
        loopbackOnly: openCodeFixture.requests.every((request) => request.method === "DELETE" || request.method === undefined),
        childExitCodes: [serverReplay.exitCode, serverReplayAgain.exitCode, desktopReplay.exitCode, desktopReplayAgain.exitCode],
      },
      safety: {
        allResolvedTargetsInsideFixture: customPaths.every((target) => inside(fixtureRoot, target)),
        realHomeOnMyAgentTargeted: false,
        repositoryRuntimeTargeted: false,
        defaultRuntimeRootObserved: resolveExpertSessionRuntimeRoot() !== fixture.runtimeRoot,
      },
      evidencePath: EVIDENCE_PATH,
    };
    assert.equal(evidence.safety.allResolvedTargetsInsideFixture, true);
    assert.equal(JSON.stringify(evidence).includes(fixtureRoot), false);
    await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
    await writeJson(EVIDENCE_PATH, evidence);
    console.log(`REAL_SMOKE_EVIDENCE ${EVIDENCE_PATH}`);
    console.log(`REAL_SMOKE_RESULT ${JSON.stringify({ status: evidence.status, evidence: EVIDENCE_PATH })}`);
  } finally {
    if (openCodeFixture) await openCodeFixture.close().catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
    resetExpertLifecycleEventsForTest();
  }
}

const mode = process.argv[2];
if (mode === "--server-replay" || mode === "--desktop-replay") {
  await (mode === "--server-replay" ? serverReplay(process.argv[3]) : desktopReplay(process.argv[3]));
} else {
  await main();
}
