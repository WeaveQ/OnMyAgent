import { createHash, randomUUID, type Hash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { toPortableRelativePath } from "../workspace/portable-path.js";

const BLOCKED_DIRECTORY_NAMES = new Set([".git", ".hg", ".svn", "__pycache__"]);
const BLOCKED_FILE_NAMES = new Set([".ds_store", ".npmrc", ".pypirc"]);

export type DirectoryReplacement = {
  staging: string;
  destination: string;
};

export async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonRecord(target: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSafePackageSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== "." && value !== "..";
}

export function normalizePackageRelativePath(value: unknown): string | null {
  return toPortableRelativePath(value);
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

export async function resolveSafePackagePath(
  root: string,
  relativePath: string,
): Promise<string> {
  const sourceRoot = await realpath(root);
  const target = packagePath(sourceRoot, relativePath);
  const canonicalTarget = await realpath(target);
  if (!isPathInside(sourceRoot, canonicalTarget)) {
    throw new Error(`WorkBuddy package path escapes source root: ${relativePath}`);
  }
  return canonicalTarget;
}

export async function copySafePackageTree(
  source: string,
  destination: string,
): Promise<string[]> {
  const sourceRoot = await realpath(source);
  const skipped: string[] = [];
  await copyEntry(sourceRoot, destination, sourceRoot, "", skipped, new Set());
  return skipped.sort();
}

export async function fingerprintSafePackageTree(source: string): Promise<string> {
  const sourceRoot = await realpath(source);
  const hash = createHash("sha256");
  await fingerprintEntry(sourceRoot, sourceRoot, "", hash, new Set());
  return hash.digest("hex");
}

async function fingerprintEntry(
  source: string,
  sourceRoot: string,
  relativePath: string,
  hash: Hash,
  activeRealDirectories: Set<string>,
): Promise<void> {
  if (relativePath && shouldSkipPackagePath(relativePath)) return;
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    const target = await realpath(source);
    if (!isPathInside(sourceRoot, target)) {
      throw new Error(`WorkBuddy package symlink escapes source root: ${relativePath}`);
    }
    const targetInfo = await stat(target);
    if (targetInfo.isDirectory()) {
      await fingerprintDirectory(target, sourceRoot, relativePath, hash, activeRealDirectories);
      return;
    }
    if (targetInfo.isFile()) {
      hash.update(`file:${relativePath}\0`);
      hash.update(await readFile(target));
      return;
    }
    throw new Error(`Unsupported WorkBuddy package symlink target: ${relativePath}`);
  }
  if (info.isDirectory()) {
    await fingerprintDirectory(source, sourceRoot, relativePath, hash, activeRealDirectories);
    return;
  }
  if (info.isFile()) {
    hash.update(`file:${relativePath}\0`);
    hash.update(await readFile(source));
  }
}

async function fingerprintDirectory(
  source: string,
  sourceRoot: string,
  relativePath: string,
  hash: Hash,
  activeRealDirectories: Set<string>,
): Promise<void> {
  const canonical = await realpath(source);
  if (activeRealDirectories.has(canonical)) {
    throw new Error(`WorkBuddy package contains a symlink cycle: ${relativePath}`);
  }
  activeRealDirectories.add(canonical);
  try {
    hash.update(`dir:${relativePath}\0`);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relativePath ? join(relativePath, entry.name) : entry.name;
      await fingerprintEntry(
        join(source, entry.name),
        sourceRoot,
        childRelative,
        hash,
        activeRealDirectories,
      );
    }
  } finally {
    activeRealDirectories.delete(canonical);
  }
}

async function copyEntry(
  source: string,
  destination: string,
  sourceRoot: string,
  relativePath: string,
  skipped: string[],
  activeRealDirectories: Set<string>,
): Promise<void> {
  if (relativePath && shouldSkipPackagePath(relativePath)) {
    skipped.push(relativePath);
    return;
  }

  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    const target = await realpath(source);
    if (!isPathInside(sourceRoot, target)) {
      throw new Error(`WorkBuddy package symlink escapes source root: ${relativePath}`);
    }
    const targetInfo = await stat(target);
    if (targetInfo.isDirectory()) {
      await copyDirectory(target, destination, sourceRoot, relativePath, skipped, activeRealDirectories);
      return;
    }
    if (targetInfo.isFile()) {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(target, destination);
      return;
    }
    throw new Error(`Unsupported WorkBuddy package symlink target: ${relativePath}`);
  }

  if (info.isDirectory()) {
    await copyDirectory(source, destination, sourceRoot, relativePath, skipped, activeRealDirectories);
    return;
  }
  if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  skipped.push(relativePath || basename(source));
}

async function copyDirectory(
  source: string,
  destination: string,
  sourceRoot: string,
  relativePath: string,
  skipped: string[],
  activeRealDirectories: Set<string>,
): Promise<void> {
  const canonical = await realpath(source);
  if (activeRealDirectories.has(canonical)) {
    throw new Error(`WorkBuddy package contains a symlink cycle: ${relativePath}`);
  }
  activeRealDirectories.add(canonical);
  try {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relativePath ? join(relativePath, entry.name) : entry.name;
      await copyEntry(
        join(source, entry.name),
        join(destination, entry.name),
        sourceRoot,
        childRelative,
        skipped,
        activeRealDirectories,
      );
    }
  } finally {
    activeRealDirectories.delete(canonical);
  }
}

function shouldSkipPackagePath(relativePath: string): boolean {
  const segments = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.some((segment) => BLOCKED_DIRECTORY_NAMES.has(segment.toLowerCase()))) return true;
  if (segments[0] === ".codebuddy-plugin") return true;

  const leaf = segments.at(-1)?.toLowerCase() ?? "";
  if (BLOCKED_FILE_NAMES.has(leaf)) return true;
  if (leaf === ".env" || leaf.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx)$/.test(leaf)) return true;
  if (/^(credentials?|secrets?|tokens?)(\.[^.]+)?\.json$/.test(leaf)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(leaf)) return true;
  return false;
}

export async function replaceDirectoriesAtomically(
  replacements: DirectoryReplacement[],
  verify?: () => Promise<void>,
): Promise<void> {
  const applied: Array<{ destination: string; backup: string | null }> = [];
  try {
    for (const replacement of replacements) {
      const backup = await pathExists(replacement.destination)
        ? `${replacement.destination}.getworkbuddy-backup-${randomUUID()}`
        : null;
      if (backup) await rename(replacement.destination, backup);
      try {
        await rename(replacement.staging, replacement.destination);
      } catch (error) {
        if (backup) await rename(backup, replacement.destination).catch(() => undefined);
        throw error;
      }
      applied.push({ destination: replacement.destination, backup });
    }
    if (verify) await verify();
  } catch (error) {
    for (const item of [...applied].reverse()) {
      await rm(item.destination, { recursive: true, force: true }).catch(() => undefined);
      if (item.backup) await rename(item.backup, item.destination).catch(() => undefined);
    }
    throw error;
  }

  for (const item of applied) {
    if (item.backup) await rm(item.backup, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function packagePath(root: string, relativePath: string): string {
  const target = join(root, ...relativePath.split("/"));
  if (!isPathInside(root, target)) throw new Error(`Unsafe WorkBuddy package path: ${relativePath}`);
  return target;
}

export function relativePackagePath(root: string, target: string): string {
  return relative(root, target).replaceAll("\\", "/");
}
