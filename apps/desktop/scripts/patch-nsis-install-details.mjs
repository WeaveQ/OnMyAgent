/**
 * electron-builder defaults hide install details:
 *   common.nsh        → ShowInstDetails nevershow
 *   installSection.nsh → SetDetailsPrint none
 *
 * That produces a progress bar with an empty details area (or no log at all).
 * Force details ON so assisted installers show extract / install log lines.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");

function resolveNsisDir() {
  const tries = [];
  for (const name of ["app-builder-lib", "electron-builder"]) {
    try {
      const pkg = require.resolve(`${name}/package.json`, {
        paths: [desktopRoot, repoRoot],
      });
      tries.push(path.dirname(pkg));
    } catch {
      // continue
    }
  }
  for (const root of tries) {
    const direct = path.join(root, "templates", "nsis");
    if (existsSync(path.join(direct, "common.nsh"))) return direct;
    const nested = path.join(
      root,
      "node_modules",
      "app-builder-lib",
      "templates",
      "nsis",
    );
    if (existsSync(path.join(nested, "common.nsh"))) return nested;
  }

  const pnpm = path.join(repoRoot, "node_modules", ".pnpm");
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith("app-builder-lib@")) continue;
      const candidate = path.join(
        pnpm,
        entry,
        "node_modules",
        "app-builder-lib",
        "templates",
        "nsis",
      );
      if (existsSync(path.join(candidate, "common.nsh"))) return candidate;
    }
  }
  throw new Error("Cannot locate app-builder-lib NSIS templates");
}

function patchFile(filePath, replacements) {
  let text = readFileSync(filePath, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      changed = true;
    } else if (!text.includes(to)) {
      console.warn(
        `[patch-nsis] pattern not found in ${path.basename(filePath)}: ${JSON.stringify(from)}`,
      );
    }
  }
  if (changed) {
    writeFileSync(filePath, text, "utf8");
    console.log(`[patch-nsis] patched ${filePath}`);
  } else {
    console.log(`[patch-nsis] unchanged ${filePath}`);
  }
}

const nsisDir = resolveNsisDir();
console.log(`[patch-nsis] templates: ${nsisDir}`);

// Force details list + log printing (undo nevershow / none).
patchFile(path.join(nsisDir, "common.nsh"), [
  ["ShowInstDetails nevershow", "ShowInstDetails show"],
  ["ShowUninstDetails nevershow", "ShowUninstDetails show"],
]);
patchFile(path.join(nsisDir, "installSection.nsh"), [
  ["SetDetailsPrint none", "SetDetailsPrint both"],
]);

// Add DetailPrint around the 7z extract so the log is not silent during long waits.
const extractPath = path.join(nsisDir, "include", "extractAppPackage.nsh");
if (existsSync(extractPath)) {
  let extract = readFileSync(extractPath, "utf8");
  const before = extract;
  if (!extract.includes("Extracting OnMyAgent application package")) {
    extract = extract.replace(
      `!macro extractUsing7za FILE
  Push $OUTDIR
  CreateDirectory "$PLUGINSDIR\\7z-out"
  ClearErrors
  SetOutPath "$PLUGINSDIR\\7z-out"
  Nsis7z::Extract "\${FILE}"`,
      `!macro extractUsing7za FILE
  Push $OUTDIR
  CreateDirectory "$PLUGINSDIR\\7z-out"
  ClearErrors
  SetOutPath "$PLUGINSDIR\\7z-out"
  DetailPrint "Extracting OnMyAgent application package (7z)..."
  DetailPrint "This step can take several minutes for runtimes and sidecars."
  Nsis7z::Extract "\${FILE}"`,
    );
    extract = extract.replace(
      `  DoneExtract7za:
!macroend`,
      `  DoneExtract7za:
  DetailPrint "Application package extract finished."
!macroend`,
    );
  }
  if (extract !== before) {
    writeFileSync(extractPath, extract, "utf8");
    console.log(`[patch-nsis] patched ${extractPath}`);
  } else {
    console.log(`[patch-nsis] unchanged ${extractPath}`);
  }
}

console.log("[patch-nsis] done — install details enabled");
