import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSkillsDomainHandlers } from "./skills.mjs";

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-delete-"));
  const packageDir = path.join(fixtureRoot, "my-experts", "custom-expert");
  const builtinDir = path.join(fixtureRoot, "experts", "custom-expert");
  const skillsRoot = path.join(fixtureRoot, "skills");
  await mkdir(path.join(packageDir, "skills", "shared-skill"), { recursive: true });
  await mkdir(path.join(builtinDir, ".expert-plugin"), { recursive: true });
  await mkdir(path.join(packageDir, ".expert-plugin"), { recursive: true });
  await mkdir(path.join(skillsRoot, "shared-skill"), { recursive: true });
  await writeFile(path.join(packageDir, ".expert-plugin", "plugin.json"), JSON.stringify({ skills: ["./skills/shared-skill"] }));
  await writeFile(path.join(packageDir, "skills", "shared-skill", "SKILL.md"), "---\nname: shared-skill\n---\nshared\n");
  await writeFile(path.join(builtinDir, ".expert-plugin", "plugin.json"), JSON.stringify({ name: "builtin" }));
  await writeFile(path.join(skillsRoot, "shared-skill", ".onmyagent-expert-owners.json"), JSON.stringify({ owners: ["custom-expert", "other-expert"] }));
  const registryPath = path.join(fixtureRoot, "user-data", "agents", "registry.json");
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify({ version: 1, updatedAt: "2026-01-01T00:00:00.000Z", agents: [{ id: "agent-1", name: "Custom" }] }));
  return { fixtureRoot, packageDir, builtinDir, skillsRoot, registryPath, journalPath: path.join(fixtureRoot, "user-data", "expert-delete.json") };
}

function handlers(fixture, overrides = {}) {
  return createSkillsDomainHandlers({
    mkdir,
    cp: async () => undefined,
    readFile,
    writeFile,
    rename,
    rm,
    path,
    existsSync,
    expertDeleteJournalPath: fixture.journalPath,
    userAgentRegistryPath: () => fixture.registryPath,
    onmyagentMarketplaceRoot: (marketplace) => path.join(fixture.fixtureRoot, marketplace),
    onmyagentUserSkillsRoot: () => fixture.skillsRoot,
    validateExpertPackageName: (value) => String(value),
    refreshRuntimeSkillLinks: async () => undefined,
    ...overrides,
  });
}

test("deleteExpertPackage removes custom package, preserves shared skills, and protects built-in copy", async () => {
  const fixture = await createFixture();
  try {
    const result = await handlers(fixture).deleteExpertPackage({}, [{
      operationId: "desktop-delete-1",
      agentId: "agent-1",
      packageName: "custom-expert",
      marketplace: "my-experts",
    }]);
    assert.equal(result.state, "completed");
    assert.equal(existsSync(fixture.packageDir), false);
    assert.equal(existsSync(fixture.builtinDir), true);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.skillsRoot, "shared-skill", ".onmyagent-expert-owners.json"), "utf8")), { owners: ["other-expert"] });
    assert.equal(result.steps.find((step) => step.target === "experts").code, "builtin_protected");
    assert.deepEqual(JSON.parse(await readFile(fixture.registryPath, "utf8")).agents, []);
    const replay = await handlers(fixture).deleteExpertPackage({}, [{
      operationId: "desktop-delete-1",
      agentId: "agent-1",
      packageName: "custom-expert",
      marketplace: "my-experts",
    }]);
    assert.deepEqual(replay, result);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("deleteExpertPackage refuses built-in marketplace and malformed journal", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      handlers(fixture).deleteExpertPackage({}, [{ operationId: "op", agentId: "agent-1", packageName: "custom-expert", marketplace: "experts" }]),
      /Built-in expert packages cannot be deleted/,
    );
    await mkdir(path.dirname(fixture.journalPath), { recursive: true });
    await writeFile(fixture.journalPath, "not-json");
    await assert.rejects(
      handlers(fixture).deleteExpertPackage({}, [{ operationId: "op2", agentId: "agent-1", packageName: "custom-expert", marketplace: "my-experts" }]),
      /journal is corrupt/,
    );
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("deleteExpertPackage rejects operation-id reuse across identities and missing registry is idempotent", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.dirname(fixture.journalPath), { recursive: true });
    await writeFile(fixture.journalPath, JSON.stringify([{
      version: 1,
      operationId: "same-op",
      agentId: "other-agent",
      packageName: "other-package",
      state: "partial",
      result: {
        ok: true,
        operationId: "same-op",
        packageName: "other-package",
        state: "partial",
        steps: [
          { target: "my-experts", state: "pending" },
          { target: "experts", state: "pending" },
          { target: "registry", state: "pending" },
          { target: "skills", state: "pending" },
        ],
        removedSkills: [],
      },
    }]));
    await assert.rejects(
      handlers(fixture).deleteExpertPackage({}, [{ operationId: "same-op", agentId: "agent-1", packageName: "custom-expert", marketplace: "my-experts" }]),
      /belongs to another package/,
    );
    await rm(fixture.registryPath, { force: true });
    const result = await handlers(fixture).deleteExpertPackage({}, [{ operationId: "missing-registry", agentId: "agent-1", packageName: "custom-expert", marketplace: "my-experts" }]);
    assert.equal(result.state, "completed");
    assert.equal(result.steps.find((step) => step.target === "registry").code, "registry_missing");
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("deleteExpertPackage keeps registry pending until package deletion succeeds and resumes failed steps", async () => {
  const fixture = await createFixture();
  let failPackageDelete = true;
  const deleteHandlers = handlers(fixture, {
    rm: async (target, options) => {
      if (target === fixture.packageDir && failPackageDelete) {
        failPackageDelete = false;
        throw new Error("fixture package delete failure");
      }
      return rm(target, options);
    },
  });
  const input = {
    operationId: "desktop-delete-resume",
    agentId: "agent-1",
    packageName: "custom-expert",
    marketplace: "my-experts",
  };
  try {
    const partial = await deleteHandlers.deleteExpertPackage({}, [input]);
    assert.equal(partial.state, "partial");
    assert.equal(partial.steps.find((step) => step.target === "my-experts").state, "failed");
    assert.equal(partial.steps.find((step) => step.target === "registry").state, "pending");
    assert.equal(JSON.parse(await readFile(fixture.registryPath, "utf8")).agents.length, 1);

    const completed = await deleteHandlers.deleteExpertPackage({}, [input]);
    assert.equal(completed.state, "completed");
    assert.equal(completed.steps.find((step) => step.target === "my-experts").state, "completed");
    assert.equal(completed.steps.find((step) => step.target === "registry").state, "completed");
    assert.deepEqual(JSON.parse(await readFile(fixture.registryPath, "utf8")).agents, []);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});
