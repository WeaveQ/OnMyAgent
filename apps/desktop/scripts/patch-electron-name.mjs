// Patch Electron.app's Info.plist so that in dev mode the macOS menu bar shows
// "OnMyAgent" (or the value of ONMYAGENT_APP_NAME) instead of "Electron".
//
// Only patches CFBundleDisplayName and CFBundleName — the Dock hover tooltip
// reads from the .app bundle path and is not worth changing in dev mode.
//
// This only modifies the local `node_modules/electron/dist/Electron.app` which
// is ephemeral and regenerated on `pnpm install`. Safe to re-run.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const APP_NAME = process.env.ONMYAGENT_APP_NAME?.trim() || "OnMyAgent";

function resolveElectronAppPath() {
  try {
    const resolved = require.resolve("electron");
    const electronDir = dirname(resolved);
    const direct = resolve(electronDir, "dist", "Electron.app");
    if (existsSync(direct)) return direct;
    const fromPkg = resolve(
      dirname(require.resolve("electron/package.json")),
      "dist",
      "Electron.app",
    );
    if (existsSync(fromPkg)) return fromPkg;
  } catch {
    // ignore
  }
  return resolve(desktopRoot, "node_modules/electron/dist/Electron.app");
}

async function main() {
  if (process.platform !== "darwin") return;

  const appPath = resolveElectronAppPath();
  const plistPath = resolve(appPath, "Contents/Info.plist");
  if (!existsSync(plistPath)) {
    console.log(
      `[patch-electron-name] Info.plist not found at ${plistPath}, skipping.`,
    );
    return;
  }

  try {
    execFileSync("plutil", ["-convert", "xml1", plistPath], { stdio: "ignore" });
  } catch {
    // not fatal — continue with text replacement
  }

  const original = await readFile(plistPath, "utf8");
  const patched = original
    .replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)([^<]+)(<\/string>)/,
      (_m, pre, _val, post) => `${pre}${APP_NAME}${post}`,
    )
    .replace(
      /(<key>CFBundleName<\/key>\s*<string>)([^<]+)(<\/string>)/,
      (_m, pre, _val, post) => `${pre}${APP_NAME}${post}`,
    );

  if (patched === original) {
    console.log(
      `[patch-electron-name] Info.plist already patched for "${APP_NAME}".`,
    );
    return;
  }

  await writeFile(plistPath, patched, "utf8");
  try {
    execFileSync("plutil", ["-convert", "binary1", plistPath], { stdio: "ignore" });
  } catch {
    // not fatal — macOS accepts XML plists too
  }
  console.log(
    `[patch-electron-name] Patched menu bar name → "${APP_NAME}".`,
  );
}

main().catch((error) => {
  console.error("[patch-electron-name] Failed:", error?.message ?? error);
});
