import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database, type SqliteDatabase, type SqliteStatement } from "../core/sqlite.js";
import type { SessionArchiveAgent } from "@onmyagent/types/session-archive";
import type { SessionArchiveSummary } from "./session-archive-cache.js";

// SQLite-backed cache persistence (Phase 2).
// Stores only file-level summary rows (cc-switch parity granularity):
// agent, source_root, file_path, session_id, title, project_dir, created_at,
// last_active_at, size, mtime_ms, ino.
// No message/part/analytics tables. Cheap to open, cheap to query, cheap to drop.

const SCHEMA_VERSION = 1;

export type SessionArchiveCacheStore = {
  loadAll: () => SessionArchiveSummary[];
  upsertMany: (summaries: readonly SessionArchiveSummary[]) => void;
  deleteMany: (filePaths: readonly string[]) => void;
  replaceAll: (summaries: readonly SessionArchiveSummary[]) => void;
  close: () => void;
};

export async function openSessionArchiveCacheStore(input: { dbPath: string }): Promise<SessionArchiveCacheStore> {
  await mkdir(dirname(input.dbPath), { recursive: true });
  const db = new Database(input.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  ensureSchema(db);
  return createSessionArchiveCacheStore(db);
}

export function createSessionArchiveCacheStore(db: SqliteDatabase): SessionArchiveCacheStore {
  const selectAll = db.prepare(
    "SELECT agent, source_root, file_path, session_id, title, project_dir, created_at, last_active_at, size, mtime_ms, ino FROM session_archive_summary",
  );
  const upsert = db.prepare(
    `INSERT INTO session_archive_summary (agent, source_root, file_path, session_id, title, project_dir, created_at, last_active_at, size, mtime_ms, ino)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       agent = excluded.agent,
       source_root = excluded.source_root,
       session_id = excluded.session_id,
       title = excluded.title,
       project_dir = excluded.project_dir,
       created_at = excluded.created_at,
       last_active_at = excluded.last_active_at,
       size = excluded.size,
       mtime_ms = excluded.mtime_ms,
       ino = excluded.ino`,
  );
  const deleteOne = db.prepare("DELETE FROM session_archive_summary WHERE file_path = ?");
  const truncate = db.prepare("DELETE FROM session_archive_summary");

  const applyUpsert = db.transaction((rows: readonly SessionArchiveSummary[]) => {
    for (const row of rows) {
      upsert.run(
        row.agent,
        row.sourceRoot,
        row.filePath,
        row.sessionId,
        row.title,
        row.projectDir,
        row.createdAt,
        row.lastActiveAt,
        row.size,
        row.mtimeMs,
        row.ino,
      );
    }
  });
  const applyDelete = db.transaction((paths: readonly string[]) => {
    for (const path of paths) deleteOne.run(path);
  });
  const applyReplace = db.transaction((rows: readonly SessionArchiveSummary[]) => {
    truncate.run();
    for (const row of rows) {
      upsert.run(
        row.agent,
        row.sourceRoot,
        row.filePath,
        row.sessionId,
        row.title,
        row.projectDir,
        row.createdAt,
        row.lastActiveAt,
        row.size,
        row.mtimeMs,
        row.ino,
      );
    }
  });

  return {
    loadAll() {
      return selectAll.all().map(toSummary);
    },
    upsertMany(summaries) {
      if (summaries.length === 0) return;
      applyUpsert(summaries);
    },
    deleteMany(filePaths) {
      if (filePaths.length === 0) return;
      applyDelete(filePaths);
    },
    replaceAll(summaries) {
      applyReplace(summaries);
    },
    close() {
      db.close();
    },
  };
}

function ensureSchema(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS session_archive_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS session_archive_summary (
    file_path TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    source_root TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT,
    project_dir TEXT,
    created_at TEXT,
    last_active_at TEXT,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    ino INTEGER NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_summary_last_active ON session_archive_summary (last_active_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_summary_agent ON session_archive_summary (agent)");
  const readVersion = db.prepare("SELECT value FROM session_archive_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  if (readVersion === undefined) {
    db.prepare("INSERT INTO session_archive_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  }
}

function toSummary(row: unknown): SessionArchiveSummary {
  const record = row as Record<string, unknown>;
  return {
    agent: String(record.agent) as SessionArchiveAgent,
    sourceRoot: String(record.source_root),
    filePath: String(record.file_path),
    sessionId: String(record.session_id),
    title: coerceNullableString(record.title),
    projectDir: coerceNullableString(record.project_dir),
    createdAt: coerceNullableString(record.created_at),
    lastActiveAt: coerceNullableString(record.last_active_at),
    size: Number(record.size),
    mtimeMs: Number(record.mtime_ms),
    ino: Number(record.ino),
  };
}

function coerceNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

// Explicitly reference the internal statement typedef so it is not shaken out
// of downstream re-exports; keeps the type import alive at build time.
export type SessionArchiveCacheStoreStatement = SqliteStatement;
