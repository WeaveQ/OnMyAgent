#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OSS_BUCKET = "weaveq-onmyagent";
export const DEFAULT_OSS_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com";
export const DEFAULT_OSS_PREFIX = "onmyagent";
export const DEFAULT_OSS_OBJECT_ACL = "public-read";
export const OSS_PROBE_OBJECT = ".github-oss-probe.txt";

const MANIFEST_NAMES = ["latest-mac.yml", "latest.yml"];
const WEBSITE_DOWNLOAD = {
  "mac-arm64.dmg": "website-download/onmyagent-mac-arm64.dmg",
  "mac-x64.dmg": "website-download/onmyagent-mac-x64.dmg",
  "win-x64.exe": "website-download/onmyagent-win-x64.exe",
};

export function isDesktopReleaseTag(tag) {
  return /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(String(tag ?? "").trim());
}

export function versionFromReleaseTag(tag) {
  const trimmed = String(tag ?? "").trim();
  if (!isDesktopReleaseTag(trimmed)) {
    throw new Error(`Invalid release tag: ${trimmed || "(empty)"} (expected vX.Y.Z)`);
  }
  return trimmed.slice(1);
}

function isTruthyFlag(value) {
  return value === true || value === "true";
}

/** Customer OSS feed only follows published, non-prerelease desktop tags. */
export function shouldSyncCustomerOssFeed({ draft, prerelease, tag } = {}) {
  if (isTruthyFlag(draft) || isTruthyFlag(prerelease)) return false;
  return isDesktopReleaseTag(tag);
}

export function unquoteYamlScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function prefixRelativeArtifactUrl(url, version) {
  const relative = String(url ?? "").trim().replace(/^\/+/, "");
  if (!relative) throw new Error("Manifest file url is empty.");
  if (/^https?:\/\//i.test(relative)) {
    throw new Error(`Manifest url must be a relative OSS path, got ${relative}`);
  }
  if (relative === version || relative.startsWith(`${version}/`)) return relative;
  return `${version}/${relative}`;
}

function parseUpdaterManifest(raw) {
  const files = [];
  let version = "";
  let releaseDate = "";
  let current = null;
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const fileStart = line.match(/^\s*-\s+url:\s*(.*?)\s*$/);
    if (fileStart) {
      current = { url: unquoteYamlScalar(fileStart[1]), sha512: "", size: "" };
      files.push(current);
      continue;
    }
    const fileProp = line.match(/^\s+(sha512|size):\s*(.*?)\s*$/);
    if (fileProp && current) {
      current[fileProp[1]] = unquoteYamlScalar(fileProp[2]);
      continue;
    }
    const top = line.match(/^(version|releaseDate):\s*(.*?)\s*$/);
    if (top) {
      current = null;
      const value = unquoteYamlScalar(top[2]);
      if (top[1] === "version") version = value;
      else releaseDate = value;
    }
  }
  return { version, releaseDate, files };
}

function isCustomerFeedUrl(url, manifestName) {
  const base = String(url ?? "").split("/").pop() ?? "";
  if (manifestName === "latest-mac.yml") return /^onmyagent-mac-(arm64|x64)-.+\.zip$/i.test(base);
  if (manifestName === "latest.yml") return /^onmyagent-win-x64-.+\.exe$/i.test(base);
  return false;
}

export function stringifyCustomerManifest(manifest) {
  const lines = [`version: ${manifest.version}`, "files:"];
  for (const file of manifest.files) {
    lines.push(`  - url: ${file.url}`);
    if (file.sha512) lines.push(`    sha512: ${file.sha512}`);
    if (file.size !== "" && file.size != null) lines.push(`    size: ${file.size}`);
  }
  if (manifest.releaseDate) lines.push(`releaseDate: '${manifest.releaseDate}'`);
  return `${lines.join("\n")}\n`;
}

