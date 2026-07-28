import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listCodeWorkspaceFiles,
  readCodeWorkspaceBinaryFile,
  readCodeWorkspaceFile,
} from "./code-workspace-files.mjs";

test("lists and reads files inside the selected workspace", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "onmyagent-files-"));
  try {
    await mkdir(path.join(workspacePath, "src"));
    await writeFile(path.join(workspacePath, "README.md"), "hello");
    await writeFile(path.join(workspacePath, "src", "index.ts"), "export {}");
    const root = await listCodeWorkspaceFiles({ workspacePath });
    assert.deepEqual(
      root.items.map((item) => [item.name, item.kind]),
      [["src", "dir"], ["README.md", "file"]],
    );
    const nested = await listCodeWorkspaceFiles({
      workspacePath,
      relativePath: "src",
    });
    assert.equal(nested.items[0]?.path, "src/index.ts");
    const deep = await listCodeWorkspaceFiles({
      workspacePath,
      recursive: true,
    });
    assert.ok(deep.items.some((item) => item.path === "src/index.ts"));
    assert.ok(deep.items.some((item) => item.path === "src" && item.kind === "dir"));
    const content = await readCodeWorkspaceFile({
      workspacePath,
      relativePath: "src/index.ts",
    });
    assert.equal(content.content, "export {}");
    await writeFile(path.join(workspacePath, "sample.bin"), Uint8Array.from([0, 1, 2, 255]));
    const binary = await readCodeWorkspaceBinaryFile({
      workspacePath,
      relativePath: "sample.bin",
    });
    assert.deepEqual(Array.from(binary.data), [0, 1, 2, 255]);
    assert.equal(binary.bytes, 4);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("rejects paths outside the selected workspace", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "onmyagent-files-"));
  try {
    await assert.rejects(
      readCodeWorkspaceFile({
        workspacePath,
        relativePath: "../outside.txt",
      }),
      /outside the selected directory/,
    );
    await assert.rejects(
      readCodeWorkspaceBinaryFile({
        workspacePath,
        relativePath: "../outside.bin",
      }),
      /outside the selected directory/,
    );
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
