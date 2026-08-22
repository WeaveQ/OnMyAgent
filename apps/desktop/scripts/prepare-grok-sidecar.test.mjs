import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  GROK_MODIFICATIONS,
  sriMatches,
  stageVerifiedGrokBinary,
  stagedGrokSidecarIsValid,
  targetTriple,
} from "./prepare-grok-sidecar.mjs";
import { GROK_SIDECAR_SOURCE, GROK_SIDECAR_TARGETS, grokSidecarSpec } from "./grok-sidecar-manifest.mjs";

test("pins every supported release target to audited source and strong checksums", () => {
  assert.deepEqual(Object.keys(GROK_SIDECAR_TARGETS).sort(), [
    "aarch64-apple-darwin",
    "aarch64-pc-windows-msvc",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
  ]);
  assert.match(GROK_SIDECAR_SOURCE.publicTreeCommit, /^[a-f0-9]{40}$/);
  assert.match(GROK_SIDECAR_SOURCE.sourceRevision, /^[a-f0-9]{40}$/);
  for (const spec of Object.values(GROK_SIDECAR_TARGETS)) {
    assert.match(spec.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
    assert.match(spec.binarySha256, /^[a-f0-9]{64}$/);
    assert.ok(spec.binarySize > 100_000_000);
  }
});

test("resolves only macOS and Windows product targets", () => {
  assert.equal(targetTriple({}, "darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(targetTriple({}, "win32", "x64"), "x86_64-pc-windows-msvc");
  assert.equal(targetTriple({}, "linux", "x64"), null);
  assert.equal(grokSidecarSpec("aarch64-unknown-linux-gnu"), null);
});

test("rejects modified package and staged binary bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "onmyagent-grok-sidecar-test-"));
  try {
    const archive = join(root, "fixture.tgz");
    writeFileSync(archive, "fixture");
    const integrity = `sha512-${createHash("sha512").update("fixture").digest("base64")}`;
    assert.equal(sriMatches(archive, integrity), true);
    writeFileSync(archive, "changed");
    assert.equal(sriMatches(archive, integrity), false);
    const spec = grokSidecarSpec("aarch64-apple-darwin");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, spec.outputName), brotliCompressSync(Buffer.from("wrong")));
    assert.equal(stagedGrokSidecarIsValid(root, spec), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("records the required prominent modification notice", () => {
  assert.match(GROK_MODIFICATIONS, /unmodified official Grok Build binary/);
  assert.match(GROK_MODIFICATIONS, /external ACP adapter/);
});

test("stages an already downloaded binary only after binary and notices verification", () => {
  const root = mkdtempSync(join(tmpdir(), "onmyagent-grok-binary-cache-test-"));
  try {
    const bytes = Buffer.from("verified-binary");
    const notices = join(root, "notices.md");
    writeFileSync(notices, "verified notices");
    const spec = {
      outputName: "grok-fixture",
      targetTriple: "fixture-target",
      version: "1.0.1",
      packageName: "@xai-official/grok-fixture",
      integrity: "sha512-fixture",
      binarySize: bytes.byteLength,
      binarySha256: createHash("sha256").update(bytes).digest("hex"),
    };
    assert.throws(
      () => stageVerifiedGrokBinary({ bytes, notices, outdir: root, spec }),
      /notices mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
