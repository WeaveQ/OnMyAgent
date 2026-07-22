import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  clearDownloadQuarantine,
  movePreparedRuntimeTree,
  preparedRuntimeRoot,
} from "./runtime-archive.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const constants = JSON.parse(readFileSync(resolve(repoRoot, "constants.json"), "utf8"));
const outdirIndex = process.argv.indexOf("--outdir");
const cacheDirIndex = process.argv.indexOf("--cachedir");
const offline =
  process.argv.includes("--offline") ||
  process.env.ONMYAGENT_RUNTIME_OFFLINE === "1";
const outputRoot = resolve(
  outdirIndex >= 0 && process.argv[outdirIndex + 1]
    ? process.argv[outdirIndex + 1]
    : resolve(desktopRoot, "resources", "runtimes"),
);
const downloadCacheRoot = resolve(
  cacheDirIndex >= 0 && process.argv[cacheDirIndex + 1]
    ? process.argv[cacheDirIndex + 1]
    : process.env.ONMYAGENT_RUNTIME_DOWNLOAD_DIR?.trim() ||
        resolve(desktopRoot, "resources", "runtime-downloads"),
);

const target = (() => {
  const explicit =
    process.env.ONMYAGENT_TARGET_TRIPLE?.trim() ||
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
    process.env.CARGO_CFG_TARGET_TRIPLE?.trim() ||
    process.env.TARGET?.trim();
  if (explicit) return explicit;
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  throw new Error(`Unsupported runtime target: ${process.platform}/${process.arch}`);
})();

const nodeVersion = String(constants.nodeVersion ?? "").trim();
const pythonVersion = String(constants.pythonVersion ?? "").trim();
const pythonRelease = String(constants.pythonStandaloneRelease ?? "").trim();
if (!nodeVersion || !pythonVersion || !pythonRelease) {
  throw new Error("constants.json is missing bundled runtime versions");
}

const specs = {
  "aarch64-apple-darwin": {
    nodeAsset: `node-${nodeVersion}-darwin-arm64.tar.gz`,
    nodeSha256: "39189dab4eeb15706c424af0ac08a3044c9e48f7db12a7d77f6b7aafc7dd5df6",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-aarch64-apple-darwin-install_only.tar.gz`,
    pythonSha256: "e18ddd4c1e8f4a1d6c4590b37f423d76aec734447edc20ed08e93983d95f2132",
  },
  "x86_64-apple-darwin": {
    nodeAsset: `node-${nodeVersion}-darwin-x64.tar.gz`,
    nodeSha256: "298b4c7b3cb80765c8703e42b90324a4ece3b6634947b89e769c3c980ab55185",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-x86_64-apple-darwin-install_only.tar.gz`,
    pythonSha256: "ba02164e4db381af8c288c0bc1657584a835e9121a0fa2836b0f2e712ff8cdf5",
  },
  "aarch64-unknown-linux-gnu": {
    nodeAsset: `node-${nodeVersion}-linux-arm64.tar.gz`,
    nodeSha256: "589f5b6dd4fcfee4dfda73013903c966abaa8abd93dbc9d436544e472b4f0e74",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
    pythonSha256: "bc74cf1bb517651868342b0619b21eaaf9f94a2022c9c61886dd980e16fb091b",
  },
  "x86_64-unknown-linux-gnu": {
    nodeAsset: `node-${nodeVersion}-linux-x64.tar.gz`,
    nodeSha256: "2faf6a387e9b62b888e21c54f01249fb27537ffecf1842f29f4c919d0a59a0ff",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
    pythonSha256: "c218f50baeb2c06a30c2f03db5986b2bad6ab7c8a52faad2d5a59bda0677b93a",
  },
  "aarch64-pc-windows-msvc": {
    nodeAsset: `node-${nodeVersion}-win-arm64.zip`,
    nodeSha256: "14834611d4c6b3c06054e7007732b90474c16e0b32f395e05b55a571ef71c6d2",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-aarch64-pc-windows-msvc-install_only.tar.gz`,
    pythonSha256: "b50d4eee0a9c440597fb57a7b6b8f0021e799ebbf84d9fcb81f7ca199785e865",
  },
  "x86_64-pc-windows-msvc": {
    nodeAsset: `node-${nodeVersion}-win-x64.zip`,
    nodeSha256: "edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-x86_64-pc-windows-msvc-install_only.tar.gz`,
    pythonSha256: "f5e4d9f856567493776f3d1e832c939fbaba5dcbcc5e0492a82ecfceea83b316",
  },
};

const spec = specs[target];
const targetRoot = join(outputRoot, target);
const manifestPath = join(targetRoot, "versions.json");
const expectedManifest = {
  target,
  node: nodeVersion,
  python: pythonVersion,
  pythonStandaloneRelease: pythonRelease,
};
const nodeBinary = join(
  targetRoot,
  "node",
  process.platform === "win32" ? "node.exe" : "bin/node",
);
const pythonBinary = join(
  targetRoot,
  "python",
  process.platform === "win32" ? "python.exe" : "bin/python3",
);
function executableWorks(binary) {
  if (!existsSync(binary)) return false;
  return spawnSync(binary, ["--version"], { encoding: "utf8" }).status === 0;
}

