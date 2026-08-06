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
  loadOfficeCliDownloadConfig,
  officeCliPlatformKey,
  resolveOfficeCliDownloadConfigPath,
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

function streamingBytesResponse(value) {
  const chunks = [value.subarray(0, 3), value.subarray(3)];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-length": String(value.byteLength) },
    },
  );
}

function stallingResponse() {
  return new Response(new ReadableStream({ start() {} }), { status: 200 });
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
      "officecli-mac-arm64": {
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
  assert.equal(officeCliPlatformKey("darwin", "arm64"), "officecli-mac-arm64");
  assert.equal(officeCliPlatformKey("win32", "x64"), "officecli-win-x64");
  assert.equal(officeCliPlatformKey("linux", "x64"), null);
  assert.equal(officeCliPlatformKey("freebsd", "x64"), null);
  assert.equal(compareOfficeCliVersions("1.0.103", "1.0.102"), 1);
  assert.equal(compareOfficeCliVersions("1.0.102", "1.0.102"), 0);
  assert.equal(compareOfficeCliVersions("1.0.101", "1.0.102"), -1);
});

test("accepts the uploaded Alibaba OSS manifest shape with signed URL overrides", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-oss-manifest-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const rootUrl = "https://oss.test/officecli/manifest.json?root-signature";
    const releaseUrl = "https://oss.test/officecli/releases/1.0.102/manifest.json?release-signature";
    const skillUrl = "https://oss.test/officecli/releases/1.0.102/SKILL.md?skill-signature";
    const assetUrl = "https://oss.test/officecli/releases/1.0.102/officecli-mac-arm64?asset-signature";
    const latest = {
      schemaVersion: 1,
      channel: "stable",
      latestVersion: "1.0.102",
      releaseManifest: "releases/1.0.102/manifest.json",
    };
    const releaseManifest = {
      schemaVersion: 1,
      version: "1.0.102",
      officecliVersion: "1.0.102",
      skillPath: "SKILL.md",
      assets: {
        "officecli-mac-arm64": {
          path: "officecli-mac-arm64",
          sha256: sha256(binary),
          size: binary.byteLength,
        },
      },
    };
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl: rootUrl,
      releaseManifestUrl: releaseUrl,
      skillUrl,
      assetUrlOverrides: { "officecli-mac-arm64": assetUrl },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === rootUrl) return jsonResponse(latest);
        if (url === releaseUrl) return jsonResponse(releaseManifest);
        if (url === assetUrl) return bytesResponse(binary);
        if (url === skillUrl) return bytesResponse(skill);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    const status = await manager.installLatest();

    assert.equal(status.installedVersion, "1.0.102");
    assert.equal(status.usable, true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("does not expose signed URL query parameters in network errors", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-safe-error-"));
  try {
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl:
        "https://oss.test/officecli/manifest.json?OSSAccessKeyId=secret&Signature=secret",
      networkRetryCount: 0,
      fetchImpl: async () => new Response("temporary failure", { status: 503 }),
      platform: "darwin",
      arch: "arm64",
    });

    const status = await manager.checkForUpdates(true);

    assert.equal(status.state, "error");
    assert.match(status.errorMessage ?? "", /manifest\.json/);
    assert.doesNotMatch(status.errorMessage ?? "", /OSSAccessKeyId|Signature|secret/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("publishes the refreshed status after a background update check", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-status-event-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    const statuses = [];
    const manager = createOfficeCliManager({
      downloadConfig: false,
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
      onStatus: (status) => statuses.push(status),
    });

    const status = await manager.checkForUpdates(true);

    assert.equal(status.state, "not_installed");
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].latestVersion, "1.0.102");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("retries a transient manifest fetch before reporting an error", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-retry-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    let rootAttempts = 0;
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      networkRetryCount: 2,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/releases/1.0.102/manifest.json")) {
          return jsonResponse(releaseManifest);
        }
        if (url.endsWith("/manifest.json")) {
          rootAttempts += 1;
          if (rootAttempts < 3) throw new Error("temporary network failure");
          return jsonResponse(pointer("1.0.102", releaseManifest));
        }
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
    });

    const status = await manager.checkForUpdates(true);

    assert.equal(status.errorCode, undefined);
    assert.equal(status.latestVersion, "1.0.102");
    assert.equal(rootAttempts, 3);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("returns a typed timeout when the manifest request never completes", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-timeout-"));
  try {
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      networkTimeoutMs: 10,
      networkRetryCount: 0,
      fetchImpl: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      platform: "darwin",
      arch: "arm64",
    });

    const status = await manager.checkForUpdates(true);

    assert.equal(status.state, "error");
    assert.equal(status.errorCode, "network_timeout");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("times out when a response stream stalls after its headers arrive", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-stream-timeout-"));
  try {
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      networkTimeoutMs: 10,
      networkRetryCount: 0,
      fetchImpl: async () => stallingResponse(),
      platform: "darwin",
      arch: "arm64",
    });

    const status = await manager.checkForUpdates(true);

    assert.equal(status.state, "error");
    assert.equal(status.errorCode, "network_timeout");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("streams binary downloads and reports received bytes", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-stream-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    const progress = [];
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/releases/1.0.102/manifest.json")) {
          return jsonResponse(releaseManifest);
        }
        if (url.endsWith("/manifest.json")) {
          return jsonResponse(pointer("1.0.102", releaseManifest));
        }
        if (url.endsWith("/officecli-1.0.102")) return streamingBytesResponse(binary);
        if (url.endsWith("/SKILL.md")) return bytesResponse(skill);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      onProgress: (event) => progress.push(event),
    });

    await manager.installLatest();

    assert.equal(
      progress.some(
        (event) =>
          event.phase === "downloading_binary" &&
          event.receivedBytes === binary.byteLength &&
          event.totalBytes === binary.byteLength,
      ),
      true,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("installs a verified OfficeCLI release and materializes the official skill", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-manager-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    const manager = createOfficeCliManager({
      downloadConfig: false,
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

test("rejects a binary whose version only contains the requested version", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-version-boundary-"));
  try {
    const binary = Buffer.from(
      "#!/usr/bin/env node\nprocess.stdout.write(\"1.0.1029\\n\");\n",
    );
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    const manager = createOfficeCliManager({
      downloadConfig: false,
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
    });

    await assert.rejects(() => manager.installLatest(), /version check failed/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("marks an installed runtime unusable when its binary is tampered with", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-integrity-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = release("1.0.102", binary, skill);
    const manager = createOfficeCliManager({
      downloadConfig: false,
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

    await manager.installLatest();
    await writeFile(
      path.join(
        manager.paths.managedRoot,
        "releases",
        "1.0.102",
        "officecli-mac-arm64",
        "officecli",
      ),
      "tampered",
      "utf8",
    );

    const status = await manager.getStatus();

    assert.equal(status.usable, false);
    assert.equal(status.state, "error");
    assert.equal(status.errorCode, "integrity_mismatch");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("selects the Windows x64 asset and launcher names", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-win32-"));
  try {
    const binary = Buffer.from("officecli-1.0.102-win-x64-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseManifest = {
      schemaVersion: 1,
      pluginId: "officecli",
      version: "1.0.102",
      skill: {
        path: "SKILL.md",
        sha256: sha256(skill),
        size: Buffer.byteLength(skill),
      },
      assets: {
        "officecli-win-x64": {
          path: "officecli-win-x64.exe",
          sha256: sha256(binary),
          size: binary.byteLength,
        },
      },
    };
    const manager = createOfficeCliManager({
      downloadConfig: false,
      homeDir: home,
      manifestUrl: "https://oss.test/officecli/manifest.json",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/releases/1.0.102/manifest.json")) {
          return jsonResponse(releaseManifest);
        }
        if (url.endsWith("/manifest.json")) {
          return jsonResponse(pointer("1.0.102", releaseManifest));
        }
        if (url.endsWith("/officecli-win-x64.exe")) return bytesResponse(binary);
        if (url.endsWith("/SKILL.md")) return bytesResponse(skill);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "win32",
      arch: "x64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    const status = await manager.installLatest();

    assert.equal(status.platform, "officecli-win-x64");
    assert.equal(status.usable, true);
    assert.equal(
      (await stat(
        path.join(
          manager.paths.managedRoot,
          "releases",
          "1.0.102",
          "officecli-win-x64",
          "officecli.exe",
        ),
      )).isFile(),
      true,
    );
    assert.equal((await stat(path.join(manager.paths.toolsBinRoot, "officecli.cmd"))).isFile(), true);
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
      downloadConfig: false,
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
      downloadConfig: false,
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
        "officecli-mac-arm64": {
          ...release("1.0.103", binary103, skill103).assets["officecli-mac-arm64"],
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
        "officecli-mac-arm64": {
          ...releaseForLatest.assets["officecli-mac-arm64"],
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
      downloadConfig: false,
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

test("loadOfficeCliDownloadConfig reads local URL overrides from JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-download-config-"));
  try {
    const configPath = path.join(root, "download-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        manifestUrl: "https://oss.test/officecli/manifest.json?sig=root",
        releaseManifestUrl: "https://oss.test/officecli/releases/1.0.143/manifest.json?sig=rel",
        skillUrl: "https://oss.test/officecli/releases/1.0.143/SKILL.md?sig=skill",
        assets: {
          "officecli-mac-arm64":
            "https://oss.test/officecli/releases/1.0.143/officecli-mac-arm64?sig=bin",
          "officecli-mac-x64":
            "https://oss.test/officecli/releases/1.0.143/officecli-mac-x64?sig=binx",
        },
      }),
      "utf8",
    );

    const config = loadOfficeCliDownloadConfig(configPath);
    assert.equal(
      config.manifestUrl,
      "https://oss.test/officecli/manifest.json?sig=root",
    );
    assert.equal(
      config.releaseManifestUrl,
      "https://oss.test/officecli/releases/1.0.143/manifest.json?sig=rel",
    );
    assert.equal(
      config.skillUrl,
      "https://oss.test/officecli/releases/1.0.143/SKILL.md?sig=skill",
    );
    assert.equal(
      config.assetUrlOverrides["officecli-mac-arm64"],
      "https://oss.test/officecli/releases/1.0.143/officecli-mac-arm64?sig=bin",
    );
    assert.equal(
      resolveOfficeCliDownloadConfigPath(configPath),
      configPath,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs from pinned CDN config without root manifest (zip assets)", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-pinned-zip-"));
  try {
    const binary = Buffer.from("officecli-1.0.143-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const releaseUrl =
      "https://cdn.test/officecli/release/1_0_143/manifest.json";
    const skillUrl = "https://cdn.test/officecli/release/1_0_143/SKILL.md";
    const zipUrl = "https://cdn.test/officecli/release/1_0_143/officecli_mac_arm64.zip";
    const releaseManifest = {
      schemaVersion: 1,
      version: "1.0.143",
      officecliVersion: "1.0.143",
      assets: {
        "officecli-mac-arm64": {
          path: "officecli-mac-arm64",
          sha256: sha256(binary),
          size: binary.byteLength,
        },
      },
    };

    // Build a real zip so extractZipEntry runs.
    const zipRoot = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-zip-src-"));
    const entryPath = path.join(zipRoot, "officecli-mac-arm64");
    const zipPath = path.join(zipRoot, "officecli_mac_arm64.zip");
    await writeFile(entryPath, binary);
    execFileSync("zip", ["-j", zipPath, entryPath], { stdio: "ignore" });
    const zipBytes = await readFile(zipPath);

    const manager = createOfficeCliManager({
      downloadConfig: {
        version: "1.0.143",
        releaseManifestUrl: releaseUrl,
        skillUrl,
        assets: {
          "officecli-mac-arm64": {
            url: zipUrl,
            archive: "zip",
            entry: "officecli-mac-arm64",
          },
        },
      },
      homeDir: home,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === releaseUrl) return jsonResponse(releaseManifest);
        if (url === skillUrl) return bytesResponse(skill);
        if (url === zipUrl) return bytesResponse(zipBytes);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    const status = await manager.installLatest();
    assert.equal(status.installedVersion, "1.0.143");
    assert.equal(status.usable, true);
    assert.equal(status.latestVersion, "1.0.143");
    await rm(zipRoot, { recursive: true, force: true });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("installLatest uses download-config.json overrides without env injection", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-config-install-"));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "oma-officecli-config-file-"));
  try {
    const binary = Buffer.from("officecli-1.0.143-binary");
    const skill = "---\nname: officecli\n---\nUse OfficeCLI.\n";
    const rootUrl = "https://oss.test/officecli/manifest.json?root-signature";
    const releaseUrl =
      "https://oss.test/officecli/releases/1.0.143/manifest.json?release-signature";
    const skillUrl =
      "https://oss.test/officecli/releases/1.0.143/SKILL.md?skill-signature";
    const assetUrl =
      "https://oss.test/officecli/releases/1.0.143/officecli-mac-arm64?asset-signature";
    const configPath = path.join(configRoot, "download-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        manifestUrl: rootUrl,
        releaseManifestUrl: releaseUrl,
        skillUrl,
        assets: { "officecli-mac-arm64": assetUrl },
      }),
      "utf8",
    );

    const latest = {
      schemaVersion: 1,
      channel: "stable",
      latestVersion: "1.0.143",
      releaseManifest: "releases/1.0.143/manifest.json",
    };
    const releaseManifest = {
      schemaVersion: 1,
      version: "1.0.143",
      officecliVersion: "1.0.143",
      skillPath: "SKILL.md",
      assets: {
        "officecli-mac-arm64": {
          path: "officecli-mac-arm64",
          sha256: sha256(binary),
          size: binary.byteLength,
        },
      },
    };

    const manager = createOfficeCliManager({
      homeDir: home,
      downloadConfigPath: configPath,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === rootUrl) return jsonResponse(latest);
        if (url === releaseUrl) return jsonResponse(releaseManifest);
        if (url === assetUrl) return bytesResponse(binary);
        if (url === skillUrl) return bytesResponse(skill);
        throw new Error(`unexpected test URL: ${url}`);
      },
      platform: "darwin",
      arch: "arm64",
      runBinaryVersion: async () => true,
      refreshSkillLinks: async () => undefined,
    });

    const status = await manager.installLatest();
    assert.equal(status.installedVersion, "1.0.143");
    assert.equal(status.usable, true);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
