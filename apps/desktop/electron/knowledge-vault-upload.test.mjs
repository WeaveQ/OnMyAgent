import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createKnowledgeFolder,
  safeJoinUnderScope,
  uploadKnowledgeFiles,
  uploadKnowledgeFolder,
} from "./knowledge-vault-upload.mjs";

async function withHome(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kb-upload-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("safeJoinUnderScope rejects path traversal", () => {
  const scope = "/vault";
  assert.throws(() => safeJoinUnderScope(scope, "", "../evil.md"), /invalid_path/);
  assert.throws(() => safeJoinUnderScope(scope, "sub", "../../evil.md"), /invalid_path/);
  assert.throws(() => safeJoinUnderScope(scope, "", "foo/../bar/../../evil.md"), /invalid_path/);
  assert.throws(() => safeJoinUnderScope(scope, "", "a/../../etc/passwd"), /invalid_path/);
});

test("safeJoinUnderScope allows nested safe names", () => {
  const scope = "/vault";
  const joined = safeJoinUnderScope(scope, "a/b", "note.md");
  assert.equal(joined, path.join("/vault", "a", "b", "note.md"));
});

test("createKnowledgeFolder creates nested directories", async () => {
  await withHome(async (home) => {
    const result = await createKnowledgeFolder({
      homeDir: home,
      scope: "user",
      relPath: "work/projects",
    });
    assert.equal(result.ok, true);
    const vault = path.join(home, ".onmyagent", "data", "user", "knowledge", "vault");
    await assert.doesNotReject(readFile(path.join(vault, "work", "projects", ".keep")).catch(() => {
      // directory existence check; mkdir ensures it
    }));
    const stat = await import("node:fs/promises").then((fs) =>
      fs.stat(path.join(vault, "work", "projects")),
    );
    assert.ok(stat.isDirectory());
  });
});

test("uploadKnowledgeFiles writes files and rejects unsafe names", async () => {
  await withHome(async (home) => {
    const result = await uploadKnowledgeFiles({
      homeDir: home,
      scope: "user",
      destFolder: "inbox",
      files: [
        { name: "hello.md", dataBase64: Buffer.from("# hi", "utf8").toString("base64") },
        { name: "../escape.md", dataBase64: Buffer.from("x", "utf8").toString("base64") },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].ok, false);
    const vault = path.join(home, ".onmyagent", "data", "user", "knowledge", "vault");
    const written = await readFile(path.join(vault, "inbox", "hello.md"), "utf8");
    assert.equal(written, "# hi");
  });
});

test("uploadKnowledgeFolder preserves relative entries", async () => {
  await withHome(async (home) => {
    const src = await mkdtemp(path.join(os.tmpdir(), "kb-src-"));
    await mkdir(path.join(src, "sub"), { recursive: true });
    await writeFile(path.join(src, "a.md"), "A");
    await writeFile(path.join(src, "sub", "b.md"), "B");
    try {
      const result = await uploadKnowledgeFolder({
        homeDir: home,
        scope: "user",
        destFolder: "imported",
        entries: [
          { relPath: "a.md", dataBase64: Buffer.from("A").toString("base64") },
          { relPath: "sub/b.md", dataBase64: Buffer.from("B").toString("base64") },
          { relPath: "../bad.md", dataBase64: Buffer.from("x").toString("base64") },
        ],
      });
      assert.equal(result.results[0].ok, true);
      assert.equal(result.results[1].ok, true);
      assert.equal(result.results[2].ok, false);
      const vault = path.join(home, ".onmyagent", "data", "user", "knowledge", "vault");
      assert.equal(await readFile(path.join(vault, "imported", "a.md"), "utf8"), "A");
      assert.equal(await readFile(path.join(vault, "imported", "sub", "b.md"), "utf8"), "B");
    } finally {
      await rm(src, { recursive: true, force: true });
    }
  });
});
