import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";

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
