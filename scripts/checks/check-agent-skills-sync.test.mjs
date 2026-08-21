import assert from "node:assert/strict";
import { lstatSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const expected = "../.agents/skills";
const harnesses = [".codex/skills", ".claude/skills", ".grok/skills", ".cursor/skills"];

describe("agent skill harness sync", () => {
  test("Codex, Claude, Grok, and Cursor skills are symlinks to .agents/skills", () => {
    for (const rel of harnesses) {
      const target = join(root, rel);
      assert.equal(lstatSync(target).isSymbolicLink(), true, `${rel} must be a symlink`);
      assert.equal(readlinkSync(target), expected, `${rel} must point at ${expected}`);
    }
  });
});
