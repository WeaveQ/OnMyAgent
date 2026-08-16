import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  listVaultsFromConfig,
  normalizeWikilink,
  resolveNoteTarget,
  resolveVaultDir,
} from "./knowledge-target.mjs";

describe("knowledge-target", () => {
  test("normalizes wikilinks like Obsidian file=", () => {
    assert.equal(normalizeWikilink("[[使用说明]]"), "使用说明");
    assert.equal(normalizeWikilink("使用说明.md"), "使用说明");
    assert.equal(normalizeWikilink("  Brief  "), "brief");
  });

  test("resolves vault by name or defaults to the first space", () => {
    const vaults = listVaultsFromConfig("/tmp/knowledge", {
      personalVaultPath: "/tmp/notes/work",
      vaults: [{ name: "personal", path: "/tmp/notes/home" }],
    });
    assert.equal(resolveVaultDir(vaults, "").path, "/tmp/notes/work");
    assert.equal(resolveVaultDir(vaults, "personal").path, "/tmp/notes/home");
    assert.equal(resolveVaultDir(vaults, "missing"), null);
  });

  test("path= is exact and file= is a unique basename", () => {
    const files = [
      { relPath: "guides/intro.md" },
      { relPath: "meetings/intro.md" },
      { relPath: "getting-started.md" },
    ];
    assert.equal(
      resolveNoteTarget({ files, path: "getting-started.md" }).relPath,
      "getting-started.md",
    );
    assert.equal(resolveNoteTarget({ files, file: "intro" }).reason, "ambiguous");
    assert.deepEqual(resolveNoteTarget({ files, file: "intro" }).candidates, [
      "guides/intro.md",
      "meetings/intro.md",
    ]);
    assert.equal(
      resolveNoteTarget({
        files,
        file: "使用说明",
        titles: { "getting-started.md": "使用说明" },
      }).relPath,
      "getting-started.md",
    );
    assert.equal(resolveNoteTarget({ files, path: "../x.md" }).reason, "unsafe_path");
    assert.equal(resolveNoteTarget({ files }).reason, "missing_target");
  });
});
