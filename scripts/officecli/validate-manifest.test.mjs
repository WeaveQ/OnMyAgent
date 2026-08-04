import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { validateOfficeCliManifests } from "./validate-manifest.mjs";

const assetNames = [
  "officecli-mac-arm64",
  "officecli-mac-x64",
  "officecli-win-arm64.exe",
  "officecli-win-x64.exe",
];

function digest(content) {
  const bytes = Buffer.from(content);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture({ strict }) {
  const root = await mkdtemp(path.join(tmpdir(), "officecli-validator-"));
  const releaseDir = path.join(root, "release");
  await mkdir(releaseDir, { recursive: true });

  const skillContent = "---\nname: officecli\n---\n";
  const skillDigest = digest(skillContent);
  await writeFile(path.join(releaseDir, "SKILL.md"), skillContent, "utf8");

  const assets = {};
  for (const [index, fileName] of assetNames.entries()) {
    const content = `binary-${index}`;
    const filePath = path.join(releaseDir, fileName);
    await writeFile(filePath, content, "utf8");
    assets[fileName.replace(/\.exe$/, "")] = {
      path: fileName,
      ...digest(content),
    };
  }

  const releaseManifest = {
    schemaVersion: 1,
    version: "1.0.102",
    assets,
  };
  if (strict) {
    releaseManifest.pluginId = "officecli";
    releaseManifest.officecliVersion = "1.0.102";
    releaseManifest.skill = {
      path: "SKILL.md",
      ...skillDigest,
    };
  } else {
    releaseManifest.skillPath = "SKILL.md";
  }

  const releaseManifestPath = path.join(releaseDir, "manifest.json");
  await writeJson(releaseManifestPath, releaseManifest);
  const releaseManifestBytes = await readFile(releaseManifestPath);
  const latestManifest = {
    schemaVersion: 1,
    channel: "stable",
    latestVersion: "1.0.102",
    releaseManifest: strict
      ? {
          path: "releases/1.0.102/manifest.json",
          ...digest(releaseManifestBytes),
        }
      : "releases/1.0.102/manifest.json",
  };
  if (strict) latestManifest.pluginId = "officecli";

  const latestManifestPath = path.join(root, "manifest.json");
  await writeJson(latestManifestPath, latestManifest);
  return { root, releaseDir, latestManifestPath, releaseManifestPath };
}

test("validates the strict release contract and every referenced file", async () => {
  const fixture = await createFixture({ strict: true });
  try {
    const result = await validateOfficeCliManifests({
      latestManifestPath: fixture.latestManifestPath,
      releaseManifestPath: fixture.releaseManifestPath,
      releaseDir: fixture.releaseDir,
      strict: true,
    });

    assert.equal(result.version, "1.0.102");
    assert.equal(result.checkedFiles, 5);
    assert.deepEqual(result.assets, [
      "officecli-mac-arm64",
      "officecli-mac-x64",
      "officecli-win-arm64",
      "officecli-win-x64",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("accepts the current OSS-compatible manifest shape", async () => {
  const fixture = await createFixture({ strict: false });
  try {
    const result = await validateOfficeCliManifests({
      latestManifestPath: fixture.latestManifestPath,
      releaseManifestPath: fixture.releaseManifestPath,
      releaseDir: fixture.releaseDir,
    });

    assert.equal(result.version, "1.0.102");
    assert.equal(result.checkedFiles, 5);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a release whose latest pointer does not match", async () => {
  const fixture = await createFixture({ strict: false });
  try {
    const latest = JSON.parse(await readFile(fixture.latestManifestPath, "utf8"));
    latest.latestVersion = "1.0.103";
    await writeJson(fixture.latestManifestPath, latest);

    await assert.rejects(
      validateOfficeCliManifests({
        latestManifestPath: fixture.latestManifestPath,
        releaseManifestPath: fixture.releaseManifestPath,
      }),
      /latestVersion does not match release version/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a tampered referenced asset", async () => {
  const fixture = await createFixture({ strict: true });
  try {
    await writeFile(
      path.join(fixture.releaseDir, "officecli-mac-arm64"),
      "tampered",
      "utf8",
    );

    await assert.rejects(
      validateOfficeCliManifests({
        latestManifestPath: fixture.latestManifestPath,
        releaseManifestPath: fixture.releaseManifestPath,
        releaseDir: fixture.releaseDir,
        strict: true,
      }),
      /OfficeCLI asset officecli-mac-arm64 sha256 mismatch/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
