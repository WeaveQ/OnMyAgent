import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GROK_SIDECAR_SOURCE,
  GROK_THIRD_PARTY_NOTICES_SHA256,
  grokSidecarSpec,
} from "./grok-sidecar-manifest.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");
export const GROK_LICENSE_NAME = "GROK_BUILD_LICENSE.txt";
export const GROK_NOTICES_NAME = "GROK_BUILD_THIRD_PARTY_NOTICES.md";
export const GROK_MODIFICATIONS_NAME = "GROK_BUILD_MODIFICATIONS.txt";
export const GROK_MANIFEST_NAME = "grok-build-manifest.json";
export const GROK_MODIFICATIONS = [
  "Grok Build sidecar distribution notice",
  "",
  "OnMyAgent redistributes the unmodified official Grok Build binary.",
  "OnMyAgent adds an external ACP adapter, process supervisor, packaging metadata,",
  "and runtime selection UI; it does not modify the Grok Build binary.",
  "",
].join("\n");

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sriMatches(path, integrity) {
  const [algorithm, expected] = String(integrity).split("-", 2);
  if (algorithm !== "sha512" || !expected) return false;
  return createHash("sha512").update(readFileSync(path)).digest("base64") === expected;
}

export function stagedGrokSidecarIsValid(outdir, spec) {
  const binary = join(outdir, spec.outputName);
  const notices = join(outdir, GROK_NOTICES_NAME);
  return existsSync(binary)
    && statSync(binary).size === spec.binarySize
    && sha256File(binary) === spec.binarySha256
    && existsSync(notices)
    && sha256File(notices) === GROK_THIRD_PARTY_NOTICES_SHA256
    && existsSync(join(outdir, GROK_LICENSE_NAME))
    && existsSync(join(outdir, GROK_MODIFICATIONS_NAME));
}

export function targetTriple(env = process.env, platform = process.platform, arch = process.arch) {
  const explicit = env.ONMYAGENT_TARGET_TRIPLE?.trim()
    || env.TAURI_ENV_TARGET_TRIPLE?.trim()
    || env.CARGO_CFG_TARGET_TRIPLE?.trim()
    || env.TARGET?.trim();
  if (explicit) return explicit;
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  return null;
}

