import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const requestedTarget = process.argv[2] === "x64" ? "x64" : null;
const hostArch = process.arch === "arm64" ? "arm64" : "x64";
const targetArch = requestedTarget ?? hostArch;
const targetTriple =
  targetArch === "arm64"
    ? "aarch64-pc-windows-msvc"
    : "x86_64-pc-windows-msvc";

const result = spawnSync(
  process.execPath,
  [resolve(scriptDir, "electron-dev.mjs")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ONMYAGENT_DEV_MODE: process.env.ONMYAGENT_DEV_MODE || "1",
      ONMYAGENT_TARGET_TRIPLE: targetTriple,
      TARGET: targetTriple,
    },
  },
);

process.exit(result.status ?? 1);
