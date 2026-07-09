import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeJsonFile } from "./utils.mjs";

test("writeJsonFile survives concurrent writers to same target (no ENOENT rename race)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "onmyagent-writejson-"));
  try {
    const target = path.join(dir, "session.json");
    const N = 20;
    const jobs = Array.from({ length: N }, (_, i) => writeJsonFile(target, { i, at: Date.now() }));
    const results = await Promise.allSettled(jobs);
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(rejected.length, 0, `expected no rejections, got ${rejected.length}: ${rejected.map((r) => r.reason?.message).join(", ")}`);
    const parsed = JSON.parse(await readFile(target, "utf8"));
    assert.ok(typeof parsed.i === "number" && parsed.i >= 0 && parsed.i < N, "final content should be one of the writes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
