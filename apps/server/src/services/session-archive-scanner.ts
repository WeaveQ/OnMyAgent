import { open, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type {
  SessionArchiveAgent,
} from "@onmyagent/types/session-archive";
import {
  resolveSessionArchiveSourceRoots,
  sessionArchiveRegistryEntry,

  type SessionArchiveResolvedSourceRoot,
} from "./session-archive-registry.js";

// cc-switch parity scanner (Phase 1, additive):
// - Enumerate JSONL/JSON session files per resolved provider root.
// - stat + head-read only (no full-file parse) for cheap meta.
// - Bounded concurrency to keep the Node event loop responsive.
// - No cache/watcher/DB writes here; those live in session-archive-cache.ts.

export type SessionArchiveScannerMeta = {
  agent: SessionArchiveAgent;
  sourceRoot: string;
  filePath: string;
  size: number;
  mtimeMs: number;
  ino: number;
  headSample: string;
};

export type SessionArchiveScanOptions = {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  config?: Record<string, unknown> | string;
  fileConcurrency?: number;
  headBytes?: number;
  maxFilesPerRoot?: number;
};

const DEFAULT_FILE_CONCURRENCY = 32;
const DEFAULT_HEAD_BYTES = 16 * 1024;
const SESSION_FILE_EXTENSIONS = new Set([".jsonl", ".json"]);

export async function scanSessionArchiveRoots(
  options: SessionArchiveScanOptions = {},
): Promise<SessionArchiveScannerMeta[]> {
  const roots = resolveSessionArchiveSourceRoots({
    homeDir: options.homeDir,
    env: options.env,
    config: options.config,
  });
  const perRoot = await Promise.all(roots.map((root) => scanSessionArchiveRoot(root, options)));
  const byFilePath = new Map<string, SessionArchiveScannerMeta>();
  for (const meta of perRoot.flat()) {
    const existing = byFilePath.get(meta.filePath);
    if (existing === undefined || meta.sourceRoot.length > existing.sourceRoot.length) {
      byFilePath.set(meta.filePath, meta);
    }
  }
  return [...byFilePath.values()];
}

export async function scanSessionArchiveRoot(
  root: SessionArchiveResolvedSourceRoot,
  options: SessionArchiveScanOptions = {},
): Promise<SessionArchiveScannerMeta[]> {
  const files = await collectSessionArchiveFiles(root.root, options.maxFilesPerRoot);
  const limit = Math.max(1, options.fileConcurrency ?? DEFAULT_FILE_CONCURRENCY);
  const headBytes = Math.max(512, options.headBytes ?? DEFAULT_HEAD_BYTES);
  const results: SessionArchiveScannerMeta[] = [];
  for (let index = 0; index < files.length; index += limit) {
    const slice = files.slice(index, index + limit);
    const metas = await Promise.all(
      slice.map((file) => readSessionArchiveFileMeta(root.agent, root.root, file, headBytes)),
    );
    for (const meta of metas) {
      if (meta) results.push(meta);
    }
  }
  return results;
}

async function collectSessionArchiveFiles(root: string, cap?: number): Promise<string[]> {
  const collected: string[] = [];
  const registryEntry = sessionArchiveDetectableFile(root);
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!registryEntry.acceptFile(entry.name)) continue;
      collected.push(full);
      if (cap !== undefined && collected.length >= cap) return collected;
    }
  }
  return collected;
}

function sessionArchiveDetectableFile(_root: string): { acceptFile: (name: string) => boolean } {
  return {
    acceptFile: (name) => {
      const dot = name.lastIndexOf(".");
      if (dot < 0) return false;
      return SESSION_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
    },
  };
}

async function readSessionArchiveFileMeta(
  agent: SessionArchiveAgent,
  sourceRoot: string,
  filePath: string,
  headBytes: number,
): Promise<SessionArchiveScannerMeta | null> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return null;
  }
  if (!fileStat.isFile() || fileStat.size === 0) return null;
  const handle = await openReadOnly(filePath);
  if (!handle) return null;
  try {
    const bufferSize = Math.min(headBytes, fileStat.size);
    const buffer = Buffer.alloc(bufferSize);
    const { bytesRead } = await handle.read(buffer, 0, bufferSize, 0);
    const headSample = buffer.subarray(0, bytesRead).toString("utf8");
    return {
      agent,
      sourceRoot,
      filePath,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      ino: fileStat.ino,
      headSample,
    };
  } finally {
    await handle.close();
  }
}

async function openReadOnly(filePath: string) {
  try {
    return await open(filePath, "r");
  } catch {
    return null;
  }
}

export function extractSessionArchiveFirstJsonLine(sample: string): string | null {
  const newline = sample.indexOf("\n");
  const line = newline >= 0 ? sample.slice(0, newline).trim() : sample.trim();
  if (!line) return null;
  return line;
}

// Consumer of registry entries; keeps this module coupled to registry only.
export function sessionArchiveScannerCoveredAgents(
  input: { homeDir?: string; env?: Record<string, string | undefined>; config?: Record<string, unknown> | string } = {},
): SessionArchiveAgent[] {
  const seen = new Set<SessionArchiveAgent>();
  for (const root of resolveSessionArchiveSourceRoots(input)) {
    const registry = sessionArchiveRegistryEntry(root.agent);
    if (registry?.fileBased) seen.add(root.agent);
  }
  return [...seen];
}
