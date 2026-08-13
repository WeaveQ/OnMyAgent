/**
 * Pi coding-agent sidecar preparation.
 *
 * Pi is a Node package (`@earendil-works/pi-coding-agent`), unlike OpenCode's
 * single compiled binary. The sidecar bundles the full package tree (dist +
 * node_modules incl. platform native prebuilds) under
 * `resources/sidecars/pi/`, run with the product-bundled Node runtime.
 *
 * Sources (first that succeeds):
 *   1. ONMYAGENT_PI_SOURCE=local — copy from an existing local install
 *      (default: `npm root -g`/@earendil-works/pi-coding-agent).
 *   2. npm registry tarball pinned by constants.json piVersion.
 *
 * Outputs `resources/sidecars/pi/{package,dist,node_modules,...}` plus the
 * version entry merged into `versions.json`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const constants = JSON.parse(
  readFileSync(resolve(repoRoot, "constants.json"), "utf8"),
);
const pinVersion = String(constants.piVersion ?? "").trim();
if (!pinVersion) {
  console.error("[pi-sidecar] constants.json is missing piVersion");
  process.exit(1);
}

const sidecarDir = resolve(
  process.env.ONMYAGENT_SIDECAR_DIR?.trim() || join(desktopRoot, "resources", "sidecars"),
);
const piSidecarRoot = join(sidecarDir, "pi");
const versionsPath = join(sidecarDir, "versions.json");

const readArg = (name) => {
  const raw = process.argv.slice(2);
  const direct = raw.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.split("=")[1];
  const index = raw.indexOf(name);
  if (index >= 0 && raw[index + 1]) return raw[index + 1];
  return null;
};
const hasFlag = (name) => process.argv.slice(2).includes(name);
const force = hasFlag("--force") || process.env.ONMYAGENT_PI_FORCE === "1";
const sourceMode = readArg("--source") || process.env.ONMYAGENT_PI_SOURCE || "auto";

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

/** Locate a local pi install (npm global root). */
function findLocalPiPackageRoot() {
  const npmRoot = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["root", "-g"],
    { encoding: "utf8" },
  ).stdout?.trim();
  const candidates = [
    npmRoot ? join(npmRoot, "@earendil-works", "pi-coding-agent") : null,
    "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
    "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
    join(process.env.HOME ?? "", ".local", "lib", "node_modules", "@earendil-works", "pi-coding-agent"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, "dist", "cli.js"))) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function readInstalledVersion(packageRoot) {
  try {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    return String(pkg.version ?? "").trim();
  } catch {
    return null;
  }
}

/** Copy a local pi install into the sidecar (fast, offline-friendly). */
function copyLocalInstall(sourceRoot) {
  mkdirSync(piSidecarRoot, { recursive: true });
  rmSync(piSidecarRoot, { recursive: true, force: true });
  mkdirSync(piSidecarRoot, { recursive: true });
  // cpSync preserves symlinks; node_modules in global installs can contain
  // deduped links — copy contents, not the link itself.
  for (const entry of ["package.json", "dist", "docs", "examples", "containerization.md", "CHANGELOG.md", "npm-shrinkwrap.json"]) {
    const source = join(sourceRoot, entry);
    if (existsSync(source)) cpSync(source, join(piSidecarRoot, entry), { recursive: true });
  }
  const nmSource = join(sourceRoot, "node_modules");
  if (existsSync(nmSource)) {
    cpSync(nmSource, join(piSidecarRoot, "node_modules"), { recursive: true });
  }
  const cliPath = join(piSidecarRoot, "dist", "cli.js");
  if (existsSync(cliPath)) {
    try {
      chmodSync(cliPath, 0o755);
    } catch {
      // ignore
    }
  }
}

/** Download + install the pinned tarball from the npm registry. */
function downloadFromRegistry() {
  const tarballUrl = `https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-${pinVersion}.tgz`;
  const stamp = Date.now();
  const workDir = join(tmpdir(), `pi-sidecar-${stamp}`);
  const archive = join(workDir, "pi.tgz");
  mkdirSync(workDir, { recursive: true });

  console.log(`[pi-sidecar] downloading ${tarballUrl}`);
  const curl = spawnSync("curl", ["-fsSL", "-o", archive, tarballUrl], {
    stdio: "inherit",
  });
  if (curl.status !== 0) {
    console.error("[pi-sidecar] tarball download failed");
    process.exit(curl.status ?? 1);
  }

  const extract = spawnSync(
    process.platform === "win32" ? "tar.exe" : "tar",
    ["-xzf", archive, "-C", workDir],
    { stdio: "inherit" },
  );
  if (extract.status !== 0) process.exit(extract.status ?? 1);

  const pkgDir = join(workDir, "package");
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-save"],
    { cwd: pkgDir, stdio: "inherit" },
  );
  if (install.status !== 0) {
    console.error("[pi-sidecar] npm install failed");
    process.exit(install.status ?? 1);
  }

  rmSync(piSidecarRoot, { recursive: true, force: true });
  mkdirSync(piSidecarRoot, { recursive: true });
  cpSync(pkgDir, piSidecarRoot, { recursive: true });
  rmSync(workDir, { recursive: true, force: true });
}

// ── main ────────────────────────────────────────────────
const cliMarker = join(piSidecarRoot, "dist", "cli.js");
const existingVersion = existsSync(cliMarker)
  ? readInstalledVersion(piSidecarRoot)
  : null;
const pinMatches = existingVersion && existingVersion === pinVersion;

if (!force && pinMatches) {
  console.log(`[pi-sidecar] already present (${existingVersion}).`);
} else {
  if (existingVersion) {
    console.warn(
      `[pi-sidecar] existing ${existingVersion} != pinned ${pinVersion}; refreshing.`,
    );
  }
  let copied = false;
  if (sourceMode === "local" || sourceMode === "auto") {
    const localRoot = findLocalPiPackageRoot();
    if (localRoot) {
      const localVersion = readInstalledVersion(localRoot);
      if (localVersion && localVersion === pinVersion) {
        console.log(`[pi-sidecar] copying local install (${localVersion}) from ${localRoot}`);
        copyLocalInstall(localRoot);
        copied = true;
      } else {
        console.warn(
          `[pi-sidecar] local install ${localVersion ?? "unknown"} != pinned ${pinVersion}; falling through.`,
        );
      }
    }
  }
  if (!copied) {
    if (sourceMode === "local") {
      console.error("[pi-sidecar] --source=local but no matching local install");
      process.exit(1);
    }
    downloadFromRegistry();
  }
}

// ── versions.json merge ─────────────────────────────────
const finalVersion = readInstalledVersion(piSidecarRoot);
if (!finalVersion) {
  console.error("[pi-sidecar] no version after prepare");
  process.exit(1);
}
let versions = {};
try {
  versions = JSON.parse(readFileSync(versionsPath, "utf8"));
} catch {
  // first write
}
versions.pi = {
  version: finalVersion,
  sha256: existsSync(cliMarker) ? sha256File(cliMarker) : null,
  file: existsSync(cliMarker) ? statSync(cliMarker).size : null,
  hasFile: true,
};
try {
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n", "utf8");
} catch (error) {
  console.error(`[pi-sidecar] failed to write ${versionsPath}: ${error}`);
  process.exit(1);
}

console.log(`[pi-sidecar] ready: pi ${finalVersion} at ${piSidecarRoot}`);
