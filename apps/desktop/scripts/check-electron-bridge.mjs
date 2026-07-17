import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DESKTOP_HANDLER_COMMANDS } from "../electron/desktop-handlers/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");

const appLibDir = resolve(repoRoot, "apps/app/src/app/lib");
const desktopBridgePath = join(appLibDir, "desktop.ts");
const electronMainPath = resolve(desktopRoot, "electron/main.mjs");
const preloadPath = resolve(desktopRoot, "electron/preload.mjs");

const desktopBridgeSource = readFileSync(desktopBridgePath, "utf8");
const electronMainSource = readFileSync(electronMainPath, "utf8");
const preloadSource = readFileSync(preloadPath, "utf8");

const clientOnlyBridgeMethods = new Set([
  "isElectron",
  "getPlatform",
  "getVersion",
  "getElectronVersion",
  "getChromeVersion",
]);

/** Collect IPC command names used by renderer desktop wrappers (all desktop*.ts). */
function collectRendererCommandNames() {
  const names = new Set();
  const files = readdirSync(appLibDir).filter(
    (name) => name === "desktop.ts" || (name.startsWith("desktop-") && name.endsWith(".ts")),
  );
  for (const file of files) {
    const source = readFileSync(join(appLibDir, file), "utf8");
    for (const match of source.matchAll(
      /invoke(?:DesktopCommand|ElectronHelper)\s*(?:<[^>]*>)?\s*\(\s*["']([A-Za-z0-9_]+)["']/g,
    )) {
      names.add(match[1]);
    }
  }

  // Legacy: methods destructured from desktopBridge Proxy still count as IPC surface.
  const destructure = desktopBridgeSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*desktopBridge;/);
  if (destructure?.[1]) {
    for (const line of destructure[1].split(/\r?\n/)) {
      if (line.trim().startsWith("//")) continue;
      const name = line.split(":")[0]?.trim().replace(/,$/, "");
      if (name && !clientOnlyBridgeMethods.has(name)) names.add(name);
    }
  }

  return [...names].sort();
}

const bridgeMethods = collectRendererCommandNames();
const electronHandlers = new Set(DESKTOP_HANDLER_COMMANDS);
const missing = bridgeMethods.filter((name) => !electronHandlers.has(name));

const requiredMainSnippets = [
  'const DESKTOP_IPC_CHANNEL = "onmyagent:desktop";',
  'const LEGACY_DESKTOP_IPC_CHANNEL = "open" + "work:desktop";',
  "ipcMain.handle(DESKTOP_IPC_CHANNEL, handleDesktopInvoke);",
  "ipcMain.handle(LEGACY_DESKTOP_IPC_CHANNEL, handleDesktopInvoke);",
];
const requiredPreloadSnippets = [
  'const DESKTOP_IPC_CHANNEL = "onmyagent:desktop";',
  'const LEGACY_DESKTOP_IPC_CHANNEL = "open" + "work:desktop";',
  "ipcRenderer.invoke(DESKTOP_IPC_CHANNEL, command, ...args)",
  "ipcRenderer.invoke(LEGACY_DESKTOP_IPC_CHANNEL, command, ...args)",
];
const bridgeFailures = [];

for (const snippet of requiredMainSnippets) {
  if (!electronMainSource.includes(snippet)) bridgeFailures.push(`main.mjs missing ${snippet}`);
}
for (const snippet of requiredPreloadSnippets) {
  if (!preloadSource.includes(snippet)) bridgeFailures.push(`preload.mjs missing ${snippet}`);
}
if (/ipcRenderer\.invoke\("onmyagent:desktop"/.test(preloadSource)) {
  bridgeFailures.push("preload.mjs should invoke DESKTOP_IPC_CHANNEL instead of hard-coded onmyagent:desktop");
}

if (missing.length > 0 || bridgeFailures.length > 0) {
  if (missing.length > 0) {
    console.error("Electron desktop bridge missing IPC handlers:");
    for (const name of missing) console.error(`- ${name}`);
  }
  if (bridgeFailures.length > 0) {
    console.error("Electron desktop IPC channel checks failed:");
    for (const failure of bridgeFailures) console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Electron desktop bridge covers ${bridgeMethods.length} renderer methods and IPC channels.`,
);
