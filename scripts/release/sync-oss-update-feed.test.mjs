import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildOssPutAuthorization,
  parseCliArgs,
  prefixRelativeArtifactUrl,
  prepareOssSyncStaging,
  publicOssObjectUrl,
  rewriteManifestUrls,
  shouldSyncCustomerOssFeed,
  syncOssUpdateFeed,
  uploadOssSyncPlan,
  versionFromReleaseTag,
  waitAndDownloadGithubReleaseAssets,
  websiteDownloadKey,
} from "./sync-oss-update-feed.mjs";

const version = "0.5.19";

function sampleMacManifest({ prefixed = false } = {}) {
  const prefix = prefixed ? `${version}/` : "";
  return [
    "version: 0.5.19",
    "files:",
    `  - url: ${prefix}onmyagent-mac-arm64-0.5.19.zip`,
    "    sha512: macziphash==",
    "    size: 12",
    `  - url: ${prefix}onmyagent-mac-arm64-0.5.19.dmg`,
    "    sha512: macdmghash==",
    "    size: 10",
    `  - url: ${prefix}onmyagent-mac-x64-0.5.19.zip`,
    "    sha512: macx64ziphash==",
    "    size: 13",
    `  - url: ${prefix}onmyagent-mac-x64-0.5.19.dmg`,
    "    sha512: macx64dmghash==",
    "    size: 11",
    "releaseDate: '2026-08-18T04:36:27.135Z'",
    "",
  ].join("\n");
}

function sampleWinManifest() {
  return [
    "version: 0.5.19",
    "files:",
    "  - url: onmyagent-win-x64-0.5.19.exe",
    "    sha512: winexehash==",
    "    size: 9",
    "releaseDate: '2026-08-18T04:34:07.809Z'",
    "",
  ].join("\n");
}

async function writeReleaseFixture(root) {
  const required = [
    `onmyagent-mac-arm64-${version}.zip`,
    `onmyagent-mac-arm64-${version}.zip.blockmap`,
    `onmyagent-mac-arm64-${version}.dmg`,
    `onmyagent-mac-arm64-${version}.dmg.blockmap`,
    `onmyagent-mac-x64-${version}.zip`,
    `onmyagent-mac-x64-${version}.zip.blockmap`,
    `onmyagent-mac-x64-${version}.dmg`,
    `onmyagent-win-x64-${version}.exe`,
    `onmyagent-win-x64-${version}.exe.blockmap`,
  ];
  for (const name of required) {
    await writeFile(path.join(root, name), name, "utf8");
  }
  await writeFile(path.join(root, "latest-mac.yml"), sampleMacManifest(), "utf8");
  await writeFile(path.join(root, "latest.yml"), sampleWinManifest(), "utf8");
}

test("versionFromReleaseTag reads a v-prefixed semver tag", () => {
  assert.equal(versionFromReleaseTag("v0.5.19"), "0.5.19");
  assert.throws(() => versionFromReleaseTag("0.5.19"), /Invalid release tag/);
});

test("shouldSyncCustomerOssFeed only allows published non-prerelease desktop tags", () => {
  assert.equal(shouldSyncCustomerOssFeed({ draft: false, prerelease: false, tag: "v0.5.19" }), true);
  assert.equal(shouldSyncCustomerOssFeed({ draft: "false", prerelease: "false", tag: "v0.5.19" }), true);
  assert.equal(shouldSyncCustomerOssFeed({ draft: true, prerelease: false, tag: "v0.5.19" }), false);
  assert.equal(shouldSyncCustomerOssFeed({ draft: false, prerelease: true, tag: "v0.5.19" }), false);
  assert.equal(shouldSyncCustomerOssFeed({ draft: false, prerelease: false, tag: "onmyagent-orchestrator-v0.4.20" }), false);
});

test("prefixRelativeArtifactUrl adds the version directory once", () => {
  assert.equal(
    prefixRelativeArtifactUrl("onmyagent-mac-arm64-0.5.19.zip", version),
    "0.5.19/onmyagent-mac-arm64-0.5.19.zip",
  );
  assert.equal(
    prefixRelativeArtifactUrl("0.5.19/onmyagent-mac-arm64-0.5.19.zip", version),
    "0.5.19/onmyagent-mac-arm64-0.5.19.zip",
  );
  assert.throws(
    () => prefixRelativeArtifactUrl("https://example.com/onmyagent-mac-arm64-0.5.19.zip", version),
    /relative OSS path/,
  );
});