export function rewriteManifestUrls(raw, version, manifestName = "latest-mac.yml") {
  const parsed = parseUpdaterManifest(raw);
  if (!parsed.version) throw new Error("Updater manifest is missing version.");
  if (parsed.version !== version) {
    throw new Error(`Updater manifest version ${parsed.version} does not match tag version ${version}.`);
  }
  const files = parsed.files
    .filter((file) => isCustomerFeedUrl(file.url, manifestName))
    .map((file) => ({
      url: prefixRelativeArtifactUrl(file.url, version),
      sha512: file.sha512,
      size: file.size,
    }));
  if (files.length === 0) {
    throw new Error(`${manifestName} has no customer feed urls.`);
  }
  return stringifyCustomerManifest({
    version: parsed.version,
    releaseDate: parsed.releaseDate,
    files,
  });
}

export function requiredVersionedAssetNames(version) {
  return [
    `onmyagent-mac-arm64-${version}.zip`,
    `onmyagent-mac-arm64-${version}.zip.blockmap`,
    `onmyagent-mac-x64-${version}.zip`,
    `onmyagent-mac-x64-${version}.zip.blockmap`,
    `onmyagent-win-x64-${version}.exe`,
    `onmyagent-win-x64-${version}.exe.blockmap`,
  ];
}

export function requiredWebsiteAssetNames(version) {
  return [
    `onmyagent-mac-arm64-${version}.dmg`,
    `onmyagent-mac-x64-${version}.dmg`,
    `onmyagent-win-x64-${version}.exe`,
  ];
}

function versionFolderAssetPattern(version) {
  return new RegExp(
    `^onmyagent-(mac-arm64|mac-x64|win-x64)-${version.replaceAll(".", "\\.")}\\.(zip|exe)(\\.blockmap)?$`,
  );
}

export function websiteDownloadKey(fileName, version) {
  const match = fileName.match(
    new RegExp(`^onmyagent-(mac-arm64|mac-x64|win-x64)-${version.replaceAll(".", "\\.")}\\.(dmg|exe)$`),
  );
  if (!match) return "";
  const [, platform, ext] = match;
  return WEBSITE_DOWNLOAD[`${platform}.${ext}`] ?? "";
}

function listFiles(dir) {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

function contentTypeForKey(key) {
  if (key.endsWith(".yml") || key.endsWith(".yaml")) return "text/yaml";
  return "application/octet-stream";
}

export function prepareOssSyncStaging({ sourceDir, stagingDir, version, prefix = DEFAULT_OSS_PREFIX }) {
  const source = resolve(sourceDir);
  const staging = resolve(stagingDir);
  const feedPrefix = String(prefix ?? "").replace(/^\/+|\/+$/g, "") || DEFAULT_OSS_PREFIX;
  const names = listFiles(source);
  const missing = [
    ...new Set([...MANIFEST_NAMES, ...requiredVersionedAssetNames(version), ...requiredWebsiteAssetNames(version)]),
  ].filter((name) => !names.includes(name));
  if (missing.length) {
    throw new Error(`Missing required release assets: ${missing.join(", ")}`);
  }

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, version), { recursive: true });
  mkdirSync(join(staging, "website-download"), { recursive: true });

  const objects = [];
  const versionAssetRe = versionFolderAssetPattern(version);
  for (const name of names) {
    if (versionAssetRe.test(name)) {
      const relative = `${version}/${name}`;
      const localPath = join(staging, relative);
      copyFileSync(join(source, name), localPath);
      objects.push({
        localPath,
        key: `${feedPrefix}/${relative}`,
        contentType: contentTypeForKey(relative),
      });
    }

    const websiteKey = websiteDownloadKey(name, version);
    if (websiteKey) {
      const websiteLocal = join(staging, websiteKey);
      copyFileSync(join(source, name), websiteLocal);
      objects.push({
        localPath: websiteLocal,
        key: `${feedPrefix}/${websiteKey}`,
        contentType: contentTypeForKey(websiteKey),
      });
    }
  }

  for (const name of MANIFEST_NAMES) {
    const rewritten = rewriteManifestUrls(readFileSync(join(source, name), "utf8"), version, name);
    const localPath = join(staging, name);
    writeFileSync(localPath, rewritten, "utf8");
    objects.push({
      localPath,
      key: `${feedPrefix}/${name}`,
      contentType: contentTypeForKey(name),
    });
  }

  return { version, prefix: feedPrefix, objects };
}

