import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
/**
 * Skip LibreOffice download/stage (large DMG/MSI).
 * electron-dev passes --skip-office by default; packaging keeps office.
 */
const skipOffice =
  process.argv.includes("--skip-office") ||
  process.env.ONMYAGENT_RUNTIME_SKIP_OFFICE === "1" ||
  process.env.ONMYAGENT_SKIP_LIBREOFFICE === "1";
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
const libreOfficeVersion = "25.8.2.2";
const artifactPythonPackages = Object.freeze([
  "cffi==2.1.0",
  "chardet==7.4.3",
  "charset-normalizer==3.4.9",
  "cryptography==49.0.0",
  "defusedxml==0.7.1",
  "et-xmlfile==2.0.0",
  "lxml==5.4.0",
  "numpy==2.2.6",
  "openpyxl==3.1.5",
  "pandas==2.2.3",
  "Pillow==11.2.1",
  "PyMuPDF==1.26.1",
  "pypdf==5.6.0",
  "pdfplumber==0.11.7",
  "pdfminer.six==20250506",
  "pycparser==3.0",
  "pypdfium2==5.12.1",
  "python-dateutil==2.9.0.post0",
  "python-docx==1.2.0",
  "pytz==2026.2",
  "reportlab==4.4.1",
  "six==1.17.0",
  "typing_extensions==4.16.0",
  "tzdata==2026.3",
]);
if (!nodeVersion || !pythonVersion || !pythonRelease) {
  throw new Error("constants.json is missing bundled runtime versions");
}