function argValue(name) {
  const args = process.argv.slice(2);
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1] ?? null;
  return args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function download(url, destination) {
  const result = spawnSync("curl", [
    "-fL", "--retry", "4", "--retry-all-errors", "--connect-timeout", "20",
    "--max-time", "900", "-o", destination, url,
  ], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error("Grok Build package download failed");
}

function extractPackage(archive, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync("tar", ["-xzf", archive, "-C", destination], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Grok Build package extraction failed");
}

export function stageGrokPackage({ archive, outdir, spec, extractionRoot }) {
  if (!sriMatches(archive, spec.integrity)) {
    throw new Error("Grok Build npm package integrity mismatch");
  }
  extractPackage(archive, extractionRoot);
  const packageRoot = join(extractionRoot, "package");
  const compressed = join(packageRoot, "bin", "grok.br");
  const notices = join(packageRoot, "THIRD_PARTY_NOTICES.md");
  if (!existsSync(compressed) || !existsSync(notices)) {
    throw new Error("Grok Build package is missing required release files");
  }
  if (sha256File(notices) !== GROK_THIRD_PARTY_NOTICES_SHA256) {
    throw new Error("Grok Build third-party notices mismatch");
  }
  const bytes = brotliDecompressSync(readFileSync(compressed));
  stageVerifiedGrokBinary({ bytes, notices, outdir, spec });
}

export function stageVerifiedGrokBinary({ bytes, notices, outdir, spec }) {
  if (bytes.byteLength !== spec.binarySize
    || createHash("sha256").update(bytes).digest("hex") !== spec.binarySha256) {
    throw new Error("Grok Build binary checksum mismatch");
  }
  if (sha256File(notices) !== GROK_THIRD_PARTY_NOTICES_SHA256) {
    throw new Error("Grok Build third-party notices mismatch");
  }
  mkdirSync(outdir, { recursive: true });
  const binary = join(outdir, spec.outputName);
  const temporaryBinary = `${binary}.tmp.${process.pid}`;
  writeFileSync(temporaryBinary, bytes, { mode: 0o755 });
  renameSync(temporaryBinary, binary);
  if (process.platform !== "win32") chmodSync(binary, 0o755);
  copyFileSync(notices, join(outdir, GROK_NOTICES_NAME));
  writeFileSync(
    join(outdir, GROK_LICENSE_NAME),
    `Copyright 2023-2026 SpaceXAI\n\n${readFileSync(join(repoRoot, "LICENSE"), "utf8")}`,
    "utf8",
  );
  writeFileSync(join(outdir, GROK_MODIFICATIONS_NAME), GROK_MODIFICATIONS, "utf8");
  writeFileSync(join(outdir, GROK_MANIFEST_NAME), `${JSON.stringify({
    version: 1,
    runtime: "grok-build",
    target: spec.targetTriple,
    binary: {
      file: spec.outputName,
      version: spec.version,
      sha256: spec.binarySha256,
      size: spec.binarySize,
      package: spec.packageName,
      packageIntegrity: spec.integrity,
    },
    source: GROK_SIDECAR_SOURCE,
    notices: {
      license: GROK_LICENSE_NAME,
      thirdParty: GROK_NOTICES_NAME,
      modifications: GROK_MODIFICATIONS_NAME,
      thirdPartySha256: GROK_THIRD_PARTY_NOTICES_SHA256,
    },
  }, null, 2)}\n`, "utf8");
}

export async function main() {
  const triple = targetTriple();
  const spec = triple ? grokSidecarSpec(triple) : null;
  if (!spec) {
    console.log(`Grok Build bundled sidecar is disabled for target ${triple ?? "unsupported"}.`);
    return;
  }
  const outdir = resolve(argValue("--outdir") ?? join(desktopRoot, "resources", "sidecars"));
  if (stagedGrokSidecarIsValid(outdir, spec)) {
    console.log(`Grok Build sidecar already verified (${spec.version}, ${triple}).`);
    return;
  }
  const binaryCache = argValue("--binary-cache")
    || process.env.ONMYAGENT_GROK_BINARY_CACHE?.trim();
  const noticesCache = argValue("--notices-cache")
    || process.env.ONMYAGENT_GROK_NOTICES_CACHE?.trim();
  if (binaryCache || noticesCache) {
    if (!binaryCache || !noticesCache) {
      throw new Error("Both Grok Build binary and notices caches are required");
    }
    stageVerifiedGrokBinary({
      bytes: readFileSync(resolve(binaryCache)),
      notices: resolve(noticesCache),
      outdir,
      spec,
    });
    console.log(`Grok Build sidecar verified from local cache (${spec.version}, ${triple}).`);
    return;
  }
  const cacheRoot = resolve(argValue("--cachedir")
    ?? process.env.ONMYAGENT_GROK_DOWNLOAD_DIR?.trim()
    ?? join(desktopRoot, "resources", "sidecar-downloads"));
  const archive = join(cacheRoot, `${spec.packageName.replace("@", "").replace("/", "-")}-${spec.version}.tgz`);
  mkdirSync(cacheRoot, { recursive: true });
  if (!existsSync(archive) || !sriMatches(archive, spec.integrity)) {
    if (process.argv.includes("--offline") || process.env.ONMYAGENT_GROK_OFFLINE === "1") {
      throw new Error("Verified Grok Build package is unavailable offline");
    }
    download(spec.tarballUrl, archive);
  }
  const extractionRoot = join(tmpdir(), `onmyagent-grok-${process.pid}-${Date.now()}`);
  try {
    stageGrokPackage({ archive, outdir, spec, extractionRoot });
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
  console.log(`Grok Build sidecar verified (${spec.version}, ${triple}).`);
}

if (process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
