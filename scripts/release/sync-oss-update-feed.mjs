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

export function versionFromReleaseTag(tag) {
  const trimmed = String(tag ?? "").trim();
  const match = trimmed.match(/^v(\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?)$/);
  if (!match) {
    throw new Error(`Invalid release tag: ${trimmed || "(empty)"} (expected vX.Y.Z)`);
  }
  return match[1];
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

export function rewriteManifestUrls(raw, version) {
  const text = String(raw ?? "");
  let versionValue = "";
  const rewritten = text.replace(/^(\s*-\s+url:\s*)(\S.*?)\s*$/gm, (_full, prefix, urlRaw) => {
    const next = prefixRelativeArtifactUrl(unquoteYamlScalar(urlRaw), version);
    return `${prefix}${next}`;
  });

  const versionLine = rewritten.match(/^version:\s*(.*?)\s*$/m);
  if (versionLine) versionValue = unquoteYamlScalar(versionLine[1]);
  if (!versionValue) throw new Error("Updater manifest is missing version.");
  if (versionValue !== version) {
    throw new Error(`Updater manifest version ${versionValue} does not match tag version ${version}.`);
  }
  if (!/^\s*-\s+url:\s*\S/m.test(rewritten)) {
    throw new Error("Updater manifest has no file urls.");
  }
  return rewritten.endsWith("\n") ? rewritten : `${rewritten}\n`;
}

export function requiredVersionedAssetNames(version) {
  return [
    `onmyagent-mac-arm64-${version}.zip`,
    `onmyagent-mac-arm64-${version}.zip.blockmap`,
    `onmyagent-mac-x64-${version}.zip`,
    `onmyagent-mac-x64-${version}.zip.blockmap`,
    `onmyagent-mac-arm64-${version}.dmg`,
    `onmyagent-mac-x64-${version}.dmg`,
    `onmyagent-win-x64-${version}.exe`,
    `onmyagent-win-x64-${version}.exe.blockmap`,
  ];
}

function installerNamePattern(version) {
  return new RegExp(
    `^onmyagent-(mac-arm64|mac-x64|win-x64)-${version.replaceAll(".", "\\.")}\\.(zip|dmg|exe)(\\.blockmap)?$`,
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
  const missing = [...MANIFEST_NAMES, ...requiredVersionedAssetNames(version)].filter(
    (name) => !names.includes(name),
  );
  if (missing.length) {
    throw new Error(`Missing required release assets: ${missing.join(", ")}`);
  }

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, version), { recursive: true });
  mkdirSync(join(staging, "website-download"), { recursive: true });

  const objects = [];
  const installerRe = installerNamePattern(version);
  for (const name of names) {
    if (!installerRe.test(name)) continue;
    const relative = `${version}/${name}`;
    const localPath = join(staging, relative);
    copyFileSync(join(source, name), localPath);
    objects.push({
      localPath,
      key: `${feedPrefix}/${relative}`,
      contentType: contentTypeForKey(relative),
    });

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
    const rewritten = rewriteManifestUrls(readFileSync(join(source, name), "utf8"), version);
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

export function downloadGithubReleaseAssets(tag, destDir, { repo, run = runGh } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is required to download release assets.");
  mkdirSync(destDir, { recursive: true });
  run(["release", "download", tag, "--repo", repo, "--dir", destDir, "--clobber"]);
}

export function parseCliArgs(argv) {
  const parsed = { tag: "", source: "", out: "", dryRun: false, probe: false };
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
  if (!args.tag) throw new Error("Usage: node scripts/release/sync-oss-update-feed.mjs --tag vX.Y.Z [--source DIR] [--out DIR] [--dry-run] | --probe");
  const version = versionFromReleaseTag(args.tag);
  const workRoot = args.out ? resolve(args.out) : mkdtempSync(join(tmpdir(), "onmyagent-oss-sync-"));
  const sourceDir = args.source ? resolve(args.source) : join(workRoot, "download");
  const stagingDir = join(workRoot, "staging");
  if (!args.source) {
    downloadGithubReleaseAssets(args.tag, sourceDir, { repo: env.GITHUB_REPOSITORY });
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
