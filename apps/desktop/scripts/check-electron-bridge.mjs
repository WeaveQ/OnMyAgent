import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");

const desktopBridgePath = resolve(repoRoot, "apps/app/src/app/lib/desktop.ts");
const electronMainPath = resolve(desktopRoot, "electron/main.mjs");
const preloadPath = resolve(desktopRoot, "electron/preload.mjs");

const desktopBridgeSource = readFileSync(desktopBridgePath, "utf8");
const electronMainSource = readFileSync(electronMainPath, "utf8");
const preloadSource = readFileSync(preloadPath, "utf8");

const destructure = desktopBridgeSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*desktopBridge;/);
if (!destructure?.[1]) {
  throw new Error(`Could not find desktopBridge export destructure in ${desktopBridgePath}`);
}

const clientOnlyBridgeMethods = new Set([
  "isElectron",
  "getPlatform",
  "getVersion",
  "getElectronVersion",
  "getChromeVersion",
]);
const bridgeMethods = destructure[1]
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("//"))
  .map((line) => line.split(":")[0]?.trim().replace(/,$/, ""))
  .filter(Boolean)
  .filter((name) => !clientOnlyBridgeMethods.has(name));

const electronHandlers = new Set(
  Array.from(electronMainSource.matchAll(/case\s+"([^"]+)"\s*:/g)).map((match) => match[1]),
);
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

console.log(`Electron desktop bridge covers ${bridgeMethods.length} renderer methods and IPC channels.`);