export function resolveOssConfig(env = process.env) {
  const accessKeyId = String(env.OSS_ACCESS_KEY_ID ?? "").trim();
  const accessKeySecret = String(env.OSS_ACCESS_KEY_SECRET ?? "").trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET are required.");
  }
  return {
    accessKeyId,
    accessKeySecret,
    bucket: String(env.OSS_BUCKET ?? "").trim() || DEFAULT_OSS_BUCKET,
    endpoint: String(env.OSS_ENDPOINT ?? "").trim().replace(/^https?:\/\//, "") || DEFAULT_OSS_ENDPOINT,
    prefix: String(env.OSS_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "") || DEFAULT_OSS_PREFIX,
    acl: Object.hasOwn(env, "OSS_OBJECT_ACL")
      ? String(env.OSS_OBJECT_ACL ?? "").trim()
      : DEFAULT_OSS_OBJECT_ACL,
  };
}

export function canonicalOssResource(bucket, key) {
  return `/${bucket}/${key}`;
}

export function buildOssPutAuthorization({
  accessKeyId,
  accessKeySecret,
  bucket,
  key,
  contentType,
  date,
  acl,
}) {
  const ossHeaders = acl ? `x-oss-object-acl:${acl}\n` : "";
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${ossHeaders}${canonicalOssResource(bucket, key)}`;
  const signature = createHmac("sha1", accessKeySecret).update(stringToSign, "utf8").digest("base64");
  return {
    stringToSign,
    authorization: `OSS ${accessKeyId}:${signature}`,
  };
}

function encodeOssKey(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function publicOssObjectUrl({ bucket, endpoint, key }) {
  return `https://${bucket}.${endpoint}/${encodeOssKey(key)}`;
}

export async function putOssObject(config, object, fetchImpl = fetch) {
  const date = new Date().toUTCString();
  const { authorization } = buildOssPutAuthorization({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    key: object.key,
    contentType: object.contentType,
    date,
    acl: config.acl,
  });
  const headers = {
    Date: date,
    "Content-Type": object.contentType,
    Authorization: authorization,
  };
  if (config.acl) headers["x-oss-object-acl"] = config.acl;
  const body = object.body ?? readFileSync(object.localPath);
  const response = await fetchImpl(publicOssObjectUrl({ ...config, key: object.key }), {
    method: "PUT",
    headers,
    body,
  });
  if (!response.ok) {
    const detail = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`OSS PUT ${object.key} failed: ${response.status} ${detail}`.trim());
  }
}

