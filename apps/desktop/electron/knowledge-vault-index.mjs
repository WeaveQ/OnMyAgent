/**
 * Knowledge vault FTS5 index (md / txt / csv only). Never indexes raw xlsx.
 * Falls back to a linear scan when node:sqlite is unavailable.
 */
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { readKnowledgeConfig } from "./knowledge-vault-config.mjs";
import {
  INDEXABLE_EXTENSIONS,
  resolveKnowledgeIndexPath,
  resolveKnowledgeRoot,
  resolveKnowledgeScopeDir,
} from "./knowledge-vault-paths.mjs";
import {
  foldKnowledgeNeedle,
  knowledgeTextMatchesQuery,
} from "./knowledge-search-match.mjs";
import { WALK_MAX_BYTES, walkKnowledgeTree } from "./knowledge-vault-walk.mjs";

const MAX_INDEX_BYTES = WALK_MAX_BYTES;
const DEFAULT_LIMIT = 20;
/** Bump to rebuild standing indexes after indexed-column / fold changes. */
const INDEX_SCHEMA_VERSION = "2";

const NOTES_FTS_DDL = `
  CREATE VIRTUAL TABLE notes_fts USING fts5(
    scope UNINDEXED,
    rel_path UNINDEXED,
    title,
    body,
    fold,
    tokenize = 'trigram'
  );
`;