if (
  existsSync(manifestPath) &&
  JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) ===
    JSON.stringify(expectedManifest) &&
    executableWorks(nodeBinary) &&
    executableWorks(pythonBinary)
) {
  process.stdout.write(`[runtimes] ${target} already prepared\n`);
  process.exit(0);
}

const workRoot = join(
  outputRoot,
  `.prepare-${target}-${process.pid}-${Date.now()}`,
);
mkdirSync(workRoot, { recursive: true });
mkdirSync(downloadCacheRoot, { recursive: true });

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function verifyArchive(filePath, sha256) {
  if (!existsSync(filePath)) return false;
  const digest = fileSha256(filePath);
  if (digest !== sha256) {
    throw new Error(
      `Checksum mismatch for ${filePath}. Remove or replace this archive before packaging.`,
    );
  }
  return true;
}

async function acquireArchive(url, fileName, sha256) {
  const cachedArchive = join(downloadCacheRoot, fileName);
  if (verifyArchive(cachedArchive, sha256)) {
    clearDownloadQuarantine(cachedArchive);
    process.stdout.write(`[runtimes] Using cached ${cachedArchive}\n`);
    return cachedArchive;
  }
  if (offline) {
    throw new Error(
      `Missing runtime archive: ${cachedArchive}. Download it manually or run without --offline.`,
    );
  }

  const partialArchive = `${cachedArchive}.part`;
  process.stdout.write(`[runtimes] Downloading ${fileName} to ${downloadCacheRoot}\n`);
  const result = spawnSync(
    "curl",
    [
      "--fail",
      "--location",
      "--http1.1",
      "--silent",
      "--show-error",
      "--retry",
      "3",
      "--retry-all-errors",
      "--continue-at",
      "-",
      "--connect-timeout",
      "30",
      "--max-time",
      "1800",
      "--output",
      partialArchive,
      url,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0 || !existsSync(partialArchive)) {
    throw new Error(`Download failed: ${url}`);
  }
  try {
    verifyArchive(partialArchive, sha256);
  } catch (error) {
    rmSync(partialArchive, { force: true });
    throw error;
  }
  renameSync(partialArchive, cachedArchive);
  clearDownloadQuarantine(cachedArchive);
  return cachedArchive;
}

function extract(archive, destination) {
  mkdirSync(destination, { recursive: true });
  if (archive.endsWith(".zip")) {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error(`Failed to extract ${archive}`);
    return;
  }
  const result = spawnSync("tar", ["-xzf", archive, "-C", destination], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Failed to extract ${archive}`);
}

try {
  const nodeArchive = await acquireArchive(
    `https://nodejs.org/dist/${nodeVersion}/${spec.nodeAsset}`,
    spec.nodeAsset,
    spec.nodeSha256,
  );
  const pythonArchive = await acquireArchive(
    `https://github.com/astral-sh/python-build-standalone/releases/download/${pythonRelease}/${encodeURIComponent(spec.pythonAsset).replaceAll("%2F", "/")}`,
    spec.pythonAsset,
    spec.pythonSha256,
  );
  const nodeExtract = join(workRoot, "node-extract");
  const pythonExtract = join(workRoot, "python-extract");
  extract(nodeArchive, nodeExtract);
  extract(pythonArchive, pythonExtract);

  const nodeFolder = join(nodeExtract, spec.nodeAsset.replace(/\.(tar\.gz|zip)$/, ""));
  const pythonFolder = join(pythonExtract, "python");
  if (!existsSync(nodeFolder) || !existsSync(pythonFolder)) {
    throw new Error(`Runtime archive layout is invalid for ${target}`);
  }

  const stagedRoot = preparedRuntimeRoot(targetRoot);
  rmSync(stagedRoot, { recursive: true, force: true });
  mkdirSync(stagedRoot, { recursive: true });
  movePreparedRuntimeTree(nodeFolder, join(stagedRoot, "node"));
  movePreparedRuntimeTree(pythonFolder, join(stagedRoot, "python"));
  if (process.platform !== "win32") {
    chmodSync(join(stagedRoot, "node", "bin", "node"), 0o755);
    chmodSync(join(stagedRoot, "python", "bin", "python3"), 0o755);
  }
  writeFileSync(
    join(stagedRoot, "versions.json"),
    `${JSON.stringify(expectedManifest, null, 2)}\n`,
  );

  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(dirname(targetRoot), { recursive: true });
  renameSync(stagedRoot, targetRoot);

  if (
    !executableWorks(nodeBinary) ||
    !executableWorks(pythonBinary)
  ) {
    throw new Error(`Prepared runtimes failed validation for ${target}`);
  }
  process.stdout.write(
    `[runtimes] Prepared Node ${nodeVersion} and Python ${pythonVersion} for ${target}\n`,
  );
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
