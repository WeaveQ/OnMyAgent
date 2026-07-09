import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  scanSessionArchiveRoots,
  extractSessionArchiveFirstJsonLine,
} from "../src/services/session-archive-scanner.js";
import {
  createSessionArchiveCache,
  defaultSessionArchiveSummaryExtractor,
} from "../src/services/session-archive-cache.js";

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "session-archive-scanner-"));
  const codex = join(home, ".codex", "sessions");
  await mkdir(codex, { recursive: true });
  await writeFile(
    join(codex, "s1.jsonl"),
    JSON.stringify({
      sessionId: "s1",
      title: "Refactor session archive",
      cwd: "/tmp/proj",
      createdAt: "2026-07-01T10:00:00Z",
      updatedAt: "2026-07-06T12:00:00Z",
    }) + "\n{\"role\":\"user\",\"content\":\"hi\"}\n",
    "utf8",
  );
  await writeFile(
    join(codex, "s2.jsonl"),
    JSON.stringify({
      session_id: "s2",
      summary: "Another chat",
      project: "/tmp/other",
      started_at: "2026-07-05T09:00:00Z",
      last_active_at: "2026-07-07T09:00:00Z",
    }) + "\n",
    "utf8",
  );
  await writeFile(join(codex, "empty.jsonl"), "", "utf8");
  await writeFile(join(codex, "junk.txt"), "not a session\n", "utf8");
  return home;
}

describe("session-archive scanner", () => {
  test("extractSessionArchiveFirstJsonLine trims and slices at newline", () => {
    expect(extractSessionArchiveFirstJsonLine("  {\"a\":1}\nrest")).toBe("{\"a\":1}");
    expect(extractSessionArchiveFirstJsonLine("only\n")).toBe("only");
    expect(extractSessionArchiveFirstJsonLine("\n")).toBeNull();
    expect(extractSessionArchiveFirstJsonLine("")).toBeNull();
  });

  test("scans only jsonl/json files under configured roots", async () => {
    const home = await makeHome();
    try {
      const metas = await scanSessionArchiveRoots({ homeDir: home, env: {} });
      const files = metas.map((meta) => meta.filePath.split("/").pop()).sort();
      expect(files).toEqual(["s1.jsonl", "s2.jsonl"]);
      for (const meta of metas) {
        expect(meta.agent).toBe("codex");
        expect(meta.size).toBeGreaterThan(0);
        expect(meta.mtimeMs).toBeGreaterThan(0);
        expect(meta.ino).toBeGreaterThan(0);
        expect(meta.headSample.length).toBeGreaterThan(0);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cache reuses meta on unchanged {mtimeMs,size,ino} and sorts by lastActive desc", async () => {
    const home = await makeHome();
    try {
      const cache = createSessionArchiveCache({ extract: defaultSessionArchiveSummaryExtractor });
      let extractCallCount = 0;
      const spyCache = createSessionArchiveCache({
        extract: (input) => {
          extractCallCount++;
          return defaultSessionArchiveSummaryExtractor(input);
        },
      });

      const metasA = await scanSessionArchiveRoots({ homeDir: home, env: {} });
      const firstPass = spyCache.reconcile(metasA);
      expect(extractCallCount).toBe(2);
      expect(firstPass.map((s) => s.sessionId)).toEqual(["s2", "s1"]);

      const metasB = await scanSessionArchiveRoots({ homeDir: home, env: {} });
      const secondPass = spyCache.reconcile(metasB);
      expect(extractCallCount).toBe(2);
      expect(secondPass.map((s) => s.sessionId)).toEqual(["s2", "s1"]);

      // Real usage: at least one summary carries a title parsed from the head.
      const initial = cache.reconcile(metasA);
      const s1 = initial.find((entry) => entry.sessionId === "s1");
      expect(s1?.title).toBe("Refactor session archive");
      expect(s1?.projectDir).toBe("/tmp/proj");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cache drops entries not present in the latest scan", async () => {
    const home = await makeHome();
    try {
      const cache = createSessionArchiveCache({ extract: defaultSessionArchiveSummaryExtractor });
      const first = await scanSessionArchiveRoots({ homeDir: home, env: {} });
      cache.reconcile(first);
      expect(cache.size()).toBe(2);
      cache.reconcile([]);
      expect(cache.size()).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
