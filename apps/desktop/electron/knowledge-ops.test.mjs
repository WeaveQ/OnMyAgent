import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  knowledgeAppendNote,
  knowledgeCreateNote,
  knowledgeReadNote,
  knowledgeSetProperty,
} from "./knowledge-ops.mjs";

describe("knowledge-ops", () => {
  test("read / create / append / property against a temp vault", async () => {
    const root = await mkdir(path.join(os.tmpdir(), `oma-kops-${Date.now()}`), { recursive: true });
    const vault = path.join(root, "vault");
    await mkdir(vault, { recursive: true });
    await writeFile(path.join(vault, "使用说明.md"), "# 使用说明\n\nHello vault.\n", "utf8");
    try {
      const read = await knowledgeReadNote({
        knowledgeRoot: root,
        file: "使用说明",
      });
      assert.equal(read.ok, true);
      assert.match(read.content, /Hello vault/);

      const created = await knowledgeCreateNote({
        knowledgeRoot: root,
        name: "meetings/standup",
        content: "# Standup\n\nEmpty.\n",
      });
      assert.equal(created.ok, true);
      assert.equal(created.relPath, "meetings/standup.md");

      const appended = await knowledgeAppendNote({
        knowledgeRoot: root,
        path: "meetings/standup.md",
        content: "- shipped knowledge tools\n",
      });
      assert.equal(appended.ok, true);
      const after = await knowledgeReadNote({
        knowledgeRoot: root,
        path: "meetings/standup.md",
      });
      assert.match(after.content, /shipped knowledge tools/);

      const tagged = await knowledgeSetProperty({
        knowledgeRoot: root,
        file: "standup",
        name: "tags",
        value: "work,vault",
      });
      assert.equal(tagged.ok, true);
      const withProps = await knowledgeReadNote({
        knowledgeRoot: root,
        file: "standup",
      });
      assert.match(withProps.content, /tags:/);
      assert.match(withProps.content, /work/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
