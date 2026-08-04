#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  officeCliAssetKeySchema,
  officeCliLatestManifestSchema,
  officeCliReleaseManifestSchema,
} from "../../packages/types/src/officecli.ts";

const assetKeys = officeCliAssetKeySchema.options;

function usage() {
  return [
    "Usage: node scripts/officecli/validate-manifest.mjs --latest <manifest.json> --release <release-manifest.json> [options]",
    "",
    "Options:",
    "  --release-dir <directory>  Check SKILL.md and binary files referenced by the release manifest",
    "  --strict                   Require publisher metadata and verify every referenced file",
    "  --help                     Show this message",
  ].join("\n");
}

function parseArgs(argv) {
  const values = { strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--strict") {
      values.strict = true;
      continue;
    }
    if (argument === "--help") {
      values.help = true;
      continue;
    }
    if (argument === "--latest" || argument === "--release" || argument === "--release-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      const key = argument.slice(2).replaceAll("-", "");
      values[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

async function readJsonDocument(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}

function parseSchema(name, value, schema) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => {
      const issuePath = issue.path.length ? issue.path.join(".") : "<root>";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(`Invalid OfficeCLI ${name}: ${details}`);
}

async function hashFile(filePath) {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    size += chunk.byteLength;
    digest.update(chunk);
  }
  return { sha256: digest.digest("hex"), size };
}

function referencePath(reference) {
  return typeof reference === "string" ? reference : reference.path;
}

function resolveReleaseFile(releaseDir, reference, label) {
  const relativeReference = referencePath(reference);
  const target = path.resolve(releaseDir, relativeReference);
  const relativeTarget = path.relative(path.resolve(releaseDir), target);
  if (
    !relativeReference ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error(`${label} path escapes the release directory: ${relativeReference}`);
  }
  return target;
}

async function assertFileDigest(filePath, reference, label) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("is not a regular file");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is unavailable at ${filePath}: ${message}`);
  }

  const actual = await hashFile(filePath);
  if (actual.size !== reference.size) {
    throw new Error(
      `${label} size mismatch: expected ${reference.size}, received ${actual.size}`,
    );
  }
  if (actual.sha256.toLowerCase() !== reference.sha256.toLowerCase()) {
    throw new Error(`${label} sha256 mismatch`);
  }
}

async function assertFileExists(filePath, label) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("is not a regular file");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is unavailable at ${filePath}: ${message}`);
  }
}

function assertReleaseContract(latest, release, strict) {
  if (latest.latestVersion !== release.version) {
    throw new Error(
      `latestVersion does not match release version: ${latest.latestVersion} != ${release.version}`,
    );
  }
  if (release.officecliVersion && release.officecliVersion !== release.version) {
    throw new Error(
      `officecliVersion does not match release version: ${release.officecliVersion} != ${release.version}`,
    );
  }
  if (
    release.skill &&
    release.skillPath &&
    release.skill.path !== release.skillPath
  ) {
    throw new Error("release skill and skillPath refer to different files");
  }

  const assetEntries = Object.entries(release.assets);
  if (assetEntries.length === 0) {
    throw new Error("release manifest must provide at least one platform asset");
  }
  if (strict) {
    if (latest.pluginId !== "officecli") {
      throw new Error("strict validation requires latest manifest pluginId=officecli");
    }
    if (release.pluginId !== "officecli") {
      throw new Error("strict validation requires release manifest pluginId=officecli");
    }
    if (!release.officecliVersion) {
      throw new Error("strict validation requires release manifest officecliVersion");
    }
    if (!release.skill) {
      throw new Error("strict validation requires a hashed skill descriptor");
    }
    if (typeof latest.releaseManifest === "string") {
      throw new Error("strict validation requires a hashed releaseManifest descriptor");
    }
    const missingAssets = assetKeys.filter((key) => !release.assets[key]);
    if (missingAssets.length > 0) {
      throw new Error(`strict validation is missing assets: ${missingAssets.join(", ")}`);
    }
  }

  const seenPaths = new Set();
  for (const [assetKey, reference] of assetEntries) {
    if (seenPaths.has(reference.path)) {
      throw new Error(`release asset path is reused: ${reference.path}`);
    }
    seenPaths.add(reference.path);
    if (!assetKeys.includes(assetKey)) {
      throw new Error(`unsupported OfficeCLI asset key: ${assetKey}`);
    }
  }
}

export async function validateOfficeCliManifests({
  latestManifestPath,
  releaseManifestPath,
  releaseDir,
  strict = false,
}) {
  if (!latestManifestPath || !releaseManifestPath) {
    throw new Error("latestManifestPath and releaseManifestPath are required");
  }
  if (strict && !releaseDir) {
    throw new Error("strict validation requires releaseDir");
  }

  const latestDocument = await readJsonDocument(latestManifestPath);
  const releaseDocument = await readJsonDocument(releaseManifestPath);
  const latest = parseSchema(
    "latest manifest",
    latestDocument.value,
    officeCliLatestManifestSchema,
  );
  const release = parseSchema(
    "release manifest",
    releaseDocument.value,
    officeCliReleaseManifestSchema,
  );
  assertReleaseContract(latest, release, strict);

  if (typeof latest.releaseManifest !== "string") {
    await assertFileDigest(
      releaseManifestPath,
      latest.releaseManifest,
      "release manifest",
    );
  }

  let checkedFiles = 0;
  if (releaseDir) {
    const skillReference = release.skill ?? release.skillPath;
    if (!skillReference) {
      throw new Error("release manifest does not provide SKILL.md");
    }
    const skillPath = resolveReleaseFile(releaseDir, skillReference, "SKILL.md");
    if (typeof skillReference === "string") {
      await assertFileExists(skillPath, "SKILL.md");
    } else {
      await assertFileDigest(skillPath, skillReference, "SKILL.md");
    }
    checkedFiles += 1;

    for (const [assetKey, reference] of Object.entries(release.assets)) {
      const assetPath = resolveReleaseFile(
        releaseDir,
        reference,
        `OfficeCLI asset ${assetKey}`,
      );
      await assertFileDigest(assetPath, reference, `OfficeCLI asset ${assetKey}`);
      checkedFiles += 1;
    }
  }

  return {
    assets: Object.keys(release.assets).sort(),
    checkedFiles,
    version: release.version,
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.latest || !args.release) {
    throw new Error(usage());
  }
  const result = await validateOfficeCliManifests({
    latestManifestPath: path.resolve(args.latest),
    releaseManifestPath: path.resolve(args.release),
    releaseDir: args.releasedir ? path.resolve(args.releasedir) : undefined,
    strict: args.strict,
  });
  console.log(
    `OfficeCLI manifest validation passed: version=${result.version}, assets=${result.assets.length}, checkedFiles=${result.checkedFiles}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`OfficeCLI manifest validation failed: ${message}`);
    process.exitCode = 1;
  });
}
