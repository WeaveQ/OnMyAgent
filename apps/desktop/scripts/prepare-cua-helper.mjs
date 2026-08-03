/**
 * Stage the TryCua Cua Driver binary pack for Windows Computer Use MCP.
 *
 * - Stages the full release binary zip (exe + uia + dll siblings).
 * - Pins version + SHA256 (supply chain).
 * - Skips on non-Windows package targets unless --force-target is set.
 * - Does not commit binaries to git; download/cache at build time.
 *
 * Usage:
 *   node prepare-cua-helper.mjs [--outdir <helpers>] [--arch x64|arm64]
 *     [--offline] [--force]
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");

/** Pinned Cua Driver release (trycua/cua). */
export const CUA_DRIVER_VERSION = "0.17.0";
export const CUA_DRIVER_RELEASE_TAG = `cua-driver-rs-v${CUA_DRIVER_VERSION}`;

const SPECS = {
  x64: {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
    sha256:
      "f7e366edc4b7148b4f6f78957782b2a2d962620b0daaeb99df7cf9dce6176193",
  },
  arm64: {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-arm64-binary.zip`,
    sha256:
      "bd3febdabff06331efd0951495f34ef7a5fb2cc230fd5270bd34292bc7ee036a",
  },
};

const readArg = (name) => {
  const raw = process.argv.slice(2);
  const direct = raw.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = raw.indexOf(name);
  if (index >= 0 && raw[index + 1]) return raw[index + 1];
  return null;
};

const hasFlag = (name) => process.argv.slice(2).includes(name);

function resolveTargetArch() {
  const explicit = readArg("--arch")?.trim() || process.env.ONMYAGENT_CUA_ARCH?.trim();
  if (explicit === "x64" || explicit === "arm64") return explicit;
  if (process.arch === "arm64") return "arm64";
  return "x64";
}

function shouldStageWindowsHelper() {
  if (hasFlag("--force-target")) return true;
  const target =
    process.env.ONMYAGENT_TARGET_PLATFORM?.trim() ||
    process.env.npm_config_target_platform?.trim() ||
    "";
  if (target === "win32" || target === "windows") return true;
  // Cross-package from mac/linux for win installer
  if (process.env.CSC_LINK && process.env.ONMYAGENT_PACKAGE_WIN === "1") return true;
  return process.platform === "win32";
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function verifyArchive(filePath, expected) {
  if (!existsSync(filePath)) return false;
  return sha256File(filePath) === expected;
}

async function downloadFile(url, destPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  const partial = `${destPath}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  rmSync(destPath, { force: true });
  // renameSync across devices can fail; copy via read/write is fine for zip size
  const { renameSync } = await import("node:fs");
  try {
    renameSync(partial, destPath);
  } catch {
    writeFileSync(destPath, readFileSync(partial));
    rmSync(partial, { force: true });
  }
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  // Prefer system unzip tools; PowerShell Expand-Archive on Windows, unzip elsewhere.
  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8" },
    );
    if (ps.status !== 0) {
      throw new Error(
        `Expand-Archive failed: ${ps.stderr?.trim() || ps.stdout?.trim() || "unknown"}`,
      );
    }
    return;
  }
  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", destDir], {
    encoding: "utf8",
  });
  if (unzip.status !== 0) {
    throw new Error(
      `unzip failed: ${unzip.stderr?.trim() || unzip.stdout?.trim() || "unknown"}`,
    );
  }
}

function findDriverExe(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) stack.push(full);
      else if (name.name.toLowerCase() === "cua-driver.exe") return full;
    }
  }
  return null;
}

async function main() {
  if (!shouldStageWindowsHelper() && !hasFlag("--force")) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        skipped: true,
        reason: "cua-helper-is-windows-package-only",
        platform: process.platform,
      })}\n`,
    );
    return;
  }

  const outDir = resolve(
    readArg("--outdir") ?? join(desktopRoot, "resources", "helpers"),
  );
  const stageDir = join(outDir, "cua");
  const arch = resolveTargetArch();
  const spec = SPECS[arch];
  if (!spec) throw new Error(`Unsupported Cua arch: ${arch}`);

  const offline =
    hasFlag("--offline") || process.env.ONMYAGENT_CUA_OFFLINE === "1";
  const cacheRoot = resolve(
    readArg("--cachedir") ||
      process.env.ONMYAGENT_CUA_DOWNLOAD_DIR?.trim() ||
      join(desktopRoot, "resources", "cua-downloads"),
  );
  mkdirSync(cacheRoot, { recursive: true });
  const archivePath = join(cacheRoot, spec.asset);
  const markerPath = join(stageDir, ".cua-driver-version");

  if (
    !hasFlag("--force") &&
    existsSync(join(stageDir, "cua-driver.exe")) &&
    existsSync(markerPath) &&
    readFileSync(markerPath, "utf8").trim() === `${CUA_DRIVER_VERSION}:${arch}`
  ) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        skipped: true,
        reason: "already-staged",
        stageDir,
        version: CUA_DRIVER_VERSION,
        arch,
      })}\n`,
    );
    return;
  }

  if (!verifyArchive(archivePath, spec.sha256)) {
    if (offline) {
      throw new Error(
        `Cua archive missing or checksum mismatch (offline): ${archivePath}`,
      );
    }
    const url = `https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}/${spec.asset}`;
    process.stdout.write(`[cua] Downloading ${spec.asset}\n`);
    await downloadFile(url, archivePath);
    if (!verifyArchive(archivePath, spec.sha256)) {
      throw new Error(`SHA256 mismatch after download: ${spec.asset}`);
    }
  }

  rmSync(stageDir, { recursive: true, force: true });
  const extractTmp = join(cacheRoot, `extract-${arch}-${Date.now()}`);
  rmSync(extractTmp, { recursive: true, force: true });
  extractZip(archivePath, extractTmp);

  const driverExe = findDriverExe(extractTmp);
  if (!driverExe) {
    throw new Error(`cua-driver.exe not found inside ${spec.asset}`);
  }
  const driverDir = dirname(driverExe);
  mkdirSync(stageDir, { recursive: true });
  // Copy entire sibling set next to cua-driver.exe
  const { cpSync } = await import("node:fs");
  for (const name of readdirSync(driverDir)) {
    cpSync(join(driverDir, name), join(stageDir, name), { recursive: true });
  }
  rmSync(extractTmp, { recursive: true, force: true });

  if (!existsSync(join(stageDir, "cua-driver.exe"))) {
    throw new Error(`Stage incomplete: missing ${join(stageDir, "cua-driver.exe")}`);
  }

  writeFileSync(markerPath, `${CUA_DRIVER_VERSION}:${arch}\n`, "utf8");
  writeFileSync(
    join(stageDir, "NOTICE.txt"),
    [
      "Cua Driver (trycua/cua) — MIT License",
      `Version: ${CUA_DRIVER_VERSION}`,
      `Release: ${CUA_DRIVER_RELEASE_TAG}`,
      "https://github.com/trycua/cua",
      "",
      "Bundled by OnMyAgent for Windows Computer Use MCP only.",
      "",
    ].join("\n"),
    "utf8",
  );

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      stageDir,
      version: CUA_DRIVER_VERSION,
      arch,
      asset: spec.asset,
    })}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