test("rewriteManifestUrls prefixes urls and keeps hashes", () => {
  const rewritten = rewriteManifestUrls(sampleMacManifest(), version);
  assert.match(rewritten, /^  - url: 0\.5\.19\/onmyagent-mac-arm64-0\.5\.19\.zip$/m);
  assert.match(rewritten, /^    sha512: macziphash==$/m);
  assert.equal(rewriteManifestUrls(sampleMacManifest({ prefixed: true }), version), sampleMacManifest({ prefixed: true }));
  assert.throws(() => rewriteManifestUrls("version: 0.5.18\nfiles:\n  - url: a.zip\n", version), /does not match/);
});

test("websiteDownloadKey maps versioned installers onto stable names", () => {
  assert.equal(
    websiteDownloadKey("onmyagent-mac-arm64-0.5.19.dmg", version),
    "website-download/onmyagent-mac-arm64.dmg",
  );
  assert.equal(websiteDownloadKey("onmyagent-mac-arm64-0.5.19.zip", version), "");
});

test("prepareOssSyncStaging stages versioned packages, rewritten yml, and website copies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oss-sync-src-"));
  const staging = path.join(root, "staging");
  await writeReleaseFixture(root);

  const plan = prepareOssSyncStaging({ sourceDir: root, stagingDir: staging, version });
  const keys = plan.objects.map((object) => object.key);

  assert.equal(plan.prefix, "onmyagent");
  assert.ok(keys.includes("onmyagent/0.5.19/onmyagent-mac-arm64-0.5.19.zip"));
  assert.ok(keys.includes("onmyagent/0.5.19/onmyagent-mac-arm64-0.5.19.zip.blockmap"));
  assert.ok(keys.includes("onmyagent/0.5.19/onmyagent-win-x64-0.5.19.exe"));
  assert.ok(keys.includes("onmyagent/website-download/onmyagent-mac-arm64.dmg"));
  assert.ok(keys.includes("onmyagent/website-download/onmyagent-mac-x64.dmg"));
  assert.ok(keys.includes("onmyagent/website-download/onmyagent-win-x64.exe"));
  assert.ok(keys.includes("onmyagent/latest-mac.yml"));
  assert.ok(keys.includes("onmyagent/latest.yml"));
  assert.equal(
    keys.filter((key) => key === "onmyagent/website-download/onmyagent-win-x64.exe").length,
    1,
  );

  const macYml = await readFile(path.join(staging, "latest-mac.yml"), "utf8");
  assert.match(macYml, /url: 0\.5\.19\/onmyagent-mac-arm64-0\.5\.19\.zip/);
  assert.match(macYml, /sha512: macziphash==/);
});

test("prepareOssSyncStaging fails when a required installer is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oss-sync-missing-"));
  await writeFile(path.join(root, "latest-mac.yml"), sampleMacManifest(), "utf8");
  await writeFile(path.join(root, "latest.yml"), sampleWinManifest(), "utf8");
  await assert.rejects(
    async () => prepareOssSyncStaging({ sourceDir: root, stagingDir: path.join(root, "out"), version }),
    /Missing required release assets/,
  );
});

test("buildOssPutAuthorization signs the Aliyun OSS StringToSign", () => {
  const signed = buildOssPutAuthorization({
    accessKeyId: "id",
    accessKeySecret: "secret",
    bucket: "weaveq-onmyagent",
    key: "onmyagent/latest-mac.yml",
    contentType: "text/yaml",
    date: "Tue, 18 Aug 2026 04:00:00 GMT",
    acl: "public-read",
  });
  assert.equal(
    signed.stringToSign,
    [
      "PUT",
      "",
      "text/yaml",
      "Tue, 18 Aug 2026 04:00:00 GMT",
      "x-oss-object-acl:public-read",
      "/weaveq-onmyagent/onmyagent/latest-mac.yml",
    ].join("\n"),
  );
  assert.match(signed.authorization, /^OSS id:[A-Za-z0-9+/=]+$/);
  assert.equal(
    publicOssObjectUrl({
      bucket: "weaveq-onmyagent",
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      key: "onmyagent/latest-mac.yml",
    }),
    "https://weaveq-onmyagent.oss-cn-hangzhou.aliyuncs.com/onmyagent/latest-mac.yml",
  );
});