export async function verifyPublicOssObject(url, { contains, fetchImpl = fetch, attempts = 3 } = {}) {
  let lastError = new Error(`OSS GET ${url} failed.`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET" });
      if (!response.ok) {
        lastError = new Error(`OSS GET ${url} failed: ${response.status}`);
      } else {
        const text = typeof response.text === "function" ? await response.text() : "";
        if (contains && !text.includes(contains)) {
          lastError = new Error(`OSS object ${url} did not contain ${contains}.`);
        } else {
          return;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < attempts) await new Promise((resolveWait) => setTimeout(resolveWait, 400 * attempt));
  }
  throw lastError;
}

export async function probeOssCredentials(env = process.env, fetchImpl = fetch) {
  const config = resolveOssConfig(env);
  const token = `ok ${new Date().toISOString()}`;
  const key = `${config.prefix}/${OSS_PROBE_OBJECT}`;
  await putOssObject(
    config,
    {
      key,
      contentType: "text/plain",
      body: token,
    },
    fetchImpl,
  );
  const url = publicOssObjectUrl({ ...config, key });
  await verifyPublicOssObject(url, { contains: token, fetchImpl });
  return { key, url };
}

export async function uploadOssSyncPlan(plan, config, fetchImpl = fetch) {
  for (const object of plan.objects) {
    await putOssObject(config, object, fetchImpl);
    console.log(`uploaded ${object.key}`);
  }
  for (const name of MANIFEST_NAMES) {
    const key = `${plan.prefix}/${name}`;
    await verifyPublicOssObject(publicOssObjectUrl({ ...config, key }), {
      contains: `version: ${plan.version}`,
      fetchImpl,
    });
  }
}

function runGh(args) {
  const result = spawnSync("gh", args, { stdio: "inherit", encoding: "utf8" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function missingRequiredReleaseAssets(dir, version) {
  const names = new Set(listFiles(dir));
  return [
    ...new Set([...MANIFEST_NAMES, ...requiredVersionedAssetNames(version), ...requiredWebsiteAssetNames(version)]),
  ].filter((name) => !names.has(name));
}

export function downloadGithubReleaseAssets(tag, destDir, { repo, run = runGh } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is required to download release assets.");
  mkdirSync(destDir, { recursive: true });
  run(["release", "download", tag, "--repo", repo, "--dir", destDir, "--clobber"]);
}

export async function waitAndDownloadGithubReleaseAssets(
  tag,
  destDir,
  { repo, run = runGh, waitSeconds = 0, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {},
) {
  const version = versionFromReleaseTag(tag);
  const deadline = now() + Math.max(0, Number(waitSeconds) || 0) * 1000;
  let lastError = new Error(`Missing required release assets for ${tag}.`);
  while (true) {
    try {
      downloadGithubReleaseAssets(tag, destDir, { repo, run });
      const missing = missingRequiredReleaseAssets(destDir, version);
      if (missing.length === 0) return;
      lastError = new Error(`Missing required release assets: ${missing.join(", ")}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (now() >= deadline) throw lastError;
    console.log(`waiting for GitHub Release assets: ${lastError.message}`);
    await sleep(15_000);
  }
}

export function parseCliArgs(argv) {
  const parsed = { tag: "", source: "", out: "", dryRun: false, probe: false, waitAssetsSeconds: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--probe") {
      parsed.probe = true;
      continue;
    }
    if (arg === "--wait-assets-seconds") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      parsed.waitAssetsSeconds = Number(value);
      if (!Number.isFinite(parsed.waitAssetsSeconds) || parsed.waitAssetsSeconds < 0) {
        throw new Error(`${arg} must be a non-negative number.`);
      }
      index += 1;
      continue;
    }
    if (arg === "--tag" || arg === "--source" || arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

export async function syncOssUpdateFeed(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const args = parseCliArgs(argv);
  if (args.probe) {
    const probed = await probeOssCredentials(env, fetchImpl);
    console.log(`oss probe ok ${probed.url}`);
    return probed;
  }
  if (!args.tag) {
    throw new Error(
      "Usage: node scripts/release/sync-oss-update-feed.mjs --tag vX.Y.Z [--source DIR] [--out DIR] [--wait-assets-seconds N] [--dry-run] | --probe",
    );
  }
  const version = versionFromReleaseTag(args.tag);
  const workRoot = args.out ? resolve(args.out) : mkdtempSync(join(tmpdir(), "onmyagent-oss-sync-"));
  const sourceDir = args.source ? resolve(args.source) : join(workRoot, "download");
  const stagingDir = join(workRoot, "staging");
  if (!args.source) {
    await waitAndDownloadGithubReleaseAssets(args.tag, sourceDir, {
      repo: env.GITHUB_REPOSITORY,
      waitSeconds: args.waitAssetsSeconds,
    });
  }
  const plan = prepareOssSyncStaging({
    sourceDir,
    stagingDir,
    version,
    prefix: String(env.OSS_PREFIX ?? "").trim() || DEFAULT_OSS_PREFIX,
  });
  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          version: plan.version,
          prefix: plan.prefix,
          objects: plan.objects.map((object) => object.key),
        },
        null,
        2,
      ),
    );
    return plan;
  }
  await uploadOssSyncPlan(plan, resolveOssConfig(env), fetchImpl);
  return plan;
}

const isMain =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  syncOssUpdateFeed().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
