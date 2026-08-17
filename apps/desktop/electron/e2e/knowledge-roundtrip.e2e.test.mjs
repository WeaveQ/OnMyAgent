/**
 * Knowledge vault roundtrip e2e (no live model).
 *
 * Live smoke: knowledge_search("Getting started") returned hits=[] because the
 * seed title is "Knowledge vault" and the filename uses a hyphen. A unique
 * token planted in the same vault the generated plugin embeds must hit.
 */
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { after, describe, test } from "node:test";

import {
  executeKnowledgeSearch,
} from "../knowledge-search-plugin.mjs";
import { writeKnowledgeFile } from "../knowledge-vault-io.mjs";
import { resolveKnowledgeRoot } from "../knowledge-vault-paths.mjs";
import { createDesktopE2eSandbox } from "./sandbox.mjs";

const TOKEN = "oma-realcase-token-d6fa";
const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

describe("desktop knowledge vault roundtrip e2e", () => {
  test("generated plugin ROOT searches the planted user-vault note", async () => {
    const sandbox = await createDesktopE2eSandbox({
      prefix: "oma-desktop-knowledge-e2e-",
    });
    roots.push(sandbox.root);

    const planted = await writeKnowledgeFile({
      homeDir: sandbox.realHome,
      scope: "user",
      relPath: "real-case-token.md",
      content: `# Real case token\n\nUnique search token: ${TOKEN}\n`,
    });
    assert.equal(planted.ok, true);

    const config = JSON.parse(
      await readFile(sandbox.paths.opencodeConfigPath, "utf8"),
    );
    const pluginPath = config.plugin.find((item) =>
      String(item).endsWith("knowledge-search.mjs"),
    );
    assert.ok(pluginPath, "knowledge-search.mjs missing from sandbox config");
    const source = await readFile(pluginPath, "utf8");
    const knowledgeRoot = resolveKnowledgeRoot(sandbox.realHome);
    assert.match(source, new RegExp(knowledgeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const result = await executeKnowledgeSearch({
      knowledgeRoot,
      query: TOKEN,
      env: {},
    });
    assert.equal(result.ok, true);
    assert.ok(
      result.hits.some(
        (hit) => hit.relPath === "real-case-token.md" && hit.scope === "user",
      ),
      `expected planted note, got ${JSON.stringify(result.hits)}`,
    );
    assert.ok(
      result.hits.some((hit) => String(hit.snippet ?? "").includes(TOKEN)),
      `snippet missing token: ${JSON.stringify(result.hits)}`,
    );
  });
});