const specs = {
  "aarch64-apple-darwin": {
    nodeAsset: `node-${nodeVersion}-darwin-arm64.tar.gz`,
    nodeSha256: "39189dab4eeb15706c424af0ac08a3044c9e48f7db12a7d77f6b7aafc7dd5df6",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-aarch64-apple-darwin-install_only.tar.gz`,
    pythonSha256: "e18ddd4c1e8f4a1d6c4590b37f423d76aec734447edc20ed08e93983d95f2132",
    officeAsset: `LibreOffice_${libreOfficeVersion}_MacOS_aarch64.dmg`,
    officeSha256: "f6e4881a787134ddb8621830a58dc127921a3b965e299cb6b8c7d6839cfa7b68",
    officePath: "mac/aarch64",
  },
  "x86_64-apple-darwin": {
    nodeAsset: `node-${nodeVersion}-darwin-x64.tar.gz`,
    nodeSha256: "298b4c7b3cb80765c8703e42b90324a4ece3b6634947b89e769c3c980ab55185",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-x86_64-apple-darwin-install_only.tar.gz`,
    pythonSha256: "ba02164e4db381af8c288c0bc1657584a835e9121a0fa2836b0f2e712ff8cdf5",
    officeAsset: `LibreOffice_${libreOfficeVersion}_MacOS_x86-64.dmg`,
    officeSha256: "3f0cbf06f8a9a6eaa4ffaae89aff7a5a12b8543069b2dc0021f30ce6e53708fd",
    officePath: "mac/x86_64",
  },
  "aarch64-unknown-linux-gnu": {
    nodeAsset: `node-${nodeVersion}-linux-arm64.tar.gz`,
    nodeSha256: "589f5b6dd4fcfee4dfda73013903c966abaa8abd93dbc9d436544e472b4f0e74",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
    pythonSha256: "bc74cf1bb517651868342b0619b21eaaf9f94a2022c9c61886dd980e16fb091b",
    officeAsset: `LibreOffice_${libreOfficeVersion}_Linux_aarch64_deb.tar.gz`,
    officeSha256: "e26953050f56e610d946ad4c94e0e85d2503418aa329054cb536a6640d29a4a6",
    officePath: "deb/aarch64",
  },
  "x86_64-unknown-linux-gnu": {
    nodeAsset: `node-${nodeVersion}-linux-x64.tar.gz`,
    nodeSha256: "2faf6a387e9b62b888e21c54f01249fb27537ffecf1842f29f4c919d0a59a0ff",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
    pythonSha256: "c218f50baeb2c06a30c2f03db5986b2bad6ab7c8a52faad2d5a59bda0677b93a",
    officeAsset: `LibreOffice_${libreOfficeVersion}_Linux_x86-64_deb.tar.gz`,
    officeSha256: "d703ce5d6760684061f7d22e2b8df91320c2fe3601a8472975b4b05b22af43ba",
    officePath: "deb/x86_64",
  },
  "aarch64-pc-windows-msvc": {
    nodeAsset: `node-${nodeVersion}-win-arm64.zip`,
    nodeSha256: "14834611d4c6b3c06054e7007732b90474c16e0b32f395e05b55a571ef71c6d2",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-aarch64-pc-windows-msvc-install_only.tar.gz`,
    pythonSha256: "b50d4eee0a9c440597fb57a7b6b8f0021e799ebbf84d9fcb81f7ca199785e865",
    officeAsset: `LibreOffice_${libreOfficeVersion}_Win_aarch64.msi`,
    officeSha256: "77c92b0272399778fca25a294b300de7d41548c60101f403130a223905bda11d",
    officePath: "win/aarch64",
  },
  "x86_64-pc-windows-msvc": {
    nodeAsset: `node-${nodeVersion}-win-x64.zip`,
    nodeSha256: "edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56",
    pythonAsset: `cpython-${pythonVersion}+${pythonRelease}-x86_64-pc-windows-msvc-install_only.tar.gz`,
    pythonSha256: "f5e4d9f856567493776f3d1e832c939fbaba5dcbcc5e0492a82ecfceea83b316",
    officeAsset: `LibreOffice_${libreOfficeVersion}_Win_x86-64.msi`,
    officeSha256: "5e8cfdcacffaa779c14362897579385d4722f1d582d9c5bc1bbf473a21628403",
    officePath: "win/x86_64",
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
  artifactPythonPackages,
  libreOffice: skipOffice || !spec.officeAsset ? null : libreOfficeVersion,
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

function pythonArtifactPackagesWork(binary) {
  if (!existsSync(binary)) return false;
  return spawnSync(
    binary,
    [
      "-c",
      "import defusedxml, docx, fitz, lxml, numpy, openpyxl, pandas, pdfplumber, PIL, pypdf, reportlab",
    ],
    { encoding: "utf8" },
  ).status === 0;
}

function officeBinaryFor(root) {
  if (process.platform === "darwin") {
    return join(root, "libreoffice", "LibreOffice.app", "Contents", "MacOS", "soffice");
  }
  if (process.platform === "win32") {
    return join(root, "libreoffice", "LibreOffice", "program", "soffice.exe");
  }
  return join(root, "bin", "soffice");
}

function officeWorks(root) {
  if (skipOffice || !spec.officeAsset) return true;
  const binary = officeBinaryFor(root);
  return existsSync(binary) && spawnSync(binary, ["--version"], { encoding: "utf8" }).status === 0;
}

function coreRuntimesReady() {
  return (
    executableWorks(nodeBinary) &&
    executableWorks(pythonBinary) &&
    pythonArtifactPackagesWork(pythonBinary)
  );
}

function manifestCoreMatches(current) {
  if (!current || typeof current !== "object") return false;
  return (
    current.target === expectedManifest.target &&
    current.node === expectedManifest.node &&
    current.python === expectedManifest.python &&
    current.pythonStandaloneRelease ===
      expectedManifest.pythonStandaloneRelease &&
    JSON.stringify(current.artifactPythonPackages ?? null) ===
      JSON.stringify(expectedManifest.artifactPythonPackages)
  );
}

if (existsSync(manifestPath) && coreRuntimesReady()) {
  let current = null;
  try {
    current = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    current = null;
  }
  if (skipOffice) {
    // Dev path: do not re-download just because LibreOffice is missing.
    if (manifestCoreMatches(current)) {
      process.stdout.write(
        `[runtimes] ${target} already prepared (LibreOffice skipped)\n`,
      );
      process.exit(0);
    }
  } else if (
    JSON.stringify(current) === JSON.stringify(expectedManifest) &&
    officeWorks(targetRoot)
  ) {
    process.stdout.write(`[runtimes] ${target} already prepared\n`);
    process.exit(0);
  }
}

if (skipOffice) {
  process.stdout.write(
    `[runtimes] Skipping LibreOffice (unset ONMYAGENT_RUNTIME_SKIP_OFFICE or omit --skip-office to bundle it)\n`,
  );
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

function prepareOfficeRuntime(archive, stagedRoot) {
  const officeRoot = join(stagedRoot, "libreoffice");
  const binRoot = join(stagedRoot, "bin");
  mkdirSync(officeRoot, { recursive: true });
  mkdirSync(binRoot, { recursive: true });
  if (process.platform === "darwin") {
    const mountPoint = join(workRoot, "libreoffice-mount");
    mkdirSync(mountPoint, { recursive: true });
    const attach = spawnSync(
      "hdiutil",
      ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, archive],
      { stdio: "inherit" },
    );
    if (attach.status !== 0) throw new Error(`Failed to mount ${archive}`);
    try {
      cpSync(join(mountPoint, "LibreOffice.app"), join(officeRoot, "LibreOffice.app"), {
        recursive: true,
        preserveTimestamps: true,
      });
    } finally {
      spawnSync("hdiutil", ["detach", mountPoint, "-force"], { stdio: "inherit" });
    }
    symlinkSync(
      relative(binRoot, officeBinaryFor(stagedRoot)),
      join(binRoot, "soffice"),
    );
    return;
  }
  if (process.platform === "win32") {
    const install = spawnSync(
      "msiexec.exe",
      ["/a", archive, "/qn", `TARGETDIR=${officeRoot}`],
      { stdio: "inherit" },
    );
    if (install.status !== 0) throw new Error(`Failed to extract ${archive}`);
    return;
  }
  const extracted = join(workRoot, "libreoffice-extract");
  extract(archive, extracted);
  const debs = spawnSync("find", [extracted, "-type", "f", "-name", "*.deb"], {
    encoding: "utf8",
  });
  if (debs.status !== 0) throw new Error("Failed to enumerate LibreOffice packages");
  for (const deb of debs.stdout.split(/\r?\n/).filter(Boolean)) {
    const unpack = spawnSync("dpkg-deb", ["-x", deb, officeRoot], { stdio: "inherit" });
    if (unpack.status !== 0) throw new Error(`Failed to extract ${deb}`);
  }
  const search = spawnSync("find", [officeRoot, "-type", "f", "-path", "*/program/soffice"], {
    encoding: "utf8",
  });
  const source = search.stdout.split(/\r?\n/).find(Boolean);
  if (!source) throw new Error("LibreOffice extraction did not contain soffice");
  symlinkSync(relative(binRoot, source), join(binRoot, "soffice"));
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
  const officeArchive =
    !skipOffice && spec.officeAsset
      ? await acquireArchive(
          `https://downloadarchive.documentfoundation.org/libreoffice/old/${libreOfficeVersion}/${spec.officePath}/${spec.officeAsset}`,
          spec.officeAsset,
          spec.officeSha256,
        )
      : null;

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
  if (officeArchive) prepareOfficeRuntime(officeArchive, stagedRoot);
  const stagedPythonBinary = join(
    stagedRoot,
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python3",
  );
  const artifactWheelhouse = join(downloadCacheRoot, "artifact-wheels", target);
  mkdirSync(artifactWheelhouse, { recursive: true });
  if (!offline) {
    const downloadResult = spawnSync(
      stagedPythonBinary,
      [
        "-m",
        "pip",
        "download",
        "--only-binary=:all:",
        "--dest",
        artifactWheelhouse,
        ...artifactPythonPackages,
      ],
      { stdio: "inherit" },
    );
    if (downloadResult.status !== 0) {
      throw new Error("Failed to download bundled artifact Python wheels");
    }
  }
  const installResult = spawnSync(
    stagedPythonBinary,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-index",
      "--find-links",
      artifactWheelhouse,
      ...artifactPythonPackages,
    ],
    { stdio: "inherit" },
  );
  if (installResult.status !== 0 || !pythonArtifactPackagesWork(stagedPythonBinary)) {
    throw new Error(
      `Bundled artifact Python packages are unavailable. Populate ${artifactWheelhouse} before an offline build.`,
    );
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
    !executableWorks(pythonBinary) ||
    !pythonArtifactPackagesWork(pythonBinary) ||
    !officeWorks(targetRoot)
  ) {
    throw new Error(`Prepared runtimes failed validation for ${target}`);
  }
  process.stdout.write(
    `[runtimes] Prepared Node ${nodeVersion} and Python ${pythonVersion} for ${target}` +
      (skipOffice ? " (LibreOffice skipped)\n" : "\n"),
  );
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
