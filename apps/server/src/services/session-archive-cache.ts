import { extractSessionArchiveFirstJsonLine, type SessionArchiveScannerMeta } from "./session-archive-scanner.js";
import type { SessionArchiveAgent } from "@onmyagent/types/session-archive";

// Lightweight in-memory summary cache (Phase 1, additive).
// Keyed by filePath. Reuses meta when {mtimeMs,size,ino} match; otherwise re-parses head.
// Persistence to disk lives in a later phase; this module is pure logic + easy to unit test.

export type SessionArchiveSummary = {
  agent: SessionArchiveAgent;
  sourceRoot: string;
  filePath: string;
  sessionId: string;
  title: string | null;
  projectDir: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  size: number;
  mtimeMs: number;
  ino: number;
};

export type SessionArchiveSummaryExtractor = (input: {
  agent: SessionArchiveAgent;
  filePath: string;
  headSample: string;
}) => Pick<SessionArchiveSummary, "sessionId" | "title" | "projectDir" | "createdAt" | "lastActiveAt">;

export type SessionArchiveCache = {
  get: (filePath: string) => SessionArchiveSummary | undefined;
  seed: (summaries: readonly SessionArchiveSummary[]) => void;
  reconcile: (metas: readonly SessionArchiveScannerMeta[]) => SessionArchiveSummary[];
  invalidate: (filePath: string) => boolean;
  size: () => number;
  entries: () => SessionArchiveSummary[];
};

export function createSessionArchiveCache(input: {
  extract: SessionArchiveSummaryExtractor;
}): SessionArchiveCache {
  const store = new Map<string, SessionArchiveSummary>();
  return {
    get(filePath) {
      return store.get(filePath);
    },
    seed(summaries) {
      for (const summary of summaries) store.set(summary.filePath, summary);
    },
    reconcile(metas) {
      const seen = new Set<string>();
      const merged: SessionArchiveSummary[] = [];
      for (const meta of metas) {
        seen.add(meta.filePath);
        const existing = store.get(meta.filePath);
        if (
          existing !== undefined
          && existing.mtimeMs === meta.mtimeMs
          && existing.size === meta.size
          && existing.ino === meta.ino
        ) {
          merged.push(existing);
          continue;
        }
        const summary = summarize(meta, input.extract);
        store.set(meta.filePath, summary);
        merged.push(summary);
      }
      for (const key of store.keys()) {
        if (!seen.has(key)) store.delete(key);
      }
      return merged.sort(compareSessionArchiveSummary);
    },
    invalidate(filePath) {
      return store.delete(filePath);
    },
    size() {
      return store.size;
    },
    entries() {
      return [...store.values()].sort(compareSessionArchiveSummary);
    },
  };
}

function summarize(meta: SessionArchiveScannerMeta, extract: SessionArchiveSummaryExtractor): SessionArchiveSummary {
  const parsed = extract({ agent: meta.agent, filePath: meta.filePath, headSample: meta.headSample });
  return {
    agent: meta.agent,
    sourceRoot: meta.sourceRoot,
    filePath: meta.filePath,
    sessionId: parsed.sessionId,
    title: parsed.title,
    projectDir: parsed.projectDir,
    createdAt: parsed.createdAt,
    lastActiveAt: parsed.lastActiveAt,
    size: meta.size,
    mtimeMs: meta.mtimeMs,
    ino: meta.ino,
  };
}

function compareSessionArchiveSummary(left: SessionArchiveSummary, right: SessionArchiveSummary): number {
  const leftTs = toTimestampNumber(left.lastActiveAt) ?? toTimestampNumber(left.createdAt) ?? left.mtimeMs;
  const rightTs = toTimestampNumber(right.lastActiveAt) ?? toTimestampNumber(right.createdAt) ?? right.mtimeMs;
  return rightTs - leftTs;
}

function toTimestampNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Default extractor: consumes the first JSON line of the head sample, tolerates parse failures.
export function defaultSessionArchiveSummaryExtractor(input: {
  agent: SessionArchiveAgent;
  filePath: string;
  headSample: string;
}): ReturnType<SessionArchiveSummaryExtractor> {
  const fileFallbackSessionId = deriveSessionIdFromPath(input.filePath);
  const line = extractSessionArchiveFirstJsonLine(input.headSample);
  if (line === null) {
    return {
      sessionId: fileFallbackSessionId,
      title: null,
      projectDir: null,
      createdAt: null,
      lastActiveAt: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      sessionId: fileFallbackSessionId,
      title: null,
      projectDir: null,
      createdAt: null,
      lastActiveAt: null,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      sessionId: fileFallbackSessionId,
      title: null,
      projectDir: null,
      createdAt: null,
      lastActiveAt: null,
    };
  }
  const record = parsed as Record<string, unknown>;
  return {
    sessionId: firstString(record, ["sessionId", "session_id", "id"]) ?? fileFallbackSessionId,
    title: firstString(record, ["title", "summary", "name"]) ?? null,
    projectDir: firstString(record, ["cwd", "project", "projectDir", "project_dir"]) ?? null,
    createdAt: firstString(record, ["createdAt", "created_at", "startedAt", "started_at", "timestamp"]) ?? null,
    lastActiveAt: firstString(record, ["updatedAt", "updated_at", "lastActiveAt", "last_active_at"]) ?? null,
  };
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function deriveSessionIdFromPath(filePath: string): string {
  const last = filePath.split(/[/\\]/).pop() ?? filePath;
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(0, dot) : last;
}
