import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createLarkCliManager,
  larkCliPlatformKey,
  loadLarkCliDownloadConfig,
} from "./lark-cli-manager.mjs";
import { resolveLocalSkillsRoot } from "../config-profile-paths.mjs";
import { MANAGED_CLI_DEFAULT_REGISTRY_PATH } from "./managed-cli/index.mjs";

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

test("maps supported platforms for lark-cli", () => {
  assert.equal(larkCliPlatformKey("darwin", "arm64"), "lark-cli-mac-arm64");
  assert.equal(larkCliPlatformKey("darwin", "x64"), "lark-cli-mac-x64");
  assert.equal(larkCliPlatformKey("win32", "x64"), "lark-cli-win-x64");
});

test("loadLarkCliDownloadConfig reads lark-cli entry from managed-cli registry", () => {
  const loaded = loadLarkCliDownloadConfig(MANAGED_CLI_DEFAULT_REGISTRY_PATH);
  assert.equal(
    loaded.manifestUrl,
    "https://weaveq-plugs.oss-cn-hangzhou.aliyuncs.com/lark-cli/manifest.json",
  );
});

test("installs from self-contained root catalog with skillsPack", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-lark-cli-catalog-"));
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "oma-lark-cli-fx-"));
  try {
    const binary = Buffer.from("lark-cli-1.0.84-binary");
    const skill = "---\nname: lark-cli\n---\nEntry skill.\n";
    const rootUrl = "https://cdn.test/lark-cli/manifest.json";
    const skillUrl = "https://cdn.test/lark-cli/SKILL.md";
    const zipUrl = "https://cdn.test/lark-cli/lark-cli-mac-arm64.zip";
    const packUrl = "https://cdn.test/lark-cli/lark-cli-skills.zip";

    const packDir = path.join(fixtureRoot, "lark-cli-skills");
    for (const id of ["lark-im", "lark-shared", "lark-calendar"]) {
      const dir = path.join(packDir, id);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "SKILL.md"),
        `---\nname: ${id}\n---\nBody for ${id}.\n`,
        "utf8",
      );
    }
    const packZipPath = path.join(fixtureRoot, "lark-cli-skills.zip");
    execFileSync("zip", ["-ry", packZipPath, "lark-cli-skills"], {
      cwd: fixtureRoot,
      stdio: "ignore",
    });
    const packBytes = await readFile(packZipPath);

    const entryPath = path.join(fixtureRoot, "lark-cli");
    const binZipPath = path.join(fixtureRoot, "lark-cli-mac-arm64.zip");
    await writeFile(entryPath, binary);
    execFileSync("zip", ["-j", binZipPath, entryPath], { stdio: "ignore" });
    const zipBytes = await readFile(binZipPath);

    const catalog = {
      schemaVersion: 1,
      pluginId: "lark-cli",
      channel: "stable",
      latestVersion: "1.0.84",
      skill: { url: skillUrl },
      skillsPack: {
        url: packUrl,
        archive: "zip",
        sha256: sha256(packBytes),
      },
      assets: {
        "lark-cli-mac-arm64": {
          url: zipUrl,
          archive: "zip",
          entry: "lark-cli",
          sha256: sha256(binary),
        },
      },
    };

    const manager = createLarkCliManager({
      downloadConfig: { manifestUrl: rootUrl },
      homeDir: home,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === rootUrl) return jsonResponse(catalog);
        if (url === skillUrl) return bytesResponse(skill);
        if (url === zipUrl) return bytesResponse(zipBytes);
        if (url === packUrl) return bytesResponse(packBytes);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    const status = await manager.installLatest();
    assert.equal(status.pluginId, "lark-cli");
    assert.equal(status.installedVersion, "1.0.84");
    assert.equal(status.usable, true);

    const skillsRoot = resolveLocalSkillsRoot(home);
    assert.equal(
      await readFile(path.join(skillsRoot, "lark-cli", "SKILL.md"), "utf8"),
      skill,
    );
    assert.match(
      await readFile(path.join(skillsRoot, "lark-im", "SKILL.md"), "utf8"),
      /name: lark-im/,
    );
    assert.match(
      await readFile(path.join(skillsRoot, "lark-shared", "SKILL.md"), "utf8"),
      /name: lark-shared/,
    );

    const uninstalled = await manager.uninstall();
    assert.equal(uninstalled.state, "not_installed");
    await assert.rejects(
      () => readFile(path.join(skillsRoot, "lark-cli", "SKILL.md"), "utf8"),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
