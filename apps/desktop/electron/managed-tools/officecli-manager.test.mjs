import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  compareOfficeCliVersions,
  createOfficeCliManager,
  officeCliPlatformKey,
} from "./officecli-manager.mjs";
import { resolveLocalSkillsRoot } from "../config-profile-paths.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(value) {
  return new Response(value, { status: 200 });
}

function release(version, binary, skill) {
  return {
    schemaVersion: 1,
    pluginId: "officecli",
    version,
    skill: {
      path: "SKILL.md",
      sha256: sha256(skill),
      size: Buffer.byteLength(skill),
    },
    assets: {
      "darwin-arm64": {
        path: `officecli-${version}`,
        sha256: sha256(binary),
        size: binary.byteLength,
      },
    },
  };
}

function pointer(version, releaseManifest) {
  const text = JSON.stringify(releaseManifest);
  return {
    schemaVersion: 1,
    pluginId: "officecli",
    channel: "stable",
    latestVersion: version,
    releaseManifest: {
      path: `releases/${version}/manifest.json`,
      sha256: sha256(text),
      size: Buffer.byteLength(text),
    },
  };
}

function fixtureFetch({ pointerManifest, releaseManifest, binary, skill }) {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/releases/1.0.102/manifest.json")) {
      return jsonResponse(releaseManifest);
    }
    if (url.endsWith("/manifest.json")) return jsonResponse(pointerManifest);
    if (url.endsWith("/officecli-1.0.102")) return bytesResponse(binary);
    if (url.endsWith("/SKILL.md")) return bytesResponse(skill);
    throw new Error(`unexpected test URL: ${url}`);
  };
}

test("maps supported platforms and compares OfficeCLI versions", () => {
  assert.equal(officeCliPlatformKey("darwin", "arm64"), "darwin-arm64");
  assert.equal(officeCliPlatformKey("win32", "x64"), "win32-x64");
  assert.equal(officeCliPlatformKey("freebsd", "x64"), null);
  assert.equal(compareOfficeCliVersions("1.0.103", "1.0.102"), 1);
  assert.equal(compareOfficeCliVersions("1.0.102", "1.0.102"), 0);
  assert.equal(compareOfficeCliVersions("1.0.101", "1.0.102"), -1);
});

test("installs a verified OfficeCLI release and materializes the official skill", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-manager-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    const manager = createOfficeCliManager({
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      fetchImpl: fixtureFetch({
        pointerManifest: pointer("1.0.102", releaseManifest),
        releaseManifest,
        binary,
        skill,
      }),
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    const status = await manager.installLatest();

    assert.equal(status.installedVersion, "1.0.102");
    assert.equal(status.usable, true);
    assert.equal(
      await readFile(path.join(resolveLocalSkillsRoot(home), "officecli", "SKILL.md"), "utf8"),
      skill,
    );
    assert.equal(
      (await stat(path.join(home, ".onmyagent", "profiles", "local", "tools", "bin", "officecli"))).isFile(),
      true,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test(
  "the stable launcher dispatches commands to the active release",
  { skip: process.platform !== "darwin" || os.arch() !== "arm64" },
  async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-launcher-"));
    try {
      const outputPath = path.join(home, "launcher-output.json");
      const binary = Buffer.from(
        `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.OFFICECLI_TEST_OUTPUT, JSON.stringify(process.argv.slice(2)));\n`,
      );
      const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
      const releaseManifest = release("1.0.102", binary, skill);
      const manager = createOfficeCliManager({
        homeDir: home,
        manifestUrl: "https://oss.test/officecli/manifest.json",
        fetchImpl: fixtureFetch({
          pointerManifest: pointer("1.0.102", releaseManifest),
          releaseManifest,
          binary,
          skill,
        }),
        platform: process.platform,
        arch: os.arch(),
        runBinaryVersion: async () => true,
        refreshSkillLinks: async () => undefined,
      });

      await manager.installLatest();
      execFileSync(
        path.join(manager.paths.toolsBinRoot, "officecli"),
        ["--help", "sample.docx"],
        { env: { ...process.env, OFFICECLI_TEST_OUTPUT: outputPath } },
      );
      assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), [
        "--help",
        "sample.docx",
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test("keeps the active release when a later update fails verification", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-rollback-"));
  try {
    const binary102 = Buffer.from("officecli-1.0.102-binary");
    const skill102 = "---\nname: officecli\n---\n102\n";
    const release102 = release("1.0.102", binary102, skill102);
    let latest = pointer("1.0.102", release102);
    let releaseForLatest = release102;
    let binaryForLatest = binary102;
    let skillForLatest = skill102;
    const manager = createOfficeCliManager({
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      fetchImpl: async (input) => {
      const url = String(input);
        if (url.endsWith("/releases/1.0.102/manifest.json")) return jsonResponse(release102);
        if (url.endsWith("/releases/1.0.103/manifest.json")) return jsonResponse(releaseForLatest);
        if (url.endsWith("/manifest.json")) return jsonResponse(latest);
        if (url.endsWith("/officecli-1.0.102")) return bytesResponse(binary102);
        if (url.endsWith("/officecli-1.0.103")) return bytesResponse(binaryForLatest);
        if (url.includes("/releases/1.0.102/SKILL.md")) return bytesResponse(skill102);
        if (url.includes("/releases/1.0.103/SKILL.md")) return bytesResponse(skillForLatest);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    await manager.installLatest();

    const binary103 = Buffer.from("officecli-1.0.103-binary");
    const skill103 = "---\nname: officecli\n---\n103\n";
    releaseForLatest = {
      ...release("1.0.103", binary103, skill103),
      assets: {
        "darwin-arm64": {
          ...release("1.0.103", binary103, skill103).assets["darwin-arm64"],
          sha256: "0".repeat(64),
        },
      },
    };
    binaryForLatest = binary103;
    skillForLatest = skill103;
    latest = pointer("1.0.103", releaseForLatest);

    const updateStatus = await manager.checkForUpdates(true);
    assert.equal(updateStatus.state, "update_available");
    assert.equal(updateStatus.latestVersion, "1.0.103");

    releaseForLatest = {
      ...releaseForLatest,
      assets: {
        ...releaseForLatest.assets,
        "darwin-arm64": {
          ...releaseForLatest.assets["darwin-arm64"],
          sha256: "0".repeat(64),
        },
      },
    };
    latest = pointer("1.0.103", releaseForLatest);
    await assert.rejects(() => manager.installLatest(), /checksum/i);
    const status = await manager.getStatus();
    assert.equal(status.installedVersion, "1.0.102");
    assert.equal(status.usable, true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("does not overwrite a user-owned OfficeCLI skill", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-skill-conflict-"));
  try {
    const skillRoot = resolveLocalSkillsRoot(home);
    const skillPath = path.join(skillRoot, "officecli");
    await mkdir(skillPath, { recursive: true });
    const userSkill = "---\nname: officecli\n---\nUser-owned skill.\n";
    await writeFile(path.join(skillPath, "SKILL.md"), userSkill, "utf8");

    const binary = Buffer.from("officecli-1.0.102-binary");
    const releaseManifest = release("1.0.102", binary, userSkill);
    const manager = createOfficeCliManager({
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      fetchImpl: fixtureFetch({
        pointerManifest: pointer("1.0.102", releaseManifest),
        releaseManifest,
        binary,
        skill: userSkill,
      }),
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    await assert.rejects(() => manager.installLatest(), /user-owned|conflict/i);
    assert.equal(await readFile(path.join(skillPath, "SKILL.md"), "utf8"), userSkill);
    assert.equal((await manager.getStatus()).state, "not_installed");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
