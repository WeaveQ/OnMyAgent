import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "../src/core/sqlite.js";

describe("sqlite loader", () => {
  test("opens a file db via bun:sqlite or node:sqlite and round-trips a row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oma-sqlite-loader-"));
    const db = new Database(join(dir, "archive.sqlite"));
    try {
      db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
      db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("ses_1", "hello");
      const row = db.prepare("SELECT title FROM sessions WHERE id = ?").get("ses_1") as { title: string };
      expect(row.title).toBe("hello");
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