function noteFoldText(note) {
  return [foldKnowledgeNeedle(note.relPath), foldKnowledgeNeedle(note.title)]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {string} query
 */
export function buildFtsMatchQuery(query) {
  const raw = String(query ?? "").trim();
  if (!raw) return null;
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const parts = [quote(raw)];
  const folded = foldKnowledgeNeedle(raw);
  if (folded && folded !== raw.toLowerCase()) parts.push(quote(folded));
  const hyphenated = raw.toLowerCase().replace(/\s+/g, "-");
  if (hyphenated && hyphenated !== raw.toLowerCase()) parts.push(quote(hyphenated));
  return [...new Set(parts)].join(" OR ");
}

/**
 * @param {string} body
 * @param {string} query
 * @param {number} [width]
 */
export function snippetAroundQuery(body, query, width = 160) {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  const needle = String(query ?? "").trim();
  if (!text) return "";
  if (!needle) return text.slice(0, width);
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return text.slice(0, width);
  const start = Math.max(0, index - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function titleFromRelPath(relPath, body) {
  const heading = String(body ?? "").match(/^\s*#\s+(.+)$/m);
  if (heading?.[1]?.trim()) return heading[1].trim();
  return path.posix.basename(relPath, path.posix.extname(relPath));
}

async function listIndexableManifest(dir) {
  return walkKnowledgeTree(dir, { maxBytes: MAX_INDEX_BYTES });
}

/**
 * @param {Array<{ scope: string, workspaceId?: string, expertId?: string }>} scopes
 * @param {Array<{ scope: string, relPath: string, size: number, mtimeMs: number }>} files
 */
export function fingerprintKnowledgeManifest(scopes, files) {
  const scopeKey = (scopes ?? [])
    .map((item) => `${item.scope}:${item.workspaceId ?? ""}:${item.expertId ?? ""}`)
    .join(";");
  const fileKey = [...files]
    .map((file) => `${file.scope}:${file.relPath}:${file.size}:${file.mtimeMs}`)
    .sort()
    .join("\n");
  return `${scopeKey}\n${fileKey}`;
}

/**
 * @param {{
 *   homeDir?: string,
 *   scopes?: Array<{ scope: "user" | "project" | "expert", workspaceId?: string, expertId?: string }>,
 * }} input
 */
export async function collectIndexableNotes(input) {
  const root = resolveKnowledgeRoot(input.homeDir);
  const scopes = input.scopes ?? [{ scope: "user" }];
  const notes = [];
  for (const item of scopes) {
    const dir = resolveKnowledgeScopeDir(root, item.scope, {
      ...item,
      userVaultDir: readKnowledgeConfig(input.homeDir).resolvedUserVaultDir,
    });
    if (!dir) continue;
    const files = await listIndexableManifest(dir);
    for (const file of files) {
      const abs = file.abs;
      let body = "";
      try {
        body = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      notes.push({
        scope: item.scope,
        relPath: file.relPath,
        title: titleFromRelPath(file.relPath, body),
        body,
      });
    }
  }
  return notes;
}

function openIndex(homeDir) {
  const db = new DatabaseSync(resolveKnowledgeIndexPath(homeDir));
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  ensureNotesFts(db);
  return db;
}

function notesFtsHasFoldColumn(db) {
  try {
    db.prepare("SELECT fold FROM notes_fts LIMIT 0").get();
    return true;
  } catch {
    return false;
  }
}

function ensureNotesFts(db) {
  if (readIndexMeta(db, "schema") === INDEX_SCHEMA_VERSION && notesFtsHasFoldColumn(db)) {
    return;
  }
  db.exec("DROP TABLE IF EXISTS notes_fts;");
  db.exec(NOTES_FTS_DDL);
  writeIndexMeta(db, "schema", INDEX_SCHEMA_VERSION);
  writeIndexMeta(db, "fingerprint", "");
}

function readIndexMeta(db, key) {
  const row = db.prepare("SELECT value FROM notes_meta WHERE key = ?").get(key);
  return row ? String(row.value) : "";
}

function writeIndexMeta(db, key, value) {
  db.prepare(
    "INSERT INTO notes_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/**
 * @param {string} [homeDir]
 */
export function invalidateKnowledgeIndex(homeDir) {
  try {
    const db = openIndex(homeDir);
    try {
      writeIndexMeta(db, "fingerprint", "");
    } finally {
      db.close();
    }
  } catch {
    // Index may not exist yet.
  }
}

function indexedNoteCount(db) {
  const row = db.prepare("SELECT count(*) AS n FROM notes_fts").get();
  return Number(row?.n ?? 0);
}

/**
 * @param {{
 *   homeDir?: string,
 *   scopes?: Array<{ scope: "user" | "project" | "expert", workspaceId?: string, expertId?: string }>,
 * }} input
 */
export async function collectKnowledgeManifest(input) {
  const root = resolveKnowledgeRoot(input.homeDir);
  const scopes = input.scopes ?? [{ scope: "user" }];
  const files = [];
  for (const item of scopes) {
    const dir = resolveKnowledgeScopeDir(root, item.scope, {
      ...item,
      userVaultDir: readKnowledgeConfig(input.homeDir).resolvedUserVaultDir,
    });
    if (!dir) continue;
    const listed = await listIndexableManifest(dir);
    for (const file of listed) {
      files.push({ scope: item.scope, ...file });
    }
  }
  return {
    fingerprint: fingerprintKnowledgeManifest(scopes, files),
    files,
  };
}

/**
 * @param {{
 *   homeDir?: string,
 *   notes: Array<{ scope: string, relPath: string, title: string, body: string }>,
 * }} input
 */
/**
 * @param {{
 *   homeDir?: string,
 *   scopes?: Array<{ scope: "user" | "project" | "expert", workspaceId?: string, expertId?: string }>,
 * }} input
 */
export async function rebuildAndCommitKnowledgeIndex(input) {
  const scopes = input.scopes ?? [{ scope: "user" }];
  const notes = await collectIndexableNotes({
    homeDir: input.homeDir,
    scopes,
  });
  rebuildKnowledgeIndex({ homeDir: input.homeDir, notes });
  const manifest = await collectKnowledgeManifest({
    homeDir: input.homeDir,
    scopes,
  });
  const db = openIndex(input.homeDir);
  try {
    writeIndexMeta(db, "fingerprint", manifest.fingerprint);
  } finally {
    db.close();
  }
  return { ok: true, index: "rebuilt", count: notes.length };
}

export function rebuildKnowledgeIndex(input) {
  const db = openIndex(input.homeDir);
  try {
    db.exec("DELETE FROM notes_fts;");
    const insert = db.prepare(
      "INSERT INTO notes_fts (scope, rel_path, title, body, fold) VALUES (?, ?, ?, ?, ?)",
    );
    for (const note of input.notes) {
      insert.run(note.scope, note.relPath, note.title, note.body, noteFoldText(note));
    }
  } finally {
    db.close();
  }
}

/**
 * @param {{
 *   homeDir?: string,
 *   query: string,
 *   scopes?: Array<{ scope: "user" | "project" | "expert", workspaceId?: string, expertId?: string }>,
 *   limit?: number,
 * }} input
 */
export async function searchKnowledgeNotes(input) {
  const query = String(input.query ?? "").trim();
  const limit = Math.max(1, Math.min(50, Number(input.limit) || DEFAULT_LIMIT));
  if (!query) return { ok: true, backend: "none", index: "none", hits: [] };

  const scopes = input.scopes ?? [{ scope: "user" }];
  const manifest = await collectKnowledgeManifest({
    homeDir: input.homeDir,
    scopes,
  });

  try {
    let index = "reused";
    const probe = openIndex(input.homeDir);
    let reuse = false;
    try {
      reuse =
        readIndexMeta(probe, "fingerprint") === manifest.fingerprint &&
        indexedNoteCount(probe) === manifest.files.length;
    } finally {
      probe.close();
    }

    if (!reuse) {
      const notes = await collectIndexableNotes({
        homeDir: input.homeDir,
        scopes,
      });
      rebuildKnowledgeIndex({ homeDir: input.homeDir, notes });
      const meta = openIndex(input.homeDir);
      try {
        writeIndexMeta(meta, "fingerprint", manifest.fingerprint);
      } finally {
        meta.close();
      }
      index = "rebuilt";
    }

    const match = buildFtsMatchQuery(query);
    const db = openIndex(input.homeDir);
    try {
      const rows = db
        .prepare(
          "SELECT scope, rel_path, title, body FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?",
        )
        .all(match, limit);
      return {
        ok: true,
        backend: "fts5",
        index,
        hits: rows.map((row) => ({
          scope: String(row.scope),
          relPath: String(row.rel_path),
          title: String(row.title ?? ""),
          snippet: snippetAroundQuery(String(row.body ?? ""), query),
        })),
      };
    } finally {
      db.close();
    }
  } catch {
    const notes = await collectIndexableNotes({
      homeDir: input.homeDir,
      scopes,
    });
    const hits = notes
      .filter((note) => {
        return (
          knowledgeTextMatchesQuery(note.title, query) ||
          knowledgeTextMatchesQuery(note.relPath, query) ||
          knowledgeTextMatchesQuery(note.body, query)
        );
      })
      .slice(0, limit)
      .map((note) => ({
        scope: note.scope,
        relPath: note.relPath,
        title: note.title,
        snippet: snippetAroundQuery(note.body, query),
      }));
    return { ok: true, backend: "scan", index: "scan", hits };
  }
}

export { INDEXABLE_EXTENSIONS, MAX_INDEX_BYTES };
