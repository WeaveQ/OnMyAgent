import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  pruneRecentEntries,
  readRecentFile,
  recordRecentAccess,
  RECENT_MAX_ENTRIES,
  resolveRecentFilePath,
  sortRecentEntries,
  writeRecentFile,
} from "./knowledge-recent.mjs";

describe("knowledge recent pure reducers", () => {
  test("recordRecentAccess builds an MRU entry with display name", () => {
    const entries = recordRecentAccess([], {
      scope: "user",
      relPath: "briefs/q3-plan.md",
      vaultLabel: "OnMyAgent",
      now: new Date("2026-08-25T09:00:00Z"),
    });
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
      key: "user:briefs/q3-plan.md",
      scope: "user",
      relPath: "briefs/q3-plan.md",
      name: "q3-plan",
      location: "OnMyAgent",
      accessedAt: "2026-08-25T09:00:00.000Z",
    });
  });

  test("dedupes by key and bumps to front", () => {
    let entries = recordRecentAccess([], {
      scope: "user",
      relPath: "a.md",
      now: new Date("2026-08-25T09:00:00Z"),
    });
    entries = recordRecentAccess(entries, {
      scope: "user",
      relPath: "b.md",
      now: new Date("2026-08-25T09:05:00Z"),
    });
    entries = recordRecentAccess(entries, {
      scope: "user",
      relPath: "a.md",
      now: new Date("2026-08-25T09:10:00Z"),
    });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].key, "user:a.md");
    assert.equal(entries[0].accessedAt, "2026-08-25T09:10:00.000Z");
    assert.equal(entries[1].key, "user:b.md");
  });

  test("caps at 100 entries", () => {
    let entries = [];
    for (let i = 0; i < RECENT_MAX_ENTRIES + 10; i += 1) {
      entries = recordRecentAccess(entries, {
        scope: "user",
        relPath: `n${i}.md`,
        now: new Date(Date.UTC(2026, 0, 1, 0, i)),
      });
    }
    assert.equal(entries.length, RECENT_MAX_ENTRIES);
    // newest (last inserted) at front; oldest evicted
    assert.equal(entries[0].relPath, `n${RECENT_MAX_ENTRIES + 9}.md`);
    assert.ok(!entries.some((item) => item.relPath === "n0.md"));
  });

  test("sortRecentEntries orders newest first", () => {
    const out = sortRecentEntries([
      { key: "user:a.md", accessedAt: "2026-01-01T00:00:00Z" },
      { key: "user:b.md", accessedAt: "2026-03-01T00:00:00Z" },
      { key: "user:c.md", accessedAt: "2026-02-01T00:00:00Z" },
    ]);
    assert.deepEqual(out.map((item) => item.key), ["user:b.md", "user:c.md", "user:a.md"]);
  });

  test("pruneRecentEntries drops entries whose file no longer exists", () => {
    const entries = [
      { key: "user:keep.md", scope: "user", relPath: "keep.md" },
      { key: "user:gone.md", scope: "user", relPath: "gone.md" },
    ];
    const kept = pruneRecentEntries(entries, (scope, relPath) => relPath === "keep.md");
    assert.deepEqual(kept.map((item) => item.relPath), ["keep.md"]);
  });

  test("pruneRecentEntries is a no-op without a predicate", () => {
    const entries = [{ key: "user:keep.md", scope: "user", relPath: "keep.md" }];
    assert.equal(pruneRecentEntries(entries).length, 1);
  });
});

describe("knowledge recent file io", () => {
  test("write then read roundtrips via temp HOME", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-recent-"));
    try {
      let entries = recordRecentAccess([], {
        scope: "user",
        relPath: "a.md",
        now: new Date("2026-08-25T09:00:00Z"),
      });
      entries = recordRecentAccess(entries, {
        scope: "expert",
        relPath: "playbook.md",
        vaultLabel: "Reviewer",
        now: new Date("2026-08-25T10:00:00Z"),
      });
      await writeRecentFile(home, entries);

      const resolved = resolveRecentFilePath(home);
      assert.match(resolved, new RegExp(`${path.sep}\\.onmyagent${path.sep}knowledge${path.sep}recent\\.json$`));

      const loaded = await readRecentFile(home);
      assert.equal(loaded.length, 2);
      assert.equal(loaded[0].key, "expert:playbook.md");
      assert.equal(loaded[0].location, "Reviewer");
      assert.equal(loaded[1].key, "user:a.md");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("missing file yields empty list", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-recent-missing-"));
    try {
      assert.deepEqual(await readRecentFile(home), []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("corrupt JSON yields empty list instead of throwing", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-recent-corrupt-"));
    try {
      const filePath = resolveRecentFilePath(home);
      await import("node:fs/promises").then((fs) =>
        fs.mkdir(path.dirname(filePath), { recursive: true }),
      );
      await writeFile(filePath, "{ not valid json", "utf8");
      assert.deepEqual(await readRecentFile(home), []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