test("parseCliArgs and dry-run skip upload", async () => {
  assert.deepEqual(parseCliArgs(["--tag", "v0.5.19", "--dry-run"]), {
    tag: "v0.5.19",
    source: "",
    out: "",
    dryRun: true,
    probe: false,
    waitAssetsSeconds: 0,
  });

  const root = await mkdtemp(path.join(tmpdir(), "oss-sync-cli-"));
  const source = path.join(root, "source");
  const out = path.join(root, "out");
  await mkdir(source, { recursive: true });
  await writeReleaseFixture(source);

  const calls = [];
  const plan = await syncOssUpdateFeed(
    ["--tag", "v0.5.19", "--source", source, "--out", out, "--dry-run"],
    {},
    async (url, init) => {
      calls.push({ url, method: init?.method });
      return { ok: true, status: 200, text: async () => "" };
    },
  );
  assert.equal(calls.length, 0);
  assert.ok(plan.objects.some((object) => object.key === "onmyagent/latest.yml"));
});

test("uploadOssSyncPlan PUTs every object then verifies the two manifests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oss-sync-upload-"));
  await writeReleaseFixture(root);
  const plan = prepareOssSyncStaging({
    sourceDir: root,
    stagingDir: path.join(root, "staging"),
    version,
  });
  const calls = [];
  await uploadOssSyncPlan(
    plan,
    {
      accessKeyId: "id",
      accessKeySecret: "secret",
      bucket: "weaveq-onmyagent",
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      prefix: "onmyagent",
      acl: "public-read",
    },
    async (url, init) => {
      calls.push({ url, method: init?.method, acl: init?.headers?.["x-oss-object-acl"] });
      return {
        ok: true,
        status: init?.method === "PUT" ? 200 : 200,
        text: async () => "version: 0.5.19\n",
      };
    },
  );
  assert.equal(calls.filter((call) => call.method === "PUT").length, plan.objects.length);
  assert.deepEqual(
    calls.filter((call) => call.method === "GET").map((call) => call.url),
    [
      "https://weaveq-onmyagent.oss-cn-hangzhou.aliyuncs.com/onmyagent/latest-mac.yml",
      "https://weaveq-onmyagent.oss-cn-hangzhou.aliyuncs.com/onmyagent/latest.yml",
    ],
  );
  assert.ok(calls.every((call) => call.method !== "PUT" || call.acl === "public-read"));
});

test("syncOssUpdateFeed --probe PUTs a tiny object and reads it back", async () => {
  const bodies = [];
  const result = await syncOssUpdateFeed(
    ["--probe"],
    {
      OSS_ACCESS_KEY_ID: "id",
      OSS_ACCESS_KEY_SECRET: "secret",
    },
    async (url, init) => {
      const body = init?.body ? String(init.body) : "";
      if (init?.method === "PUT") bodies.push(body);
      return { ok: true, status: 200, text: async () => bodies[0] ?? "" };
    },
  );
  assert.equal(result.key, "onmyagent/.github-oss-probe.txt");
  assert.match(result.url, /\/onmyagent\/\.github-oss-probe\.txt$/);
  assert.match(bodies[0] ?? "", /^ok /);
});

test("waitAndDownloadGithubReleaseAssets retries until required files exist", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "oss-sync-wait-src-"));
  const dest = await mkdtemp(path.join(tmpdir(), "oss-sync-wait-dest-"));
  await writeReleaseFixture(fixture);
  let attempts = 0;
  await waitAndDownloadGithubReleaseAssets("v0.5.19", dest, {
    repo: "WeaveQ/OnMyAgent",
    waitSeconds: 30,
    now: (() => {
      let current = 0;
      return () => {
        const value = current;
        current += 10_000;
        return value;
      };
    })(),
    sleep: async () => {},
    run: () => {
      attempts += 1;
      if (attempts < 2) throw new Error("assets not ready");
      cpSync(fixture, dest, { recursive: true });
    },
  });
  assert.equal(attempts, 2);
});
