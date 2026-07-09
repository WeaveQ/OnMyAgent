import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "../src/core/sqlite.js";
import {
  findOpenCodeSqliteSource,
  listOpenCodeSqliteSessions,
  loadOpenCodeSqliteSession,
} from "../src/services/session-archive-sqlite-opencode.js";

describe("session-archive opencode sqlite adapter", () => {
  test("lists sessions and loads messages with tool + text parts", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-sqlite-"));
    try {
      const dbPath = join(root, "opencode.db");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
      `);
      db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("ses_a", "Named", "/tmp/proj-a", 1000, 3000);
      db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_1", "ses_a", 1000, JSON.stringify({ role: "user" }));
      db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_2", "ses_a", 2000, JSON.stringify({ role: "assistant" }));
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p1", "msg_1", "ses_a", 1000, JSON.stringify({ type: "text", text: "Hello" }));
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p2", "msg_2", "ses_a", 2000, JSON.stringify({ type: "tool", tool: "bash" }));
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p3", "msg_2", "ses_a", 2001, JSON.stringify({ type: "text", text: "Done" }));
      db.close();

      const source = findOpenCodeSqliteSource(root);
      expect(source).not.toBeNull();
      const metas = listOpenCodeSqliteSessions(source!);
      expect(metas).toHaveLength(1);
      expect(metas[0]?.sessionId).toBe("ses_a");
      expect(metas[0]?.sourceKey).toBe(`sqlite:${dbPath}:ses_a`);

      const parsed = loadOpenCodeSqliteSession({ source: source!, session: metas[0]! });
      expect(parsed).not.toBeNull();
      expect(parsed!.session.id).toBe("opencode:ses_a");
      expect(parsed!.session.display_name).toBe("Named");
      expect(parsed!.session.agent).toBe("opencode");
      expect(parsed!.session.message_count).toBe(2);
      expect(parsed!.session.user_message_count).toBe(1);
      expect(parsed!.session.file_path).toBe(`sqlite:${dbPath}:ses_a`);
      expect(parsed!.messages[0]?.content).toBe("Hello");
      expect(parsed!.messages[1]?.content).toContain("[Tool: bash]");
      expect(parsed!.messages[1]?.content).toContain("Done");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("findOpenCodeSqliteSource returns null when db missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-sqlite-empty-"));
    try {
      expect(findOpenCodeSqliteSource(root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
