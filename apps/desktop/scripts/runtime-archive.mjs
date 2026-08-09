import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import path from "node:path";

export function clearDownloadQuarantine(
  archivePath,
  { platform = process.platform, spawn = spawnSync } = {},
) {
  if (platform !== "darwin") return;
  spawn("xattr", ["-d", "com.apple.quarantine", archivePath], {
    stdio: "ignore",
  });
}

export function movePreparedRuntimeTree(
  source,
  destination,
  { rename = renameSync } = {},
) {
  rename(source, destination);
}

export function preparedRuntimeRoot(targetRoot) {
  return `${targetRoot}.prepared`;
}

export function resolveRuntimeTarExtraction(
  archivePath,
  destinationPath,
  { platform = process.platform, env = process.env, cwd = process.cwd() } = {},
) {
  if (platform === "win32") {
    const systemRoot = String(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows").trim() || "C:\\Windows";
    return {
      command: path.win32.join(systemRoot, "System32", "tar.exe"),
      args: [
        "-xzf",
        path.win32.resolve(cwd, archivePath),
        "-C",
        path.win32.resolve(cwd, destinationPath),
      ],
    };
  }
  return {
    command: "tar",
    args: ["-xzf", path.resolve(cwd, archivePath), "-C", path.resolve(cwd, destinationPath)],
  };
}
