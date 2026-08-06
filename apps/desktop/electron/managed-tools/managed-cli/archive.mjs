/**
 * Archive helpers for managed CLI installers (OfficeCLI, future Feishu CLI, …).
 * Prefer system unzip tools to avoid new desktop dependencies.
 */
import { execFile } from "node:child_process";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate `entryName` under `root` (exact relative path or basename match).
 * @param {string} root
 * @param {string} entryName
 */
async function findExtractedEntry(root, entryName) {
  const direct = path.join(root, entryName);
  if (await pathExists(direct)) return direct;

  const base = path.basename(entryName);
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name === base || entry.name === entryName) return full;
    }
  }
  return null;
}

/**
 * Extract a single file from a zip archive to `destPath`.
 *
 * @param {{
 *   archivePath: string,
 *   entryName: string,
 *   destPath: string,
 *   platform?: NodeJS.Platform,
 * }} input
 */
export async function extractZipEntry(input) {
  const archivePath = String(input.archivePath ?? "");
  const entryName = String(input.entryName ?? "").trim();
  const destPath = String(input.destPath ?? "");
  const platform = input.platform ?? process.platform;
  if (!archivePath || !entryName || !destPath) {
    throw new Error("extractZipEntry requires archivePath, entryName, and destPath");
  }

  const extractRoot = path.join(
    path.dirname(destPath),
    `.extract-${process.pid}-${randomUUID()}`,
  );
  await mkdir(extractRoot, { recursive: true });
  try {
    if (platform === "win32") {
      const script = [
        `$ErrorActionPreference = 'Stop'`,
        `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractRoot.replaceAll("'", "''")}' -Force`,
      ].join("; ");
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      );
    } else {
      // Prefer exact entry; fall back to full extract if zip layout differs.
      try {
        await execFileAsync(
          "unzip",
          ["-o", archivePath, entryName, "-d", extractRoot],
          { maxBuffer: 16 * 1024 * 1024 },
        );
      } catch {
        await execFileAsync("unzip", ["-o", archivePath, "-d", extractRoot], {
          maxBuffer: 16 * 1024 * 1024,
        });
      }
    }

    const found = await findExtractedEntry(extractRoot, entryName);
    if (!found) {
      throw new Error(`Zip entry not found after extract: ${entryName}`);
    }
    const info = await stat(found);
    if (!info.isFile()) {
      throw new Error(`Zip entry is not a file: ${entryName}`);
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    await rm(destPath, { force: true });
    await rename(found, destPath);
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}
