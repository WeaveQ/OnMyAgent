import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { extractZipEntry } from "./archive.mjs";

test("extractZipEntry pulls a single entry out of a zip", async () => {
  if (process.platform === "win32") {
    // Covered on CI Windows via Expand-Archive path; keep local mac/linux fast path.
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-managed-cli-zip-"));
  try {
    const payload = path.join(root, "officecli-mac-arm64");
    const zipPath = path.join(root, "payload.zip");
    const dest = path.join(root, "out-binary");
    await writeFile(payload, "binary-bytes\n", "utf8");
    execFileSync("zip", ["-j", zipPath, payload], { stdio: "ignore" });
    await extractZipEntry({
      archivePath: zipPath,
      entryName: "officecli-mac-arm64",
      destPath: dest,
      platform: process.platform,
    });
    assert.equal(await readFile(dest, "utf8"), "binary-bytes\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
